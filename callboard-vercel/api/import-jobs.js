// /api/import-jobs — bringing past jobs into the app so the year has a
// revenue figure and the costs have somewhere to hang.
//
//   POST ?preview=1   { text }            read a pasted table. WRITES NOTHING.
//   POST ?commit=1    { rows, note }      create the shows and the quotes
//   GET                                   past imports, newest first
//   POST ?undo=<batchId>                  take one import back out
//
// ADMIN ONLY, all of it. This is every job and every figure in the company.
//
// SETUP: run sql/setup-imports.sql.
//
// WHY THIS CREATES A SHOW AND NOT JUST A QUOTE
//   Tyler's ask was "track the gross revenue for this year AND be able to
//   attach expenses to it". Those are two different tables. Revenue is a won
//   quote. An expense is `expenses.show_id` — the ONLY join an expense has.
//   A quote with no show is a number with nowhere to put a receipt, so every
//   imported job is a show and a won quote linked to it, created together.
//
//   The show is a thin one: a name, a client, the dates. No crew, no rundown,
//   no pull list. It is a place for money to attach to, and Today already
//   hides anything whose end date has passed, so forty of them do not turn
//   the landing page into an archive.
//
// WHY IT IS NOT api/import-quotes.js
//   Because api/import-quote.js already exists — the single-PDF reader — and
//   the two names would differ by one letter in a folder Tyler uploads to by
//   hand. A file picked wrong there is a deploy that half-works.
//
// THE RULE THIS FILE IS BUILT AROUND
//
//   IMPORTING THE SAME TABLE TWICE MUST NOT DOUBLE THE YEAR.
//
//   Not "should not" — must not. Tyler is not going to audit a revenue figure
//   against a spreadsheet; he is going to believe it. So a duplicate is
//   decided on the SERVER, from the database, at COMMIT time — not from
//   whatever the review screen worked out a minute ago. Pressing Import twice
//   creates the jobs once, because by the second press they are already there
//   and every one of them is skipped by name and date.
//
//   This is the same failure the Open Pipeline had — one job counted three
//   times because nothing folded the versions — arriving by a different road.
import crypto from "node:crypto";
import { json, readBody, auth, isAdmin, supabaseRest, supabaseProfile, logActivity } from "./_lib.js";
import { readTable, cleanJob, dupKey, nameKey, money, MAX_ROWS } from "./_jobs.js";
import { rowsForQuote } from "./_items.js";

const BATCHES = "/import_batches";

async function actorName(p) {
  if (!p) return "";
  if (!p.sub) return p.scope === "admin" ? "admin (password)" : "";
  try {
    const prof = await supabaseProfile(p.sub);
    return (prof && (prof.name || prof.email)) || "";
  } catch (e) { return ""; }
}

/* Every job already in the app, by name-and-date.
   Both tables, because the two ways a job can already be here are different
   and so is what Tyler should do about each:
     - a QUOTE with this name and date is the same job already imported or
       already quoted, and importing it again would double the revenue;
     - a SHOW with this name and date is a job that was run in the app but
       never quoted, and the right move there is to add the quote to the show
       that exists rather than make a second show beside it.
   Nothing is deduplicated automatically. It is reported and skipped. */
async function existingKeys() {
  const [quotes, shows] = await Promise.all([
    supabaseRest("GET", "/quotes?select=id,name,start_date,total,status,event_id&limit=5000", null),
    supabaseRest("GET", "/shows?select=id,name,start_date&limit=5000", null),
  ]);
  const byQuote = new Map();
  for (const q of quotes || []) {
    if (!q || !q.name || !q.start_date) continue;
    const k = dupKey(q.name, q.start_date);
    /* First one wins, and rows arrive in no guaranteed order, so this is only
       ever used to say "something like this exists" — never to pick which. */
    if (!byQuote.has(k)) byQuote.set(k, q);
  }
  const byShow = new Map();
  for (const s of shows || []) {
    if (!s || !s.name || !s.start_date) continue;
    const k = dupKey(s.name, s.start_date);
    if (!byShow.has(k)) byShow.set(k, s);
  }
  return { byQuote, byShow };
}

