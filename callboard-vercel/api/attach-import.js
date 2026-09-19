// /api/attach-import — an imported job that already had a show.
//
//   GET  ?pairs=1                     every imported stub, with its best match
//   GET  ?preview=1&stub=&keep=       exactly what would move, and what would not
//   POST ?commit=1  { stub, keep }    move it
//   GET  ?undo=1                      what can be put back
//   POST ?undo=<id>                   put one back
//
// SETUP: run sql/setup-attach-import.sql. Admin only.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS IS NOT A "MERGE SHOWS" TOOL, AND WHY THAT MATTERS
//
//   The past-jobs importer creates a show for every job it reads, because most
//   of them are jobs from years ago that were never in the app. When one of
//   them WAS already in the app, the result is two shows: the real one, with
//   its crew and schedule and tasks, and a stub carrying the quote.
//
//   Merging two arbitrary shows is a genuinely dangerous operation — both
//   sides can hold crew, tasks, invoices, costings and confirmations, and
//   every one of those has a collision case with no obviously right answer.
//
//   THIS IS NOT THAT. An imported show holds exactly what api/import-jobs.js
//   put in it:
//
//       name, client, start_date, end_date, category, and a data blob of
//       { client, venue?, _import }
//
//   No crew. No schedule. No tasks, invoices, expenses, costing or
//   confirmations — it is minutes old and nothing has been done to it. The
//   only things pointing at it are its own quote and that quote's line items.
//
//   So the operation is three pointers and a delete, not a merge. That is why
//   it can be made safe, and why the FIRST thing it does is check that the
//   stub really is a stub: if anything has attached itself to one since the
//   import, the assumption above has expired and the attach refuses rather
//   than quietly discarding whatever it was.
//
// WHAT COULD STILL GO WRONG, AND IS CHECKED FOR
//
//   TWO WON QUOTES ON ONE SHOW. If the keeper already has its own won quote
//   for the same job, attaching a second one does not overwrite anything — it
//   leaves two won quotes in two different families, and every screen that
//   folds by family counts BOTH. The year's revenue silently grows by the
//   value of the job. Nothing errors, nothing looks wrong. That is refused,
//   not warned about.
//
//   A WRONG PAIR. Money on the wrong show is worse than money on a duplicate
//   show, because a duplicate is visible and a mis-attached job is not. So
//   every attach is recorded with the stub's whole row, and can be put back.
// ─────────────────────────────────────────────────────────────────────────────
import { json, readBody, auth, isAdmin, supabaseRest, logActivity } from "./_lib.js";
import { bestMatch, nameKey } from "./_jobs.js";

const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);

/* Everything that can point at a show. Written out rather than discovered,
   and the test reads this list back out of the api/ folder to check nothing
   has been forgotten — a table missing from here is a table whose rows would
   be orphaned by a delete, silently. */
export const SHOW_REFS = [
  { table: "quotes", col: "event_id" },
  { table: "tasks", col: "event_id" },
  { table: "expenses", col: "show_id" },
  { table: "billing_invoices", col: "event_id" },
  { table: "billing_adjustments", col: "event_id" },
  { table: "show_items", col: "show_id" },
  { table: "show_members", col: "show_id" },
  { table: "show_costing", col: "show_id" },
  { table: "call_acks", col: "event_id" },
  { table: "availability_requests", col: "event_id" },
  { table: "scheduled_messages", col: "show_id" },
  { table: "todoist_links", col: "event_id" },
  { table: "activity", col: "show_id" },
];

/* What an attach is allowed to move. Everything else in SHOW_REFS existing on
   a stub means the stub is not a stub any more, and the attach stops.

   Deliberately only two. A quote and its derived line items are what the
   importer created; anything else arrived afterwards and this tool has no
   business guessing what to do with it. */
export const MOVABLE = new Set(["quotes", "show_items"]);

/* `activity` is the exception in both directions: it is a log, its rows are
   not "work on the show", and its foreign key is ON DELETE SET NULL — so a
   deleted stub leaves its history intact but unattached. Moved with the rest
   so the trail follows the job, and never a reason to refuse. */
export const LOG_ONLY = new Set(["activity"]);

