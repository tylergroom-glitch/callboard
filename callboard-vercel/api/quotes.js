// /api/quotes — the quoting pipeline (Supabase `quotes`). TCG admin only.
//
// GET                      list every quote (newest first), without the heavy blob
// GET  ?id=                one quote in full
// GET  ?family=            every revision of one quote, oldest first
// POST { ...quote }        create a new quote (v1 of a new family)
// POST ?revise=<id>        duplicate a quote as the next version, back in draft
// PATCH ?id= { ...quote }  save a quote. Refuses if it is not a draft.
// PATCH ?id=&status=sent   change status only. Works on locked quotes.
// DELETE ?id=              delete one version
//
// SETUP: run setup-catalog.sql then setup-quotes.sql. No new env vars.
import { json, readBody, auth, isAdmin, supabaseRest } from "./_lib.js";

const STATUSES = ["draft", "sent", "won", "lost"];
const LIST_COLS = "id,family_id,version,status,name,client_id,contact_id,venue_id,start_date,end_date,total,sent_at,created_at,updated_at";

function num(v) {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : 0;
}

// The one place line maths is defined on the server. The browser mirrors this;
// the server recalculates on every save so `total` can never drift from the lines.
function lineTotal(l) {
  if (!l) return 0;
  const qty = num(l.qty) || 0;
  const days = num(l.days) || 0;
  const rate = num(l.rate) || 0;
  const disc = Math.min(Math.max(num(l.discount) || 0, 0), 100);
  return Math.round(qty * days * rate * (1 - disc / 100) * 100) / 100;
}

function grandTotal(data) {
  const lines = (data && Array.isArray(data.lines)) ? data.lines : [];
  const sum = lines.reduce((t, l) => t + lineTotal(l), 0);
  return Math.round(sum * 100) / 100;
}

function shape(r, withData) {
  const out = {
    id: r.id,
    familyId: r.family_id,
    version: r.version,
    status: r.status || "draft",
    name: r.name || "",
    clientId: r.client_id || null,
    contactId: r.contact_id || null,
    venueId: r.venue_id || null,
    startDate: r.start_date || "",
    endDate: r.end_date || "",
    total: Number(r.total || 0),
    sentAt: r.sent_at || null,
    updatedAt: r.updated_at || null,
  };
  if (withData) out.data = (r.data && typeof r.data === "object") ? r.data : {};
  return out;
}

// Only the fields a caller is allowed to set. Anything else is ignored.
function writable(b, data) {
  return {
    name: String(b.name || "").trim(),
    client_id: b.clientId || null,
    contact_id: b.contactId || null,
    venue_id: b.venueId || null,
    start_date: b.startDate || null,
    end_date: b.endDate || null,
    data,
    total: grandTotal(data),
    updated_at: new Date().toISOString(),
  };
}

async function getOne(id) {
  const rows = await supabaseRest("GET", "/quotes?id=eq." + encodeURIComponent(id) + "&select=*", null);
  if (!rows || !rows[0]) { const e = new Error("Quote not found"); e.status = 404; throw e; }
  return rows[0];
}

export default async function handler(req, res) {
  const p = auth(req);
  if (!p) return json(res, 401, { error: "Not signed in" });
  if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });

  const q = req.query || {};

  try {
    if (req.method === "GET") {
      if (q.id) return json(res, 200, shape(await getOne(q.id), true));
      if (q.family) {
        const rows = await supabaseRest("GET", "/quotes?family_id=eq." + encodeURIComponent(q.family) + "&select=" + LIST_COLS + "&order=version.asc", null);
        return json(res, 200, (rows || []).map((r) => shape(r, false)));
      }
      const rows = await supabaseRest("GET", "/quotes?select=" + LIST_COLS + "&order=updated_at.desc", null);
      return json(res, 200, (rows || []).map((r) => shape(r, false)));
    }

    if (req.method === "POST") {
      // ---- make the next revision of an existing quote ----
      if (q.revise) {
        const src = await getOne(q.revise);
        const sibs = await supabaseRest("GET", "/quotes?family_id=eq." + encodeURIComponent(src.family_id) + "&select=version&order=version.desc&limit=1", null);
        const next = ((sibs && sibs[0] && sibs[0].version) || src.version) + 1;
        const made = await supabaseRest("POST", "/quotes", {
          family_id: src.family_id,
          version: next,
          status: "draft",
          name: src.name,
          client_id: src.client_id,
          contact_id: src.contact_id,
          venue_id: src.venue_id,
          start_date: src.start_date,
          end_date: src.end_date,
          data: src.data || {},
          total: src.total || 0,
        }, "return=representation");
        return json(res, 200, shape(made[0], true));
      }

      // ---- brand new quote ----
      const b = await readBody(req);
      const data = (b.data && typeof b.data === "object") ? b.data : {};
      const made = await supabaseRest("POST", "/quotes", {
        ...writable(b, data),
        version: 1,
        status: "draft",
      }, "return=representation");
      return json(res, 200, shape(made[0], true));
    }

    if (req.method === "PATCH") {
      if (!q.id) return json(res, 400, { error: "id required" });
      const cur = await getOne(q.id);

      // ---- status change only (allowed even when locked) ----
      if (q.status) {
        const st = String(q.status);
        if (STATUSES.indexOf(st) < 0) return json(res, 400, { error: "Unknown status" });
        const patch = { status: st, updated_at: new Date().toISOString() };
        // Stamp the send date the first time it goes out; that is the lock.
        if (st === "sent" && !cur.sent_at) patch.sent_at = new Date().toISOString();
        await supabaseRest("PATCH", "/quotes?id=eq." + encodeURIComponent(q.id), patch);
        return json(res, 200, { ok: true, status: st });
      }

      // ---- content save ----
      // A sent/won/lost version is a record of what the client received, so it
      // is never edited in place. The app offers a revision instead.
      if ((cur.status || "draft") !== "draft")
        return json(res, 409, { error: "This version is locked. Create a revision to keep editing." });

      const b = await readBody(req);
      const data = (b.data && typeof b.data === "object") ? b.data : (cur.data || {});
      await supabaseRest("PATCH", "/quotes?id=eq." + encodeURIComponent(q.id), writable(b, data));
      return json(res, 200, { ok: true, total: grandTotal(data) });
    }

    if (req.method === "DELETE") {
      if (!q.id) return json(res, 400, { error: "id required" });
      await supabaseRest("DELETE", "/quotes?id=eq." + encodeURIComponent(q.id), null);
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: "Method not allowed" });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || "Server error" });
  }
}
