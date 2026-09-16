// /api/tasks
//   GET    /api/tasks                list tasks (admin)
//   GET    /api/tasks?owner=me       only mine   (needs an ACCOUNT, not the
//                                    shared admin password — see below)
//   GET    /api/tasks?owner=<uuid>   only that person's
//   GET    /api/tasks?owner=none     only the ones nobody has taken
//   GET    /api/tasks?settings=1     inbox settings (allowed senders, digest on/off)
//   POST   /api/tasks                create one         { task }
//   POST   /api/tasks?settings=1     save settings      { settings }
//   PATCH  /api/tasks?id=xxx         update one         { patch }
//   DELETE /api/tasks?id=xxx         delete one
//
// Everything here is admin-only, both reading and writing. Crew never see the
// task list — it is where money, clients and unfinished business live.
//
// SETUP: run setup-tasks.sql. No new env vars for this file; the inbox needs
// its own (see api/inbox.js).
import { json, readBody, auth, isAdmin, supabaseRest, supabaseProfile, sendBrevoEmail, logActivity } from "./_lib.js";

const SETTINGS_KEY = "inbox_settings";
const BUSINESS_TZ = "America/Los_Angeles";

/* Calendar day in the business timezone. new Date().toISOString() is UTC and
   rolls over mid-afternoon Pacific, which would make things look overdue a day
   early — the same bug that was fixed across the front end in 1.17.0. */
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS_TZ });

const STATUSES = ["open", "done", "dismissed"];
const PRIORITIES = ["high", "med", "low", ""];

/* Only these columns can be written from a request. Anything else a caller
   sends is dropped rather than trusted — id, created_at and the source_*
   fields are set here or by the inbox, never by a client. */
const WRITABLE = ["title", "notes", "status", "review", "event_id", "due", "due_time", "priority", "kind", "owner_id"];

const isUuid = (v) =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/* WHO IS ASKING.

   An account token carries { sub }. The shared admin password carries
   { scope: "admin" } and no identity at all — so with it there is no such
   person as "me", and every path that needs one has to say so instead of
   quietly falling back to showing everything. */
const whoami = (p) => (p && p.sub && isUuid(p.sub) ? p.sub : null);

/* An owner has to be a real account AND an admin.

   Tasks are admin-only to read. Assigning one to a crew account would email
   somebody about a list they cannot open — a dead end that looks like it
   worked. Refusing is the only honest answer, and it is also the check that
   stops an arbitrary uuid being written into the column.

   Returns { id, name } or { error }. */
async function resolveOwner(id) {
  if (id === null || id === "") return { id: null, name: null };   // unassign
  if (!isUuid(id)) return { error: "That is not a person." };
  const prof = await supabaseProfile(id);
  if (!prof) return { error: "That account does not exist." };
  if (!prof.is_tcg) {
    return { error: "Only an admin can be given a to-do — the list is admin-only." };
  }
  return { id, name: String(prof.name || prof.email || "").slice(0, 200), email: prof.email || "" };
}

/* Whose name goes on the email. The shared admin password has no profile, so
   it is honestly "Someone" rather than a guess at which of them it was. */
async function myName(p) {
  const me = whoami(p);
  if (!me) return "Someone";
  try {
    const prof = await supabaseProfile(me);
    return String((prof && (prof.name || prof.email)) || "Someone").slice(0, 200);
  } catch { return "Someone"; }
}

/* One email, and only when the task lands on somebody ELSE. Assigning
   something to yourself is not news. Wrapped so a mail failure can never fail
   the save — the task is already written, and a 500 here would have the
   caller retry and reassign it. */
