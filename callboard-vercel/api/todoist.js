// /api/todoist — your to-do list, mirrored into Todoist so it can live on the
// iPhone lock screen, with completions coming back.
//
//   GET  ?status=1     (admin)  is it connected, which project, when did it last run
//   POST ?connect=1    (admin)  find or create the project, turn it on
//   POST ?sync=1       (admin)  run a sync now and report what happened
//   POST ?disconnect=1 (admin)  stop syncing (links are kept, nothing is deleted)
//   GET                (cron)   the scheduled sync, needs CRON_SECRET
//
// SETUP: run sql/setup-todoist.sql, add TODOIST_API_TOKEN in Vercel, then
// connect it in Settings → Todoist.
//
// ---------------------------------------------------------------------------
// WHICH SIDE OWNS WHAT
//
// Crew Call owns the wording, the notes and the date. Todoist owns "is it
// ticked". Nothing else crosses, and because the two sides own disjoint
// fields there is no such thing as a conflict here — which is the entire
// reason this version does not let you create tasks in Todoist. The moment
// both sides can author a task you need a conflict rule, and a conflict rule
// nobody can predict is how a synced list stops being believed.
//
// WHY THIS CANNOT SILENTLY DRIFT
//
//   * READS ARE A BOOKMARK, NOT A NOTIFICATION. Todoist's /sync takes a
//     sync_token meaning "here is where I got to" and returns everything
//     changed since. A run that does not happen costs nothing; the next one
//     catches up. Webhooks would be the opposite — a missed delivery is gone
//     and you never learn it was missed.
//
//   * WRITES ARE IDEMPOTENT. Every command carries a uuid, and Todoist
//     documents that it "will not execute a command that has same UUID as a
//     previously executed command". Those uuids are DERIVED from what the
//     command is, not random, so a sync that times out half way and runs again
//     re-sends the same uuids and Todoist ignores the ones it already did. A
//     retry cannot double-add or double-complete.
//
//   * IT RUNS ON THE CRON AND WHEN YOU OPEN THE SCREEN. The cron is the thing
//     that has already failed once in this project; opening To Do reconciles
//     regardless, so there is no single point of failure.
//
//   * IT SAYS WHEN IT LAST RAN. On the Settings panel, in plain words. A
//     mirror that goes stale invisibly is worse than no mirror.
// ---------------------------------------------------------------------------
import crypto from "node:crypto";
import { json, readBody, auth, isAdmin, supabaseRest } from "./_lib.js";

const SETTINGS_KEY = "todoist";
const API = "https://api.todoist.com/api/v1";
const PROJECT_NAME = "Crew Call";
const BUSINESS_TZ = "America/Los_Angeles";

/* One push is capped so a first sync of a long-neglected list cannot run a
   serverless function out of time half way through. It is not a loss: the
   uuids make the next run pick up exactly where this one stopped. */
const MAX_COMMANDS = 90;

const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);

/* ------------------------------------------------------------------ settings */

async function loadSettings() {
  try {
    const rows = await supabaseRest(
      "GET", "/app_settings?key=eq." + SETTINGS_KEY + "&select=value", null);
    const v = (rows && rows[0] && rows[0].value) || {};
    return {
      enabled: v.enabled === true,
      projectId: str(v.projectId, 100),
      // "*" is Todoist's "I have never read anything, give me everything".
      syncToken: str(v.syncToken, 2000) || "*",
      lastSyncAt: str(v.lastSyncAt, 40),
      lastResult: v.lastResult && typeof v.lastResult === "object" ? v.lastResult : null,
    };
  } catch (e) {
    return null;                       // null means "could not read", not "off"
  }
}

async function saveSettings(patch) {
  const cur = (await loadSettings()) || {};
  const next = { ...cur, ...patch };
  await supabaseRest(
    "POST", "/app_settings?on_conflict=key",
    { key: SETTINGS_KEY, value: next, updated_at: new Date().toISOString() },
    "resolution=merge-duplicates");
  return next;
}

/* ------------------------------------------------------------------ Todoist */

