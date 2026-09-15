// /api/distance — driving miles between your shop and a venue.
//
//   GET  /api/distance?to=<address>          look it up (admin only)
//   GET  /api/distance?to=<address>&fresh=1  ignore the cache, ask again
//   GET  /api/distance?origin=1              read the saved shop address
//   POST /api/distance?origin=1  { origin }  set it
//
// SETUP: run sql/setup-distance.sql, add GOOGLE_MAPS_API_KEY to Vercel.
//
// THE KEY NEVER LEAVES THE SERVER
//   A Maps key in browser JavaScript is readable by anyone who opens dev
//   tools, and Google bills the project it belongs to. Keys scraped off
//   client-side pages are a well-known way to wake up to a four-figure
//   invoice. Every call here is made from this function; the browser only ever
//   sees a number of miles.
//
// WHY IT CACHES
//   Google bills per request and does NOT stop at a budget — alerts tell you
//   after the money is gone. The same shop → venue pair is asked for again on
//   every quote revision, so a venue quoted five times must cost one lookup,
//   not five. The cache is the cost control, not a speed tweak.
import { json, readBody, auth, isAdmin, supabaseRest } from "./_lib.js";

const KEY = process.env.GOOGLE_MAPS_API_KEY;
const SETTINGS_KEY = "trucking_origin";
const RATES_KEY = "trucking_rates";
const METERS_PER_MILE = 1609.344;

/* What a new quote starts its trucking lines at, until Tyler sets his own.
   These are the numbers that were hardcoded in the quote editor before there
   was anywhere to change them. */
const RATE_FALLBACK = { van: 0.75, box: 3, semi: 4 };
const VEHICLES = ["van", "box", "semi"];

/* Address in, cache key out. Collapses the differences that are not
   differences — case, punctuation, runs of whitespace — so "600 Stockton St."
   and "600 stockton st" are one paid lookup rather than two. */
export function addrKey(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* Google answers in metres. Everything downstream — the rates, the quote line,
   what Tyler types today — is miles, so the conversion happens once, here, and
   the rest of the app never sees a metre. */
export const metersToMiles = (m) => Math.round((Number(m) / METERS_PER_MILE) * 10) / 10;

async function loadOrigin() {
  try {
    const rows = await supabaseRest(
      "GET", "/app_settings?key=eq." + SETTINGS_KEY + "&select=value", null);
    const v = rows && rows[0] ? rows[0].value : null;
    return (v && typeof v === "object" && typeof v.origin === "string") ? v.origin : "";
  } catch { return ""; }
}

/* `?on_conflict=key` is not optional, and its absence would not show up until
   the SECOND save — i.e. the first time the shop address is changed rather than
   set. Without it PostgREST infers the conflict target from the primary key; if
   that is `id` rather than `key`, an upsert with no id looks like a fresh
   insert and dies on the unique constraint over `key`. Naming the target makes
   it correct under either table shape, and matches what every other writer to
   this table does. `updated_at` likewise — three other call sites send it. */
async function saveOrigin(origin) {
  await supabaseRest(
    "POST", "/app_settings?on_conflict=key",
    { key: SETTINGS_KEY, value: { origin }, updated_at: new Date().toISOString() },
    "resolution=merge-duplicates");
}

/* ---- default $/mile per vehicle ------------------------------------------
   Company-wide, and only a STARTING point: a quote that already carries its
   own rates keeps them, so changing these can never reprice a quote already
   sent. That is the whole reason they are defaults rather than a live lookup. */
async function loadRates() {
  try {
    const rows = await supabaseRest(
      "GET", "/app_settings?key=eq." + RATES_KEY + "&select=value", null);
    const v = (rows && rows[0] && rows[0].value) || null;
    const out = {};
    for (const k of VEHICLES) {
      /* A stored zero is a real answer — "we don't charge for the van" — so it
         must survive, and a missing one must not become one. That rules out
         Number() on its own: Number(null) and Number("") are both 0, so an
         unset row would read back as "every vehicle is free" and quietly price
         every future truck line at nothing. Absence is checked first, by hand,
         and only then is the value converted. */
      const raw = v ? v[k] : undefined;
      if (raw === undefined || raw === null || raw === "") { out[k] = RATE_FALLBACK[k]; continue; }
      const n = Number(raw);
      out[k] = isFinite(n) && n >= 0 ? n : RATE_FALLBACK[k];
    }
    return out;
  } catch { return { ...RATE_FALLBACK }; }
}

function cleanRates(b) {
  // Same Number(null) === 0 trap as loadRates, in the other direction: with no
  // body at all, `Number(b && b[k])` is 0 three times over and this would
  // cheerfully save "everything is free".
  if (!b || typeof b !== "object") return { error: "No rates were sent." };
  const out = {};
  for (const k of VEHICLES) {
    const raw = b[k];
    if (raw === undefined || raw === null || raw === "") {
      return { error: "The " + k + " rate is missing." };
    }
    const n = Number(raw);
    if (!isFinite(n) || n < 0) {
      // Refused, never silently zeroed — a rate quietly set to 0 prices every
      // future truck line at nothing, and nothing on screen would say so.
      return { error: "That " + k + " rate is not a number I can use." };
    }
    if (n > 100) return { error: "That " + k + " rate looks wrong — over $100 a mile." };
    out[k] = Math.round(n * 100) / 100;
  }
  return { rates: out };
}

async function saveRates(rates) {
  await supabaseRest(
    "POST", "/app_settings?on_conflict=key",
    { key: RATES_KEY, value: rates, updated_at: new Date().toISOString() },
    "resolution=merge-duplicates");
}

/* One paid call, and deliberately the cheapest kind Google sells.

   The SKU is decided by what the REQUEST asks for, not by the size of the
   response. Three things would move this off "Compute Routes Essentials" and
   none of them are here: a routingPreference of TRAFFIC_AWARE or
   TRAFFIC_AWARE_OPTIMAL (omitted, so it defaults to traffic-unaware — we want
   a stable cacheable mileage, not a live-traffic estimate), more than ten
   waypoints (there are two), and waypoint optimisation (not asked for).

   The field mask is therefore about keeping the payload small and the parsing
   honest, not about the bill: only the two numbers actually used. */
async function askGoogle(from, to) {
  const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": KEY,
      "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
    },
    body: JSON.stringify({
      origin: { address: from },
      destination: { address: to },
      travelMode: "DRIVE",
      units: "IMPERIAL",
    }),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = (data && data.error && data.error.message) || ("Maps error " + r.status);
    const e = new Error(msg);
    e.status = r.status;
    throw e;
  }
  const route = data && Array.isArray(data.routes) && data.routes[0];
  if (!route || typeof route.distanceMeters !== "number") {
    throw new Error("No driving route found between those two addresses.");
  }
  return {
    meters: route.distanceMeters,
    seconds: parseInt(String(route.duration || "0").replace(/[^0-9]/g, ""), 10) || null,
  };
}