async function tellThem({ to, toName, title, due, byName, host }) {
  if (!to) return false;
  const esc = (x) => String(x == null ? "" : x)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const link = "https://" + (host || "crewcall.touchstonecreativegroup.com");
  try {
    return await sendBrevoEmail({
      to, toName,
      subject: "For you: " + String(title || "a to-do").slice(0, 120),
      html:
        `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;color:#1E293B">
<p style="font-size:15px;line-height:1.6">${esc(byName || "Someone")} put this on your list:</p>
<p style="font-size:17px;font-weight:700;line-height:1.4;margin:14px 0">${esc(title)}</p>
${due ? `<p style="font-size:14px;color:#64748B">Due ${esc(due)}</p>` : ""}
<p style="margin:22px 0"><a href="${esc(link)}"
 style="background:#0F1E35;color:#fff;text-decoration:none;padding:13px 21px;border-radius:10px;font-weight:700;font-size:15px;display:inline-block">Open Crew Call</a></p>
</div>`,
      text: (byName || "Someone") + " put this on your list:\n\n" + String(title || "") +
            (due ? "\nDue " + due : "") + "\n\n" + link + "\n",
    });
  } catch { return false; }
}

/* A wall-clock time in the business timezone, "HH:MM" or "HH:MM:SS". NOT an
   instant — a task due at 3pm is due at 3pm whichever side of a clock change
   it falls on. Anything unparseable is refused rather than coerced, because a
   deadline silently becoming midnight is worse than a rejected save. */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

function clean(input, { creating }) {
  const o = {};
  WRITABLE.forEach((k) => { if (input[k] !== undefined) o[k] = input[k]; });

  if (o.title !== undefined) o.title = String(o.title).trim().slice(0, 500);
  if (o.notes !== undefined) o.notes = String(o.notes).slice(0, 20000);
  if (o.kind !== undefined) o.kind = String(o.kind).trim().slice(0, 40);
  if (o.status !== undefined && STATUSES.indexOf(o.status) < 0) o.status = "open";
  if (o.priority !== undefined && PRIORITIES.indexOf(o.priority) < 0) o.priority = "";
  if (o.review !== undefined) o.review = !!o.review;
  // Empty string is not a null uuid or a null date; PostgREST will reject it.
  if (o.event_id !== undefined && !String(o.event_id || "").trim()) o.event_id = null;
  // Same shape as event_id: an empty string means "nobody", not a null uuid.
  if (o.owner_id !== undefined && !String(o.owner_id || "").trim()) o.owner_id = null;
  if (o.due !== undefined && !String(o.due || "").trim()) o.due = null;
  if (o.due_time !== undefined) {
    const t = String(o.due_time || "").trim();
    if (!t) o.due_time = null;
    else if (!TIME_RE.test(t)) return { error: "A due time must look like 14:30." };
    else o.due_time = t.length === 5 ? t + ":00" : t;
  }
  /* On CREATE, a missing date IS no date — the column defaults to null. Without
     this, omitting `due` entirely leaves o.due undefined, the check below is
     skipped, and the row reaches Postgres to be refused by the constraint with
     a message no human wants to read. A test enumerating the cases found this;
     reading the code did not. */
  if (creating && o.due === undefined) o.due = null;

  /* A time with no date is a deadline with no day — it can never come due, and
     it would sit in the list looking scheduled. Caught here on create and
     whenever the same request clears the date; a PATCH that sets ONLY a time
     cannot be judged without the stored row, so the caller checks that case
     and a database constraint backs up all three. */
  if (o.due_time && o.due === null) {
    return { error: "A due time needs a due date as well." };
  }
  /* Rescheduling makes any nudge already sent stale. Clearing it here means a
     moved deadline becomes eligible to warn again, without a separate step
     somewhere else that someone will forget to call. */
  if (o.due !== undefined || o.due_time !== undefined) o.nudged_for = null;

  if (creating && !o.title) return { error: "A task needs a title." };
  // done_at is derived, never sent: it is the moment the status became done,
  // and a client clock is not the authority on that.
  if (o.status === "done") o.done_at = new Date().toISOString();
  if (o.status && o.status !== "done") o.done_at = null;
  o.updated_at = new Date().toISOString();
  return { value: o };
}

