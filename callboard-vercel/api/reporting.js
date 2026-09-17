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

/* ─────────────────────────────────────────────────────────────────────────────
 * THE PERIOD WINDOW
 *
 * Every figure in the Reports tab hangs off these two dates, so a window that
 * is off by one day does not produce an error — it quietly moves a job from
 * one month into another and both months are wrong.
 *
 * PACIFIC, NOT UTC, AND THIS IS THE WHOLE REASON IT IS A FUNCTION.
 *   The serverless container runs in UTC. On the evening of the 31st, Pacific
 *   is still the 31st and UTC is already the 1st — so `new Date()` on the
 *   server says next month while Tyler's screen says this one. "September" at
 *   5pm on the 30th would report October's figures, every time, and only in
 *   the evenings. Every date this app decides is decided in BUSINESS_TZ.
 *
 * All dates are plain YYYY-MM-DD strings, compared as strings, never Date
 * objects — the same rule the importer's date parsing follows, and for the
 * same reason: a Date is a moment in time, and a show date is not.
 * ───────────────────────────────────────────────────────────────────────────── */
export const BUSINESS_TZ = "America/Los_Angeles";

/* Today where Tyler is, as YYYY-MM-DD. en-CA because it formats that way.
 *
 * `now` is for tests and nothing else. Without it the only assertion possible
 * was `todayLocal() === todayLocal()`, which is true however this is written —
 * a mutant swapping Pacific for the container's UTC survived a full mutation
 * run against it. With an instant passed in, the seven hours a day where the
 * two disagree can be pinned exactly. */
export const todayLocal = (now) =>
  new Date(now === undefined ? Date.now() : now)
    .toLocaleDateString("en-CA", { timeZone: BUSINESS_TZ });

/* The last day of a month, without constructing a Date and hoping.
   Day 0 of the NEXT month is the last day of this one, and Date.UTC keeps the
   arithmetic out of the container's timezone entirely. */
