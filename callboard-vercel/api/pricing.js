// /api/pricing — the admin-only pricing catalog (Supabase `pricing_catalog`).
//
// GET                list every catalog item (admin only — crew never see rates)
// POST  { item }     create or update one item. Include item.id to update.
// POST  { bulk:[] }  upsert many at once (used by the import wizard).
//                    Matching is by name, so re-importing updates rates
//                    instead of creating duplicates.
// DELETE ?id=        delete an item AND strip it out of any package that
//                    referenced it, so no package is left pointing at nothing.
//
// SETUP: run setup-catalog.sql in the Supabase SQL editor. No new env vars.
//
// qty_owned drives the sub-rental check on a quote: anything quoted beyond what
// we own has to come from a vendor. sub_cost_per_day is what that shortfall
// typically costs us — the only cost basis we keep, since owned gear has no
// marginal cost per show.
import { json, readBody, auth, isAdmin, supabaseRest } from "./_lib.js";

const DEPTS = ["Audio", "Video", "Lighting", "Power", "Scenic", "Misc"];

function cleanDept(d) {
  const s = String(d || "").trim();
  const hit = DEPTS.find((x) => x.toLowerCase() === s.toLowerCase());
  return hit || "Misc";
}

function cleanRate(v) {
  if (typeof v === "number") return isFinite(v) ? Math.round(v * 100) / 100 : 0;
  const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function cleanQty(v) {
  const n = parseInt(String(v == null ? "" : v).replace(/[^0-9]/g, ""), 10);
  return isFinite(n) && n > 0 ? n : 0;
}

// Blank means "I have never priced a sub-rent for this" — stored as null so the
// quote screen can tell it apart from a genuine $0.
function cleanSubCost(v) {
  if (v === "" || v == null) return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function cleanComponents(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const c of list) {
    if (!c || !c.itemId) continue;
    const qty = parseInt(c.qty, 10);
    out.push({ itemId: String(c.itemId), qty: isFinite(qty) && qty > 0 ? qty : 1 });
  }
  return out;
}

// [{itemId}] — no quantity, unlike components: a substitute replaces the
// placeholder one-for-one at whatever qty the quote line asked for.
function cleanSubs(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const c of list) {
    const id = c && (c.itemId || c.id);
    if (!id || seen.has(String(id))) continue;
    seen.add(String(id));
    out.push({ itemId: String(id) });
  }
  return out;
}

function row(r) {
  return {
    id: r.id,
    name: r.name || "",
    department: r.department || "Misc",
    rate: Number(r.rate_per_day || 0),
    qtyOwned: r.qty_owned == null ? 0 : Number(r.qty_owned),
    subCost: r.sub_cost_per_day == null ? null : Number(r.sub_cost_per_day),
    isGeneric: r.is_generic === true,
    substitutes: Array.isArray(r.substitutes) ? r.substitutes : [],
    components: Array.isArray(r.components) ? r.components : [],
    notes: r.notes || "",
  };
}

export default async function handler(req, res) {
  const p = auth(req);
  if (!p) return json(res, 401, { error: "Not signed in" });
  if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });

  try {
    if (req.method === "GET") {
      const rows = await supabaseRest("GET", "/pricing_catalog?select=*&order=name.asc", null);
      return json(res, 200, (rows || []).map(row));
    }

    if (req.method === "POST") {
      const b = await readBody(req);

      // ---- bulk upsert (import wizard) ----
      if (Array.isArray(b.bulk)) {
        // Existing names, so a re-import matches regardless of capitalisation
        // and updates the row you already have instead of adding a twin.
        const existing = await supabaseRest("GET", "/pricing_catalog?select=name", null);
        const byLower = {};
        for (const r of existing || []) byLower[String(r.name).toLowerCase()] = r.name;

        const seen = new Set();
        const payload = [];
        for (const it of b.bulk) {
          let name = String((it && it.name) || "").trim();
          if (!name) continue;
          const key = name.toLowerCase();
          if (seen.has(key)) continue; // one import can't carry the same name twice
          seen.add(key);
          if (byLower[key]) name = byLower[key]; // reuse the stored spelling
          payload.push({
            name,
            department: cleanDept(it.department),
            rate_per_day: cleanRate(it.rate),
            updated_at: new Date().toISOString(),
          });
        }
        if (!payload.length) return json(res, 400, { error: "Nothing to import" });
        // merge-duplicates = update the row when the name already exists.
        // Only the columns above are touched, so a re-import refreshes rates
        // and leaves your packages, notes and taxable flags alone.
        await supabaseRest("POST", "/pricing_catalog?on_conflict=name", payload, "resolution=merge-duplicates");
        return json(res, 200, { ok: true, count: payload.length });
      }

      // ---- single create / update ----
      const it = b.item || b;
      const name = String(it.name || "").trim();
      if (!name) return json(res, 400, { error: "Name required" });
      const patch = {
        name,
        department: cleanDept(it.department),
        rate_per_day: cleanRate(it.rate),
        qty_owned: cleanQty(it.qtyOwned),
        sub_cost_per_day: cleanSubCost(it.subCost),
        is_generic: it.isGeneric === true,
        substitutes: cleanSubs(it.substitutes),
        components: cleanComponents(it.components),
        notes: String(it.notes || ""),
        updated_at: new Date().toISOString(),
      };
      if (it.id) {
        await supabaseRest("PATCH", "/pricing_catalog?id=eq." + encodeURIComponent(it.id), patch);
        return json(res, 200, { ok: true, id: it.id });
      }
      const made = await supabaseRest("POST", "/pricing_catalog", patch, "return=representation");
      return json(res, 200, row(made[0]));
    }

    if (req.method === "DELETE") {
      const id = req.query && req.query.id;
      if (!id) return json(res, 400, { error: "id required" });
      // Pull any package that lists this item and rewrite it without the item,
      // so deleting a component never leaves a package pointing at a ghost.
      const all = await supabaseRest("GET", "/pricing_catalog?select=id,components,substitutes", null);
      for (const r of all || []) {
        const comps = Array.isArray(r.components) ? r.components : [];
        const subs = Array.isArray(r.substitutes) ? r.substitutes : [];
        const hitC = comps.some((c) => c && c.itemId === id);
        const hitS = subs.some((c) => c && c.itemId === id);
        if (!hitC && !hitS) continue;
        await supabaseRest("PATCH", "/pricing_catalog?id=eq." + encodeURIComponent(r.id), {
          components: comps.filter((c) => c && c.itemId !== id),
          substitutes: subs.filter((c) => c && c.itemId !== id),
          updated_at: new Date().toISOString(),
        });
      }
      await supabaseRest("DELETE", "/pricing_catalog?id=eq." + encodeURIComponent(id), null);
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: "Method not allowed" });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || "Server error" });
  }
}
