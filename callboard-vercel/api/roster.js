// /api/roster — global crew roster. One Supabase row per person.
// A special row named "__positions__" stores the admin-managed position list.
//
// GET                  list crew (excludes the config row)
// GET ?positions=1     return only the positions array
// GET ?new=1           crew who joined via the onboarding form and have not
//                      been reviewed yet (admin only) — powers the home screen
// POST                 create/update crew member (admin only)
// POST ?positions=1    save positions array (admin only)  body: { positions: [...] }
// POST ?reviewed=<id>  clear one person off the New crew list (admin only)
// DELETE ?id=          delete crew member (admin only)
//
// SETUP: run setup-roster.sql.
//
// Moved off Airtable. The routes, the request bodies and the response shapes
// are byte-for-byte what they were, so nothing in the front end changes: the
// only visible difference is that `id` is now a uuid rather than an Airtable
// record id, and both are opaque to the caller.
import { json, readBody, auth, isAdmin, supabaseRest, logActivity } from "./_lib.js";

const POS_KEY = "__positions__";
const COLS = "id,name,data";

/* Exported so /api/onboard uses the same fallback. Two copies of this list is
   how the onboarding form ends up offering positions the roster screen has
   never heard of, on exactly the day the config row goes missing. */
export const DEFAULT_POSITIONS = [
  "Show Caller","Production Manager","Stage Manager",
  "Technical Director","Video Director",
  "Audio Engineer (A1)","Monitor Engineer (A2)",
  "Camera Operator","Camera TD","Graphics Operator",
  "Lighting Designer","Lighting Tech","LED Tech",
  "Record Op","Playback Operator",
  "Rigging Supervisor","Rigger",
];

/* The column is jsonb, so it comes back as an object already. Older rows
   written while this lived in Airtable may still hold a JSON *string*, so both
   are accepted — a roster that half-parses is worse than one that is slow. */
function asData(v) {
  if (v && typeof v === "object") return v;
  if (typeof v === "string") { try { return JSON.parse(v) || {}; } catch { return {}; } }
  return {};
}

const rosterRecord = (r) => ({ id: r.id, name: r.name || "", data: asData(r.data) });

/* The home screen's view of a new arrival — deliberately NOT the full record.
   `rosterRecord` carries date of birth, passport expiry, TSA PreCheck number,
   phone, emergency contact and the agreed rate. The Today screen is the one
   view that sits open all day, on whatever machine is to hand, and it needs
   none of that to answer "who turned up and do I need to do something".
   So this is the short list: who, what they can do, what they want, how to
   reply. Anything more is one click away on the crew tab, behind the same
   admin check. */
const newCrewRecord = (r) => {
  const d = asData(r.data);
  const list = Array.isArray(d.positions) ? d.positions : (d.position ? [d.position] : []);
  return {
    id: r.id,
    name: r.name || "",
    positions: list.filter(Boolean).map(String),
    positionSuggest: d.positionSuggest || "",
    rateAsk: d.rateAsk || "",
    rateAskType: d.rateAskType === "hourly" ? "hourly" : "day",
    email: d.email || "",
    joinedAt: d.joinedAt || "",
  };
};

async function getPositionsRow() {
  const rows = await supabaseRest(
    "GET", `/roster?name=eq.${encodeURIComponent(POS_KEY)}&select=${COLS}&limit=1`, null);
  return (rows && rows[0]) || null;
}

