// /api/roster — global crew roster. One Supabase row per person.
// A special row named "__positions__" stores the admin-managed position list.
//
// GET                  list crew (excludes the config row)
// GET ?positions=1     return only the positions array
// POST                 create/update crew member (admin only)
// POST ?positions=1    save positions array (admin only)  body: { positions: [...] }
// DELETE ?id=          delete crew member (admin only)
//
// SETUP: run setup-roster.sql. If you are coming from Airtable, run
// POST /api/migrate first — it copies the Roster table across, including the
// __positions__ row — and only then deploy this file.
//
// Moved off Airtable. The routes, the request bodies and the response shapes
// are byte-for-byte what they were, so nothing in the front end changes: the
// only visible difference is that `id` is now a uuid rather than an Airtable
// record id, and both are opaque to the caller.
import { json, readBody, auth, isAdmin, supabaseRest } from "./_lib.js";

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

  try {
    /* ---- GET ---- */
    if (req.method === "GET") {
      if (posMode) {
        const row = await getPositionsRow();
        const d = row ? asData(row.data) : null;
        const stored = d && Array.isArray(d.positions) ? d.positions : null;
        return json(res, 200, { positions: stored && stored.length ? stored : DEFAULT_POSITIONS });
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