/* Every call goes through here so there is one place that knows the shape of a
   Todoist failure. It returns rather than throws for an API-level refusal,
   because a sync that cannot reach Todoist has to report that and leave
   everything else alone — not half-apply and not blow up a cron. */
async function todoist(token, body) {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    form.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  const r = await fetch(API + "/sync", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) {
    return { ok: false, status: r.status, error:
      (data && (data.error || data.error_tag)) || ("Todoist returned " + r.status) };
  }
  return { ok: true, data: data || {} };
}

/* A command uuid derived from WHAT THE COMMAND IS.

   This is the whole reliability story, so it is worth being precise about.
   Todoist refuses to run a command whose uuid it has already run. If these
   were random, a retry after a timeout would look like a brand new command and
   would add a second copy. Derived, the retry carries the same uuid and
   Todoist ignores it.

   `version` is in the hash so a genuine second edit of the same task is a
   DIFFERENT command and does go through — without it, correcting a typo twice
   would silently do nothing the second time. */
function commandId(action, key, version) {
  const h = crypto.createHash("sha256")
    /* JSON, not a delimiter character. The first version of this joined the
       parts with a literal NUL, which the file then CONTAINED as a raw byte —
       grep called this file binary, and Tyler uploads through the GitHub web
       UI, which is no place for a control character. JSON.stringify is
       unambiguous and prints. */
    .update(JSON.stringify([action, key, String(version || "")]))
    .digest("hex");
  // Todoist wants a uuid-shaped string.
  return [h.slice(0, 8), h.slice(8, 12), "4" + h.slice(13, 16),
          "8" + h.slice(17, 20), h.slice(20, 32)].join("-");
}

/* What Todoist is told about an item. Hashing exactly this — and nothing else
   — is what makes most syncs send no commands at all: if the hash matches what
   was last pushed, there is nothing to say. */
function payloadOf(item) {
  return { content: item.title, description: item.notes || "", due: item.due || null };
}
const hashOf = (item) =>
  crypto.createHash("sha256").update(JSON.stringify(payloadOf(item))).digest("hex").slice(0, 32);

/* ------------------------------------------------------- the two kinds of item */

/* Everything open on the To Do screen, flattened to one shape. The same two
   sources TasksScreen merges — tasks, and to-dos living inside a show record —
   because a mirror that carries half the list is the split list this feature
   exists to prevent. */
async function openItems() {
  const items = [];

  const rows = await supabaseRest(
    "GET", "/tasks?status=eq.open&select=id,title,notes,due,event_id&limit=500", null);
  for (const t of rows || []) {
    if (!str(t.title, 500)) continue;
    items.push({
      key: "task:" + t.id, kind: "task", taskId: t.id, eventId: null, todoId: null,
      title: str(t.title, 500), notes: str(t.notes, 2000), due: t.due || "",
      showId: t.event_id || null,
    });
  }

  const shows = await supabaseRest(
    "GET", "/events?select=id,name,data&limit=500", null);
  for (const s of shows || []) {
    const d = (s.data && typeof s.data === "object") ? s.data
      : (() => { try { return JSON.parse(s.data || "{}"); } catch { return {}; } })();
    for (const td of Array.isArray(d.todos) ? d.todos : []) {
      if (!td || td.done || !str(td.title, 500) || !td.id) continue;
      items.push({
        key: "showtodo:" + s.id + ":" + td.id, kind: "showtodo",
        taskId: null, eventId: s.id, todoId: String(td.id),
        title: str(td.title, 500), notes: str(td.notes, 2000), due: td.due || "",
        showId: s.id, showName: str(s.name, 200),
      });
    }
  }
  return items;
}

const linkKey = (l) =>
  l.kind === "task" ? "task:" + l.task_id : "showtodo:" + l.event_id + ":" + l.todo_id;

async function loadLinks() {
  const rows = await supabaseRest(
    "GET", "/todoist_links?select=todoist_id,kind,task_id,event_id,todo_id,pushed_hash,closed_at&limit=2000",
    null);
  const byKey = new Map();
  const byTodoist = new Map();
  for (const l of rows || []) { byKey.set(linkKey(l), l); byTodoist.set(l.todoist_id, l); }
  return { byKey, byTodoist };
}