/* ─────────────────────────────────────────────────────────────────────────────
 * WHEN THE NAME IS NO HELP
 *
 * The matcher above pairs an import with a show by name. That is the right
 * first move and it handles most of them — but the imports that most need
 * pairing are precisely the ones it cannot do, because a quote written as
 * "Acme Q3 Mtg" against a show built as "Acme Quarterly Meeting" is the same
 * job to a human and nothing alike to a string comparison.
 *
 * So for those, this offers the other two things the rows have in common: the
 * CLIENT and the DATES. Neither is conclusive and neither is offered as a
 * match — they are ranked hints, shown with the reason in words, and the pair
 * is still previewed and confirmed by hand before anything moves.
 *
 * Deliberately NOT scored on a scale anybody sees. "0.62" on a screen is not
 * a reason to click yes.
 * ───────────────────────────────────────────────────────────────────────────── */
const DAY = 86400000;
const clientKey = (v) => String(v || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

export function nearby(stub, real, max = 5) {
  const sc = clientKey(stub.client);
  const sd = stub.start_date ? Date.parse(stub.start_date + "T00:00:00Z") : NaN;

  const out = [];
  for (const r of real) {
    const sameClient = !!sc && clientKey(r.client) === sc;
    const rd = r.start_date ? Date.parse(r.start_date + "T00:00:00Z") : NaN;
    const gap = (Number.isFinite(sd) && Number.isFinite(rd)) ? Math.abs(sd - rd) : null;

    /* Client is worth more than dates on its own, because two shows a week
       apart for different clients are not the same job and two shows for the
       same client in the same month very often are. */
    let score = 0;
    if (sameClient) score += 4;
    if (gap !== null) {
      if (gap === 0) score += 3;
      else if (gap <= 7 * DAY) score += 2;
      else if (gap <= 31 * DAY) score += 1;
    }
    if (!score) continue;

    out.push({
      id: r.id, name: r.name, client: r.client || "", startDate: r.start_date || "",
      score,
      why: sameClient && gap === 0 ? "Same client, same date."
         : sameClient && gap !== null && gap <= 7 * DAY ? "Same client, within a week."
         : sameClient && gap !== null && gap <= 31 * DAY ? "Same client, same sort of time."
         : sameClient ? "Same client."
         : gap === 0 ? "Same date, different client."
         : "Around the same time.",
    });
  }

  out.sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)));
  return out.slice(0, max);
}

const isStub = (show) => {
  const d = (show && show.data && typeof show.data === "object") ? show.data : {};
  return !!(d._import && d._import.batch);
};

async function loadShows() {
  const rows = await supabaseRest(
    "GET", "/shows?select=id,name,client,start_date,end_date,data&limit=5000", null);
  return (rows || []).map((s) => ({
    ...s,
    data: (s.data && typeof s.data === "object") ? s.data
      : (() => { try { return JSON.parse(s.data || "{}"); } catch { return {}; } })(),
  }));
}

/* How many rows in each table point at this show. One request per table, which
   is thirteen — acceptable for a screen opened a handful of times, and far
   better than guessing. */
async function refCounts(showId) {
  const out = {};
  for (const r of SHOW_REFS) {
    try {
      /* SELECT THE COLUMN BEING FILTERED ON, not `id`.
         Several of these tables have no `id` at all — show_members is keyed on
         (user_id, show_id), show_costing on show_id, todoist_links on
         todoist_id — and asking PostgREST for a column that does not exist is
         a 400. That landed in the `catch` below as "could not be checked",
         which counts as a blocker, so EVERY attach was refused with a message
         naming tables that were perfectly empty. The filter column is the one
         column guaranteed to be there. */
      const rows = await supabaseRest(
        "GET", "/" + r.table + "?" + r.col + "=eq." + encodeURIComponent(showId) +
          "&select=" + r.col + "&limit=200", null);
      out[r.table] = (rows || []).length;
    } catch (e) {
      /* A MISSING TABLE OR COLUMN IS A GENUINE ZERO, NOT AN UNKNOWN.
         If `billing_adjustments` does not exist, or has no `event_id`, then no
         row in it can possibly point at this show — there is nothing to
         orphan. Treating that as "could not be checked" made it a blocker, and
         since a blocker refuses the attach, one absent table anywhere in this
         list would have refused EVERY attach with a message naming tables that
         held nothing.

         What must still block is a real failure — a timeout, a 500, the
         database refusing — because then rows may well exist and this simply
         could not see them. Those two are opposite answers and were being
         given the same one. */
      const msg = String((e && e.message) || "");
      const gone = e && (e.status === 404 || e.status === 400) &&
                   /does not exist|Could not find/i.test(msg);
      out[r.table] = gone ? 0 : null;
      if (gone) (out.__absent = out.__absent || []).push(r.table);
    }
  }
  return out;
}

