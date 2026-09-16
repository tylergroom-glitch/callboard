// /api/costing — per-show P&L / costing figures, ADMIN ONLY.
//
// Stored in its own `show_costing` table rather than on the show record,
// because /api/events hands the whole `data` blob to anyone with show
// access — crew included. Keeping the numbers in a separate table that is
// only ever read here, behind canManageShow(), means a crew token can
// never receive them.
//
// GET   ?id=   read costing for a show   (admin only)
// GET   ?all=1 read costing for EVERY show (TCG admin only) — the roll-up
// PATCH ?id=   save costing for a show   (admin only)   body: { costing }
//
// SETUP: run setup-costing.sql once in the Supabase SQL Editor.
import { json, readBody, auth, canManageShow, isAdmin, supabaseRest } from "./_lib.js";

export default async function handler(req, res) {
  const p = auth(req);
  if (!p) return json(res, 401, { error: "Not signed in" });
  const q = req.query || {};
  const all = q.all === "1" || q.all === "true";
  const id = q.id;

  /* Two shapes, two gates, decided before anything is read.

     `?all=1` has no single show to name, so canManageShow has nothing to ask
     about — and "every show's costing in one response" is precisely what a
     show-scoped manager must never receive. It is gated on isAdmin instead,
     which is the only gate that means "company-wide" in this app. */
  if (all) {
    if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
    if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
  } else {
    if (!id) return json(res, 400, { error: "id required" });
    if (!canManageShow(p, id)) return json(res, 403, { error: "Admin only" });
  }

  try {
    if (all) {
      /* The roll-up used to read these figures off the show record, where
         nothing has written them since they moved into this table. Zeros, or
         worse, whatever was left behind at the time of the move. One request
         for the lot rather than one per show: the roll-up already makes an
         /api/events call per show and does not need a second N. */
      const rows = await supabaseRest(
        "GET", "/show_costing?select=show_id,costing", null);
      const costing = {};
      (rows || []).forEach((r) => {
        if (r && r.show_id && r.costing && typeof r.costing === "object") {
          costing[r.show_id] = r.costing;
        }
      });
      return json(res, 200, { costing });
    }

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
