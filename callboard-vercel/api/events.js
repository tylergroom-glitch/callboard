// /api/events — Supabase `shows` with per-account role enforcement.
// TCG + producers: full edit. Department editors: edit only fields owned by tabs
// tagged to their department(s) (enforced server-side). Crew + others: read only.
import { json, readBody, auth, isAdmin, memberRole, memberShowIds, supabaseRest, hashPassword, scopedSave } from "./_lib.js";

const summary = (row) => ({
  id: row.id,
  name: row.name || "",
  client: row.client || "",
  startDate: row.start_date || "",
  endDate: row.end_date || "",
  hasPassword: !!row.pass_hash,
});

// Returns { role, depts } for the caller on a show. role: tcg|producer|dept_editor|crew|null
async function effective(p, id) {
  if (isAdmin(p)) return { role: "tcg", depts: [] };
  if (p && p.scope === "show" && p.id === id) {
    const lvl = p.level === "admin" ? "producer" : p.level === "editor" ? "dept_editor" : "crew";
    return { role: lvl, depts: [] };
  }
  if (p && p.sub) {
    const m = await memberRole(p, id);
    if (m) return { role: m.role, depts: (m.areas && Array.isArray(m.areas.depts)) ? m.areas.depts : [] };
  }
  return { role: null, depts: [] };
}

export default async function handler(req, res) {
  const p = auth(req);
  if (!p) return json(res, 401, { error: "Not signed in" });
  const id = req.query && req.query.id;

  try {
    if (req.method === "GET") {
      if (id) {
        const { role, depts } = await effective(p, id);
        if (!role) return json(res, 403, { error: "No access to this show" });
        const rows = await supabaseRest("GET", "/shows?id=eq." + encodeURIComponent(id) + "&select=*", null);
        const row = rows && rows[0];
        if (!row) return json(res, 404, { error: "Show not found" });
        const data = row.data && typeof row.data === "object" ? row.data : {};
        data.id = row.id;
        data.name = row.name ?? "";
        data.client = row.client ?? "";
        data.startDate = row.start_date ?? "";
        data.endDate = row.end_date ?? "";
        data._role = role;
        if (role === "dept_editor") data._depts = depts;
        return json(res, 200, data);
      }
      if (isAdmin(p)) {
        const rows = await supabaseRest("GET", "/shows?select=id,name,client,start_date,end_date,pass_hash&order=start_date.asc.nullslast", null);
        return json(res, 200, (rows || []).map(summary));
      }
      if (p.scope === "show" && p.id) {
        const rows = await supabaseRest("GET", "/shows?id=eq." + encodeURIComponent(p.id) + "&select=id,name,client,start_date,end_date,pass_hash", null);
        return json(res, 200, (rows || []).map(summary));
      }
      if (p.sub) {
        const ids = await memberShowIds(p);
        if (!ids.length) return json(res, 200, []);
        const inList = ids.map(encodeURIComponent).join(",");
        const rows = await supabaseRest("GET", "/shows?id=in.(" + inList + ")&select=id,name,client,start_date,end_date,pass_hash&order=start_date.asc.nullslast", null);
        return json(res, 200, (rows || []).map(summary));
      }
      return json(res, 200, []);
    }

    if (req.method === "POST") {
      if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
      const b = await readBody(req);
      const rec = { name: b.name || "New Event", client: b.client || "", start_date: b.startDate || null, end_date: b.endDate || null, data: b.data || {} };
      if (b.password) rec.pass_hash = hashPassword(b.password);
      const rows = await supabaseRest("POST", "/shows", rec, "return=representation");
      return json(res, 200, summary(rows[0]));
    }

    if (req.method === "PATCH") {
      if (!id) return json(res, 400, { error: "id required" });
      const { role, depts } = await effective(p, id);
      const fullEdit = role === "tcg" || role === "producer";

      if (fullEdit) {
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

      if (role === "dept_editor") {
        if (!depts.length) return json(res, 403, { error: "No department assigned to you for this show." });
        const b = await readBody(req);
        const srows = await supabaseRest("GET", "/shows?id=eq." + encodeURIComponent(id) + "&select=data", null);
        const stored = (srows && srows[0] && srows[0].data && typeof srows[0].data === "object") ? srows[0].data : {};
        const result = scopedSave(stored, b.data || {}, depts);
        if (!result.ok) return json(res, 403, { error: "You can only edit your department's areas. Blocked changes to: " + result.bad.join(", ") });
        await supabaseRest("PATCH", "/shows?id=eq." + encodeURIComponent(id), { data: result.data, updated_at: new Date().toISOString() });
        return json(res, 200, { ok: true });
      }

      return json(res, 403, { error: "You don't have edit access to this show" });
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
