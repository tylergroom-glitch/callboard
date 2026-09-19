// /api/call-ack — "Confirm receipt" on the call sheet.
//
//   GET  ?show=<id>   who on this show has confirmed, and of what
//   POST ?show=<id>   confirm mine   { crewId, ackOf }
//   GET  ?t=<token>   the page a crew member lands on from an email
//   POST ?t=<token>   what that page posts   { via } or { undo: 1 }
//
// SETUP: run sql/setup-call-acks.sql, then sql/setup-message-acks.sql.
//
// ---------------------------------------------------------------------------
// A CONFIRMATION IS OF A MESSAGE, NOT OF A SHOW
//
// It used to be one row per person per show: confirm once and you were
// confirmed forever, however many messages went out afterwards. Send the
// schedule change on Tuesday and the parking note on Thursday and Thursday
// could not be tracked at all, because everyone was already green from
// Tuesday.
//
// Rows now carry `msg_id`. An empty one means "the call itself" — the in-app
// button, and links minted before messages had ids, which are sitting in
// inboxes with weeks left on them and still work.
// ---------------------------------------------------------------------------
//
// ---------------------------------------------------------------------------
// WHY THIS IS NOT A FIELD ON THE CREW ROW
//
// A show is one record, and the app writes that whole record back on every
// change. Every crew member's browser holds its own copy. On the morning of a
// job they all read their call within a few minutes of each other — so two
// confirmations through the normal save path would each write a whole copy
// back, and the second would erase the first along with anything Tyler changed
// in between. One row per confirmation, written straight to its own table,
// removes that rather than narrowing the window.
//
// WHY A CONFIRMATION CAN GO STALE
//
// The question this feature answers is "has this person seen their call". If
// the call then MOVES, yesterday's confirmation is worse than none: it says
// they know about something they have never seen. So a confirmation records a
// fingerprint of the call as it stood, and the app asks again when the call no
// longer matches. A confirmation that cannot expire would make the screen
// lie on exactly the day it matters — the day the schedule changed.
//
// WHO MAY DO WHAT
//
// Anyone who can open the show can confirm, and can see the list. That is the
// same bar as reading the call sheet itself, which is where all of this
// information already is. What it may NOT do is write a confirmation for a
// crew id that is not on the show — checked against the show's own crew list,
// not taken on trust from the request.
// ---------------------------------------------------------------------------
import { json, readBody, auth, isAdmin, canAccessShow, memberRole, supabaseRest } from "./_lib.js";
import { fingerprintFor, readAckToken } from "./_call.js";

