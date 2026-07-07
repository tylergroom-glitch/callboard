// /api/inventory — global case inventory, one Airtable record per case.
// GET            list all cases (any signed-in user — needed to pick for a show)
// POST           create a case (admin only)  body: { name, category, data }
//   or update    body: { id, name, category, data }
// DELETE ?id=    delete a case (admin only)
//
// SETUP: add a table named "Inventory" to the same Airtable base.
// Fields: Name (primary, single line text), Category (single line text),
//         Data (long text). No new env vars required.
import { json, readBody, auth, isAdmin, airtableTable } from "./_lib.js";

const TABLE = process.env.AIRTABLE_INVENTORY_TABLE || "Inventory";

function invRecord(rec) {
  const f = rec.fields || {};
  let data = {};
  try { data = f.Data ? JSON.parse(f.Data) : {}; } catch {}
  return { id: rec.id, name: f.Name || "Untitled", category: f.Category || "Misc", data };
}

export default async function handler(req, res) {
  const p = auth(req);
  if (!p) return json(res, 401, { error: "Not signed in" });
  const id = req.query && req.query.id;

  try {
    if (req.method === "GET") {
      const out = [];
      let offset;
      do {
        const d = await airtableTable(TABLE, "GET", offset ? `?offset=${offset}` : "");
        for (const r of d.records) out.push(invRecord(r));
        offset = d.offset;
      } while (offset);
      out.sort((a, b) => a.name.localeCompare(b.name));
      return json(res, 200, out);
    }

    if (req.method === "POST") {
      if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
      const b = await readBody(req);
      const name = (b.name || "").trim();
      if (!name) return json(res, 400, { error: "Name required" });
      const fields = {
        Name: name,
        Category: b.category || "Misc",
        Data: JSON.stringify(b.data || {}),
      };
      if (b.id) {
        await airtableTable(TABLE, "PATCH", "/" + b.id, { fields });
        return json(res, 200, { ok: true, id: b.id });
      }
      const rec = await airtableTable(TABLE, "POST", "", { fields });
      return json(res, 200, invRecord(rec));
    }

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
