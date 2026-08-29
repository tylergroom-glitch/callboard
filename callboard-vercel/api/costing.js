// /api/costing — per-show P&L / costing figures, ADMIN ONLY.
//
// Stored in its own `show_costing` table rather than on the show record,
// because /api/events hands the whole `data` blob to anyone with show
// access — crew included. Keeping the numbers in a separate table that is
// only ever read here, behind canManageShow(), means a crew token can
// never receive them.
//
// GET   ?id=   read costing for a show   (admin only)
// PATCH ?id=   save costing for a show   (admin only)   body: { costing }
//
// SETUP: run setup-costing.sql once in the Supabase SQL Editor.
import { json, readBody, auth, canManageShow, supabaseRest } from "./_lib.js";

export default async function handler(req, res) {
  const p = auth(req);
  if (!p) return json(res, 401, { error: "Not signed in" });
  const id = req.query && req.query.id;
  if (!id) return json(res, 400, { error: "id required" });
  if (!canManageShow(p, id)) return json(res, 403, { error: "Admin only" });

  try {
    if (req.method === "GET") {
      const rows = await supabaseRest(
        "GET",
        "/show_costing?show_id=eq." + encodeURIComponent(id) + "&select=costing&limit=1",
        null
      );
      const row = rows && rows[0];
      // No row yet just means nobody has entered figures for this show.
      const costing = row && row.costing && typeof row.costing === "object" ? row.costing : {};
      return json(res, 200, { costing });
    }

    if (req.method === "PATCH" || req.method === "POST") {
      const b = await readBody(req);
      const costing = b && b.costing && typeof b.costing === "object" ? b.costing : {};
      // Upsert, so the first save on a show creates the row.
      await supabaseRest(
        "POST",
        "/show_costing",
        { show_id: id, costing, updated_at: new Date().toISOString() },
        "resolution=merge-duplicates,return=minimal"
      );
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: "Method not allowed" });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || "Server error" });
  }
}
