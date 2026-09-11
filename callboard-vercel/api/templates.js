// /api/templates — a shared library of pull-list templates, stored in Supabase
// so a template saved on one device is available on every device.
// GET            list all templates (any signed-in user — needed to apply)
// POST           save a template (admin only)   body: { name, data }
// DELETE ?id=    delete a template (admin only)
//
// SETUP: run setup-inventory-templates.sql. Coming from Airtable, run
// POST /api/migrate first — it copies the Templates table across — and only
// then deploy this file.
//
// Moved off Airtable. Routes, request bodies and response shapes are unchanged.
//
// NOTE ON SAVING: as on Airtable, POST always CREATES. Saving two templates
// under the same name gives you two templates, because the front end has no
// update path (db.js exposes createTemplate(name, data) with no id). That
// behaviour is preserved deliberately rather than quietly changed during a
// database move — if you want same-name saves to overwrite, that is a decision
// to make on its own.
import { json, readBody, auth, isAdmin, supabaseRest } from "./_lib.js";

const COLS = "id,name,data";

/* jsonb arrives as a value, but a row written while this lived in Airtable may
   still hold a JSON string. A template's data is an ARRAY of cases, so the
   empty fallback is [] and not {} — handing the pull list an object here would
   fail on .map() far from the cause. */
function asRows(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

const tplSummary = (r) => ({
  id: r.id,
  name: r.name || "Untitled template",
  data: asRows(r.data),
});

export default async function handler(req, res) {
  const p = auth(req);
  if (!p) return json(res, 401, { error: "Not signed in" });
  const id = req.query && req.query.id;

  try {
    if (req.method === "GET") {
      const rows = await supabaseRest("GET", `/templates?select=${COLS}&limit=2000`, null);
      const out = (rows || []).map(tplSummary);
      // Sorted here so the order matches what this endpoint returned before.
      out.sort((a, b) => a.name.localeCompare(b.name));
      return json(res, 200, out);
    }

    if (req.method === "POST") {
      if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
      const b = await readBody(req);
      const name = (b.name || "").trim();
      if (!name) return json(res, 400, { error: "Template name required" });
      const payload = {
        name,
        data: Array.isArray(b.data) ? b.data : [],
        updated_at: new Date().toISOString(),
      };
      const made = await supabaseRest("POST", `/templates?select=${COLS}`, payload, "return=representation");
      return json(res, 200, tplSummary((made && made[0]) || { id: null, ...payload }));
    }

    if (req.method === "DELETE") {
      if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
      if (!id) return json(res, 400, { error: "id required" });
      await supabaseRest("DELETE", `/templates?id=eq.${encodeURIComponent(id)}`, null);
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: "Method not allowed" });
  } catch (e) {
    // Most likely cause on first run: setup-inventory-templates.sql was not run.
    return json(res, e.status || 500, { error: e.message || "Server error" });
  }
}
