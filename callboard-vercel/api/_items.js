// api/_items.js — flattening quote lines into show_items.
//
// Underscore: a helper, not a route. It lives here rather than inside
// reporting.js because api/quotes.js needs it too, and one serverless route
// importing another is a reliable way to end up with two copies of a handler
// in a bundle.

import { supabaseRest } from "./_lib.js";

/* ---------------------------------------------------------------------------
   The line maths.

   Copied deliberately from api/quotes.js rather than imported, because that
   file does not export it and turning a route into a module is the thing this
   file exists to avoid. The two must agree; the test suite asserts that they
   still do, against both implementations, on the same inputs.
   --------------------------------------------------------------------------- */
export function num(v) {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : 0;
}

export function lineTotal(l) {
  if (!l) return 0;
  const qty = num(l.qty) || 0;
  const days = num(l.days) || 0;
  const rate = num(l.rate) || 0;
  const disc = Math.min(Math.max(num(l.discount) || 0, 0), 100);
  return Math.round(qty * days * rate * (1 - disc / 100) * 100) / 100;
}

/* Lines that are not things that went out. A section is a heading. These are
   kept OUT of show_items entirely rather than stored and filtered later,
   because a heading with a qty of 0 sitting in a table called "items" is a
   trap for whoever writes the next report. */
export const NOT_AN_ITEM = new Set(["section", "note", "heading"]);

/* A line's stable identity within its quote. Lines carry an `id`; older ones
   may not, in which case the index is the best available key — stable as long
   as the quote is not edited, and a won quote is locked, so it is not. */
export const lineKey = (l, i) => String((l && (l.id || l.lineId)) || "i" + i);

export function rowsForQuote(q) {
  const data = (q && q.data && typeof q.data === "object")
    ? q.data
    : (() => { try { return JSON.parse((q && q.data) || "{}"); } catch { return {}; } })();
  const lines = Array.isArray(data.lines) ? data.lines : [];
  const out = [];
  lines.forEach((l, i) => {
    if (!l) return;
    const kind = String(l.kind || "item");
    if (NOT_AN_ITEM.has(kind)) return;
    const name = String(l.name || "").trim();
    if (!name) return;                       // an empty row is not a fact
    out.push({
      quote_id: q.id,
      quote_family_id: q.family_id || null,
      quote_version: q.version || null,
      line_key: lineKey(l, i),
      show_id: q.event_id || null,
      catalog_id: l.catalogId || null,
      name: name.slice(0, 300),
      department: String(l.department || "Misc").slice(0, 60),
      kind,
      qty: num(l.qty),
      days: num(l.days),
      rate: num(l.rate),
      discount: Math.min(Math.max(num(l.discount) || 0, 0), 100),
      extended: lineTotal(l),
      start_date: q.start_date || null,
      end_date: q.end_date || null,
      client_id: q.client_id || null,
      source: "quote",
      updated_at: new Date().toISOString(),
    });
  });
  return out;
}

/* Sync one quote's rows to match its status.
 *
 * A quote that is not won has no rows: winning creates them, un-winning takes
 * them away again. That is the whole contract, and it is why this takes the
 * quote rather than a flag — the status on the row is the single thing that
 * decides, so there is no way for a caller to ask for the wrong answer.
 *
 * Delete-then-insert rather than upsert, because a revision can REMOVE a line
 * and an upsert would leave the removed one behind for ever. The delete is
 * scoped to one quote id, so it can never reach another quote's rows.
 */
export async function syncQuoteItems(q) {
  if (!q || !q.id) return 0;
  await supabaseRest("DELETE", "/show_items?quote_id=eq." + encodeURIComponent(q.id), null);
  if ((q.status || "") !== "won") return 0;
  const rows = rowsForQuote(q);
  if (rows.length) await supabaseRest("POST", "/show_items", rows);
  return rows.length;
}