/* Mark up a list of clean jobs with what is already here and what repeats
   inside the paste itself. Used by BOTH preview and commit, from the same
   database read, so the review screen and the import cannot disagree about
   what a duplicate is. */
function markDuplicates(jobs, { byQuote, byShow }) {
  const seen = new Map();
  return jobs.map((j) => {
    if (!j.ok) return { ...j, dup: "", dupNote: "", action: "skip" };
    const k = dupKey(j.name, j.startDate);
    if (seen.has(k)) {
      return { ...j, dup: "paste", dupNote: "Same name and date as row " + seen.get(k) + " above.", action: "skip" };
    }
    seen.set(k, j.line);
    const q = byQuote.get(k);
    if (q) {
      return {
        ...j, dup: "quote",
        dupNote: "A quote for this job is already in the app" +
                 (q.status ? " (" + q.status + ")" : "") + ".",
        action: "skip",
      };
    }
    const s = byShow.get(k);
    if (s) {
      return {
        ...j, dup: "show",
        dupNote: "A show with this name and date already exists. Importing would make a second one.",
        action: "skip", showId: s.id,
      };
    }
    return { ...j, dup: "", dupNote: "", action: "create" };
  });
}

function summarise(rows) {
  const creating = rows.filter((r) => r.action === "create");
  return {
    read: rows.length,
    creating: creating.length,
    gross: money(creating.reduce((t, r) => t + (r.status === "won" ? Number(r.total) || 0 : 0), 0)),
    duplicates: rows.filter((r) => r.dup).length,
    problems: rows.filter((r) => !r.ok).length,
    won: creating.filter((r) => r.status === "won").length,
  };
}

/* The stamp every created row carries. It is what `?undo=` finds, and it is
   deliberately ON THE ROW rather than in a list kept somewhere else: a list
   can be lost halfway through a function that times out, and then there are
   rows nothing knows how to take back. Asking the database what it holds
   cannot go stale. */
const stamp = (batchId, who, source) => ({
  batch: batchId,
  at: new Date().toISOString(),
  by: who || null,
  source: source === "pdf" ? "pdf" : "paste",
});

const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);

/* A client or venue the caller wants created. Only the fields the directory
   tables actually have, and only when there is a name — a nameless directory
   row is a row nobody can ever find again. */
function dirRow(v) {
  if (!v || typeof v !== "object") return null;
  const name = str(v.name, 200);
  if (!name) return null;
  return {
    name,
    address: str(v.address, 300),
    city: str(v.city, 120),
    state: str(v.state, 40),
    zip: str(v.zip, 20),
  };
}

/* Quote lines off a read PDF.
 *
 * THE TOTAL IS NOT TAKEN FROM THESE. It is the grand total printed on the
 * quote, which is what the client agreed to. The lines are detail hung
 * underneath it, and if they disagree the review screen says so rather than
 * either one silently winning. So nothing here can change a job's money. */
function cleanLines(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const l of v.slice(0, 400)) {
    if (!l || typeof l !== "object") continue;
    const name = str(l.name, 300);
    if (!name) continue;
    const kind = str(l.kind, 20) === "category" ? "category" : "item";
    out.push({
      id: str(l.id, 40) || ("l" + (out.length + 1)),
      kind,
      name,
      department: str(l.department, 60) || "Misc",
      qty: Number(l.qty) > 0 ? Math.round(Number(l.qty) * 100) / 100 : 1,
      days: Number(l.days) > 0 ? Math.round(Number(l.days) * 100) / 100 : 1,
      rate: Number.isFinite(Number(l.rate)) ? money(Number(l.rate)) : 0,
      discount: 0,
    });
  }
  return out;
}