function lastDayOf(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/* `now` threads through to todayLocal, and exists for the same reason: without
   it the year-to-date window can only be checked against whatever today
   happens to be, which is true however the timezone is handled. */
export function windowFor(period, anchor, now) {
  const today = todayLocal(now);
  /* An anchor that is not a date falls back to today rather than throwing:
     the screen always sends one, and a report that refuses to load because a
     query string was odd is worse than one that shows the current month. */
  const a = /^\d{4}-\d{2}-\d{2}$/.test(String(anchor || "")) ? String(anchor) : today;
  const y = Number(a.slice(0, 4));
  const m = Number(a.slice(5, 7));
  const pad = (n) => String(n).padStart(2, "0");

  if (period === "month") {
    return {
      period: "month",
      from: y + "-" + pad(m) + "-01",
      to: y + "-" + pad(m) + "-" + pad(lastDayOf(y, m)),
      label: new Date(Date.UTC(y, m - 1, 1))
        .toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" }),
    };
  }

  if (period === "ytd") {
    /* Year to date means to TODAY, not to the end of the anchor's month — and
       for a past year it means the whole year, because "2025 to date" ended
       some time ago. Without that, picking last year in the YTD view would
       show a window ending on today's date in a year that is over, which is a
       figure that looks precise and means nothing. */
    const end = y === Number(today.slice(0, 4)) ? today : y + "-12-31";
    return { period: "ytd", from: y + "-01-01", to: end,
             label: y + " to date" + (y === Number(today.slice(0, 4)) ? "" : " (full year)") };
  }

  return { period: "year", from: y + "-01-01", to: y + "-12-31", label: String(y) };
}

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

    /* ═══════════════════════════════════════════════════════════════════════
       THE REPORTS TAB
       GET /api/reporting?report=1&period=month|year|ytd&anchor=YYYY-MM-DD

       Total income, total expenses, income by client, income by department —
       for a month, a year, or a year to date.

       ───────────────────────────────────────────────────────────────────────
       TWO INCOMES, SHOWN TOGETHER, BECAUSE THE GAP IS THE POINT

       WON is the value of the jobs booked, counted in the period the job RAN.
       INVOICED is what actually went out, counted when the invoice was sent.

       They are different numbers about different things and they are supposed
       to disagree: a December show invoiced in January sits in December on one
       and January on the other. Showing one alone invites reading it as the
       other. Showing both makes the interesting question visible — work that
       was done and never billed shows up as a gap that does not close.

       Neither is the books. Billing carries QuickBooks numbers and links;
       QuickBooks is the record. What this screen knows that QuickBooks does
       not is WHAT THE MONEY WAS FOR — which client, which department — because
       QuickBooks has never heard of the catalog.

       ───────────────────────────────────────────────────────────────────────
       EVERY BREAKDOWN ADDS UP TO ITS HEADLINE, OR SAYS WHY NOT

       A breakdown that quietly covers three quarters of the money is the one
       failure this design is against: it looks complete, it is read as a
       total, and every decision after that is made on a number that is wrong
       by an unknown amount.

       So each split carries its own remainder as a named line. Client splits
       carry "(no client)". The department split carries an explicit
       `noLineDetail` figure — the won money on jobs with no line items at all,
       which is every historical import and any job quoted as a lump sum. The
       parts always sum to the headline; the only question is how much of it
       has a label.
       ═══════════════════════════════════════════════════════════════════════ */
    if (req.method === "GET" && q.report) {
      const win = windowFor(String(q.period || "month"), q.anchor);
      const { from, to } = win;

      const [quotes, shows, invoices, expenses] = await Promise.all([
        /* version.desc so the first row seen for a family is its newest won
           version — the fold below depends on this ordering. */
        supabaseRest("GET", "/quotes?" + WON +
          "&select=id,family_id,version,name,client_id,event_id,start_date,total,data" +
          "&order=version.desc&limit=5000", null),
        supabaseRest("GET", "/shows?select=id,name,client&limit=5000", null),
        supabaseRest("GET", "/billing_invoices?select=id,event_id,scheduled_amount," +
          "actual_amount,actual_invoice_date,sent_at,void_at,payments&limit=5000", null),
        supabaseRest("GET", "/expenses?deleted_at=is.null" +
          "&select=id,show_id,spent_on,amount,category" +
          "&spent_on=gte." + from + "&spent_on=lte." + to + "&limit=20000", null),
      ]);

      let clients = [];
      try { clients = await supabaseRest("GET", "/clients?select=id,name&limit=5000", null) || []; }
      catch (e) { /* names are a nicety; the totals are not */ }
      const clientName = new Map();
      for (const c of clients) clientName.set(c.id, String(c.name || ""));
      const showClient = new Map();
      for (const s of shows || []) showClient.set(s.id, String(s.client || ""));

      /* ---- fold to one row per job ---------------------------------------
         Summing quote ROWS reported a 60,000 job as 165,000 on the dashboard
         once. The fallback key matters: a quote made before families existed
         has a null family_id, and keying all of those under "null" would
         collapse every one of them into a single job. */
      const newest = {};
      for (const qq of quotes || []) {
        if (!qq) continue;
        const key = qq.family_id || ("solo:" + qq.id);
        if (!(key in newest)) newest[key] = qq;
      }

      const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
      const bump = (map, key, label, field, amount) => {
        const e = map.get(key) || { key, label, won: 0, invoiced: 0, jobs: 0 };
        e[field] += amount;
        map.set(key, e);
      };

      const byClient = new Map();
      /* The quote ids that count. The department split below MUST use this
         exact set: show_items are stored per quote VERSION, so grouping them
         without folding first is the same double-count one table over — and
         the two figures would disagree with nothing on screen to say why. */
      const countedQuoteIds = new Set();

      let won = 0, wonJobs = 0, undatedJobs = 0, undatedWon = 0;

      for (const key of Object.keys(newest)) {
        const qq = newest[key];
        const d = String(qq.start_date || "");
        const amount = Number(qq.total) || 0;
        if (!d) {
          /* Counted OUT and reported, never dropped. A figure that is silently
             missing is worse than one that is visibly missing. */
          undatedJobs += 1; undatedWon += amount; continue;
        }
        if (d < from || d > to) continue;

        won += amount; wonJobs += 1;
        countedQuoteIds.add(qq.id);

        const cname = (qq.client_id && clientName.get(qq.client_id)) ||
                      showClient.get(qq.event_id) || "";
        const ck = cname || "(no client)";
        bump(byClient, ck, ck, "won", amount);
        const ce = byClient.get(ck); ce.jobs += 1;
      }

      /* ---- invoiced -------------------------------------------------------
         SENT, not scheduled: an invoice that exists in the plan and has not
         gone out has not been invoiced, and counting it would make the gap
         against `won` close on paper while nothing had happened.

         Dated by actual_invoice_date, falling back to the date it was sent —
         an invoice raised in QuickBooks and marked sent here may never get the
         explicit date filled in, and dropping those would understate the
         figure silently. */
      let invoiced = 0, invoicedCount = 0, collected = 0;
      const showOf = new Map();
      for (const s of shows || []) showOf.set(s.id, s);

      for (const inv of invoices || []) {
        if (!inv || inv.void_at) continue;
        if (!inv.sent_at) continue;
        const d = String(inv.actual_invoice_date || String(inv.sent_at).slice(0, 10) || "");
        if (!d || d < from || d > to) continue;

        /* The real figure when there is one, the plan when there is not. */
        const amount = inv.actual_amount == null
          ? Number(inv.scheduled_amount) || 0
          : Number(inv.actual_amount) || 0;

        invoiced += amount; invoicedCount += 1;
        const pays = Array.isArray(inv.payments) ? inv.payments : [];
        collected += pays.reduce((t, x) => t + (Number(x && x.amount) || 0), 0);

        const s = showOf.get(inv.event_id);
        const cname = (s && String(s.client || "")) || "";
        const ck = cname || "(no client)";
        bump(byClient, ck, ck, "invoiced", amount);
      }

      /* ---- expenses -------------------------------------------------------
         deleted_at is null is not optional: expenses are soft-deleted, so
         without it a receipt Tyler removed still counts against the month. */
      let expTotal = 0, expShow = 0, expOverhead = 0;
      const byCategory = new Map();
      for (const e of expenses || []) {
        const amount = Number(e.amount) || 0;
        expTotal += amount;
        if (e.show_id) expShow += amount; else expOverhead += amount;
        const c = String(e.category || "") || "(uncategorised)";
        byCategory.set(c, (byCategory.get(c) || 0) + amount);
      }

      /* ---- by department, with the items inside it ------------------------ */
      let items = [];
      if (countedQuoteIds.size) {
        /* Fetched by the folded quote ids rather than by date. show_items
           carry a denormalised start_date, but filtering on it would quietly
           include lines from a superseded version of the same job. */
        const ids = [...countedQuoteIds];
        items = [];
        for (let i = 0; i < ids.length; i += 100) {
          const chunk = ids.slice(i, i + 100);
          const got = await supabaseRest(
            "GET", "/show_items?quote_id=in.(" + chunk.join(",") + ")" +
              "&select=quote_id,catalog_id,name,department,kind,extended&limit=20000", null);
          items = items.concat(got || []);
        }
      }

      const byDept = new Map();
      let attributed = 0;
      const quotesWithLines = new Set();
      for (const it of items) {
        /* Sections and headings carry no money and would show up as a
           department full of zeroes. */
        if (it.kind === "section" || it.kind === "note" || it.kind === "heading") continue;
        const amount = Number(it.extended) || 0;
        const dept = String(it.department || "") || "Unassigned";
        const d = byDept.get(dept) || { department: dept, amount: 0, items: new Map() };
        d.amount += amount;
        const ik = it.catalog_id || ("free:" + String(it.name || "").toLowerCase());
        const ie = d.items.get(ik) || { key: ik, name: String(it.name || "Unnamed"), amount: 0, count: 0 };
        ie.amount += amount; ie.count += 1;
        d.items.set(ik, ie);
        byDept.set(dept, d);
        attributed += amount;
        quotesWithLines.add(it.quote_id);
      }

      /* THE RECONCILING LINE. Won money on jobs that have no line detail at
         all — every historical import, and anything quoted as a lump sum. It
         is reported whether or not it is zero, because "the breakdown covers
         everything" and "the breakdown covers what it covers" must look
         different on screen. */
      let noLineDetail = 0, jobsWithoutLines = 0;
      for (const key of Object.keys(newest)) {
        const qq = newest[key];
        if (!countedQuoteIds.has(qq.id)) continue;
        if (quotesWithLines.has(qq.id)) continue;
        noLineDetail += Number(qq.total) || 0;
        jobsWithoutLines += 1;
      }

      /* And the difference between what the lines add up to and what the jobs
         carrying those lines were won at — discounts, rounding, a total edited
         after the lines were set. Named rather than absorbed, so the column
         still sums to the headline. */
      let linedJobsWon = 0;
      for (const key of Object.keys(newest)) {
        const qq = newest[key];
        if (quotesWithLines.has(qq.id)) linedJobsWon += Number(qq.total) || 0;
      }
      const lineVariance = round2(linedJobsWon - attributed);

      return json(res, 200, {
        ok: true,
        window: win,
        income: {
          won: round2(won), jobs: wonJobs,
          invoiced: round2(invoiced), invoices: invoicedCount,
          collected: round2(collected),
          /* Work done in this window that has not been billed in it. Not a
             debt figure — the two are dated differently on purpose — but the
             number worth looking at twice. */
          gap: round2(won - invoiced),
          undatedJobs, undatedWon: round2(undatedWon),
        },
        expenses: {
          total: round2(expTotal), onShows: round2(expShow), overhead: round2(expOverhead),
          byCategory: [...byCategory.entries()]
            .map(([category, amount]) => ({ category, amount: round2(amount) }))
            .sort((a, b) => b.amount - a.amount),
        },
        net: round2(won - expTotal),
        byClient: [...byClient.values()]
          .map((c) => ({ ...c, won: round2(c.won), invoiced: round2(c.invoiced) }))
          .sort((a, b) => b.won - a.won || b.invoiced - a.invoiced),
        byDepartment: [...byDept.values()]
          .map((d) => ({
            department: d.department,
            amount: round2(d.amount),
            items: [...d.items.values()]
              .map((i) => ({ ...i, amount: round2(i.amount) }))
              .sort((a, b) => b.amount - a.amount),
          }))
          .sort((a, b) => b.amount - a.amount),
        /* What the department split does NOT cover, so the two can be read
           together and always add to `income.won`. */
        coverage: {
          attributed: round2(attributed),
          lineVariance,
          noLineDetail: round2(noLineDetail),
          jobsWithoutLines,
          jobsWithLines: quotesWithLines.size,
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
