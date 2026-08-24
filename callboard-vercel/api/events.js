// /api/events  — now backed by the Supabase `shows` table (Stage 3b).
// Same request/response shape the app already expects; the frontend didn't change.
// GET            list summaries (admin only)
// GET ?id=       full show JSON (admin, or the show's own token)
// POST           create show (admin only)
// PATCH ?id=     update show (admin, or the show's own token)
// DELETE ?id=    delete show (admin only)
import { json, readBody, auth, isAdmin, canAccessShow, supabaseRest, hashPassword } from "./_lib.js";

const summary = (row) => ({
  id: row.id,
  name: row.name || "",
  client: row.client || "",
  startDate: row.start_date || "",
  endDate: row.end_date || "",
  hasPassword: !!row.pass_hash,
  hasEditor: false,
  hasAdmin: false,
});

export default async function handler(req, res) {
  const p = auth(req);
  if (!p) return json(res, 401, { error: "Not signed in" });
  const id = req.query && req.query.id;

  try {
    if (req.method === "GET") {
      if (id) {
        if (!canAccessShow(p, id)) return json(res, 403, { error: "No access to this show" });
        const rows = await supabaseRest("GET", "/shows?id=eq." + encodeURIComponent(id) + "&select=*", null);
        const row = rows && rows[0];
        if (!row) return json(res, 404, { error: "Show not found" });
        const data = row.data && typeof row.data === "object" ? row.data : {};
        data.id = row.id;
        data.name = row.name ?? data.name ?? "";
        data.client = row.client ?? data.client ?? "";
        data.startDate = row.start_date ?? data.startDate ?? "";
        data.endDate = row.end_date ?? data.endDate ?? "";
        return json(res, 200, data);
      }
      if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
      const rows = await supabaseRest(
        "GET",
        "/shows?select=id,name,client,start_date,end_date,pass_hash&order=start_date.asc.nullslast",
        null
      );
      return json(res, 200, (rows || []).map(summary));
    }

    if (req.method === "POST") {
      if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
      const b = await readBody(req);
      const rec = {
        name: b.name || "New Event",
        client: b.client || "",
        start_date: b.startDate || null,
        end_date: b.endDate || null,
        data: b.data || {},
      };
      if (b.password) rec.pass_hash = hashPassword(b.password);
      const rows = await supabaseRest("POST", "/shows", rec, "return=representation");
      return json(res, 200, summary(rows[0]));
    }

    if (req.method === "PATCH") {
      if (!id) return json(res, 400, { error: "id required" });
      if (!canAccessShow(p, id)) return json(res, 403, { error: "No access to this show" });
      const b = await readBody(req);
      const patch = { updated_at: new Date().toISOString() };
      if (b.data !== undefined) patch.data = b.data;
      if (b.name !== undefined) patch.name = b.name;
      if (b.client !== undefined) patch.client = b.client;
      if (b.startDate !== undefined) patch.start_date = b.startDate || null;
      if (b.endDate !== undefined) patch.end_date = b.endDate || null;
      await supabaseRest("PATCH", "/shows?id=eq." + encodeURIComponent(id), patch);
      return json(res, 200, { ok: true });
    }

    if (req.method === "DELETE") {
      if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
      if (!id) return json(res, 400, { error: "id required" });
      await supabaseRest("DELETE", "/shows?id=eq." + encodeURIComponent(id), null);
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: "Method not allowed" });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || "Server error" });
  }
}
