// /api/reporting — the numbers, across every show.
//
//   POST /api/reporting?backfill=1        rebuild show_items from every won quote
//   POST /api/reporting?sync=1            { quoteId } — rebuild one quote's rows
//   GET  /api/reporting?items=1           how often each catalog item went out
//   GET  /api/reporting?coverage=1        which shows have line detail and which don't
//
// ADMIN ONLY, all of it. These are revenue numbers across every job.
//
// SETUP: run setup-reporting.sql.
//
// WHY A DERIVED TABLE AND NOT A QUERY OVER quotes
//   Quote lines live in a jsonb blob. Counting how often one catalog item went
//   out means reading every quote and parsing every blob, which is fine at 40
//   shows and hopeless at 400. show_items is that blob flattened, one row per
//   line, with catalog_id indexed.
//
//   It is DERIVED, never authored. Nothing in the app writes a show_item by
//   hand. That is what lets backfill be destructive-and-safe: the table can be
//   thrown away and rebuilt from the quotes at any time, so a bug here can
//   never cost you data that only lived here.

import { json, readBody, auth, isAdmin, supabaseRest } from "./_lib.js";
import { syncQuoteItems } from "./_items.js";

/* Only a WON quote is a fact about a job that happened. Drafts change, sent
   quotes may never land, and lost ones did not. Counting any of them would
   turn "how often did we rent this" into "how often did we offer it". */
const WON = "status=eq.won";
const QCOLS = "id,family_id,version,status,event_id,client_id,start_date,end_date,total,data";

