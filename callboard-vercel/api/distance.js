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
const METERS_PER_MILE = 1609.344;

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

async function saveOrigin(origin) {
  await supabaseRest(
    "POST", "/app_settings",
    { key: SETTINGS_KEY, value: { origin } },
    "resolution=merge-duplicates");
}

/* One paid call. Routes API rather than Distance Matrix: for a single pair it
   is the cheaper SKU, and the field mask keeps the response to the two numbers
   actually wanted — Google charges more for responses carrying more. */
async function askGoogle(from, to) {
  const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": KEY,
      "X-Goog-FieldMask":
        "routes.distanceMeters,routes.duration,routes.legs.startLocation,routes.legs.endLocation",
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

  try {
    // ---- the shop address -------------------------------------------------
    if (q.origin) {
      if (req.method === "GET") return json(res, 200, { origin: await loadOrigin() });
      if (req.method === "POST") {
        const b = await readBody(req);
        const origin = String((b && b.origin) || "").trim().slice(0, 300);
        await saveOrigin(origin);
        return json(res, 200, { ok: true, origin });
      }
      return json(res, 405, { error: "Method not allowed" });
    }

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
