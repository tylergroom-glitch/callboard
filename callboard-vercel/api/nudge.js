// /api/nudge — the deadline reminder, straight to Telegram.
//
//   GET /api/nudge            the deadline check (needs the CRON_SECRET header)
//   GET /api/nudge?morning=1  the daily list, same header
//   GET /api/nudge?loose=1    the afternoon poke about undated tasks
//   GET /api/nudge?dry=1      admin only: what WOULD be sent, and why each task
//                             was or was not picked. Sends nothing. Combine with
//                             &morning=1 to preview that instead.
//   GET /api/nudge?test=1     admin only: send one test message now and report
//                             exactly what Telegram said. The button for it is
//                             in Settings → Inbox & alerts.
//
// NOTE: both of the above need a signed-in admin's bearer token, so neither
// works by pasting the URL into a browser tab — an earlier version of this
// comment said "in a browser", which it never was.
//
// IF THE REMINDERS ARE SILENT, IN ORDER:
//   1. Settings → Inbox & alerts → Send a test message. That answers "can this
//      deployment reach my phone" on its own, without the schedule involved.
//   2. If the test works but reminders do not, the cron is not running.
//      Vercel invokes cron jobs ONLY on production deployments, never on
//      previews, and vercel.json must be at the REPOSITORY ROOT — not in /api,
//      where it is silently ignored. Vercel → Settings → Cron Jobs shows what
//      is actually registered.
//
// SETUP: run sql/setup-task-times.sql, then add a cron in api/vercel.json.
// Needs CRON_SECRET and TELEGRAM_BOT_TOKEN, both of which already exist.
//
// WHY TELEGRAM AND NOT A PUSH NOTIFICATION
//   Telegram is already a native app on Tyler's phone, already has his id on
//   the allowlist, and already has a working notifier in _lib.js. Web push
//   would mean a service worker, VAPID keys, an install walkthrough, and
//   subscriptions that die silently — for the same notification. This is the
//   same feature for a tenth of the work, and unlike push it can actually be
//   tested without a physical device.
//
// THE WHOLE DESIGN IS "DO NOT BECOME NOISE"
//   A reminder people mute is worse than no reminder, because you go on
//   believing you were told. So: one message per deadline, ever. Silence when
//   there is nothing. Nothing fires twice.
import { json, auth, isAdmin, supabaseRest, telegramNotify } from "./_lib.js";

const BUSINESS_TZ = "America/Los_Angeles";

/* How long before a deadline to speak up. Long enough to still do something,
   short enough that it is not just the morning digest again. */
const LEAD_MINUTES = 120;

/* Quiet hours, as wall-clock minutes in the business timezone. Nothing is sent
   outside these; a reminder that wakes you is a reminder you turn off.
   
   Enforced HERE rather than by narrowing the cron window, because a cron
   window is written in UTC and the offset changes twice a year — an evening
   nudge would quietly stop working every November and nobody would notice
   until something was missed. This reads the same Pacific clock as everything
   else, so it is correct on both sides of a clock change.
   
   A deadline falling inside quiet hours simply gets no proximity nudge; the
   morning digest still lists it. Nothing is marked, so nothing is consumed. */
const QUIET_FROM = 21 * 60;      // 21:00
const QUIET_UNTIL = 6 * 60 + 30; // 06:30

export const inQuietHours = (minutes) =>
  minutes >= QUIET_FROM || minutes < QUIET_UNTIL;

/* Everything here compares WALL-CLOCK time in the business timezone and never
   builds a UTC instant. That is deliberate: due_time is a wall-clock time, so
   turning "3pm Friday" into an instant means picking an offset, and picking it
   wrong across a DST boundary shifts every deadline by an hour in the
   direction nobody checks. Asking the platform "what is it in Los Angeles
   right now" is correct on both sides of a clock change, every year, with no
   table of rules to maintain.

   This is the same trap that made a digest test pass against the container's
   UTC clock while the code under test used Pacific — caught then by a test
   that reproduced it, and avoided here by not doing the arithmetic at all. */
