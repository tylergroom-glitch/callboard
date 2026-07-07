// /api/roster — global crew roster. One Airtable record per person.
// A special record named "__positions__" stores the admin-managed position list.
//
// GET                  list crew + positions list
// GET ?positions=1     return only the positions array
// POST                 create/update crew member (admin only)
// POST ?positions=1    save positions array (admin only)  body: { positions: [...] }
// DELETE ?id=          delete crew member (admin only)
//
// SETUP: table named "Roster" with fields: Name (primary text), Data (long text).
import { json, readBody, auth, isAdmin, airtableTable } from "./_lib.js";

const TABLE = process.env.AIRTABLE_ROSTER_TABLE || "Roster";
const POS_KEY = "__positions__";

const DEFAULT_POSITIONS = [
  "Show Caller","Production Manager","Stage Manager",
  "Technical Director","Video Director",
  "Audio Engineer (A1)","Monitor Engineer (A2)",
  "Camera Operator","Camera TD","Graphics Operator",
  "Lighting Designer","Lighting Tech","LED Tech",
  "Record Op","Playback Operator",
  "Rigging Supervisor","Rigger",
];

function rosterRecord(rec) {
  const f = rec.fields || {};
  let data = {};
  try { data = f.Data ? JSON.parse(f.Data) : {}; } catch {}
  return { id: rec.id, name: f.Name || "", data };
}

async function getPositionsRecord() {
  const enc = encodeURIComponent(`{Name}='${POS_KEY}'`);
  const d = await airtableTable(TABLE, "GET", `?filterByFormula=${enc}&maxRecords=1`);
  return d.records?.[0] || null;
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
        const rec = await getPositionsRecord();
        let positions = DEFAULT_POSITIONS;
        if (rec?.fields?.Data) {
          try { positions = JSON.parse(rec.fields.Data); } catch {}
        }
        return json(res, 200, { positions });
      }
      // List crew, excluding the special config record
      const out = [];
      let offset;
      do {
        const d = await airtableTable(TABLE, "GET", offset ? `?offset=${offset}` : "");
        for (const r of d.records) {
          if (r.fields?.Name !== POS_KEY) out.push(rosterRecord(r));
        }
        offset = d.offset;
      } while (offset);
      out.sort((a, b) => a.name.localeCompare(b.name));
      return json(res, 200, out);
    }

    /* ---- POST ---- */
    if (req.method === "POST") {
      if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
      const b = await readBody(req);

      if (posMode) {
        // Save positions list
        const fields = { Name: POS_KEY, Data: JSON.stringify(b.positions || []) };
        const existing = await getPositionsRecord();
        if (existing) await airtableTable(TABLE, "PATCH", "/" + existing.id, { fields });
        else await airtableTable(TABLE, "POST", "", { fields });
        return json(res, 200, { ok: true });
      }

      // Create / update crew member
      const name = (b.name || "").trim();
      if (!name) return json(res, 400, { error: "Name required" });
      const fields = { Name: name, Data: JSON.stringify(b.data || {}) };
      if (b.id) {
        await airtableTable(TABLE, "PATCH", "/" + b.id, { fields });
        return json(res, 200, { ok: true, id: b.id });
      }
      const rec = await airtableTable(TABLE, "POST", "", { fields });
      return json(res, 200, rosterRecord(rec));
    }

    /* ---- DELETE ---- */
    if (req.method === "DELETE") {
      if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
      if (!id) return json(res, 400, { error: "id required" });
      await airtableTable(TABLE, "DELETE", "/" + id);
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: "Method not allowed" });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || "Server error" });
  }
}