export default async function handler(req, res) {
  const p = auth(req);
  if (!p) return json(res, 401, { error: "Not signed in" });
  if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });

  const q = req.query || {};

  try {
    /* ---- past imports -------------------------------------------------- */
    if (req.method === "GET") {
      let rows;
      try {
        rows = await supabaseRest(
          "GET", BATCHES + "?select=*&order=created_at.desc&limit=50", null);
      } catch (e) {
        /* The table is the one piece of setup this feature needs, and a 404
           from PostgREST is indistinguishable from a broken endpoint unless
           it is named. Same shape as /api/activity.

           ONLY a 404. Catching everything here would dress a genuine outage up
           as "run the migration", and Tyler would run a migration that was
           already run and still have a broken screen. */
        if (e && e.status === 404) {
          return json(res, 503, {
            error: "The imports table isn't there yet. Run sql/setup-imports.sql in Supabase.",
            setup: true,
          });
        }
        throw e;
      }
      return json(res, 200, (rows || []).map((r) => ({
        id: r.id,
        note: r.note || "",
        actor: r.actor || "",
        created: r.rows_created || 0,
        gross: Number(r.gross || 0),
        status: r.status || "done",
        createdAt: r.created_at || null,
        undoneAt: r.undone_at || null,
      })));
    }

    if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

    /* ---- read a paste. Writes nothing, ever. ---------------------------- */
    if (q.preview) {
      const b = await readBody(req);
      const table = readTable(b && b.text);
      if (table.error) return json(res, 400, { error: table.error });
      const rows = markDuplicates(table.jobs, await existingKeys());
      return json(res, 200, {
        rows,
        headers: table.headers,
        unknown: table.unknown,
        summary: summarise(rows),
      });
    }

    /* ---- create ---------------------------------------------------------- */
    if (q.commit) {
      const b = await readBody(req);
      const list = Array.isArray(b && b.rows) ? b.rows : [];
      if (!list.length) return json(res, 400, { error: "No rows to import." });
      if (list.length > MAX_ROWS)
        return json(res, 400, { error: "Import " + MAX_ROWS + " or fewer at a time." });

      /* RE-VALIDATED FROM THE RAW VALUES. The review screen's verdict is not
         evidence; it was computed in a browser that can be a day old, and the
         rules live in _jobs.js. */
      const cleaned = [];
      const rejected = [];
      for (const r of list) {
        const out = cleanJob(r);
        if (out.error) { rejected.push({ name: String((r && r.name) || "").slice(0, 120), reason: out.error }); continue; }
        /* `ok` is what markDuplicates reads to decide a row is worth checking.
           cleanJob does not set it — it returns a job or a reason — so it is
           set here, at the one place that knows the row survived validation. */
        cleaned.push({
          ...out.job, ok: true, force: r && r.force === true, line: (r && r.line) || 0,
          /* Carried through untouched by cleanJob, which is about the job's own
             fields. Each is validated where it is used, below. */
          clientId: str(r && r.clientId, 60),
          venueId: str(r && r.venueId, 60),
          newClient: dirRow(r && r.newClient),
          newVenue: dirRow(r && r.newVenue),
          lines: cleanLines(r && r.lines),
          quoteNumber: str(r && r.quoteNumber, 60),
          /* Sent for display whether the venue is an existing one or a new
             one, so the show's Brief panel is filled either way. The id is
             what links; these two are what a person reads. */
          venueName: str(r && r.venueName, 200),
          venueAddress: str(r && r.venueAddress, 300),
        });
      }
      if (!cleaned.length)
        return json(res, 400, { error: "None of those rows could be read.", rejected });

      /* The duplicate check that counts — against the database as it is NOW,
         not as the review screen found it. This is what makes pressing Import
         twice safe. `force` is the deliberate override for the genuine case
         of two jobs with one name on one day. */
      const keys = await existingKeys();
      const marked = markDuplicates(cleaned, keys);
      const skipped = [];
      const going = [];
      marked.forEach((r, i) => {
        const src = cleaned[i];
        if (r.action === "create" || src.force) going.push(src);
        else skipped.push({ name: r.name, line: r.line, reason: r.dupNote || r.error });
      });
      if (!going.length) {
        return json(res, 200, {
          ok: true, batchId: null, created: 0,
          skipped, rejected,
          message: "Everything in that list is already in the app. Nothing was added.",
        });
      }

      const batchId = crypto.randomUUID();
      const who = await actorName(p);
      const mark = stamp(batchId, who, b && b.source);

      /* ---- directory rows the jobs are about to point at ------------------
         Created BEFORE the shows, because a quote carries client_id and
         venue_id and there is no second pass to come back and fill them in.

         DEDUPED WITHIN THE BATCH BY NAME. Twelve PDFs for the same new client
         are one client — importing twelve identical companies and leaving
         Tyler to merge them by hand is the precise failure that made him ask
         for "if client is not in the system, add new client" in the first
         place. The key is the same one the review screen matched on, so what
         is created agrees with what he was shown. */
      const madeClients = [];
      const madeVenues = [];
      const newBy = (list, row, table, shape) => {
        const k = nameKey(row.name);
        const hit = list.find((x) => x.key === k);
        if (hit) return hit.id;
        const id = crypto.randomUUID();
        list.push({ key: k, id, row: { id, ...shape(row) } });
        return id;
      };
      for (const j of going) {
        if (!j.clientId && j.newClient) {
          j.clientId = newBy(madeClients, j.newClient, "clients", (r) => ({
            name: r.name,
            billing_address: [r.address, [r.city, r.state].filter(Boolean).join(" "), r.zip]
              .filter(Boolean).join(", ") || null,
          }));
        }
        if (!j.venueId && j.newVenue) {
          j.venueId = newBy(madeVenues, j.newVenue, "venues", (r) => ({
            name: r.name,
            address: r.address || null,
            city: r.city || null,
            state: r.state || null,
            zip: r.zip || null,
          }));
        }
      }
      if (madeClients.length) {
        try { await supabaseRest("POST", "/clients", madeClients.map((x) => x.row), "return=minimal"); }
        catch (e) {
          return json(res, 500, {
            error: "The new clients couldn't be saved, so nothing was added. " + ((e && e.message) || ""),
          });
        }
      }
      if (madeVenues.length) {
        try { await supabaseRest("POST", "/venues", madeVenues.map((x) => x.row), "return=minimal"); }
        catch (e) {
          /* Undo the clients: they were minted seconds ago and nothing has
             seen them. Leaving them would give Tyler a directory full of
             companies with no jobs against them and no explanation. */
          if (madeClients.length) {
            try {
              await supabaseRest("DELETE",
                "/clients?id=in.(" + madeClients.map((x) => x.id).join(",") + ")", null);
            } catch (e2) { /* reported either way */ }
          }
          return json(res, 500, {
            error: "The new venues couldn't be saved, so nothing was added. " + ((e && e.message) || ""),
          });
        }
      }

      /* Ids are generated HERE rather than read back from the insert.
         Two bulk inserts instead of two-per-job is the difference between a
         function that finishes and one that times out at forty rows — and
         knowing the show id before the row exists is what lets the quote carry
         event_id in the same bulk insert, with no assumption anywhere about
         the order PostgREST returns things in. */
      const pairs = going.map((j) => ({
        job: j,
        showId: crypto.randomUUID(),
        quoteId: crypto.randomUUID(),
        familyId: crypto.randomUUID(),
      }));

      const showRows = pairs.map(({ job, showId }) => ({
        id: showId,
        name: job.name,
        client: job.client,
        start_date: job.startDate,
        end_date: job.endDate,
        category: "tcg",
        data: {
          client: job.client,
          /* The shape the Brief and the crew packet already read. Filling it
             from the PDF means an imported job opens with its venue on the
             brief rather than an empty panel — and it costs nothing, because
             the address was read anyway. */
          ...(job.venueName
            ? { venue: { name: job.venueName, address: job.venueAddress, mapLink: "" } }
            : {}),
          _import: { ...mark, invoiceNo: job.invoiceNo || job.quoteNumber || null },
        },
      }));

      const quoteRows = pairs.map(({ job, showId, quoteId, familyId }) => ({
        id: quoteId,
        /* Its own family, one version. A revision of an imported job would
           start from here and behave exactly like any other quote. Setting it
           explicitly rather than leaning on the column default is what keeps
           every one of these a separate opportunity: a null family_id collapses
           them all into one on every screen that folds by family. */
        family_id: familyId,
        version: 1,
        status: job.status,
        name: job.name,
        start_date: job.startDate,
        end_date: job.endDate,
        /* THE TOTAL IS THE ONE PRINTED ON THE QUOTE, always — never a sum of
           the lines. The grand total is what the client agreed to; the lines
           are detail read off the same page. When they disagree the review
           screen has already said so, and importing the sum instead would
           quietly replace an agreed figure with a derived one. */
        total: job.total,
        event_id: showId,
        client_id: job.clientId || null,
        venue_id: job.venueId || null,
        data: {
          lines: job.lines,
          groups: [],
          deposits: [],
          /* Said in words on the quote itself, because somebody will open one
             in two years and wonder where it came from. */
          notes: (job.note ? job.note + "\n" : "") +
                 (job.lines.length
                   ? "Imported from the quote PDF. Category amounts carry the money; " +
                     "the gear under them is recorded at zero because the PDF does not price it."
                   : "Imported past job - total only, no line detail.") +
                 (job.quoteNumber ? " Quote " + job.quoteNumber + "." : "") +
                 (job.invoiceNo ? " Invoice " + job.invoiceNo + "." : ""),
          _import: { ...mark, invoiceNo: job.invoiceNo || job.quoteNumber || null },
        },
      }));

      await supabaseRest("POST", "/shows", showRows, "return=minimal");
      try {
        await supabaseRest("POST", "/quotes", quoteRows, "return=minimal");
      } catch (e) {
        /* The compensating delete. These show ids were minted in this request
           and nothing else has ever seen them, so removing them cannot take
           anything with it — and leaving them would put a row of empty shows
           in the list with no revenue on them and no way to tell why. */
        try {
          await supabaseRest(
            "DELETE", "/shows?id=in.(" + pairs.map((x) => x.showId).join(",") + ")", null);
        } catch (e2) { /* reported below either way */ }
        return json(res, 500, {
          error: "The jobs couldn't be saved, so nothing was added. " + ((e && e.message) || ""),
        });
      }

      /* ---- the reporting rows ---------------------------------------------
         A won quote's lines belong in show_items, which is what makes "how
         often did we send out a 12K projector" a GROUP BY instead of a scan
         over every quote blob.

         rowsForQuote is api/quotes.js's own flattener, imported rather than
         re-implemented, so an imported job and a hand-built one produce the
         same rows. Built in memory and inserted ONCE: syncQuoteItems is a
         delete plus an insert per quote, which is fifty round trips for
         twenty-five jobs, and these quotes are seconds old so there is nothing
         to delete.

         Best-effort, deliberately. show_items is DERIVED — it can be rebuilt
         from the quotes at any time with ?backfill=1 — so failing to write it
         must never be the thing that loses an import. */
      const itemRows = [];
      for (const { job, quoteId, familyId, showId } of pairs) {
        if (job.status !== "won" || !job.lines.length) continue;
        itemRows.push(...rowsForQuote({
          id: quoteId, family_id: familyId, version: 1, status: "won",
          event_id: showId, client_id: job.clientId || null,
          start_date: job.startDate, end_date: job.endDate,
          data: { lines: job.lines },
        }));
      }
      let lineCount = 0;
      if (itemRows.length) {
        try {
          await supabaseRest("POST", "/show_items", itemRows, "return=minimal");
          lineCount = itemRows.length;
        } catch (e) {
          console.log("[import-jobs] show_items not written: " + ((e && e.message) || e));
        }
      }

      const gross = money(going.reduce((t, j) => t + (j.status === "won" ? j.total : 0), 0));
      try {
        await supabaseRest("POST", BATCHES, {
          id: batchId,
          kind: "jobs",
          note: String((b && b.note) || "").slice(0, 300),
          actor: who || null,
          rows_created: going.length,
          gross,
          status: "done",
          /* The directory rows this import brought into being.
             These CANNOT be stamped the way a show or a quote is — the clients
             and venues tables have no jsonb column to stamp — so the ids are
             kept here, and this is the one place in this feature where a list
             stands in for asking the database. The failure mode is the safe
             one: lose the list and a spare company stays in the directory,
             which is untidy, rather than a job going missing. */
          created: { clients: madeClients.map((x) => x.id), venues: madeVenues.map((x) => x.id) },
        }, "return=minimal");
      } catch (e) {
        /* The jobs are in. A missing audit row is worth saying out loud and
           is not worth unwinding an import over. */
        console.log("[import-jobs] batch row not written: " + ((e && e.message) || e));
      }

      /* NO MONEY IN THE FEED — the same rule api/quotes.js states where it
         logs a won quote without its total. How many jobs is news; what they
         were worth is not something a feed should carry around. */
      await logActivity(p, "import.jobs",
        "Imported " + going.length + " past job" + (going.length === 1 ? "" : "s") +
        (skipped.length ? " (" + skipped.length + " already here, skipped)" : ""),
        { actorName: who, meta: { batchId, created: going.length, skipped: skipped.length } });

      return json(res, 200, {
        ok: true,
        batchId,
        created: going.length,
        gross,
        skipped,
        rejected,
        clients: madeClients.map((x) => x.row.name),
        venues: madeVenues.map((x) => x.row.name),
        lines: lineCount,
      });
    }

    /* ---- take one back out ---------------------------------------------- */
    if (q.undo) {
      const batchId = String(q.undo);
      const f = "?data->_import->>batch=eq." + encodeURIComponent(batchId);
      const quotes = await supabaseRest("GET", "/quotes" + f + "&select=id,event_id,name", null);
      const shows = await supabaseRest("GET", "/shows" + f + "&select=id,name,data", null);
      if (!(quotes || []).length && !(shows || []).length)
        return json(res, 404, { error: "Nothing from that import is still here." });

      const showIds = (shows || []).map((s) => s.id);
      const inList = showIds.length ? "(" + showIds.join(",") + ")" : "";

      /* What has been hung on these shows since. An imported job that has had
         receipts attached to it is doing its job, and deleting it would take
         the receipts' only link to a job with it — so it is KEPT and named,
         not quietly skipped and not deleted anyway. */
      const [expenses, tasks, invoices, items] = inList
        ? await Promise.all([
            supabaseRest("GET", "/expenses?show_id=in." + inList + "&deleted_at=is.null&select=show_id", null),
            supabaseRest("GET", "/tasks?event_id=in." + inList + "&select=event_id", null),
            supabaseRest("GET", "/billing_invoices?event_id=in." + inList + "&select=event_id", null),
            supabaseRest("GET", "/show_items?show_id=in." + inList + "&select=show_id,quote_id", null),
          ])
        : [[], [], [], []];

      const why = new Map();
      const note = (id, what) => { if (id && !why.has(id)) why.set(id, what); };
      (expenses || []).forEach((r) => note(r.show_id, "expenses have been attached to it"));
      (tasks || []).forEach((r) => note(r.event_id, "it has tasks on it"));
      (invoices || []).forEach((r) => note(r.event_id, "it has been invoiced"));
      /* LINE ITEMS THIS IMPORT PUT THERE ITSELF DO NOT COUNT.
       *
       *   This guard was written when the importer created no line items at
       *   all, so any show_item on an imported show had to have come from
       *   somewhere else and was a good reason to leave the job alone. Then
       *   the PDF importer started writing 35 of them per job — and every
       *   PDF-imported job became permanently un-undoable, held in place by
       *   rows the same import had just created.
       *
       *   A guard is about what SOMEBODY ELSE has done to the row since. So
       *   the batch's own quotes are excluded, and what is left is the honest
       *   question: has anything outside this import attached itself here. */
      const ownQuotes = new Set((quotes || []).map((qq) => qq.id));
      (items || []).forEach((r) => {
        if (r.quote_id && ownQuotes.has(r.quote_id)) return;
        note(r.show_id, "it has line items");
      });
      (shows || []).forEach((s) => {
        const d = (s.data && typeof s.data === "object") ? s.data : {};
        const crew = Array.isArray(d.crew) ? d.crew.filter((c) => c && c.name) : [];
        if (crew.length) note(s.id, "crew have been added to it");
      });

      const removable = showIds.filter((id) => !why.has(id));
      const kept = showIds.filter((id) => why.has(id)).map((id) => ({
        id,
        name: ((shows || []).find((s) => s.id === id) || {}).name || "",
        reason: why.get(id),
      }));

      /* The quote goes only when its show goes. Half a pair — a show with no
         revenue, or revenue with no show — is worse than leaving both. */
      const goingQuotes = (quotes || []).filter(
        (qq) => qq.event_id && removable.indexOf(qq.event_id) >= 0).map((qq) => qq.id);

      if (goingQuotes.length) {
        /* The derived rows go FIRST, and by quote rather than by show.
           show_items has no foreign key to anything — it is rebuildable from
           the quotes, which is the whole reason it can be dropped safely — so
           deleting a quote leaves its rows behind, pointing at a show that no
           longer exists and quietly inflating every item report. */
        try {
          await supabaseRest("DELETE", "/show_items?quote_id=in.(" + goingQuotes.join(",") + ")", null);
        } catch (e) {
          console.log("[import-jobs] show_items not cleared: " + ((e && e.message) || e));
        }
        await supabaseRest("DELETE", "/quotes?id=in.(" + goingQuotes.join(",") + ")", null);
      }
      if (removable.length)
        await supabaseRest("DELETE", "/shows?id=in.(" + removable.join(",") + ")", null);

      /* ---- and the clients and venues it created -------------------------
         Only the ones nothing points at any more. A company this import
         invented, that Tyler has since used on a real quote, is his company
         now — undoing an import is not a reason to take it off that quote.

         Read AFTER the shows and quotes above were deleted, so a directory row
         used only by this import already looks unreferenced by the time it is
         asked about. */
      const rec = await supabaseRest(
        "GET", BATCHES + "?id=eq." + encodeURIComponent(batchId) + "&select=created", null);
      const made = (rec && rec[0] && rec[0].created) || {};
      const madeClients = Array.isArray(made.clients) ? made.clients : [];
      const madeVenues = Array.isArray(made.venues) ? made.venues : [];
      const dirKept = [];
      if (madeClients.length || madeVenues.length) {
        const inC = madeClients.length ? "(" + madeClients.join(",") + ")" : "";
        const inV = madeVenues.length ? "(" + madeVenues.join(",") + ")" : "";
        const [qByClient, qByVenue, contacts] = await Promise.all([
          inC ? supabaseRest("GET", "/quotes?client_id=in." + inC + "&select=client_id", null) : [],
          inV ? supabaseRest("GET", "/quotes?venue_id=in." + inV + "&select=venue_id", null) : [],
          inC ? supabaseRest("GET", "/clients?parent_id=in." + inC + "&select=parent_id", null) : [],
        ]);
        const usedC = new Set([...(qByClient || []).map((r) => r.client_id),
                               ...(contacts || []).map((r) => r.parent_id)].filter(Boolean));
        const usedV = new Set((qByVenue || []).map((r) => r.venue_id).filter(Boolean));
        const dropC = madeClients.filter((id) => !usedC.has(id));
        const dropV = madeVenues.filter((id) => !usedV.has(id));
        madeClients.filter((id) => usedC.has(id)).forEach(() => dirKept.push("client"));
        madeVenues.filter((id) => usedV.has(id)).forEach(() => dirKept.push("venue"));
        try {
          if (dropC.length) await supabaseRest("DELETE", "/clients?id=in.(" + dropC.join(",") + ")", null);
          if (dropV.length) await supabaseRest("DELETE", "/venues?id=in.(" + dropV.join(",") + ")", null);
        } catch (e) {
          /* A directory row that will not delete is untidy, not broken, and
             the jobs are already gone. Say it in the log and carry on. */
          console.log("[import-jobs] directory rows not removed: " + ((e && e.message) || e));
        }
      }

      try {
        await supabaseRest("PATCH", BATCHES + "?id=eq." + encodeURIComponent(batchId), {
          status: kept.length ? "part-undone" : "undone",
          undone_at: new Date().toISOString(),
        }, "return=minimal");
      } catch (e) { /* the rows are gone either way */ }

      await logActivity(p, "import.undone",
        "Undid an import - removed " + removable.length + " job" +
        (removable.length === 1 ? "" : "s") +
        (kept.length ? ", kept " + kept.length + " that had work on them" : ""),
        { actorName: await actorName(p), meta: { batchId, removed: removable.length, kept: kept.length } });

      return json(res, 200, { ok: true, removed: removable.length, kept, dirKept: dirKept.length });
    }

    return json(res, 400, { error: "Say what to do: preview, commit or undo." });
  } catch (e) {
    return json(res, e.status || 500, { error: (e && e.message) || "Server error" });
  }
}