export default async function handler(req, res) {
  const p = auth(req);
  if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
  const q = req.query || {};

  try {
    // ---- rebuild everything ------------------------------------------------
    if (req.method === "POST" && q.backfill) {
      const quotes = await supabaseRest("GET", "/quotes?" + WON + "&select=" + QCOLS + "&limit=5000", null);
      let quotesDone = 0, lines = 0, skipped = 0;
      for (const quote of quotes || []) {
        const n = await syncQuoteItems(quote);
        quotesDone++;
        lines += n;
        if (!n) skipped++;                    // won, but no usable lines on it
      }
      return json(res, 200, { ok: true, quotes: quotesDone, lines, withoutLines: skipped });
    }

    // ---- rebuild one -------------------------------------------------------
    if (req.method === "POST" && q.sync) {
      const b = await readBody(req);
      const id = String((b && b.quoteId) || "").trim();
      if (!id) return json(res, 400, { error: "quoteId required" });
      const rows = await supabaseRest(
        "GET", "/quotes?id=eq." + encodeURIComponent(id) + "&select=" + QCOLS + "&limit=1", null);
      const quote = rows && rows[0];
      if (!quote) return json(res, 404, { error: "Quote not found" });
      if ((quote.status || "") !== "won") {
        // Not an error: un-winning a quote should remove its rows, and this is
        // the path that does it.
        await supabaseRest("DELETE", "/show_items?quote_id=eq." + encodeURIComponent(id), null);
        return json(res, 200, { ok: true, lines: 0, removed: true });
      }
      return json(res, 200, { ok: true, lines: await syncQuoteItems(quote) });
    }

    // ---- how often did each item go out ------------------------------------
    if (req.method === "GET" && q.items) {
      const from = String(q.from || "").trim();
      const to = String(q.to || "").trim();
      let path = "/show_items?select=catalog_id,name,department,kind,qty,days,rate,extended,show_id,quote_id,start_date&limit=20000";
      if (from) path += "&start_date=gte." + encodeURIComponent(from);
      if (to) path += "&start_date=lte." + encodeURIComponent(to);
      const rows = await supabaseRest("GET", path, null);

      /* Grouped by catalog id where there is one, and by lower-cased name where
         there is not. A freehand line is still a thing that went out, and
         dropping it would quietly under-count exactly the gear that never made
         it into the catalog — which is the gear most worth noticing. */
      const by = new Map();
      for (const r of rows || []) {
        const key = r.catalog_id ? "c:" + r.catalog_id : "n:" + String(r.name || "").toLowerCase();
        let e = by.get(key);
        if (!e) {
          e = {
            catalogId: r.catalog_id || null,
            name: r.name || "",
            department: r.department || "",
            inCatalog: !!r.catalog_id,
            times: 0, shows: new Set(), units: 0, unitDays: 0, revenue: 0,
            lastOut: "",
          };
          by.set(key, e);
        }
        e.times += 1;
        if (r.show_id) e.shows.add(r.show_id);
        e.units += Number(r.qty) || 0;
        e.unitDays += (Number(r.qty) || 0) * (Number(r.days) || 0);
        e.revenue += Number(r.extended) || 0;
        if (r.start_date && r.start_date > e.lastOut) e.lastOut = r.start_date;
      }

      const items = [...by.values()]
        .map((e) => ({
          catalogId: e.catalogId,
          name: e.name,
          department: e.department,
          inCatalog: e.inCatalog,
          times: e.times,               // how many quote lines it appeared on
          shows: e.shows.size,          // how many distinct jobs
          units: Math.round(e.units * 100) / 100,
          unitDays: Math.round(e.unitDays * 100) / 100,
          revenue: Math.round(e.revenue * 100) / 100,
          lastOut: e.lastOut,
        }))
        .sort((a, b) => b.revenue - a.revenue);

      return json(res, 200, {
        items,
        totals: {
          lines: (rows || []).length,
          revenue: Math.round(items.reduce((t, i) => t + i.revenue, 0) * 100) / 100,
          distinctItems: items.length,
          notInCatalog: items.filter((i) => !i.inCatalog).length,
        },
      });
    }

    /* ---- which shows actually have line detail --------------------------
       This is the one that tells you how much importing is left to do, so it
       exists before the importer rather than after it. A won quote with no
       usable lines, or a show with no won quote at all, is a gap. */
    if (req.method === "GET" && q.coverage) {
      const [shows, quotes, items] = await Promise.all([
        supabaseRest("GET", "/shows?select=id,name,client,start_date&order=start_date.asc&limit=5000", null),
        supabaseRest("GET", "/quotes?" + WON + "&select=id,event_id,total&limit=5000", null),
        supabaseRest("GET", "/show_items?select=show_id,extended&limit=20000", null),
      ]);
      const wonByShow = new Map();
      for (const qq of quotes || []) if (qq.event_id) wonByShow.set(qq.event_id, qq);
      const lineCount = new Map();
      const lineValue = new Map();
      for (const it of items || []) {
        if (!it.show_id) continue;
        lineCount.set(it.show_id, (lineCount.get(it.show_id) || 0) + 1);
        lineValue.set(it.show_id, (lineValue.get(it.show_id) || 0) + (Number(it.extended) || 0));
      }
      const out = (shows || []).map((s) => {
        const won = wonByShow.get(s.id) || null;
        const n = lineCount.get(s.id) || 0;
        return {
          id: s.id,
          name: s.name || "",
          client: s.client || "",
          startDate: s.start_date || "",
          hasWonQuote: !!won,
          quoteTotal: won ? Number(won.total) || 0 : 0,
          lines: n,
          lineValue: Math.round((lineValue.get(s.id) || 0) * 100) / 100,
          /* What is missing, in one word, so the screen does not have to
             work it out and two screens cannot disagree about it. */
          gap: n > 0 ? "" : won ? "quote has no usable lines" : "no won quote",
        };
      });
      return json(res, 200, {
        shows: out,
        summary: {
          total: out.length,
          covered: out.filter((s) => s.lines > 0).length,
          noQuote: out.filter((s) => !s.hasWonQuote).length,
          quoteNoLines: out.filter((s) => s.hasWonQuote && !s.lines).length,
        },
      });
    }

    return json(res, 405, { error: "Method not allowed" });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || "Server error" });
  }
}