function nowLocal(at) {
  const d = at ? new Date(at) : new Date();
  const date = d.toLocaleDateString("en-CA", { timeZone: BUSINESS_TZ });  // YYYY-MM-DD
  const time = d.toLocaleTimeString("en-GB", {
    timeZone: BUSINESS_TZ, hour12: false,
    hour: "2-digit", minute: "2-digit",
  });                                                                     // HH:MM
  return { date, time, minutes: hhmmToMinutes(time) };
}

function hhmmToMinutes(t) {
  const m = /^(\d{2}):(\d{2})/.exec(String(t || ""));
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

const hhmm = (t) => String(t || "").slice(0, 5);

/* The identity of a deadline, and therefore of a nudge. Stored on the task
   after sending and compared on every later run, so moving a task to another
   day or time produces a different key and it becomes eligible again on its
   own — no flag to remember to clear. */
const deadlineKey = (task) => task.due + " " + hhmm(task.due_time);

/* Decide, for one task, whether now is the moment. Pure, so it can be tested
   against any clock rather than only the one the test machine happens to have. */
export function shouldNudge(task, now, leadMinutes) {
  if (!task || task.status !== "open") return { send: false, why: "not open" };
  if (!task.due) return { send: false, why: "no due date" };
  if (!task.due_time) return { send: false, why: "no due time — the daily digest covers this one" };

  const key = deadlineKey(task);
  if (task.nudged_for === key) return { send: false, why: "already nudged for this deadline" };

  if (task.due > now.date) return { send: false, why: "not until " + task.due };
  /* Something whose day has passed is overdue, and overdue is the morning
     digest's job. Nudging about it now would be a reminder that arrives after
     it stopped being useful. */
  if (task.due < now.date) return { send: false, why: "overdue — the digest covers this one" };

  const dueMin = hhmmToMinutes(task.due_time);
  if (dueMin === null) return { send: false, why: "unreadable due time" };
  const left = dueMin - now.minutes;

  /* Already past its time today: say nothing. The window was missed — either
     the task was created after its own deadline, or a run was skipped. Firing
     late teaches you the reminder cannot be trusted for timing. */
  if (left < 0) return { send: false, why: "its time has passed today", key };
  if (left > leadMinutes) return { send: false, why: "still " + left + " minutes away", key };
  return { send: true, why: left + " minutes away", key, left };
}

function line(task, left) {
  const when = left <= 0 ? "now" : left < 60
    ? "in " + left + " min"
    : "in " + (Math.round(left / 30) / 2) + "h";
  const p = task.priority === "high" ? "❗ " : "";
  return "• " + p + (task.title || "Untitled") + " — due " + hhmm(task.due_time) + ", " + when;
}

/* The morning list: everything open that wants attention today. Deliberately
   NOT the email digest's job moved — that keeps running, untouched, with the
   money in it. This is the short version, on the phone, tasks only, because a
   lock screen is not where a receivables position belongs.

   Money was excluded on purpose: a longer message is a less-read one, and this
   one has to survive being glanced at. */
async function morningList(now) {
  let rows = [];
  try {
    rows = await supabaseRest(
      "GET",
      "/tasks?status=eq.open&select=id,title,due,due_time,priority,review,created_at&limit=500",
      null) || [];
  } catch (e) { return null; }

  const out = { review: [], overdue: [], today: [], loose: [] };
  for (const t of rows) {
    /* Waiting on a yes is waiting on a yes whether or not it also has a date.
       Listing it twice would make the morning look busier than the work is. */
    if (t.review) { out.review.push(t); continue; }
    if (!t.due) { out.loose.push(t); continue; }
    if (t.due < now.date) out.overdue.push(t);
    else if (t.due === now.date) out.today.push(t);
  }
  const byTime = (a, b) => String(a.due_time || "99").localeCompare(String(b.due_time || "99"));
  out.today.sort(byTime);
  out.overdue.sort((a, b) => String(a.due).localeCompare(String(b.due)));
  /* Undated work is the pile that quietly grows — "respond to emails", "do
     diagrams". Oldest and most important first, because those are the ones
     worth finishing. */
  const rank = (t) => (t.priority === "high" ? 0 : t.priority === "med" ? 1 : 2);
  out.loose.sort((a, b) =>
    rank(a) - rank(b) || String(a.created_at || "").localeCompare(String(b.created_at || "")));
  out.total = out.review.length + out.overdue.length + out.today.length + out.loose.length;
  return out;
}

/* Undated tasks are nudged TWICE a day, so they are the likeliest thing here
   to become noise. Forty of them listed twice daily gets muted within a week,
   and a muted reminder is worse than none — you go on believing you were told.
   So: show the few worth acting on and count the rest. */
const LOOSE_SHOWN = 6;

function looseBlock(loose) {
  if (!loose.length) return "";
  const shown = loose.slice(0, LOOSE_SHOWN);
  const rest = loose.length - shown.length;
  return "\nNo date on these" +
    "\n" + shown.map((t) =>
      "• " + (t.priority === "high" ? "❗ " : "") + (t.title || "Untitled")).join("\n") +
    (rest > 0 ? "\n…and " + rest + " more" : "");
}

function morningMessage(list) {
  const item = (t) => "• " + (t.priority === "high" ? "❗ " : "") +
    (t.title || "Untitled") + (t.due_time ? " — " + hhmm(t.due_time) : "");
  const block = (label, arr) => arr.length ? "\n" + label + "\n" + arr.map(item).join("\n") : "";
  return "☀️ Today" +
    block("Overdue", list.overdue) +
    block("Waiting on your yes", list.review) +
    block("Due today", list.today) +
    looseBlock(list.loose);
}

/* The afternoon poke: undated work only. The morning list already carried it
   once; this is the second of the two, and it deliberately does NOT repeat
   the dated sections — a second full list would read as the same message
   twice and get muted for it. */
function looseMessage(loose) {
  return "📋 Still no date on " + loose.length +
    (loose.length === 1 ? " thing" : " things") + looseBlock(loose);
}

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });

  const dry = req.query && (req.query.dry === "1" || req.query.dry === "true");
  const test = req.query && (req.query.test === "1" || req.query.test === "true");

  /* ---- the test send ------------------------------------------------------
     Admin only, and it is the one route here that sends without the cron
     secret — deliberately, because the question it answers is "can this
     deployment message my phone at all", and that has to be answerable in one
     click rather than by reading Vercel logs.

     It is safe to open to an admin: it is signed-in-only, it sends one fixed
     sentence to the ids already on the allowlist, and it can reach no one
     else. What it buys is a clean split — if this works and the reminders do
     not, the problem is the cron, not Telegram. */
  if (test) {
    if (!isAdmin(auth(req))) return json(res, 403, { error: "Admin only" });
    const stamp = new Date().toLocaleString("en-US", {
      timeZone: BUSINESS_TZ, hour: "numeric", minute: "2-digit", timeZoneName: "short",
    });
    const r = await telegramNotify(
      "✅ Test from Crew Call\n\nIf you can read this, notifications are working.\nSent " + stamp + ".");
    return json(res, 200, {
      ok: r.sent > 0,
      sent: r.sent,
      botTokenSet: r.configured,
      idsConfigured: r.ids,
      results: r.results,
      reason: r.reason,
      /* Said here rather than left for someone to remember: a working test send
         alongside silent reminders means the schedule is not running, and on
         Vercel that is nearly always one of these two. */
      ifRemindersStillSilent:
        "Vercel runs cron jobs only on PRODUCTION deployments, never on previews — check " +
        "Settings → Git that this branch is the Production Branch. And vercel.json must sit at " +
        "the REPOSITORY ROOT, not in /api. Settings → Cron Jobs lists what is actually registered.",
    });
  }

  /* Two ways in, and only two. The cron carries the secret; a human has to be
     an admin AND ask for a dry run. There is no path that both sends and skips
     the secret — without that this is a public endpoint that messages Tyler's
     phone on demand. */
  if (dry) {
    if (!isAdmin(auth(req))) return json(res, 403, { error: "Admin only" });
  } else {
    const secret = process.env.CRON_SECRET;
    const header = req.headers.authorization || "";
    if (!secret || header !== "Bearer " + secret) {
      return json(res, 401, { error: "Unauthorized" });
    }
  }

  const now = nowLocal();
  const morning = req.query && (req.query.morning === "1" || req.query.morning === "true");
  const loose = req.query && (req.query.loose === "1" || req.query.loose === "true");

  if (loose) {
    const list = await morningList(now);
    if (!list) return json(res, 200, { ok: true, skipped: "could not read tasks" });
    if (!list.loose.length) return json(res, 200, { ok: true, sent: 0, skipped: "nothing undated" });
    const text = looseMessage(list.loose);
    if (dry) return json(res, 200, { ok: true, dryRun: true, loose: true, count: list.loose.length, message: text });
    const sent = await telegramNotify(text);
    return json(res, 200, { ok: true, sent: sent ? sent.sent : 0, count: list.loose.length });
  }

  if (morning) {
    const list = await morningList(now);
    if (!list) return json(res, 200, { ok: true, skipped: "could not read tasks" });
    /* Nothing waiting means no message. "You have nothing to do" every morning
       is how a daily message becomes wallpaper. */
    if (!list.total) return json(res, 200, { ok: true, sent: 0, skipped: "nothing open" });
    const text = morningMessage(list);
    if (dry) return json(res, 200, { ok: true, dryRun: true, morning: true, counts: {
      overdue: list.overdue.length, review: list.review.length, today: list.today.length }, message: text });
    const sent = await telegramNotify(text);
    return json(res, 200, { ok: true, sent: sent ? sent.sent : 0, counts: {
      overdue: list.overdue.length, review: list.review.length, today: list.today.length } });
  }

  if (inQuietHours(now.minutes)) {
    return json(res, 200, {
      ok: true, sent: 0, skipped: "quiet hours", now,
      ...(dry ? { dryRun: true, considered: [] } : {}),
    });
  }

  let rows = [];
  try {
    /* Only today's timed, open tasks can possibly qualify. Narrowing here
       rather than in JS keeps this cheap enough to run every 15 minutes. */
    rows = await supabaseRest(
      "GET",
      "/tasks?status=eq.open&due=eq." + now.date +
        "&due_time=not.is.null&select=id,title,due,due_time,priority,nudged_for&limit=200",
      null) || [];
  } catch (e) {
    return json(res, 200, { ok: true, skipped: "could not read tasks", error: e.message });
  }

  const considered = rows.map((t) => ({ id: t.id, title: t.title, ...shouldNudge(t, now, LEAD_MINUTES) }));
  const due = rows.filter((t) => shouldNudge(t, now, LEAD_MINUTES).send);

  if (dry) {
    return json(res, 200, {
      ok: true, dryRun: true, now,
      wouldSend: due.length,
      message: due.length ? buildMessage(due, now) : null,
      considered,
    });
  }

  // Silence is the correct output most of the time. Say nothing, mark nothing.
  if (!due.length) return json(res, 200, { ok: true, sent: 0, checked: rows.length });

  const sent = await telegramNotify(buildMessage(due, now));

  /* Mark ONLY if it actually went somewhere. Marking first would mean a
     Telegram outage silently consumes the one reminder each deadline gets —
     the failure mode where you are told nothing and believe you were told. */
  if (sent && sent.sent > 0) {
    for (const t of due) {
      try {
        await supabaseRest(
          "PATCH", "/tasks?id=eq." + encodeURIComponent(t.id),
          { nudged_for: deadlineKey(t) });
      } catch (e) { /* a failed mark repeats one reminder; a wrong mark loses it */ }
    }
  }
  return json(res, 200, { ok: true, sent: sent ? sent.sent : 0, tasks: due.length });
}

function buildMessage(due, now) {
  const head = due.length === 1 ? "⏰ Due soon" : "⏰ " + due.length + " due soon";
  return head + "\n" +
    due.map((t) => line(t, hhmmToMinutes(t.due_time) - now.minutes)).join("\n");
}
