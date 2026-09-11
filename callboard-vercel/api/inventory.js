// /api/inventory — global case inventory, one Supabase row per case.
// GET            list all cases (any signed-in user — needed to pick for a show)
// POST           create a case (admin only)  body: { name, category, data }
//   or update    body: { id, name, category, data }
// DELETE ?id=    delete a case (admin only)
//
// SETUP: run setup-inventory-templates.sql. Coming from Airtable, run
// POST /api/migrate first — it copies the Inventory table across — and only
// then deploy this file.
//
// Moved off Airtable. Routes, request bodies and response shapes are unchanged,
// so nothing in the front end needed touching: the only difference is that `id`
// is now a uuid rather than an Airtable record id, and both are opaque to the
// caller.
import { json, readBody, auth, isAdmin, supabaseRest } from "./_lib.js";

const COLS = "id,name,category,data";

/* The column is jsonb, so it arrives as an object. A row written while this
   lived in Airtable may still hold a JSON *string*, so both are accepted — a
   catalog that half-parses is worse than one that is slow. */
function asData(v) {
  if (v && typeof v === "object") return v;
  if (typeof v === "string") { try { return JSON.parse(v) || {}; } catch { return {}; } }
  return {};
}

const invRecord = (r) => ({
  id: r.id,
  name: r.name || "Untitled",
  category: r.category || "Misc",
  data: asData(r.data),
});

export default async function handler(req, res) {
  const p = auth(req);
  if (!p) return json(res, 401, { error: "Not signed in" });
  const id = req.query && req.query.id;

  try {
    if (req.method === "GET") {
      const rows = await supabaseRest("GET", `/inventory?select=${COLS}&limit=5000`, null);
      const out = (rows || []).map(invRecord);
      /* Sorted here rather than in the query so the order is identical to what
         this endpoint returned on Airtable — Postgres collation and
         localeCompare disagree about case and punctuation, and the Catalog
         screen is a list people scan by eye. */
      out.sort((a, b) => a.name.localeCompare(b.name));
      return json(res, 200, out);
    }

    if (req.method === "POST") {
      if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
      const b = await readBody(req);
      const name = (b.name || "").trim();
      if (!name) return json(res, 400, { error: "Name required" });

      const payload = {
        name,
        category: b.category || "Misc",
        data: b.data || {},
        updated_at: new Date().toISOString(),
      };
      if (b.id) {
        await supabaseRest("PATCH", `/inventory?id=eq.${encodeURIComponent(b.id)}`, payload);
        return json(res, 200, { ok: true, id: b.id });
      }
      const made = await supabaseRest("POST", `/inventory?select=${COLS}`, payload, "return=representation");
      return json(res, 200, invRecord((made && made[0]) || { id: null, ...payload }));
    }

    if (req.method === "DELETE") {
      if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
      if (!id) return json(res, 400, { error: "id required" });
      await supabaseRest("DELETE", `/inventory?id=eq.${encodeURIComponent(id)}`, null);
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: "Method not allowed" });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || "Server error" });
  }
}
