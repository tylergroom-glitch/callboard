// /api/directory — clients and venues, in one route to keep the function
// count down. Which one you get is decided by ?kind=clients or ?kind=venues.
//
// GET    ?kind=clients            list companies + their contacts
// GET    ?kind=venues             list venues
// POST   ?kind=...  { ...row }    create, or update when you include id
// DELETE ?kind=...&id=            delete one row
//
// Reading is open to any signed-in account (the quote builder and, later,
// the brief both need to look these up). Writing is admin only.
// Neither table holds pricing, so nothing sensitive leaks to crew.
//
// SETUP: run setup-catalog.sql in the Supabase SQL editor. No new env vars.
import { json, readBody, auth, isAdmin, supabaseRest } from "./_lib.js";

const s = (v) => String(v == null ? "" : v).trim();

function clientRow(r) {
  return {
    id: r.id,
    parentId: r.parent_id || null,
    name: r.name || "",
    contactName: r.contact_name || "",
    email: r.email || "",
    phone: r.phone || "",
    billingAddress: r.billing_address || "",
    notes: r.notes || "",
  };
}

function venueRow(r) {
  return {
    id: r.id,
    name: r.name || "",
    address: r.address || "",
    city: r.city || "",
    state: r.state || "",
    zip: r.zip || "",
    notes: r.notes || "",
  };
}

export default async function handler(req, res) {
  const p = auth(req);
  if (!p) return json(res, 401, { error: "Not signed in" });

  const kind = (req.query && req.query.kind) || "clients";
  if (kind !== "clients" && kind !== "venues")
    return json(res, 400, { error: "kind must be clients or venues" });
  const table = kind === "venues" ? "venues" : "clients";
  const shape = kind === "venues" ? venueRow : clientRow;

  try {
    if (req.method === "GET") {
      const rows = await supabaseRest("GET", "/" + table + "?select=*&order=name.asc", null);
      return json(res, 200, (rows || []).map(shape));
    }

    if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });

    if (req.method === "POST") {
      const b = await readBody(req);
      const name = s(b.name);
      if (!name) return json(res, 400, { error: "Name required" });

      let patch;
      if (kind === "venues") {
        patch = {
          name,
          address: s(b.address),
          city: s(b.city),
          state: s(b.state),
          zip: s(b.zip),
          notes: s(b.notes),
          updated_at: new Date().toISOString(),
        };
      } else {
        // A contact can't be its own parent, and we only allow one level deep.
        let parentId = b.parentId || null;
        if (parentId && b.id && parentId === b.id) parentId = null;
        patch = {
          parent_id: parentId,
          name,
          contact_name: s(b.contactName),
          email: s(b.email),
          phone: s(b.phone),
          billing_address: s(b.billingAddress),
          notes: s(b.notes),
          updated_at: new Date().toISOString(),
        };
      }

      if (b.id) {
        await supabaseRest("PATCH", "/" + table + "?id=eq." + encodeURIComponent(b.id), patch);
        return json(res, 200, { ok: true, id: b.id });
      }
      const made = await supabaseRest("POST", "/" + table, patch, "return=representation");
      return json(res, 200, shape(made[0]));
    }

    if (req.method === "DELETE") {
      const id = req.query && req.query.id;
      if (!id) return json(res, 400, { error: "id required" });
      // Contacts under a deleted company are kept (the database sets their
      // parent to null) so you never silently lose contact details.
      await supabaseRest("DELETE", "/" + table + "?id=eq." + encodeURIComponent(id), null);
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: "Method not allowed" });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || "Server error" });
  }
}
