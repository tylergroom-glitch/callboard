// /api/backup — take a copy of everything, in a form that outlives this app.
//
//   GET ?manifest=1        what a backup would contain, and how big — cheap
//   GET                    the whole thing, gzipped, as a download
//   GET ?table=<name>      one table, for when the whole thing will not fit
//
// Admin only. Reads everything and writes nothing.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS AT ALL
//
//   Supabase's own daily backups cover the case where something in here goes
//   wrong — a bad write, a show deleted by mistake. They do NOT cover the case
//   this file is for: losing access to Supabase itself. Their physical backups
//   are not downloadable, so every copy of this business's records lives inside
//   one company's account. If that account is suspended, unpaid, or gone, so is
//   everything.
//
//   What comes out of here is plain JSON of plain Postgres tables. It restores
//   into any Postgres anywhere — another host, a laptop — which is the only
//   thing that actually makes the data portable.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE FAILURE THIS FILE IS MOST AFRAID OF
//
//   A BACKUP THAT IS SHORT AND LOOKS COMPLETE.
//
//   PostgREST returns a PAGE, not a table. Ask for a table and you get however
//   many rows the server feels like giving — Supabase projects can carry a
//   `db-max-rows` cap, and a plain GET that returns 1,000 rows of a 4,000-row
//   table is indistinguishable, in the response, from one that returned
//   everything. Downloaded, opened, and eyeballed, it would look like a
//   perfectly good backup. Nobody would find out until the day they restored
//   it and three quarters of the shows were missing.
//
//   Two defences, and both are needed:
//
//     1. Paging advances by WHAT CAME BACK, and stops only on an EMPTY page —
//        never on a page that was merely smaller than asked for. A short page
//        is exactly what a server-side cap produces, so treating "short" as
//        "finished" is the bug itself.
//
//     2. Every table's row count is then read back INDEPENDENTLY, from the
//        database, and compared with what was collected. A mismatch does not
//        warn and carry on — it REFUSES. A backup nobody can trust is worse
//        than no backup, because it is believed.
//
//   Nothing here truncates to fit. If it will not fit, it says so and names
//   what to do instead.
// ─────────────────────────────────────────────────────────────────────────────
import zlib from "node:zlib";
import { json, auth, isAdmin, supabaseRest } from "./_lib.js";
import { stampNow } from "./_send.js";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || "";

/* Every table the app owns.
   Written out by hand rather than discovered, and that is deliberate: a
   backup should contain what someone decided it contains. A discovered list
   silently starts including whatever a migration adds — and, worse, silently
   stops including a table that is renamed, with no test failing. When a table
   is added to the app it is added here, and the test that counts this list
   against the routes' own usage is what makes anyone notice. */
export const TABLES = [
  "shows", "quotes", "clients", "venues", "tasks", "expenses",
  "billing_invoices", "billing_adjustments", "show_items", "show_costing",
  "show_members", "crew_documents", "crew_availability", "availability_requests",
  "roster", "profiles", "pricing_catalog", "quote_presets", "call_acks",
  "scheduled_messages", "activity", "todoist_links", "agent_threads",
  "app_settings", "distance_cache",
  /* These two were missed on the first pass and found by the test that reads
     the table list back out of the routes. Worth naming: `inventory` is the
     gear catalogue and `import_batches` is what makes an import undoable —
     both would simply have been absent from every backup, with nothing
     anywhere to say so. That test is the only reason this list can be written
     by hand at all. */
  "inventory", "import_batches",
  /* Added the day venue attachments were built — by the test in
     test-backup.mjs that compares this list against the database, which failed
     within a minute of the table existing. That is the whole reason this list
     is safe to write by hand. */
  "venue_files",
];

/* Tables whose loss would be an inconvenience rather than a disaster: caches
   and logs that rebuild themselves. Named so a restore knows what it can skip,
   not so the backup can skip them. */
export const REBUILDABLE = new Set(["distance_cache", "activity", "show_items"]);

/* Vercel caps a function response at 4.5MB. The backup refuses above 4.0,
   leaving room for headers and for the gzip of an awkward payload being a
   little worse than the gzip of a friendly one.

   Settable, because otherwise the refusal is only reachable by holding four
   megabytes of real data — which meant the test for it could not exist, and a
   mutant that removed the refusal entirely survived. */
export const MAX_DOWNLOAD_BYTES =
  Number(process.env.BACKUP_MAX_BYTES) || 4 * 1024 * 1024;