export default async function handler(req, res) {
  const p = auth(req);
  if (!p) return json(res, 401, { error: "Not signed in" });
  const id = req.query?.id;
  const posMode = !!(req.query?.positions);
  const newMode = !!(req.query?.new);
  const reviewedId = req.query?.reviewed;

  try {
    /* ---- GET ---- */
    if (req.method === "GET") {
      if (posMode) {
        const row = await getPositionsRow();
        const d = row ? asData(row.data) : null;
        const stored = d && Array.isArray(d.positions) ? d.positions : null;
        return json(res, 200, { positions: stored && stored.length ? stored : DEFAULT_POSITIONS });
      }
      /* THE CREW LIST IS TCG-ADMIN ONLY.
       *
       * It carries every crew member's rate, phone, email and emergency
       * contact, and until v1.30.0 any signed-in account could read the lot —
       * writes were gated, reads were not. Since almost everyone now has an
       * account rather than a show password, that was most of the company able
       * to read everyone else's pay.
       *
       * isAdmin() is a TCG admin or the master admin password. A show password
       * with level=admin is NOT covered, deliberately, and that matches the
       * rule BriefTravel already states in App.jsx: "a producer holding a show
       * admin password should not get the crew's dates of birth and KTNs."
       *
       * The POSITIONS branch above stays open on purpose. It is a list of job
       * titles, it is about no one, and the crew tab's dropdown needs it. */
      if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });

      /* ---- the home screen's New crew list ----
         Two conditions, and both matter:

         joinedAt NOT NULL    — the row was created by a public onboarding
                                submission. Crew Tyler types in himself have
                                no joinedAt and never appear here, because
                                telling him about someone he just added is
                                noise, not a notification.
         reviewedAt IS NULL   — he has not cleared them yet. There is no time
                                window on purpose: a person who joined three
                                weeks ago and was never looked at is still
                                someone who was never looked at, and quietly
                                ageing them off the screen would be the app
                                deciding that on his behalf. */
      if (newMode) {
        const rows = await supabaseRest(
          "GET",
          "/roster?data->>joinedAt=not.is.null&data->>reviewedAt=is.null" +
            `&name=neq.${encodeURIComponent(POS_KEY)}` +
            `&select=${COLS}&order=data->>joinedAt.desc&limit=50`,
          null
        );
        return json(res, 200, { crew: (rows || []).map(newCrewRecord) });
      }

      // List crew, excluding the special config row.
      const rows = await supabaseRest(
        "GET",
        `/roster?name=neq.${encodeURIComponent(POS_KEY)}&select=${COLS}&order=name.asc&limit=2000`,
        null
      );
      return json(res, 200, (rows || []).map(rosterRecord));
    }

    /* ---- POST ---- */
    if (req.method === "POST") {
      if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });

      /* Clear one person off the New crew list.
         Handled BEFORE readBody, because this carries no body — and a merge,
         never a replace. The plain create/update branch below overwrites
         `data` wholesale with what the caller sent; doing that here would
         blank the rate, the notes and every field the onboarding form does
         not collect, in exchange for one timestamp. */
      if (reviewedId) {
        const enc = encodeURIComponent(reviewedId);
        const rows = await supabaseRest(
          "GET", `/roster?id=eq.${enc}&name=neq.${encodeURIComponent(POS_KEY)}&select=id,data&limit=1`, null);
        if (!rows || !rows[0]) return json(res, 404, { error: "Not found" });
        const merged = { ...asData(rows[0].data), reviewedAt: new Date().toISOString() };
        await supabaseRest("PATCH", `/roster?id=eq.${enc}`,
          { data: merged, updated_at: new Date().toISOString() });
        return json(res, 200, { ok: true, id: reviewedId });
      }

      const b = await readBody(req);

      if (posMode) {
        /* Save the positions list. Deduplicated and trimmed here rather than in
           the browser, because /api/onboard reads this list to decide which
           positions a public submission is allowed to claim — a blank or
           duplicated entry would quietly widen that check. */
        const seen = new Set();
        const clean = (Array.isArray(b.positions) ? b.positions : [])
          .map((x) => String(x || "").trim())
          .filter((x) => {
            if (!x) return false;
            const k = x.toLowerCase();
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          })
          .slice(0, 200);

        const existing = await getPositionsRow();
        const payload = { name: POS_KEY, data: { positions: clean }, updated_at: new Date().toISOString() };
        if (existing) {
          await supabaseRest("PATCH", `/roster?id=eq.${encodeURIComponent(existing.id)}`, payload);
        } else {
          await supabaseRest("POST", "/roster", payload, "return=minimal");
        }
        return json(res, 200, { ok: true });
      }

      // Create / update crew member
      const name = (b.name || "").trim();
      if (!name) return json(res, 400, { error: "Name required" });
      if (name === POS_KEY) return json(res, 400, { error: "Reserved name" });

      const payload = { name, data: b.data || {}, updated_at: new Date().toISOString() };
      if (b.id) {
        await supabaseRest("PATCH", `/roster?id=eq.${encodeURIComponent(b.id)}`, payload);
        return json(res, 200, { ok: true, id: b.id });
      }
      const made = await supabaseRest("POST", `/roster?select=${COLS}`, payload, "return=representation");
      /* Added, not edited. An edit to somebody already on the roster is a
         detail change and does not belong in a feed; a new person joining is
         news. Note the NAME only — the roster row carries rates and contact
         details and none of that goes into a log. */
      await logActivity(p, "crew.added", "Crew member added: " + name,
        { actorName: (b && String(b.actorName || "").trim()) || "",
          meta: { rosterId: (made && made[0] && made[0].id) || null } });
      return json(res, 200, rosterRecord((made && made[0]) || { id: null, name, data: payload.data }));
    }

    /* ---- DELETE ---- */
    if (req.method === "DELETE") {
      if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
      if (!id) return json(res, 400, { error: "id required" });
      /* Belt and braces: the config row is not a person and deleting it would
         silently reset everyone's position list to the defaults. */
      await supabaseRest(
        "DELETE",
        `/roster?id=eq.${encodeURIComponent(id)}&name=neq.${encodeURIComponent(POS_KEY)}`,
        null
      );
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: "Method not allowed" });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || "Server error" });
  }
}
