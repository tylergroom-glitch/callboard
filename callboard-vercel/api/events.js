// /api/events  — all reads/writes go through here so the Airtable key stays server-side.
// GET            list summaries (admin only)
// GET ?id=       full show JSON (admin, or the show's own token)
// POST           create show (admin only)      body: { name, client, startDate, endDate, data, password }
// PATCH ?id=     update show (admin, or the show's own token)  body: { data, name, client, startDate, endDate }
// DELETE ?id=    delete show (admin only)
import { json, readBody, auth, isAdmin, canAccessShow, airtable, summary, hashPassword } from "./_lib.js";

export default async function handler(req, res) {
  const p = auth(req);
  if (!p) return json(res, 401, { error: "Not signed in" });
  const id = req.query && req.query.id;

  try {
    if (req.method === "GET") {
      if (id) {
        if (!canAccessShow(p, id)) return json(res, 403, { error: "No access to this show" });
        const rec = await airtable("GET", "/" + id);
        const f = rec.fields || {};
        let data = {};
        try {
          data = f.Data ? JSON.parse(f.Data) : {};
        } catch {
          data = {};
        }
        data.id = rec.id;
        data.name = f.Name ?? data.name ?? "";
        data.client = f.Client ?? data.client ?? "";
        data.startDate = f.StartDate ?? data.startDate ?? "";
        data.endDate = f.EndDate ?? data.endDate ?? "";
        return json(res, 200, data);
      }
      if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
      const out = [];
      let offset;
      do {
        const d = await airtable("GET", offset ? `?offset=${offset}` : "");
        for (const r of d.records) out.push(summary(r));
        offset = d.offset;
      } while (offset);
      return json(res, 200, out);
    }

    if (req.method === "POST") {
      if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
      const b = await readBody(req);
      const fields = {
        Name: b.name || "New Event",
        Client: b.client || "",
        StartDate: b.startDate || "",
        EndDate: b.endDate || "",
        Data: JSON.stringify(b.data || {}),
        UpdatedAt: new Date().toISOString(),
      };
      if (b.password) fields.PassHash = hashPassword(b.password);
      const rec = await airtable("POST", "", { fields });
      return json(res, 200, summary(rec));
    }

    if (req.method === "PATCH") {
      if (!id) return json(res, 400, { error: "id required" });
      if (!canAccessShow(p, id)) return json(res, 403, { error: "No access to this show" });
      const b = await readBody(req);
      const fields = { UpdatedAt: new Date().toISOString() };
      if (b.data !== undefined) fields.Data = JSON.stringify(b.data);
      if (b.name !== undefined) fields.Name = b.name;
      if (b.client !== undefined) fields.Client = b.client;
      if (b.startDate !== undefined) fields.StartDate = b.startDate;
      if (b.endDate !== undefined) fields.EndDate = b.endDate;
      await airtable("PATCH", "/" + id, { fields });
      return json(res, 200, { ok: true });
    }

    if (req.method === "DELETE") {
      if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
      if (!id) return json(res, 400, { error: "id required" });
      await airtable("DELETE", "/" + id);
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: "Method not allowed" });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || "Server error" });
  }
}