/* ------------------------------------------------------------------ the pull */

/* Todoist → Crew Call. Runs FIRST, always.

   If it ran second, an item you ticked on your phone would be seen by the push
   as still open, re-sent as an update, and only then noticed as done — a
   pointless write every time, and a visible flicker in Todoist. */
async function pull(token, settings, report) {
  const r = await todoist(token, {
    sync_token: settings.syncToken || "*",
    resource_types: ["items"],
  });
  if (!r.ok) { report.errors.push("Reading from Todoist: " + r.error); return settings.syncToken; }

  const items = Array.isArray(r.data.items) ? r.data.items : [];
  if (!items.length) return r.data.sync_token || settings.syncToken;

  const { byTodoist } = await loadLinks();
  const now = new Date().toISOString();

  for (const it of items) {
    const link = byTodoist.get(String(it.id));
    if (!link) continue;                       // not ours; someone else's task
    const done = it.checked === true || it.checked === 1;
    const gone = it.is_deleted === true || it.is_deleted === 1;
    if (!done && !gone) continue;              // an edit in Todoist; we ignore it

    try {
      if (link.kind === "task") {
        /* Deleted in Todoist is NOT the same as done, and `tasks` has a status
           for exactly that. Ticked closes it; deleted dismisses it. Either way
           it leaves both lists, which is what the gesture meant. */
        await supabaseRest("PATCH", "/tasks?id=eq." + encodeURIComponent(link.task_id),
          { status: gone && !done ? "dismissed" : "done", updated_at: now });
      } else {
        /* A show to-do lives inside its show. Read, change the one entry,
           write the whole record back — the same path the To Do screen already
           uses, and the reason event_id is on the link: without it this would
           mean loading every show to find which one owns this id. */
        const rows = await supabaseRest(
          "GET", "/events?id=eq." + encodeURIComponent(link.event_id) + "&select=id,data&limit=1", null);
        const row = rows && rows[0];
        if (!row) { report.errors.push("A show behind a Todoist item has gone."); continue; }
        const d = (row.data && typeof row.data === "object") ? row.data : {};
        const todos = Array.isArray(d.todos) ? d.todos : [];
        if (!todos.some((t) => t && String(t.id) === String(link.todo_id))) {
          report.errors.push("A show to-do behind a Todoist item has gone.");
        }
        const next = todos.map((t) =>
          t && String(t.id) === String(link.todo_id) ? { ...t, done: true } : t);
        await supabaseRest("PATCH", "/events?id=eq." + encodeURIComponent(link.event_id),
          { data: { ...d, todos: next }, updated_at: now });
      }
      await supabaseRest("PATCH", "/todoist_links?todoist_id=eq." + encodeURIComponent(link.todoist_id),
        { closed_at: now, updated_at: now });
      report.completed++;
    } catch (e) {
      report.errors.push("Marking one item done: " + ((e && e.message) || e));
    }
  }
  return r.data.sync_token || settings.syncToken;
}

/* ------------------------------------------------------------------ the push */

/* Crew Call → Todoist. Adds what is new, updates what changed, closes what is
   no longer open, and re-opens what came back. */