/* What is in the way. Anything on the stub that is not movable and not a log
   means the stub has been worked on since the import. */
export function blockers(counts) {
  const out = [];
  for (const r of SHOW_REFS) {
    if (MOVABLE.has(r.table) || LOG_ONLY.has(r.table)) continue;
    const n = counts[r.table];
    if (n === null) { out.push(r.table + " (could not be checked)"); continue; }
    if (n > 0) out.push(n + " in " + r.table);
  }
  return out;
}

export default async function handler(req, res) {
  const p = auth(req);
  if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
  const q = req.query || {};

  try {
    /* ---- what can be put back ------------------------------------------- */
    if (req.method === "GET" && q.undo) {
      const rows = await supabaseRest(
        "GET", "/attach_log?select=*&undone_at=is.null&order=created_at.desc&limit=200", null);
      return json(res, 200, {
        ok: true,
        attaches: (rows || []).map((r) => ({
          id: r.id, stubName: r.stub_name, keepName: r.keep_name,
          quotes: r.moved_quotes, items: r.moved_items, at: r.created_at,
        })),
      });
    }

    /* ---- the pairs ------------------------------------------------------- */
    if (req.method === "GET" && q.pairs) {
      const shows = await loadShows();
      const stubs = shows.filter(isStub);
      const real = shows.filter((s) => !isStub(s));

      const pairs = [];
      for (const s of stubs) {
        const m = bestMatch(s.name, real);
        const keep = m ? real.find((r) => r.id === m.id) : null;

        /* Dates agreeing is what turns a name match into a confident one: two
           shows for the same client can share a name across years, and putting
           2024's money on 2026's job is the mistake this whole screen exists
           to avoid. */
        const sameStart = !!(keep && s.start_date && keep.start_date &&
                             s.start_date === keep.start_date);
        const closeDates = !!(keep && s.start_date && keep.start_date &&
          Math.abs(Date.parse(s.start_date + "T00:00:00Z") -
                   Date.parse(keep.start_date + "T00:00:00Z")) <= 3 * 86400000);

        pairs.push({
          stub: { id: s.id, name: s.name, client: s.client || "",
                  startDate: s.start_date || "", endDate: s.end_date || "",
                  batch: (s.data._import && s.data._import.batch) || null,
                  invoiceNo: (s.data._import && s.data._import.invoiceNo) || null },
          match: keep ? {
            id: keep.id, name: keep.name, client: keep.client || "",
            startDate: keep.start_date || "",
            score: m.score,
            /* Said in words. "0.67" on screen is not a reason to click yes. */
            why: m.exact && sameStart ? "Same name, same date."
               : m.exact ? "Same name, but the dates differ."
               : sameStart ? "Close name, same date."
               : closeDates ? "Close name, dates within a few days."
               : "Close name only — check this one.",
            confident: !!(m.exact && sameStart),
          } : null,
          /* Offered whether or not the name matched. When it did not, this is
             the only lead there is; when it did, it is how a wrong suggestion
             gets corrected without hunting through every show in the list. */
          near: nearby(s, real),
        });
      }

      /* Best first, so the obvious ones are dealt with in one pass and the
         doubtful ones are what is left. */
      pairs.sort((a, b) => (b.match ? b.match.score : 0) - (a.match ? a.match.score : 0));

      return json(res, 200, {
        ok: true,
        stubs: stubs.length,
        matched: pairs.filter((x) => x.match).length,
        confident: pairs.filter((x) => x.match && x.match.confident).length,
        pairs,
        /* EVERY SHOW THAT COULD BE PAIRED WITH, so the picker can filter as
           fast as Tyler types rather than going back to the server on every
           keystroke. Four fields each — this is a list to choose from, not a
           copy of the shows table, and the attach itself re-reads both rows
           from the database anyway. */
        shows: real
          .map((r) => ({ id: r.id, name: r.name, client: r.client || "",
                         startDate: r.start_date || "" }))
          .sort((a, b) => String(b.startDate).localeCompare(String(a.startDate))),
      });
    }

    const stubId = str(q.stub, 100);
    const keepId = str(q.keep, 100);

    /* ---- preview, and the same checks the commit makes -------------------- */
    if (req.method === "GET" && q.preview) {
      const plan = await buildPlan(stubId, keepId);
      return json(res, plan.ok ? 200 : 409, plan);
    }

    /* ---- do it ------------------------------------------------------------ */
    if (req.method === "POST" && q.commit) {
      const b = await readBody(req);
      const sId = str((b && b.stub) || stubId, 100);
      const kId = str((b && b.keep) || keepId, 100);

      /* The plan is rebuilt here rather than trusted from the preview: the
         preview may be minutes old, and in between someone could have put a
         quote on the keeper or a receipt on the stub. */
      const plan = await buildPlan(sId, kId);
      if (!plan.ok) return json(res, 409, plan);

      const moved = { quotes: [], items: [], activity: 0 };

      /* Quotes first. If this fails, nothing has happened yet. */
      for (const qq of plan.moving.quotes) {
        await supabaseRest("PATCH", "/quotes?id=eq." + encodeURIComponent(qq.id),
          { event_id: kId }, "return=minimal");
        moved.quotes.push(qq.id);
      }
      for (const it of plan.moving.items) {
        await supabaseRest("PATCH", "/show_items?id=eq." + encodeURIComponent(it.id),
          { show_id: kId }, "return=minimal");
        moved.items.push(it.id);
      }
      /* The log follows the job. Best effort: a history row that stayed behind
         is untidy, not wrong, and is not worth failing an attach over. */
      try {
        await supabaseRest("PATCH", "/activity?show_id=eq." + encodeURIComponent(sId),
          { show_id: kId }, "return=minimal");
        moved.activity = plan.counts[ "activity" ] || 0;
      } catch (e) { /* untidy, not wrong */ }

      /* Gaps on the keeper filled from the stub, never the other way round.
         The keeper is the show Tyler built; the stub only ever contributes
         what the keeper does not already have. */
      const patch = {};
      if (!plan.keep.start_date && plan.stub.start_date) patch.start_date = plan.stub.start_date;
      if (!plan.keep.end_date && plan.stub.end_date) patch.end_date = plan.stub.end_date;
      if (!plan.keep.client && plan.stub.client) patch.client = plan.stub.client;

      const keepData = { ...(plan.keep.data || {}) };
      let dataChanged = false;
      const stubVenue = plan.stub.data && plan.stub.data.venue;
      const keepVenue = keepData.venue;
      if (stubVenue && !(keepVenue && (keepVenue.name || keepVenue.address))) {
        keepData.venue = stubVenue; dataChanged = true;
      }
      if (dataChanged) patch.data = keepData;

      if (Object.keys(patch).length) {
        await supabaseRest("PATCH", "/shows?id=eq." + encodeURIComponent(kId),
          patch, "return=minimal");
      }

      /* THE WHOLE STUB, RECORDED BEFORE IT GOES. A deleted show cannot be
         recovered from anywhere else, and a wrong pair discovered next week
         must be reversible. */
      await supabaseRest("POST", "/attach_log", {
        stub_id: sId,
        stub_name: plan.stub.name || "",
        stub_row: plan.stub,
        keep_id: kId,
        keep_name: plan.keep.name || "",
        keep_patch: patch,
        moved_quotes: moved.quotes,
        moved_items: moved.items,
        actor: str(p.name || p.sub, 200),
      }, "return=minimal");

      await supabaseRest("DELETE", "/shows?id=eq." + encodeURIComponent(sId), null);

      /* logActivity never throws — see rule 1 in _lib.js — so this is not
         wrapped. The attach has already happened; a missing feed entry is
         untidy and must not look like a failure. */
      await logActivity(p, "show.attached",
        "Imported job \"" + (plan.stub.name || "") + "\" attached to this show",
        { showId: kId, actorName: str(p.name || p.sub, 200),
          meta: { stubId: sId, quotes: moved.quotes.length } });

      return json(res, 200, {
        ok: true,
        movedQuotes: moved.quotes.length,
        movedItems: moved.items.length,
        filled: Object.keys(patch),
      });
    }

    /* ---- put one back ----------------------------------------------------- */
    if (req.method === "POST" && q.undo) {
      const id = str(q.undo, 100);
      const rows = await supabaseRest(
        "GET", "/attach_log?id=eq." + encodeURIComponent(id) + "&select=*&limit=1", null);
      const rec = rows && rows[0];
      if (!rec) return json(res, 404, { error: "No such attach." });
      if (rec.undone_at) return json(res, 409, { error: "That one has already been put back." });

      /* The stub first, so the rows have somewhere to go back TO. Recreated
         with its original id, which is what makes the quotes point at the same
         show they did before. */
      const stub = rec.stub_row || {};
      await supabaseRest("POST", "/shows", {
        id: rec.stub_id,
        name: stub.name || "",
        client: stub.client || null,
        start_date: stub.start_date || null,
        end_date: stub.end_date || null,
        category: stub.category || "tcg",
        data: stub.data || {},
      }, "return=minimal");

      for (const qid of (rec.moved_quotes || [])) {
        await supabaseRest("PATCH", "/quotes?id=eq." + encodeURIComponent(qid),
          { event_id: rec.stub_id }, "return=minimal");
      }
      for (const iid of (rec.moved_items || [])) {
        await supabaseRest("PATCH", "/show_items?id=eq." + encodeURIComponent(iid),
          { show_id: rec.stub_id }, "return=minimal");
      }

      /* The gaps this attach filled on the keeper are emptied again, but ONLY
         the ones it filled and ONLY if they still hold what it put there. A
         date Tyler has since corrected by hand is his, not this tool's to
         revert. */
      const patch = rec.keep_patch || {};
      if (Object.keys(patch).length) {
        const kr = await supabaseRest(
          "GET", "/shows?id=eq." + encodeURIComponent(rec.keep_id) +
            "&select=id,client,start_date,end_date,data&limit=1", null);
        const keep = kr && kr[0];
        if (keep) {
          const undoPatch = {};
          for (const k of ["start_date", "end_date", "client"]) {
            if (k in patch && String(keep[k] || "") === String(patch[k] || "")) undoPatch[k] = null;
          }
          if ("data" in patch) {
            const kd = (keep.data && typeof keep.data === "object") ? { ...keep.data } : {};
            const put = patch.data && patch.data.venue;
            const now = kd.venue;
            if (put && now && JSON.stringify(now) === JSON.stringify(put)) {
              delete kd.venue; undoPatch.data = kd;
            }
          }
          if (Object.keys(undoPatch).length) {
            await supabaseRest("PATCH", "/shows?id=eq." + encodeURIComponent(rec.keep_id),
              undoPatch, "return=minimal");
          }
        }
      }

      await supabaseRest("PATCH", "/attach_log?id=eq." + encodeURIComponent(id),
        { undone_at: new Date().toISOString() }, "return=minimal");

      return json(res, 200, { ok: true, restored: rec.stub_name || "" });
    }

    return json(res, 400, { error: "Nothing to do. Use ?pairs=1, ?preview=1 or ?commit=1." });
  } catch (e) {
    return json(res, e.status || 500, { error: (e && e.message) || "Server error" });
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * THE PLAN, WHICH IS ALSO THE REFUSAL
 *
 * Built by both the preview and the commit, from the same function, because a
 * preview that checks one thing and a commit that checks another is how a
 * screen tells you it is safe and then does something else.
 * ───────────────────────────────────────────────────────────────────────────── */
async function buildPlan(stubId, keepId) {
  if (!stubId || !keepId) return { ok: false, error: "Both a stub and a show to keep are needed." };
  if (stubId === keepId) return { ok: false, error: "That is the same show twice." };

  const rows = await supabaseRest(
    "GET", "/shows?id=in.(" + encodeURIComponent(stubId) + "," + encodeURIComponent(keepId) + ")" +
      "&select=id,name,client,start_date,end_date,category,data&limit=2", null);
  const byId = new Map((rows || []).map((r) => [r.id, {
    ...r,
    data: (r.data && typeof r.data === "object") ? r.data
      : (() => { try { return JSON.parse(r.data || "{}"); } catch { return {}; } })(),
  }]));
  const stub = byId.get(stubId), keep = byId.get(keepId);
  if (!stub) return { ok: false, error: "That imported show is not there any more." };
  if (!keep) return { ok: false, error: "The show to keep is not there any more." };

  /* Only an IMPORTED show may be the one that goes. Without this the endpoint
     is a general show-delete with extra steps, and the safety of everything
     above rests on the stub being what the importer made. */
  if (!isStub(stub)) {
    return { ok: false, error: "\"" + (stub.name || "That show") + "\" was not created by an " +
      "import, so this is not the tool for it. Only an imported job can be attached to a show." };
  }
  if (isStub(keep)) {
    return { ok: false, error: "Both of those were created by the import. Attach one to a show " +
      "you built, not to another import." };
  }

  const counts = await refCounts(stubId);
  const inTheWay = blockers(counts);
  if (inTheWay.length) {
    return { ok: false,
      error: "\"" + (stub.name || "That show") + "\" has had work done on it since the import (" +
        inTheWay.join(", ") + "). Attaching would throw that away, so it has not been touched.",
      counts };
  }

  const [stubQuotes, stubItems, keepQuotes] = await Promise.all([
    supabaseRest("GET", "/quotes?event_id=eq." + encodeURIComponent(stubId) +
      "&select=id,name,status,total,family_id&limit=200", null),
    supabaseRest("GET", "/show_items?show_id=eq." + encodeURIComponent(stubId) +
      "&select=id&limit=2000", null),
    supabaseRest("GET", "/quotes?event_id=eq." + encodeURIComponent(keepId) +
      "&select=id,name,status,total,family_id&limit=200", null),
  ]);

  /* THE DOUBLE COUNT. Two won quotes on one show are two families, and every
     screen that folds by family counts both — the year's revenue grows by the
     value of the job, with nothing on screen to say so. A refusal, not a
     warning beside a button that still works. */
  const wonComing = (stubQuotes || []).filter((x) => x.status === "won");
  const wonThere = (keepQuotes || []).filter((x) => x.status === "won");
  if (wonComing.length && wonThere.length) {
    return { ok: false,
      error: "\"" + (keep.name || "That show") + "\" already has a won quote on it (" +
        (wonThere[0].name || "untitled") + "). Attaching a second one would count the job " +
        "twice in every revenue figure. Decide which quote is the real one first.",
      keepWon: wonThere.map((x) => ({ id: x.id, name: x.name, total: x.total })) };
  }

  const fills = [];
  if (!keep.start_date && stub.start_date) fills.push("start date (" + stub.start_date + ")");
  if (!keep.end_date && stub.end_date) fills.push("end date (" + stub.end_date + ")");
  if (!keep.client && stub.client) fills.push("client (" + stub.client + ")");
  const kv = keep.data && keep.data.venue;
  if (stub.data.venue && !(kv && (kv.name || kv.address))) {
    fills.push("venue (" + ((stub.data.venue || {}).name || "address only") + ")");
  }

  return {
    ok: true,
    stub, keep, counts,
    moving: {
      quotes: (stubQuotes || []).map((x) => ({ id: x.id, name: x.name, status: x.status, total: x.total })),
      items: (stubItems || []).map((x) => ({ id: x.id })),
      activity: counts.activity || 0,
    },
    /* Gaps on the keeper that the stub can fill. Nothing the keeper already
       has is touched. */
    fills,
    /* Said plainly, because the next click deletes a show. */
    summary: (stubQuotes || []).length + " quote" + ((stubQuotes || []).length === 1 ? "" : "s") +
      " and " + (stubItems || []).length + " line item" + ((stubItems || []).length === 1 ? "" : "s") +
      " move to \"" + (keep.name || "") + "\", then \"" + (stub.name || "") + "\" is removed.",
  };
}