async function loadSettings() {
  try {
    const rows = await supabaseRest("GET", "/app_settings?key=eq." + SETTINGS_KEY + "&select=value", null);
    const v = rows && rows[0] ? rows[0].value : null;
    return {
      // Addresses and numbers allowed to file things. An inbound address is
      // public the moment you forward from it, so an allowlist is the only
      // thing standing between your task list and anyone who learns it.
      senders: Array.isArray(v && v.senders) ? v.senders : [],
      // Numeric Telegram user ids. Separate from `senders` because they are a
      // different kind of thing: an id is issued by Telegram and cannot be
      // chosen, so it is compared exactly rather than loosely the way a phone
      // number is.
      telegramIds: Array.isArray(v && v.telegramIds) ? v.telegramIds : [],
      digest: !(v && v.digest === false),
      inboxAddress: (v && v.inboxAddress) || "",
    };
  } catch (e) {
    return { senders: [], telegramIds: [], digest: true, inboxAddress: "" };
  }
}

async function saveSettings(next) {
  const clean = {
    senders: (Array.isArray(next.senders) ? next.senders : [])
      .map((s) => String(s || "").trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 50),
    // Digits only. Anything else is a paste accident — a @username, a link —
    // and storing it would create an entry that can never match, which reads
    // later as "I am on the list" when you are not.
    telegramIds: (Array.isArray(next.telegramIds) ? next.telegramIds : [])
      .map((s) => String(s || "").trim().replace(/[^0-9]/g, ""))
      .filter(Boolean)
      .slice(0, 50),
    digest: next.digest !== false,
    inboxAddress: String(next.inboxAddress || "").trim().slice(0, 200),
  };
  await supabaseRest("POST", "/app_settings?on_conflict=key",
    { key: SETTINGS_KEY, value: clean, updated_at: new Date().toISOString() },
    "resolution=merge-duplicates");
  return clean;
}