async function push(token, settings, report) {
  const items = await openItems();
  const { byKey } = await loadLinks();

  const commands = [];
  const pending = [];                    // what each command means, for afterwards

  for (const item of items) {
    const link = byKey.get(item.key);
    const hash = hashOf(item);

    if (!link) {
      const tempId = "t" + crypto.createHash("sha256").update(item.key).digest("hex").slice(0, 20);
      commands.push({
        type: "item_add",
        uuid: commandId("add", item.key, hash),
        temp_id: tempId,
        args: {
          content: item.title,
          description: item.notes || "",
          project_id: settings.projectId,
          ...(item.due ? { due: { date: item.due } } : {}),
          /* The show name as a label, so the phone can filter by job without
             a second list. Todoist labels cannot contain spaces. */
          ...(item.showName ? { labels: [item.showName.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 60)] } : {}),
        },
      });
      pending.push({ action: "add", item, hash, tempId });
      continue;
    }

    if (link.closed_at) {
      /* It is open here and closed there: it was un-ticked in Crew Call. Reuse
         the link rather than making a second Todoist item for the same job. */
      commands.push({ type: "item_uncomplete", uuid: commandId("uncomplete", item.key, hash), args: { id: link.todoist_id } });
      pending.push({ action: "reopen", item, hash, link });
      continue;
    }

    if (link.pushed_hash !== hash) {
      commands.push({
        type: "item_update",
        uuid: commandId("update", item.key, hash),
        args: {
          id: link.todoist_id,
          content: item.title,
          description: item.notes || "",
          due: item.due ? { date: item.due } : null,
        },
      });
      pending.push({ action: "update", item, hash, link });
    }
    byKey.delete(item.key);              // seen; whatever is left is no longer open
  }

  /* Anything still linked and still open in Todoist, but no longer open here —
     ticked off in the app, or dismissed, or the task was deleted outright. */
  for (const [, link] of byKey) {
    if (link.closed_at) continue;
    commands.push({ type: "item_close", uuid: commandId("close", linkKey(link), link.pushed_hash), args: { id: link.todoist_id } });
    pending.push({ action: "close", link });
  }

  if (!commands.length) return;

  /* Capped, and the cap is safe precisely because of the uuids: the commands
     that did not fit are sent next run, and any that did fit are not repeated. */
  const batch = commands.slice(0, MAX_COMMANDS);
  const meta = pending.slice(0, MAX_COMMANDS);
  if (commands.length > MAX_COMMANDS) report.moreToDo = commands.length - MAX_COMMANDS;

  const r = await todoist(token, { commands: batch });
  if (!r.ok) { report.errors.push("Writing to Todoist: " + r.error); return; }

  const status = r.data.sync_status || {};
  const mapping = r.data.temp_id_mapping || {};
  const now = new Date().toISOString();

  for (let i = 0; i < batch.length; i++) {
    const cmd = batch[i];
    const m = meta[i];
    const st = status[cmd.uuid];
    /* An already-executed uuid comes back "ok" too, which is exactly what
       makes a retry safe — the bookkeeping below runs either way. */
    if (st !== undefined && st !== "ok" && !(st && st.error_code === undefined)) {
      report.errors.push((m.item ? m.item.title : "an item") + ": " +
        ((st && (st.error || st.error_tag)) || "Todoist refused it"));
      continue;
    }

    try {
      if (m.action === "add") {
        const realId = mapping[m.tempId];
        if (!realId) {
          /* No id back means the add did not happen — or happened on a
             previous run whose response was lost. Either way, writing a link
             with no id would be worse than leaving it for next time. */
          report.errors.push("Todoist did not return an id for “" + m.item.title + "”.");
          continue;
        }
        await supabaseRest("POST", "/todoist_links", {
          todoist_id: String(realId), kind: m.item.kind,
          task_id: m.item.taskId, event_id: m.item.eventId, todo_id: m.item.todoId,
          pushed_hash: m.hash, created_at: now, updated_at: now,
        }, "return=minimal");
        report.added++;
      } else if (m.action === "update") {
        await supabaseRest("PATCH", "/todoist_links?todoist_id=eq." + encodeURIComponent(m.link.todoist_id),
          { pushed_hash: m.hash, updated_at: now });
        report.updated++;
      } else if (m.action === "reopen") {
        await supabaseRest("PATCH", "/todoist_links?todoist_id=eq." + encodeURIComponent(m.link.todoist_id),
          { closed_at: null, pushed_hash: m.hash, updated_at: now });
        report.reopened++;
      } else if (m.action === "close") {
        await supabaseRest("PATCH", "/todoist_links?todoist_id=eq." + encodeURIComponent(m.link.todoist_id),
          { closed_at: now, updated_at: now });
        report.closed++;
      }
    } catch (e) {
      report.errors.push("Recording one change: " + ((e && e.message) || e));
    }
  }
}

/* ------------------------------------------------------------------ one sync */

