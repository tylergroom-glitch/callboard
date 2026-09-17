// /api/call-ack — "Got it" on the call sheet.
//
//   GET  ?show=<id>   who on this show has confirmed their call
//   POST ?show=<id>   confirm mine   { crewId, ackOf }
//
// SETUP: run sql/setup-call-acks.sql.
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
 *   So: GET renders a page showing the call and a button. The write is a POST
 *   that the button makes. A scanner following the link sees a page and
 *   records nothing.
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
    "</style></head><body><div class=w>" + body + "</div>" +
    (opts.script ? "<script>" + opts.script + "</script>" : "") +
    "</body></html>";
}

const html = (res, code, body) =>
  res.status(code).setHeader("Content-Type", "text/html; charset=utf-8").end(body);

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
    const body =
      "<h1>" + esc(show.name || "Your call") + "</h1>" +
      '<p class="sub">' + esc(member.name || "") +
      (member.position ? " &middot; " + esc(member.position) : "") + "</p>" +
      (call
        ? '<p class="lbl">Your call</p><p class="call">' + esc(call) + "</p>"
        : '<p class="sub">No call time is posted for you yet.</p>') +
      '<div class="row"><button id="b">Got it</button>' +
      '<p class="err" id="e" style="display:none"></p></div>' +
      '<p class="ft">Confirming lets the office know you have seen this.</p>';

    /* The token is not in here. `location.search` already carries it. */
    const script =
      "var b=document.getElementById('b'),e=document.getElementById('e');" +
      "b.onclick=function(){b.disabled=true;b.textContent='Sending...';" +
      "fetch(location.pathname+location.search,{method:'POST'})" +
      ".then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}})})" +
      ".then(function(x){if(!x.ok)throw new Error(x.j&&x.j.error||'Could not confirm');" +
      "b.outerHTML='<div class=done>Confirmed<\\/div>';})" +
      ".catch(function(err){b.disabled=false;b.textContent='Got it';" +
      "e.style.display='block';e.textContent=err.message;});};";

    return html(res, 200, page(show.name || "Your call", body, { script }));
  }

  if (req.method === "POST") {
    const now = new Date().toISOString();
    await supabaseRest(
      "POST", "/call_acks?on_conflict=event_id,crew_id",
      {
        event_id: t.show,
        crew_id: t.crew,
        /* From the show's own crew row, never from the request. */
        crew_name: str(member.name, 200),
        /* Computed here from the show as it stands, so what gets filed is what
           they were just shown. api/_call.js is a mirror of the browser's
           version of this — if the two ever drift, every confirmation made
           from an email reads as stale on the Brief. */
        ack_of: str(fingerprint, 300),
        acked_at: now,
        updated_at: now,
      },
      "resolution=merge-duplicates");
    return json(res, 200, { ok: true, ackedAt: now });
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
      const rows = await supabaseRest(
        "GET", "/call_acks?event_id=eq." + encodeURIComponent(showId) +
          "&select=crew_id,crew_name,acked_at,ack_of&limit=500", null);
      return json(res, 200, {
        acks: (rows || []).map((r) => ({
          crewId: r.crew_id, crewName: r.crew_name || "",
          ackedAt: r.acked_at, ackOf: r.ack_of || "",
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
      /* Upsert on (event_id, crew_id): tapping twice, or confirming again
         after the call moved, updates the one row rather than adding another.
         The unique index is what makes the second tap safe even if it lands
         before the first has finished. */
      await supabaseRest(
        "POST", "/call_acks?on_conflict=event_id,crew_id",
        {
          event_id: showId,
          crew_id: crewId,
          crew_name: str(member.name, 200),
          ack_of: str(b && b.ackOf, 300),
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