export default async function handler(req, res) {
  const q = req.query || {};
  const p = auth(req);
  if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });

  // ---- settings -----------------------------------------------------------
  if (q.settings) {
    if (req.method === "GET") return json(res, 200, await loadSettings());
    if (req.method === "POST") {
      const body = await readBody(req);
      return json(res, 200, await saveSettings((body && body.settings) || {}));
    }
    res.status(405).end(); return;
  }

  // ---- list ---------------------------------------------------------------
  if (req.method === "GET") {
    const parts = ["select=*"];
    // Default view is what still needs doing. Done items are fetched only when
    // asked for, so the common request stays small however long the list gets.
    if (q.status) parts.push("status=eq." + encodeURIComponent(String(q.status)));

    /* WHOSE. Absent means everybody's, which is what this list has always
       been and stays for anyone who does not ask otherwise. */
    const owner = q.owner ? String(q.owner) : "";
    if (owner === "me") {
      const me = whoami(p);
      /* Signed in with the shared admin password: there is no "me". Saying so
         beats returning the whole list, which would look like "you have 41
         things to do" and be a lie. */
      if (!me) {
        return json(res, 200, {
          tasks: [], today: today(),
          noIdentity: true,
          error: "This sign-in is the shared admin password, so it is not a " +
                 "person. Sign in with your own email to see your own list.",
        });
      }
      parts.push("owner_id=eq." + encodeURIComponent(me));
    } else if (owner === "none") {
      parts.push("owner_id=is.null");
    } else if (owner && isUuid(owner)) {
      parts.push("owner_id=eq." + encodeURIComponent(owner));
    } else if (owner && owner !== "any") {
      return json(res, 400, { error: "Unknown owner filter." });
    }

    parts.push("order=review.desc,due.asc.nullslast,created_at.desc");
    parts.push("limit=" + Math.min(parseInt(q.limit, 10) || 500, 2000));
    const rows = await supabaseRest("GET", "/tasks?" + parts.join("&"), null);
    /* `me` is echoed so the screen can mark "yours" without a second call and
       without guessing from a name. Null for the shared password. */
    return json(res, 200, { tasks: rows || [], today: today(), me: whoami(p) });
  }

  // ---- create -------------------------------------------------------------
  if (req.method === "POST") {
    const body = await readBody(req);
    const r = clean((body && body.task) || {}, { creating: true });
    if (r.error) return json(res, 400, { error: r.error });
    const row = { ...r.value, source: "app", review: false };

    let owner = null;
    if (row.owner_id !== undefined) {
      owner = await resolveOwner(row.owner_id);
      if (owner.error) return json(res, 400, { error: owner.error });
      row.owner_id = owner.id;
      row.owner_name = owner.name;
    }

    const made = await supabaseRest("POST", "/tasks", row, "return=representation");
    const task = Array.isArray(made) ? made[0] : made;

    /* After the write, never before: an email about a task that failed to save
       is worse than no email. */
    let emailed = false;
    if (owner && owner.id && owner.id !== whoami(p)) {
      emailed = await tellThem({
        to: owner.email, toName: owner.name, title: task && task.title,
        due: task && task.due, byName: await myName(p), host: req.headers?.host,
      });
    }
    /* The feed entry. Composed by hand from the title and the owner's name:
       no body, no notes, nothing but what a person would say out loud. */
    await logActivity(p, "task.created",
      "New task: " + String((task && task.title) || "").slice(0, 120) +
      (owner && owner.name ? " (for " + owner.name + ")" : ""),
      { showId: (task && task.event_id) || null, actorName: await myName(p),
        meta: { taskId: task && task.id } });

    return json(res, 200, { task, emailed });
  }

  // ---- update -------------------------------------------------------------
  if (req.method === "PATCH") {
    if (!q.id) return json(res, 400, { error: "Missing id" });
    const body = await readBody(req);
    const r = clean((body && body.patch) || {}, { creating: false });
    if (r.error) return json(res, 400, { error: r.error });
    if (Object.keys(r.value).length <= 1) return json(res, 400, { error: "Nothing to change." });
    /* Setting a time WITHOUT touching the date is the one case clean() cannot
       judge: o.due is undefined, not null, so it cannot tell a task that has a
       date from one that does not. Only this path pays for the extra read —
       ticking a checkbox, which is most PATCHes, does not. A database
       constraint refuses it either way; this exists so the message is a
       sentence rather than a Postgres error. */
    if (r.value.due_time && r.value.due === undefined) {
      const prev = await supabaseRest(
        "GET", "/tasks?id=eq." + encodeURIComponent(q.id) + "&select=due&limit=1", null);
      const had = prev && prev[0] && prev[0].due;
      if (!had) return json(res, 400, { error: "A due time needs a due date as well." });
    }
    /* Reassignment. The name is re-snapshotted here rather than joined on
       read, so the list still reads correctly years later. */
    let owner = null;
    if (r.value.owner_id !== undefined) {
      owner = await resolveOwner(r.value.owner_id);
      if (owner.error) return json(res, 400, { error: owner.error });
      r.value.owner_id = owner.id;
      r.value.owner_name = owner.name;
    }

    const out = await supabaseRest(
      "PATCH", "/tasks?id=eq." + encodeURIComponent(q.id), r.value, "return=representation");
    const row = Array.isArray(out) ? out[0] : out;
    if (!row) return json(res, 404, { error: "No such task." });

    /* After the write, never before. */
    let emailed = false;
    if (owner && owner.id && owner.id !== whoami(p)) {
      emailed = await tellThem({
        to: owner.email, toName: owner.name, title: row.title, due: row.due,
        byName: await myName(p), host: req.headers?.host,
      });
    }
    /* Only two changes are worth a line in the feed: finishing something, and
       handing it to somebody else. Every other PATCH — a retitled task, a date
       nudged by a day — is noise, and a feed that logs everything is a feed
       nobody reads. */
    if (r.value.status === "done") {
      await logActivity(p, "task.completed",
        "Task completed: " + String(row.title || "").slice(0, 120),
        { showId: row.event_id || null, actorName: await myName(p), meta: { taskId: row.id } });
    } else if (owner && owner.id) {
      await logActivity(p, "task.assigned",
        "Task given to " + owner.name + ": " + String(row.title || "").slice(0, 120),
        { showId: row.event_id || null, actorName: await myName(p), meta: { taskId: row.id } });
    }

    return json(res, 200, { task: row, emailed });
  }

  // ---- delete -------------------------------------------------------------
  if (req.method === "DELETE") {
    if (!q.id) return json(res, 400, { error: "Missing id" });
    await supabaseRest("DELETE", "/tasks?id=eq." + encodeURIComponent(q.id), null);
    return json(res, 200, { ok: true });
  }

  res.status(405).end();
}