const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const esc = (v) => String(v == null ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/* The show's crew list, read from the show itself.

   This exists so `crewId` cannot be trusted from the request body. Without it,
   anyone able to open a show could file confirmations for people who are not
   on it, and the admin view would show names nobody recognises. */
async function showBlob(showId) {
  const rows = await supabaseRest(
    "GET", "/shows?id=eq." + encodeURIComponent(showId) + "&select=name,data&limit=1", null);
  const row = rows && rows[0];
  if (!row) return null;
  const d = (row.data && typeof row.data === "object") ? row.data
    : (() => { try { return JSON.parse(row.data || "{}"); } catch { return {}; } })();
  return { name: row.name || "", data: d, crew: Array.isArray(d.crew) ? d.crew : [] };
}

async function crewOf(showId) {
  const s = await showBlob(showId);
  return s ? s.crew : null;
}

/* Reading the call sheet is the bar. `canAccessShow` covers a TCG admin and a
   show-password holder; an account holder's membership is a lookup, which is
   why this is async. */
async function mayOpen(p, showId) {
  if (!p || !showId) return false;
  if (canAccessShow(p, showId)) return true;
  return !!(await memberRole(p, showId));
}

/* ─────────────────────────────────────────────────────────────────────────────
 * THE LINK FLOW — /api/call-ack?t=<signed token>
 *
 * This is what the "Got it" button in the emailed packet points at. It is
 * reached by someone who is not signed in, on a phone, from an email.
 *
 * THE RULE THAT SHAPES ALL OF IT: A GET MUST NOT WRITE.
 *
 *   Corporate mail security — Outlook Safe Links, Mimecast, Proofpoint, and
 *   every scanner like them — FETCHES EVERY URL IN AN EMAIL before the human
 *   ever sees it, to check where it goes. If clicking the link were a GET that
 *   recorded the confirmation, then the moment a packet landed at any company
 *   running one of those, the whole crew would show as confirmed. Nobody would
 *   have read anything. The Brief would show a full house and Tyler would ring
 *   nobody.
 *
 *   That is not a hypothetical edge case; it is the ordinary behaviour of
 *   corporate email, and it would make this feature worse than not having it —
 *   a panel that says everyone has seen their call when nobody has.
 *
 *   So: GET renders a page and records nothing, ever. The write is a POST.
 *
 * WHY THE PAGE NOW CONFIRMS ITSELF, AND WHAT THAT DOES AND DOES NOT GIVE UP
 *
 *   Tyler asked for one click: tap in the email, done, no second button on a
 *   web page. So the page POSTs on load instead of waiting to be pressed. The
 *   rule above is untouched — the GET still writes nothing; a POST still does
 *   the writing — but the POST no longer needs a human to press anything.
 *
 *   What still stops a scanner is that it has to RUN THE JAVASCRIPT. Scanners
 *   fetch URLs; the overwhelming majority do not execute scripts and follow
 *   through with a second request. Three cheap filters narrow the rest:
 *
 *     - navigator.webdriver, which Chrome sets when it is being driven by
 *       Puppeteer or WebDriver. That is most of what the ones that DO render
 *       are built on.
 *     - document.visibilityState, because a page rendered into a headless
 *       background target is frequently not 'visible'.
 *     - a short delay, because scanners are time-boxed and a page that has to
 *       still be alive most of a second later is a page somebody is looking at.
 *
 *   None of that is a proof, and the honest position is written into the
 *   schema rather than into a comment nobody reads: every row records HOW it
 *   was confirmed. If confirmations ever arrive in blocks of twelve in the
 *   same second, all 'auto', that is a scanner, and the `via` column is how
 *   anybody would ever find out. The button is still on the page, so anything
 *   the filters turn away is one tap, exactly as before.
 *
 *   The blast radius also shrank. A confirmation is now of one MESSAGE, not of
 *   the show, so a false one dirties one message's list rather than marking
 *   somebody permanently seen. And the page offers "that wasn't me", which
 *   deletes the row — a mistaken confirmation is correctable by the person who
 *   is actually in a position to notice it.
 *
 * THE PAGE SHOWS THE CALL AS IT STANDS NOW, not as it stood when the email
 * went out, and confirms THAT. Someone opening a three-week-old email sees the
 * current time, reads it, and confirms what they read. The token carries no
 * call time for exactly this reason.
 *
 * The token is never echoed back into the page. The button re-posts to the URL
 * the page was loaded from, so there is nothing to escape and nothing that can
 * be smuggled into the markup — which is how /api/onboard was once turned into
 * a form that read people's passport numbers.
 * ───────────────────────────────────────────────────────────────────────────── */
function page(title, body, opts = {}) {
  return "<!doctype html><html><head><meta charset=utf-8>" +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    /* Tells a scanner and a browser alike not to keep this around. */
    '<meta name="robots" content="noindex,nofollow">' +
    "<title>" + esc(title) + "</title><style>" +
    "body{font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#f6f6f7;" +
    "margin:0;padding:32px 20px;color:#1a1a1a}" +
    ".w{max-width:420px;margin:0 auto;background:#fff;border-radius:14px;padding:26px 22px;" +
    "box-shadow:0 1px 3px rgba(0,0,0,.09)}" +
    "h1{font-size:18px;margin:0 0 2px}.sub{color:#666;font-size:14px;margin:0 0 18px}" +
    ".call{font-size:34px;font-weight:700;letter-spacing:-.5px;margin:0 0 2px}" +
    ".lbl{font-size:12px;text-transform:uppercase;letter-spacing:.7px;color:#888;margin:0 0 4px}" +
    ".row{border-top:1px solid #ededed;padding-top:16px;margin-top:16px}" +
    "button{width:100%;font:inherit;font-size:17px;font-weight:600;padding:15px;border:0;" +
    "border-radius:10px;background:#111;color:#fff;cursor:pointer}" +
    "button:disabled{opacity:.55;cursor:default}" +
    ".done{background:#0b7a3b;color:#fff;border-radius:10px;padding:15px;text-align:center;" +
    "font-weight:600;font-size:16px}" +
    ".err{color:#b00020;font-size:14px;margin:12px 0 0}" +
    ".ft{color:#888;font-size:12px;margin:16px 0 0;text-align:center}" +
    ".undo{text-align:center;margin:12px 0 0}" +
    ".undo a{color:#888;font-size:12px}" +
    ".msg{background:#f3f4f6;border-radius:9px;padding:11px 13px;margin:0 0 16px;" +
    "font-size:14px;line-height:1.45;color:#333}" +
    ".msg b{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.6px;" +
    "color:#8a8a8a;font-weight:600;margin:0 0 3px}" +
    "</style></head><body><div class=w>" + body + "</div>" +
    (opts.script ? "<script>" + opts.script + "</script>" : "") +
    "</body></html>";
}

const html = (res, code, body) =>
  res.status(code).setHeader("Content-Type", "text/html; charset=utf-8").end(body);

/* How long the page waits before confirming itself, in milliseconds.
   Long enough that a time-boxed scanner has usually given up and moved on,
   short enough that a person watching their phone sees "Confirmed" rather
   than a spinner. */
const AUTO_DELAY_MS = 900;

/* The subject of the message this link came from, for the page to show.
   Optional in every sense: no message id, no table, a deleted row, a table
   that has not been migrated yet — all of them mean "no subject line", never
   an error. Somebody standing in a loading dock confirming their call does
   not care why the heading is missing. */
async function subjectOf(msgId, showId) {
  if (!msgId) return "";
  try {
    const rows = await supabaseRest("GET",
      "/scheduled_messages?id=eq." + encodeURIComponent(msgId) +
      "&show_id=eq." + encodeURIComponent(showId) +
      "&select=subject&limit=1", null);
    return str(rows && rows[0] && rows[0].subject, 200);
  } catch (e) {
    return "";
  }
}

async function linkFlow(req, res, token) {
  const t = readAckToken(token);
  if (!t) {
    return html(res, 403, page("Link expired", "<h1>This link has expired</h1>" +
      '<p class="sub">Open Touchstone Command and confirm your call there instead.</p>'));
  }

  const show = await showBlob(t.show);
  if (!show) return html(res, 404, page("Not found", "<h1>That show is no longer here</h1>"));

  /* Same check the signed-in path makes, and for the same reason: the crew id
     is not taken on trust. If they have come off the show since the packet
     went out, there is nothing to confirm. */
  const member = show.crew.find((c) => c && String(c.id) === t.crew);
  if (!member) {
    return html(res, 404, page("Not on this show",
      "<h1>You are not on this show's crew list</h1>" +
      '<p class="sub">If that looks wrong, call the office.</p>'));
  }

  const call = str(callTimeOf(member, show.data), 40);
  const fingerprint = fingerprintFor(member, show.data);

  if (req.method === "GET") {
    /* NOTHING IS WRITTEN HERE. See the block comment above. */
    const subject = await subjectOf(t.msg, t.show);
    const body =
      "<h1>" + esc(show.name || "Your call") + "</h1>" +
      '<p class="sub">' + esc(member.name || "") +
      (member.position ? " &middot; " + esc(member.position) : "") + "</p>" +
      /* WHICH MESSAGE they are confirming, in their own words rather than
         mine. "Confirmed" on its own is worth very little to somebody who has
         had three emails about this show in a week. */
      (subject ? '<p class="msg"><b>Confirming</b>' + esc(subject) + "</p>" : "") +
      (call
        ? '<p class="lbl">Your call</p><p class="call">' + esc(call) + "</p>"
        : '<p class="sub">No call time is posted for you yet.</p>') +
      '<div class="row" id="a"><button id="b">Confirm receipt</button>' +
      '<p class="err" id="e" style="display:none"></p></div>' +
      '<p class="ft" id="f">Confirming lets the office know you have seen this.</p>';

    /* The token is not in here. `location.search` already carries it.
       Written as ES5 on purpose: this runs on whatever browser an email client
       hands it, which on an older Android mail app is not a browser anybody
       tests against. */
    const script =
      "var b=document.getElementById('b'),e=document.getElementById('e')," +
      "a=document.getElementById('a'),f=document.getElementById('f'),busy=false;" +
      "function post(body,ok,bad){" +
      "fetch(location.pathname+location.search,{method:'POST'," +
      "headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})" +
      ".then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}})})" +
      ".then(function(x){if(!x.ok)throw new Error(x.j&&x.j.error||'Could not confirm');ok(x.j);})" +
      ".catch(bad);}" +
      /* Confirmed, with a way back out of it. */
      "function done(){a.innerHTML='<div class=done>Confirmed<\\/div>';" +
      "f.innerHTML='<span class=undo><a href=\"#\" id=\"u\">That was not me \\u2014 undo<\\/a><\\/span>';" +
      "document.getElementById('u').onclick=function(ev){ev.preventDefault();" +
      "post({undo:1},function(){a.innerHTML='<button id=b2>Confirm receipt<\\/button>';" +
      "f.textContent='Not confirmed. Tap the button if you have seen this.';" +
      "document.getElementById('b2').onclick=function(){go('click');};}," +
      "function(){f.textContent='Could not undo that. Call the office.';});};}" +
      /* One confirmation per page load. `busy` is reset on failure so the
         button still works when the automatic attempt could not reach us. */
      "function go(via){if(busy)return;busy=true;" +
      "var t=document.getElementById('b');if(t){t.disabled=true;t.textContent='Confirming...';}" +
      "post({via:via},function(){done();},function(err){busy=false;" +
      "var t2=document.getElementById('b');" +
      "if(t2){t2.disabled=false;t2.textContent='Confirm receipt';}" +
      "e.style.display='block';e.textContent=err.message;});}" +
      "b.onclick=function(){go('click');};" +
      /* The automatic attempt, and the three things that hold it back. See the
         block comment at the top of this file — none of these is a proof, and
         the button below is what anything they turn away falls back to. */
      "function auto(){if(busy)return;" +
      "if(navigator.webdriver)return;" +
      "if(document.visibilityState&&document.visibilityState!=='visible')return;" +
      "go('auto');}" +
      "if(document.addEventListener){document.addEventListener('visibilitychange'," +
      "function(){if(document.visibilityState==='visible')setTimeout(auto," + AUTO_DELAY_MS + ");});}" +
      "setTimeout(auto," + AUTO_DELAY_MS + ");";

    return html(res, 200, page(show.name || "Your call", body, { script }));
  }

  if (req.method === "POST") {
    let b = null;
    try { b = await readBody(req); } catch { b = null; }

    /* ---- that wasn't me ---------------------------------------------- */
    if (b && (b.undo === 1 || b.undo === true || b.undo === "1")) {
      /* Scoped to all three parts of the identity the token carries, so this
         can delete exactly one row: their own confirmation of this one
         message. It cannot reach anybody else's and it cannot reach their
         confirmation of a different message. */
      await supabaseRest("DELETE",
        "/call_acks?event_id=eq." + encodeURIComponent(t.show) +
        "&crew_id=eq." + encodeURIComponent(t.crew) +
        "&msg_id=eq." + encodeURIComponent(t.msg), null, "return=minimal");
      return json(res, 200, { ok: true, undone: true });
    }

    /* Self-reported, and that is fine: this column is a smoke alarm, not a
       lock. Nothing is permitted or refused on the strength of it. A scanner
       that got this far by running the page's own script reports 'auto',
       which is precisely the thing worth being able to see. */
    const via = str(b && b.via, 10) === "auto" ? "auto" : "click";

    const now = new Date().toISOString();
    await supabaseRest(
      "POST", "/call_acks?on_conflict=event_id,crew_id,msg_id",
      {
        event_id: t.show,
        crew_id: t.crew,
        /* Which message. Empty for a link minted before messages had ids —
           those file against the call itself, which is what they meant. */
        msg_id: t.msg,
        /* From the show's own crew row, never from the request. */
        crew_name: str(member.name, 200),
        /* Computed here from the show as it stands, so what gets filed is what
           they were just shown. api/_call.js is a mirror of the browser's
           version of this — if the two ever drift, every confirmation made
           from an email reads as stale on the Brief. */
        ack_of: str(fingerprint, 300),
        via,
        acked_at: now,
        updated_at: now,
      },
      "resolution=merge-duplicates");
    return json(res, 200, { ok: true, ackedAt: now, via });
  }

  return json(res, 405, { error: "Method not allowed" });
}

/* The call time for one crew member, from the module that also computes the
   fingerprint, so the number on the page and the string in the database can
   never come from two different ideas of what their call is. */
function callTimeOf(member, data) {
  /* fingerprintFor folds the call in; this pulls it out for display. Both come
     from api/_call.js so they agree by construction. */
  const parsed = (() => { try { return JSON.parse(fingerprintFor(member, data)); } catch { return null; } })();
  return (Array.isArray(parsed) && parsed[0]) || "";
}

export default async function handler(req, res) {
  /* The signed-link flow comes FIRST, before auth: it is reached by a crew
     member who is not signed in. */
  const tok = str((req.query || {}).t, 4000);
  if (tok) {
    try { return await linkFlow(req, res, tok); }
    catch (e) {
      if (req.method === "POST") return json(res, e.status || 500, { error: (e && e.message) || "Server error" });
      return html(res, 500, page("Something went wrong",
        "<h1>That did not load</h1><p class=\"sub\">Try again, or open Touchstone Command.</p>"));
    }
  }

  const p = auth(req);
  if (!p) return json(res, 401, { error: "Not signed in" });

  const q = req.query || {};
  const showId = str(q.show, 100);
  if (!showId) return json(res, 400, { error: "Missing show" });

  try {
    if (!(await mayOpen(p, showId))) return json(res, 403, { error: "Not allowed" });

    if (req.method === "GET") {
      /* Newest first, and a bigger ceiling than before, because there is now a
         row per person PER MESSAGE rather than one per person. Thirty-five
         crew and a dozen messages is four hundred rows on a single show, and
         the old limit of 500 would have started silently dropping the oldest
         on a long run. Newest-first also means the browser can dedupe to "has
         this person confirmed anything recent" by taking the first it sees. */
      const rows = await supabaseRest(
        "GET", "/call_acks?event_id=eq." + encodeURIComponent(showId) +
          "&select=crew_id,crew_name,acked_at,ack_of,msg_id,via" +
          "&order=acked_at.desc&limit=2000", null);
      return json(res, 200, {
        acks: (rows || []).map((r) => ({
          crewId: r.crew_id, crewName: r.crew_name || "",
          ackedAt: r.acked_at, ackOf: r.ack_of || "",
          msgId: r.msg_id || "", via: r.via || "",
        })),
      });
    }

    if (req.method === "POST") {
      const b = await readBody(req);
      const crewId = str(b && b.crewId, 100);
      if (!crewId) return json(res, 400, { error: "Missing crewId" });

      const crew = await crewOf(showId);
      if (crew === null) return json(res, 404, { error: "No such show" });
      const member = crew.find((c) => c && String(c.id) === crewId);
      /* Not on the show, no confirmation. The name is taken from the crew row
         rather than the request for the same reason. */
      if (!member) return json(res, 400, { error: "That person is not on this show." });

      const now = new Date().toISOString();
      /* Upsert on (event_id, crew_id, msg_id): tapping twice, or confirming
         again after the call moved, updates the one row rather than adding
         another. The unique index is what makes the second tap safe even if it
         lands before the first has finished.

         msg_id is '' here and always will be. This is the button inside the
         app, on the call sheet — there is no message involved, the person is
         confirming the CALL. Filing it against a message would mean guessing
         which one, and a guess in this column is worse than a blank. */
      await supabaseRest(
        "POST", "/call_acks?on_conflict=event_id,crew_id,msg_id",
        {
          event_id: showId,
          crew_id: crewId,
          msg_id: "",
          crew_name: str(member.name, 200),
          ack_of: str(b && b.ackOf, 300),
          via: "app",
          acked_at: now,
          updated_at: now,
        },
        "resolution=merge-duplicates");

      return json(res, 200, { ok: true, ackedAt: now });
    }

    return json(res, 405, { error: "Method not allowed" });
  } catch (e) {
    return json(res, e.status || 500, { error: (e && e.message) || "Server error" });
  }
}