export async function runSync() {
  const token = process.env.TODOIST_API_TOKEN;
  const report = { ok: false, added: 0, updated: 0, closed: 0, reopened: 0, completed: 0,
                   moreToDo: 0, errors: [], at: new Date().toISOString() };

  if (!token) { report.errors.push("TODOIST_API_TOKEN is not set on this deployment."); return report; }
  const settings = await loadSettings();
  if (!settings) { report.errors.push("Could not read the Todoist settings row — has sql/setup-todoist.sql been run?"); return report; }
  if (!settings.enabled) { report.errors.push("Todoist syncing is switched off."); return report; }
  if (!settings.projectId) { report.errors.push("No Todoist project is chosen — connect it in Settings."); return report; }

  let nextToken = settings.syncToken;
  try {
    nextToken = await pull(token, settings, report);
    await push(token, settings, report);
  } catch (e) {
    report.errors.push((e && e.message) || String(e));
  }

  report.ok = report.errors.length === 0;
  /* The token only advances when the read itself succeeded, so a failed run
     re-reads the same window next time rather than skipping past it. */
  try {
    await saveSettings({ syncToken: nextToken, lastSyncAt: report.at, lastResult: report });
  } catch (e) {
    report.errors.push("Could not save the sync position: " + ((e && e.message) || e));
  }
  return report;
}

/* ------------------------------------------------------------------ handler */

export default async function handler(req, res) {
  const q = req.query || {};

  /* The cron. Same gate as /api/nudge: the schedule carries the secret. */
  if (req.method === "GET" && !q.status) {
    const secret = process.env.CRON_SECRET;
    const header = req.headers.authorization || "";
    if (!secret || header !== "Bearer " + secret) return json(res, 401, { error: "Unauthorized" });
    return json(res, 200, await runSync());
  }

  const p = auth(req);
  if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });

  try {
    if (req.method === "GET" && q.status) {
      const s = await loadSettings();
      if (!s) return json(res, 200, { ready: false, reason: "The todoist_links table is not set up yet — run sql/setup-todoist.sql." });
      return json(res, 200, {
        ready: true,
        tokenSet: !!process.env.TODOIST_API_TOKEN,
        enabled: s.enabled,
        projectId: s.projectId,
        lastSyncAt: s.lastSyncAt,
        lastResult: s.lastResult,
      });
    }

    if (req.method === "POST" && q.connect) {
      const token = process.env.TODOIST_API_TOKEN;
      if (!token) return json(res, 400, { error: "TODOIST_API_TOKEN is not set on this deployment. Add it in Vercel, redeploy, then try again." });
      /* Find the project by name before making one, so connecting twice does
         not leave two "Crew Call" projects and half the list in each. */
      const r = await todoist(token, { sync_token: "*", resource_types: ["projects"] });
      if (!r.ok) return json(res, 400, { error: r.error });
      const existing = (r.data.projects || []).find(
        (x) => x && !x.is_deleted && String(x.name).trim().toLowerCase() === PROJECT_NAME.toLowerCase());

      let projectId = existing ? String(existing.id) : "";
      if (!projectId) {
        const tempId = "p" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
        const mk = await todoist(token, { commands: [{
          type: "project_add",
          uuid: commandId("project_add", PROJECT_NAME, ""),
          temp_id: tempId,
          args: { name: PROJECT_NAME },
        }] });
        if (!mk.ok) return json(res, 400, { error: mk.error });
        projectId = String((mk.data.temp_id_mapping || {})[tempId] || "");
        if (!projectId) return json(res, 400, { error: "Todoist did not create the project." });
      }
      await saveSettings({ enabled: true, projectId });
      return json(res, 200, { ok: true, projectId, created: !existing, sync: await runSync() });
    }

    if (req.method === "POST" && q.disconnect) {
      /* Off, not wiped. The links stay, so turning it back on picks up where
         it left off instead of adding a second copy of everything. */
      await saveSettings({ enabled: false });
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && q.sync) {
      await readBody(req).catch(() => ({}));
      return json(res, 200, await runSync());
    }

    return json(res, 405, { error: "Method not allowed" });
  } catch (e) {
    return json(res, e.status || 500, { error: (e && e.message) || "Server error" });
  }
}
