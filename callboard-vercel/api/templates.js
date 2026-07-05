// /api/templates — a shared library of pull-list templates, stored in its own
// Airtable table so a template saved on one device is available on every device.
// GET            list all templates (any signed-in user — needed to apply)
// POST           save a template (admin only)   body: { name, data }
// DELETE ?id=    delete a template (admin only)
//
// SETUP: add a table named "Templates" to the same Airtable base, with a primary
// text field "Name" and a long-text field "Data". No new env vars are needed.
import { json, readBody, auth, isAdmin, airtableTable } from "./_lib.js";

const TABLE = process.env.AIRTABLE_TEMPLATES_TABLE || "Templates";

function tplSummary(rec) {
  const f = rec.fields || {};
  let data = [];
  try {
    data = f.Data ? JSON.parse(f.Data) : [];
  } catch {
    data = [];
  }
  return { id: rec.id, name: f.Name || "Untitled template", data };
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
        for (const r of d.records) out.push(tplSummary(r));
        offset = d.offset;
      } while (offset);
      out.sort((a, b) => a.name.localeCompare(b.name));
      return json(res, 200, out);
    }

    if (req.method === "POST") {
      if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
      const b = await readBody(req);
      const name = (b.name || "").trim();
      if (!name) return json(res, 400, { error: "Template name required" });
      const fields = {
        Name: name,
        Data: JSON.stringify(b.data || []),
      };
      const rec = await airtableTable(TABLE, "POST", "", { fields });
      return json(res, 200, tplSummary(rec));
    }

    if (req.method === "DELETE") {
      if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
      if (!id) return json(res, 400, { error: "id required" });
      await airtableTable(TABLE, "DELETE", "/" + id);
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: "Method not allowed" });
  } catch (e) {
    // Most likely cause on first run: the "Templates" table doesn't exist yet.
    return json(res, e.status || 500, { error: e.message || "Server error" });
  }
}