export default async function handler(req, res) {
  const p = auth(req);
  /* Quoting is admin work and every call spends money. Nothing here is
     reachable by a crew token or a show password. */
  if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });

  const q = req.query || {};

  /* ---- the shop address, OUTSIDE the never-throw guard --------------------
     The lookup below deliberately turns every failure into a 200 so a Maps
     outage can never block a quote. That bargain is wrong for a settings
     write: "saved" when nothing was saved is the worst answer available,
     because the screen closes, the address looks set, and the next lookup asks
     for it again with no explanation. A save that fails says so. */
  if (q.origin) {
    if (req.method === "GET") {
      // Reading is different again: an unreadable setting reads as unset, which
      // is what loadOrigin already does, and the caller then prompts for it.
      return json(res, 200, { origin: await loadOrigin() });
    }
    if (req.method === "POST") {
      const b = await readBody(req);
      const origin = String((b && b.origin) || "").trim().slice(0, 300);
      try {
        await saveOrigin(origin);
      } catch (e) {
        return json(res, 500, { error: "Could not save that address: " + (e.message || "unknown error") });
      }
      return json(res, 200, { ok: true, origin });
    }
    return json(res, 405, { error: "Method not allowed" });
  }

  // ---- default truck rates, same honesty rules as the address --------------
  if (q.rates) {
    if (req.method === "GET") return json(res, 200, { rates: await loadRates() });
    if (req.method === "POST") {
      const b = await readBody(req);
      const { rates, error } = cleanRates((b && b.rates) || b);
      if (error) return json(res, 400, { error });
      try {
        await saveRates(rates);
      } catch (e) {
        return json(res, 500, { error: "Could not save those rates: " + (e.message || "unknown error") });
      }
      return json(res, 200, { ok: true, rates });
    }
    return json(res, 405, { error: "Method not allowed" });
  }

  try {
    if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });

    const to = String(q.to || "").trim();
    if (!to) return json(res, 400, { error: "Where to?" });

    const from = String(q.from || "").trim() || await loadOrigin();
    if (!from) {
      return json(res, 400, {
        error: "No origin set. Add your shop address before looking up distances.",
        needsOrigin: true,
      });
    }

    const oKey = addrKey(from);
    const dKey = addrKey(to);
    if (oKey === dKey) return json(res, 200, { miles: 0, roundTrip: 0, cached: false, same: true });

    // ---- the cache --------------------------------------------------------
    if (!q.fresh) {
      try {
        const hit = await supabaseRest(
          "GET",
          "/distance_cache?origin_key=eq." + encodeURIComponent(oKey) +
            "&dest_key=eq." + encodeURIComponent(dKey) +
            "&select=meters,seconds,origin_resolved,dest_resolved,created_at&limit=1",
          null);
        const row = hit && hit[0];
        if (row) {
          const miles = metersToMiles(row.meters);
          return json(res, 200, {
            miles, roundTrip: Math.round(miles * 2 * 10) / 10,
            minutes: row.seconds ? Math.round(row.seconds / 60) : null,
            cached: true, lookedUpAt: row.created_at, from, to,
          });
        }
      } catch { /* a cache that cannot be read is a slow day, not a failure */ }
    }

    if (!KEY) {
      return json(res, 503, {
        error: "Distance lookup is not configured — GOOGLE_MAPS_API_KEY is missing.",
        needsKey: true,
      });
    }

    const got = await askGoogle(from, to);
    const miles = metersToMiles(got.meters);

    /* Write the cache AFTER a successful answer, and never let a cache write
       failure lose the number Tyler just paid for. */
    try {
      await supabaseRest(
        "POST", "/distance_cache",
        { origin_key: oKey, dest_key: dKey, meters: got.meters, seconds: got.seconds,
          origin_resolved: from, dest_resolved: to },
        "resolution=merge-duplicates");
    } catch { /* already cached by a concurrent call, or a bad day */ }

    return json(res, 200, {
      miles,
      roundTrip: Math.round(miles * 2 * 10) / 10,
      minutes: got.seconds ? Math.round(got.seconds / 60) : null,
      cached: false, from, to,
    });
  } catch (e) {
    /* Never break a quote over this. The modal keeps its typed-miles box, and
       a failed lookup must read as "type it yourself" rather than an error
       with no way forward. */
    return json(res, 200, {
      error: e.message || "Could not work out the distance.",
      failed: true,
    });
  }
}
