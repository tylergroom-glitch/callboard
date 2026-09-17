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

    /* ---- the year's money ------------------------------------------------
       GET /api/reporting?revenue=1&year=2026

       "What did we gross this year, and what did it cost." The one number
       Tyler asked the importer for, and the reason the importer writes won
       quotes rather than notes on a show.

       THREE DECISIONS, ALL OF WHICH CHANGE THE ANSWER, SO ALL STATED:

       1. ONE JOB IS ONE NUMBER, HOWEVER MANY TIMES IT WAS REVISED.
          Quotes version as separate rows sharing family_id. Summing the rows
          reported one 60,000 job as 165,000 on the dashboard before it was
          caught; the same table would do the same thing here. Fold to the
          newest WON version per family first, then add.

          Newest *won*, not newest: a family whose v3 is a draft revision still
          earned what v2 was won at.

       2. THE JOB'S DATE, NOT THE INVOICE'S.
          Revenue is counted in the year the job happened (`start_date`),
          because that is the year Tyler means by "this year" and the year the
          costs sit in. A won quote with no date cannot be placed at all, so it
          is counted OUT and reported as `undated` — a figure that is silently
          missing is worse than one that is visibly missing.

       3. GROSS IS WHAT WAS WON, NOT WHAT WAS COLLECTED.
          This does not read invoices or payments. `gross` is the value of the
          work; billing knows what has actually been paid and that is a
          different screen and a different question. Named `gross` throughout
          so the two are never mistaken for each other. */
    if (req.method === "GET" && q.revenue) {
      const year = String(q.year || "").trim();
      if (!/^\d{4}$/.test(year)) return json(res, 400, { error: "year must be four digits" });
      const from = year + "-01-01", to = year + "-12-31";

      const [quotes, shows, expenses] = await Promise.all([
        supabaseRest("GET", "/quotes?" + WON +
          "&select=id,family_id,version,name,client_id,event_id,start_date,total,data" +
          "&order=version.desc&limit=5000", null),
        supabaseRest("GET", "/shows?select=id,name,client&limit=5000", null),
        supabaseRest("GET", "/expenses?deleted_at=is.null&select=show_id,spent_on,amount,category" +
          "&spent_on=gte." + from + "&spent_on=lte." + to + "&limit=20000", null),
      ]);
      let clients = [];
      try {
        clients = await supabaseRest("GET", "/clients?select=id,name,parent_id&limit=5000", null) || [];
      } catch (e) { /* client names are a nicety; the totals are not */ }

      const clientName = new Map();
      for (const c of clients) clientName.set(c.id, String(c.name || ""));
      const showName = new Map();
      const showClient = new Map();
      for (const s of shows || []) {
        showName.set(s.id, String(s.name || ""));
        showClient.set(s.id, String(s.client || ""));
      }

      /* Rows arrive version.desc, so the first one seen for a family IS its
         newest won version. Keyed on family_id with the row's own id as a
         fallback — a quote made before families existed carries a null
         family_id, and keying all of those under "null" would collapse every
         one of them into a single job. */
      const newest = {};
      for (const qq of quotes || []) {
        if (!qq) continue;
        const key = qq.family_id || ("solo:" + qq.id);
        if (!(key in newest)) newest[key] = qq;
      }

      const months = [];
      for (let i = 1; i <= 12; i++) months.push({ month: i, gross: 0, jobs: 0 });
      const byClient = new Map();
      const jobs = [];
      let gross = 0, undated = 0, otherYears = 0, imported = 0;

      for (const key of Object.keys(newest)) {
        const qq = newest[key];
        const d = String(qq.start_date || "");
        if (!d) { undated += 1; continue; }
        if (d < from || d > to) { otherYears += 1; continue; }

        const amount = Number(qq.total) || 0;
        const mi = parseInt(d.slice(5, 7), 10);
        if (mi >= 1 && mi <= 12) { months[mi - 1].gross += amount; months[mi - 1].jobs += 1; }
        gross += amount;

        const name = String(qq.name || "") || showName.get(qq.event_id) || "Untitled";
        /* The client id when the quote has one, and the show's own text when it
           does not — which is every imported job, because the importer does not
           invent directory records for names it has never seen. */
        const cname = (qq.client_id && clientName.get(qq.client_id)) ||
                      showClient.get(qq.event_id) || "";
        const ck = cname || "(no client)";
        const ce = byClient.get(ck) || { client: ck, gross: 0, jobs: 0 };
        ce.gross += amount; ce.jobs += 1;
        byClient.set(ck, ce);

        const wasImported = !!(qq.data && typeof qq.data === "object" && qq.data._import);
        if (wasImported) imported += 1;
        jobs.push({
          quoteId: qq.id,
          showId: qq.event_id || null,
          name,
          client: cname,
          startDate: d,
          gross: Math.round(amount * 100) / 100,
          imported: wasImported,
          costs: 0,
        });
      }

      /* Costs. Split by whether they belong to a job or to the company —
         "we spent 180,000 this year" means nothing until you know how much of
         it was on jobs. Overhead has show_id null by definition; api/expenses
         gates it on isAdmin for exactly that reason. */
      let direct = 0, overhead = 0;
      const costByShow = new Map();
      for (const e of expenses || []) {
        const a = Number(e.amount) || 0;
        if (e.show_id) {
          direct += a;
          costByShow.set(e.show_id, (costByShow.get(e.show_id) || 0) + a);
        } else overhead += a;
      }
      for (const j of jobs) {
        if (j.showId && costByShow.has(j.showId)) {
          j.costs = Math.round(costByShow.get(j.showId) * 100) / 100;
        }
      }

      const r2 = (n) => Math.round(n * 100) / 100;
      jobs.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));

      return json(res, 200, {
        year,
        gross: r2(gross),
        jobs: jobs.length,
        imported,
        byMonth: months.map((m) => ({ month: m.month, gross: r2(m.gross), jobs: m.jobs })),
        byClient: [...byClient.values()]
          .map((c) => ({ client: c.client, gross: r2(c.gross), jobs: c.jobs }))
          .sort((a, b) => b.gross - a.gross),
        rows: jobs,
        costs: { direct: r2(direct), overhead: r2(overhead), total: r2(direct + overhead) },
        net: r2(gross - direct - overhead),
        /* Won work this figure could not place. Shown on the screen, not
           swallowed: a job with no date is a job missing from the year. */
        undated,
        otherYears,
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
