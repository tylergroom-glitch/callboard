// /api/costing — per-show P&L / costing figures, ADMIN ONLY.
// Stored in a separate "Costing" field on the show's Events record and never
// returned by /api/events, so crew (show-scoped tokens) never receive the numbers.
// GET   ?id=   read costing for a show   (admin only)
// PATCH ?id=   save costing for a show   (admin only)   body: { costing }
//
// SETUP: add a long-text field named "Costing" to your Events table in Airtable.
// No new env vars are required.
import { json, readBody, auth, isAdmin, airtable } from "./_lib.js";

export default async function handler(req, res) {
  const p = auth(req);
  if (!p) return json(res, 401, { error: "Not signed in" });
  if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
  const id = req.query && req.query.id;
  if (!id) return json(res, 400, { error: "id required" });

  try {
    if (req.method === "GET") {
      const rec = await airtable("GET", "/" + id);
      const f = rec.fields || {};
      let costing = {};
      try {
        costing = f.Costing ? JSON.parse(f.Costing) : {};
      } catch {
        costing = {};
      }
      return json(res, 200, { costing });
    }

    if (req.method === "PATCH" || req.method === "POST") {
      const b = await readBody(req);
      await airtable("PATCH", "/" + id, { fields: { Costing: JSON.stringify(b.costing || {}) } });
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: "Method not allowed" });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || "Server error" });
  }
}