/* How many rows a table must account for, and how many it did.
 *
 * Pulled out as a plain function of three numbers ON PURPOSE. Inside
 * buildBackup this branch is only reachable when something is genuinely
 * broken, so there was no way to test it and a mutant that turned the refusal
 * into a shrug survived unnoticed. Out here it is four lines with no database
 * attached and every case can simply be asserted.
 *
 *   before / after — the row count either side of the dump
 *   collected      — what actually came back
 *
 * The smaller of the two counts is what must be accounted for. Rows inserted
 * while the backup ran are legitimately not in it; rows deleted while it ran
 * are legitimately gone. Rows that were there the whole time and did not come
 * back are the failure. */
export function shortfall(collected, before, after) {
  const mustHave = Math.min(before, after);
  return collected < mustHave ? mustHave - collected : 0;
}

/* A page size, not a row limit. If the server hands back fewer than this, the
   loop keeps going — see the block comment above. */
const PAGE = 1000;

/* An independent count, read from the database rather than inferred from what
   was collected. `supabaseRest` throws the response headers away and the count
   arrives in Content-Range, so this goes to fetch directly. */
async function countOf(table) {
  const r = await fetch(
    SUPABASE_URL + "/rest/v1/" + encodeURIComponent(table) + "?select=*&limit=1",
    { headers: {
        apikey: SUPABASE_SECRET_KEY,
        Authorization: "Bearer " + SUPABASE_SECRET_KEY,
        /* count=exact is the point. `planned` and `estimated` are fast and
           approximate, and an approximate count cannot verify a backup. */
        Prefer: "count=exact",
        Range: "0-0",
      } });
  if (!r.ok && r.status !== 206) {
    const e = new Error("Could not count " + table + " (HTTP " + r.status + ")");
    /* A 404 is carried through AS a 404, because that is how the caller tells
       "this table is not there" from "the database would not answer". Flattening
       everything to 502 made a dropped table look like an outage and took the
       whole backup down with it. */
    e.status = r.status === 404 ? 404 : 502;
    throw e;
  }
  /* Content-Range is "0-0/1234", or star-slash-0 for an empty table — which
     cannot be written out here, because that sequence would close this very
     comment. It did, once. */
  const cr = r.headers.get("content-range") || "";
  const total = cr.split("/")[1];
  const n = Number(total);
  if (!Number.isFinite(n)) {
    const e = new Error("Could not read a row count for " + table + " (got \"" + cr + "\")");
    e.status = 502; throw e;
  }
  return n;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * ORDERING, AND WHY IT IS DISCOVERED RATHER THAN WRITTEN DOWN
 *
 * Paging needs a stable order. Without one, PostgREST may return a row twice
 * across two pages and miss another entirely — and the result would still
 * arrive looking like a normal backup.
 *
 * Not every table here has an `id`: several are keyed on a pair or a triple.
 * The first version of this file carried a hand-written map of which column to
 * order each of those by, and the map was WRONG — `crew_availability` keyed on
 * roster_id, not crew_id; `distance_cache` on origin_key, not origin; and
 * show_costing was not in it at all, so it would have tried `id` and failed.
 * Every one of those was a guess made from memory rather than from the
 * database, and none of them would have been caught until the day someone
 * needed the backup.
 *
 * So nothing is written down. One row is read, and the order is taken from the
 * columns that row actually has: `id` when there is one, and otherwise EVERY
 * column, which makes the ordering total and therefore the paging stable. A
 * map cannot go stale if there is no map.
 * ───────────────────────────────────────────────────────────────────────────── */
async function orderFor(table) {
  const one = await supabaseRest(
    "GET", "/" + encodeURIComponent(table) + "?select=*&limit=1", null);
  const row = Array.isArray(one) && one[0];
  if (!row) return "";                       // empty table: nothing to page
  const cols = Object.keys(row);
  if (cols.includes("id")) return "id.asc";
  /* Ordering by every column is a total order unless two rows are identical
     in every field — in which case they are interchangeable and paging is
     stable anyway. */
  return cols.map((c) => c + ".asc").join(",");
}

async function dumpOne(table) {
  const order = await orderFor(table);
  if (!order) {
    /* Empty, or gone. A missing table throws out of orderFor and is handled by
       the caller; an empty one legitimately has no rows. */
    return [];
  }
  const rows = [];
  let guard = 0;
  for (;;) {
    let page;
    try {
      page = await supabaseRest(
        "GET",
        "/" + encodeURIComponent(table) + "?select=*&order=" + order +
          "&limit=" + PAGE + "&offset=" + rows.length, null);
    } catch (e) {
      /* An ordering column that does not exist, or a table that has been
         renamed. Named, because "the backup failed" with no table in it is a
         message nobody can act on. */
      e.message = "Could not read " + table + ": " + (e.message || "unknown error");
      throw e;
    }
    const got = Array.isArray(page) ? page : [];
    if (!got.length) break;
    rows.push(...got);
    if (++guard > 10000) {
      const e = new Error("Paging " + table + " did not finish — stopped at " + rows.length + " rows.");
      e.status = 500; throw e;
    }
  }
  return rows;
}

/* The whole backup, verified.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW THE VERIFICATION NEARLY MADE THE BACKUP USELESS
 *
 * The first version counted each table AFTER dumping it, and refused if the
 * count was higher than what it had collected. The comment even argued for it.
 * The argument was wrong, and running the suite against a database another
 * process was writing to showed it in one line:
 *
 *     This backup came out short and has NOT been saved: activity (1 of 2).
 *
 * Nothing was short. A row had simply been written while the backup ran — and
 * `activity` is written on essentially every action in this app. On a live
 * database that refusal would have fired most of the time, and a backup that
 * usually refuses is a backup nobody takes. It would have been strictly worse
 * than no verification at all.
 *
 * WHAT A BACKUP ACTUALLY PROMISES is a snapshot: everything that existed when
 * it started. A row created while it runs is legitimately not in it. A row that
 * existed when it started and is NOT in it is the failure.
 *
 * So the count is taken BEFORE and AFTER, and what must be accounted for is the
 * SMALLER of the two:
 *
 *   rows inserted during the run   -> after > before; compared against before,
 *                                     which the dump does cover. No false alarm.
 *   rows deleted during the run    -> after < before; compared against after,
 *                                     so a legitimately vanished row is not
 *                                     reported as a lost one.
 *   a server-side row cap          -> both counts agree and both exceed what
 *                                     was collected. REFUSED, which is the
 *                                     whole point.
 * ───────────────────────────────────────────────────────────────────────────── */
/* `io` exists so the refusal can be tested.
 *
 * The short-backup branch below is, by construction, only reachable when
 * something is genuinely wrong — which meant no test could reach it, and a
 * mutant that turned the refusal into a shrug survived a full mutation run
 * unnoticed. Two optional readers, defaulting to the real ones, let a test say
 * "the dump returned 50 rows and the database says there are 130" and assert
 * what happens. Nothing in the app passes them. */
export async function buildBackup(only, io) {
  const count = (io && io.count) || countOf;
  const dump = (io && io.dump) || dumpOne;
  const list = only ? [only] : TABLES;
  const tables = {};
  const counts = {};
  const short = [];
  const missing = [];
  const before = {};

  /* A 404 is not always a dropped table. PostgREST keeps a schema cache, and
     while it reloads one — which happens after any migration — every table
     answers 404 for a moment. Treating that as "gone" would quietly leave real
     tables out of a backup taken just after a deploy, which is exactly when
     someone is most likely to take one. So a 404 is looked at twice, a breath
     apart, and only a table that is still missing on the second look is
     recorded as missing. */
  const seemsGone = (e) =>
    e && (e.status === 404 || /does not exist|Could not find/i.test(e.message || ""));

  for (const t of list) {
    try {
      try {
        before[t] = await count(t);
      } catch (e) {
        if (!seemsGone(e)) throw e;
        await new Promise((r) => setTimeout(r, 700));
        before[t] = await count(t);
      }
      tables[t] = await dump(t);
    } catch (e) {
      /* A TABLE THAT IS NOT THERE AT ALL IS NOT THE SAME AS ONE THAT CAME BACK
         SHORT, and the two get opposite treatment on purpose.

         Short means truncation — the backup is wrong in a way nobody can see,
         so it is refused outright.

         Absent means this list has fallen behind the database: a table renamed
         or dropped. Refusing there would mean NO backup on the day one is
         wanted, over a table that may not exist any more anyway. So it is
         recorded — in the file, in the response, and by name — and the rest is
         still taken. Silently skipping it is the one thing not on offer. */
      if (seemsGone(e)) { missing.push(t); continue; }
      throw e;
    }
  }
  for (const t of list) {
    if (missing.includes(t)) continue;
    const after = await count(t);
    /* The recorded count is what is IN THIS FILE, not what the database
       happened to hold a moment later. A restore checking itself must check
       against the file's own contents; a number taken from elsewhere would
       have it reporting a discrepancy on every backup taken while anyone was
       using the app. */
    counts[t] = tables[t].length;
    const missed = shortfall(tables[t].length, before[t], after);
    if (missed) {
      short.push(t + " (" + tables[t].length + " of " +
                 (tables[t].length + missed) + ")");
    }
  }

  if (short.length) {
    /* THE REFUSAL. Not a warning on a backup that gets saved anyway — this is
       the whole reason the counts are taken. */
    const e = new Error(
      "This backup came out short and has NOT been saved: " + short.join(", ") +
      ". Try again in a moment; if it keeps happening, take the tables one at a " +
      "time with ?table=<name>.");
    e.status = 500;
    throw e;
  }

  return {
    format: "touchstone-command-backup",
    version: 1,
    generatedAt: new Date().toISOString(),
    generatedLocal: stampNow(),
    /* What is NOT in here, said plainly inside the file itself, because the
       person reading it during a crisis is not going to have this comment. */
    doesNotInclude: [
      "Uploaded files in Supabase Storage: the 'crewdocs', 'receipts' and " +
      "'venuefiles' buckets. NOTE that venue_files rows ARE in here, so this " +
      "backup will tell you exactly which drawings and photos existed and what " +
      "they were called — but not their contents.",
      "Supabase Auth accounts and passwords.",
      "Environment variables and API keys.",
      ...(missing.length
        ? ["These tables were expected but NOT FOUND in the database, so they are " +
           "absent from this backup: " + missing.join(", ") + "."]
        : []),
    ],
    /* Repeated as its own field as well as in the sentence above, so that
       anything reading this file mechanically can find it without parsing
       prose. */
    missingTables: missing,
    rebuildable: [...REBUILDABLE],
    counts,
    tables,
  };
}

export default async function handler(req, res) {
  const p = auth(req);
  if (!p) return json(res, 401, { error: "Not signed in" });
  /* Everything, about everyone: crew dates of birth, passport expiry,
     emergency contacts, every client and every figure. Admin only, and never
     reachable with a show password. */
  if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });

  const q = req.query || {};

  try {
    /* ---- what a backup would contain, without building one -------------- */
    if (q.manifest) {
      const rows = {};
      const missing = [];
      let total = 0;
      for (const t of TABLES) {
        try { rows[t] = await countOf(t); total += rows[t]; }
        catch (e) {
          /* Same rule as the backup itself: named, never skipped in silence.
             The manifest is what the screen shows before anyone presses
             Download, so this is where a stale table list should become
             visible. */
          missing.push(t);
        }
      }
      return json(res, 200, {
        ok: true, tables: TABLES.length, totalRows: total, rows, missingTables: missing,
        generatedLocal: stampNow(),
      });
    }

    const only = q.table ? String(q.table) : "";
    if (only && !TABLES.includes(only)) {
      return json(res, 400, { error: "No such table in the backup set: " + only });
    }

    const backup = await buildBackup(only);
    const body = Buffer.from(JSON.stringify(backup), "utf8");
    const gz = zlib.gzipSync(body, { level: 9 });

    if (gz.length > MAX_DOWNLOAD_BYTES) {
      /* Refuse, with the numbers and a way forward. NOT a truncated file:
         a backup cut off to fit a response limit is the exact thing this
         whole file is written to prevent. */
      return json(res, 413, {
        error: "This backup is " + Math.round(gz.length / 1048576 * 10) / 10 +
          " MB compressed, which is past what a single download can carry. " +
          "Take the big tables one at a time with ?table=<name>, or set up the " +
          "scheduled backup, which has no such limit.",
        bytes: gz.length,
        counts: backup.counts,
      });
    }

    const name = "touchstone-backup-" +
      new Date().toISOString().slice(0, 10) + (only ? "-" + only : "") + ".json.gz";

    res.status(200);
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", 'attachment; filename="' + name + '"');
    res.setHeader("Content-Length", String(gz.length));
    /* Nothing caches a backup. */
    res.setHeader("Cache-Control", "no-store");
    return res.end(gz);
  } catch (e) {
    return json(res, e.status || 500, { error: (e && e.message) || "Server error" });
  }
}
