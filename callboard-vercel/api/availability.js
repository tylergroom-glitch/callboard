// /api/availability — asking crew whether they are free, and remembering what
// they said.
//
//   GET    ?show=<id>              who has been asked, and what they said
//   POST   ?show=<id>              ask people   { rosterIds, position, fromDay, toDay, resend }
//   GET    ?t=<token>              the page a crew member opens  (PUBLIC)
//   POST   ?t=<token>              their answer  { answer: "yes" | "no" }  (PUBLIC)
//
// SETUP: run sql/setup-availability.sql.
//
// WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
//
//   It asks "are you free on these dates". It does NOT offer anybody a job.
//   Nothing here books a person onto a show, and a "yes" commits nobody to
//   anything — Tyler still does the booking. That was a decision, not an
//   omission: an accept-the-job flow needs a rule for two people accepting one
//   slot, and a misread tap would put somebody on a call sheet. Offers are a
//   later round, on top of this.
//
//   Consequently THE EMAIL CARRIES NO RATE. Show, dates, position, venue. An
//   email is forwardable and a number in one reads as an offer.
//
// THE ANSWER IS WRITTEN IN TWO PLACES, ON PURPOSE
//
//   A "no" is recorded against the request AND as a block-out on that person's
//   own calendar, for the show's dates only. A person being away on the 18th
//   is a fact about them, not about this show; keeping it only on the show
//   means asking them the same question again next week. The calendar is what
//   round two's "who is free Oct 5-7" reads.
//
// THE SECURITY PROPERTY THIS FILE EXISTS TO HOLD
//
//   The person answering is WHOEVER THE ROW SAYS. The token is looked up in
//   the table and the roster_id comes off the row that comes back — never from
//   the request body, never from a claim in the token alone. Same shape as
//   crew-docs.js. A link is single-use: answering nulls it, so a forwarded
//   email is dead rather than merely expired.
//
//   And no token ever appears in an admin response. That was a real finding in
//   the September audit — "a token in a JSON response is a token in a browser
//   cache" — and there is a regression test that walks every admin response
//   and fails if a live token shows up in one. Do not add a copyable link.
import crypto from "node:crypto";
import { json, readBody, auth, isAdmin, canManageShow, supabaseRest,
         signToken, verifyToken, sendBrevoBatch } from "./_lib.js";

const POS_KEY = "__positions__";
const LINK_DAYS = 45;

/* A show longer than this is a data-entry mistake, not a tour. The cap exists
   because a "no" writes one row per day: an end date typed as 2036 would
   otherwise write three and a half thousand block-outs onto somebody's
   calendar, and nothing would look wrong until they were never bookable
   again. */
const MAX_DAYS = 60;
const MAX_PEOPLE = 200;

const COLS =
  "id,event_id,roster_id,crew_name,crew_email,position,show_name,venue," +
  "from_day,to_day,sent_at,answered_at,answer,expires_at";

/* Escapes the five characters that matter, quotes included. The codebase has
   three of these already; the one in billing-digest.js was missing the quote
   cases, which is exactly how a name in an href becomes an injection. Same
   full set here. */
const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const str = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isUuid = (s) =>
  typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/* jsonb comes back as an object, but a row written while this lived on
   Airtable may still hold a JSON string. Accept both. */
function asData(v) {
  if (v && typeof v === "object") return v;
  if (typeof v === "string") { try { return JSON.parse(v) || {}; } catch { return {}; } }
  return {};
}

/* Inclusive, and string-in / string-out. Dates here are calendar days in the
   business timezone, never instants — the same discipline as the rest of the
   app. Going through Date objects is how "the 18th" becomes "the 17th" for
   anybody east of Greenwich. */
function dayRange(from, to) {
  const out = [];
  if (!isDate(from) || !isDate(to) || to < from) return out;
  const d = new Date(from + "T12:00:00Z");
  const end = new Date(to + "T12:00:00Z");
  while (d <= end && out.length < MAX_DAYS) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const prettyDay = (s) =>
  isDate(s) ? new Date(s + "T12:00:00Z").toLocaleDateString("en-US",
    { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }) : s;

const prettyRange = (a, b) => (a === b ? prettyDay(a) : prettyDay(a) + " – " + prettyDay(b));

function issueToken(rosterId, eventId) {
  return signToken({
    scope: "avail",
    rid: rosterId,
    eid: eventId,
    // A nonce, so re-asking the same person about the same show produces a
    // genuinely different link rather than one the old email still satisfies.
    n: crypto.randomUUID(),
    exp: Date.now() + LINK_DAYS * 24 * 60 * 60 * 1000,
  });
}

/* Two checks, and BOTH are required.

   verifyToken says we signed it and it has not expired. That alone would let a
   link be replayed for its whole window, including after it was answered. The
   row says this exact token is still the live request, and answering nulls it.

   Returns the ROW, never a boolean, so nothing downstream ever has to consult
   the caller's idea of who they are. */
async function resolveToken(token) {
  const p = verifyToken(token);
  if (!p || p.scope !== "avail" || !p.rid || !p.eid) return null;
  const rows = await supabaseRest(
    "GET",
    "/availability_requests?request_token=eq." + encodeURIComponent(token) +
      "&select=" + COLS + "&limit=1", null);
  const row = rows && rows[0];
  if (!row) return null;                      // spent, replaced, or never ours
  if (row.answered_at) return null;           // already answered; not reopenable
  /* Belt and braces. The row was found BY the token, so these cannot disagree
     unless something has gone very wrong — and if it has, refusing is the only
     safe answer. */
  if (row.roster_id !== p.rid || row.event_id !== p.eid) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

// ---------------------------------------------------------------------------
// The page a crew member sees. Self-contained: no bundle, no sign-in, one
// question and two buttons, on a phone, standing in a loading dock.
// ---------------------------------------------------------------------------
function page(status, inner) {
  return {
    status,
    body: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Are you available?</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#F2F4F8;min-height:100vh;padding:24px 16px 48px}
.card{max-width:520px;margin:0 auto;background:#fff;border-radius:16px;box-shadow:0 2px 16px rgba(0,0,0,.08);overflow:hidden}
.hdr{background:#0F1E35;padding:22px 24px;color:#fff}
.hdr-logo{font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#9FB3CE;margin-bottom:6px}
.hdr-title{font-size:21px;font-weight:700;line-height:1.25}
.body{padding:24px}
.dl{display:grid;grid-template-columns:auto 1fr;gap:9px 16px;font-size:14.5px;color:#1E293B;margin-bottom:22px}
.dl dt{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#94A3B8;padding-top:3px;white-space:nowrap}
.dl dd{font-weight:600}
.ask{font-size:15px;color:#334155;line-height:1.55;margin-bottom:18px}
.btns{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.btn{border:none;border-radius:11px;padding:16px 12px;font-size:15.5px;font-weight:700;cursor:pointer;font-family:inherit}
.yes{background:#15803D;color:#fff}
.no{background:#fff;color:#334155;border:1px solid #CBD5E1}
.btn:disabled{opacity:.5;cursor:not-allowed}
.foot{font-size:12px;color:#94A3B8;line-height:1.55;margin-top:18px;border-top:1px solid #E2E8F0;padding-top:14px}
.msg{text-align:center;padding:44px 24px}
.msg-icon{font-size:46px;margin-bottom:14px}
.msg-title{font-size:20px;font-weight:700;color:#0F1E35;margin-bottom:8px}
.msg-body{font-size:14px;color:#64748B;line-height:1.6}
.err{background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:10px 14px;font-size:13px;color:#DC2626;margin-top:14px;display:none}
</style></head><body><div class="card">${inner}</div></body></html>`,
  };
}

const message = (icon, title, body) =>
  page(200, `<div class="msg"><div class="msg-icon">${icon}</div>
<div class="msg-title">${esc(title)}</div>
<div class="msg-body">${esc(body)}</div></div>`);

function askPage(row, token) {
  const dates = prettyRange(row.from_day, row.to_day);
  return page(200, `
<div class="hdr">
  <div class="hdr-logo">Touchstone Creative Group</div>
  <div class="hdr-title">Are you free for this?</div>
</div>
<div class="body">
  <dl class="dl">
    <dt>Show</dt><dd>${esc(row.show_name || "A show")}</dd>
    <dt>Dates</dt><dd>${esc(dates)}</dd>
    ${row.venue ? `<dt>Where</dt><dd>${esc(row.venue)}</dd>` : ""}
    ${row.position ? `<dt>Role</dt><dd>${esc(row.position)}</dd>` : ""}
  </dl>
  <p class="ask">This is not a booking yet — just checking who is around, so
  nobody gets a call about dates they were never free for.</p>
  <div class="btns">
    <button class="btn yes" id="y">I'm available</button>
    <button class="btn no"  id="n">Not available</button>
  </div>
  <div class="err" id="e"></div>
  <p class="foot">If you say no, those dates are marked off on your calendar
  with us, so you will not be asked about them again.</p>
</div>
<script>
(function(){
  var y=document.getElementById('y'),n=document.getElementById('n'),e=document.getElementById('e');
  function send(a){
    y.disabled=true;n.disabled=true;e.style.display='none';
    fetch(location.pathname+location.search,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({answer:a})})
    .then(function(r){return r.text().then(function(t){return {ok:r.ok,t:t};});})
    .then(function(r){
      if(!r.ok){throw new Error('that did not save');}
      document.open();document.write(r.t);document.close();
    })
    .catch(function(){
      y.disabled=false;n.disabled=false;
      e.textContent='That did not save. Check your signal and tap again.';
      e.style.display='block';
    });
  }
  y.onclick=function(){send('yes');};
  n.onclick=function(){send('no');};
})();
</script>`);
}

// ---------------------------------------------------------------------------

export default async function handler(req, res) {
  const q = req.query || {};
  const token = str(q.t, 2000);

  // ---- PUBLIC: the crew member's link -------------------------------------
  if (token) {
    const row = await resolveToken(token);

    if (req.method === "GET") {
      const out = row
        ? askPage(row, token)
        : message("🔒", "This link is finished",
            "It has already been answered, replaced by a newer one, or expired. " +
            "Ask your production manager to send another.");
      res.status(out.status);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      /* No caching anywhere: the page is different the moment it is answered,
         and a shared phone should not be able to hit Back into a live one. */
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      return res.end(out.body);
    }

    if (req.method === "POST") {
      if (!row) return json(res, 410, { error: "This link is finished." });
      const b = await readBody(req);
      const answer = str(b && b.answer, 10);
      if (answer !== "yes" && answer !== "no") {
        return json(res, 400, { error: "Answer must be yes or no." });
      }

      /* BLOCK-OUTS FIRST, then the answer.

         Both orders can fail half way. This one fails safely: the block-out
         write is an upsert, so tapping again just writes the same rows, and
         the link is still live to tap. The other order nulls the token first,
         which would leave a dead link and a calendar that never heard about
         it — wrong forever, and silently. */
      if (answer === "no") {
        const days = dayRange(row.from_day, row.to_day);
        if (days.length) {
          const note = "Not available for " + (row.show_name || "a show");
          await supabaseRest(
            "POST", "/crew_availability?on_conflict=roster_id,day,source",
            days.map((day) => ({
              roster_id: row.roster_id,
              day,
              /* Set from the fact that this came through a crew link, never
                 from anything the browser sent. A crew member cannot write an
                 admin-sourced mark. */
              source: "crew",
              state: "off",
              note,
              set_by_email: row.crew_email || null,
              updated_at: new Date().toISOString(),
            })),
            "resolution=merge-duplicates");
        }
      }

      await supabaseRest(
        "PATCH", "/availability_requests?id=eq." + encodeURIComponent(row.id),
        {
          answer,
          answered_at: new Date().toISOString(),
          // Spent. A forwarded copy of the email is now dead.
          request_token: null,
          updated_at: new Date().toISOString(),
        });

      const out = answer === "yes"
        ? message("👍", "Thanks — noted",
            "You are down as available for " + prettyRange(row.from_day, row.to_day) +
            ". This is not a booking; you will hear from us if it goes ahead.")
        : message("✓", "Thanks — noted",
            "Those dates are marked off on your calendar with us, so you will " +
            "not be asked about them again.");
      res.status(200);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      return res.end(out.body);
    }

    return json(res, 405, { error: "Method not allowed" });
  }

  // ---- ADMIN --------------------------------------------------------------
  const p = auth(req);
  const showId = str(q.show, 100);
  if (!showId) return json(res, 400, { error: "Missing show" });
  if (!isUuid(showId)) return json(res, 400, { error: "Bad show id" });

  /* canManageShow, NOT canAccessShow. Reading this list is reading which named
     people are away from home on which days, and sending from it emails the
     whole roster. A show password must not be enough for either. */
  if (!canManageShow(p, showId)) return json(res, 403, { error: "Not allowed" });

  if (req.method === "GET") {
    const rows = await supabaseRest(
      "GET",
      "/availability_requests?event_id=eq." + encodeURIComponent(showId) +
        "&select=" + COLS + "&order=crew_name.asc&limit=500", null);
    const requests = (rows || []).map((r) => ({
      id: r.id,
      rosterId: r.roster_id,
      name: r.crew_name || "",
      email: r.crew_email || "",
      position: r.position || "",
      fromDay: r.from_day,
      toDay: r.to_day,
      sentAt: r.sent_at,
      answeredAt: r.answered_at,
      // "" rather than null so the front end has one shape to test
      answer: r.answer || "",
    }));
    return json(res, 200, {
      requests,
      tally: {
        yes: requests.filter((r) => r.answer === "yes").length,
        no: requests.filter((r) => r.answer === "no").length,
        waiting: requests.filter((r) => !r.answer).length,
      },
    });
  }

  if (req.method === "POST") {
    const b = await readBody(req);
    const ids = Array.isArray(b && b.rosterIds) ? b.rosterIds.filter(isUuid).slice(0, MAX_PEOPLE) : [];
    if (!ids.length) return json(res, 400, { error: "Nobody was selected." });

    const showRows = await supabaseRest(
      "GET", "/shows?id=eq." + encodeURIComponent(showId) +
        "&select=id,name,start_date,end_date,data&limit=1", null);
    const show = showRows && showRows[0];
    if (!show) return json(res, 404, { error: "No such show" });
    const sd = asData(show.data);

    const fromDay = isDate(b && b.fromDay) ? b.fromDay : show.start_date;
    const toDay = isDate(b && b.toDay) ? b.toDay : (show.end_date || show.start_date);
    if (!isDate(fromDay) || !isDate(toDay)) {
      return json(res, 400, { error: "This show has no dates yet — add them first." });
    }
    if (toDay < fromDay) return json(res, 400, { error: "The end date is before the start date." });
    if (dayRange(fromDay, toDay).length >= MAX_DAYS) {
      return json(res, 400, { error: "That is more than " + MAX_DAYS + " days. Check the show's dates." });
    }

    const position = str(b && b.position, 80);
    const resend = b && b.resend === true;

    /* The positions row is a settings record wearing a roster row's clothes.
       Every query against this table has to exclude it, and forgetting is how
       "__positions__" ends up in a crew list. */
    const rosterRows = await supabaseRest(
      "GET", "/roster?id=in.(" + ids.map(encodeURIComponent).join(",") + ")" +
        "&name=neq." + encodeURIComponent(POS_KEY) + "&select=id,name,data&limit=" + MAX_PEOPLE, null);

    const existing = await supabaseRest(
      "GET", "/availability_requests?event_id=eq." + encodeURIComponent(showId) +
        "&select=roster_id,answer&limit=500", null);
    const answered = new Set((existing || [])
      .filter((r) => r.answer).map((r) => r.roster_id));

    const now = new Date().toISOString();
    const expires = new Date(Date.now() + LINK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const dates = prettyRange(fromDay, toDay);
    const venue = str(sd.venue, 200);
    const showName = str(show.name, 200) || "A show";

    const rows = [];
    const mail = [];
    const skipped = [];

    for (const r of rosterRows || []) {
      const d = asData(r.data);
      const email = str(d.email, 200);
      if (!email) { skipped.push({ name: r.name || "Someone", why: "no email on file" }); continue; }
      if (answered.has(r.id) && !resend) {
        skipped.push({ name: r.name || "Someone", why: "already answered" });
        continue;
      }
      const t = issueToken(r.id, showId);
      rows.push({
        event_id: showId, roster_id: r.id,
        crew_name: str(r.name, 200), crew_email: email, position,
        show_name: showName, venue,
        from_day: fromDay, to_day: toDay,
        request_token: t, expires_at: expires,
        sent_at: now, answered_at: null, answer: null, updated_at: now,
      });
      mail.push({ email, name: str(r.name, 200), token: t });
    }

    const missing = ids.length - (rosterRows || []).length;
    if (!rows.length) {
      return json(res, 200, { sent: 0, saved: 0, skipped, missing, emailed: false });
    }

    /* SAVE BEFORE SENDING. The link in the email is only good if the row
       behind it exists — the same ordering as the receipt upload. An email
       carrying a link to a row that was never written is worse than no email,
       because the person taps it, gets "this link is finished", and concludes
       the system is broken. */
    await supabaseRest(
      "POST", "/availability_requests?on_conflict=event_id,roster_id",
      rows, "resolution=merge-duplicates");

    const base = "https://" + (req.headers?.host || "crewcall.touchstonecreativegroup.com");
    const out = await sendBrevoBatch(mail.map((m) => {
      const link = base + "/api/availability?t=" + encodeURIComponent(m.token);
      return {
        to: m.email,
        toName: m.name,
        subject: "Are you free " + dates + "? — " + showName,
        html:
          `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;color:#1E293B">
<p style="font-size:15px;line-height:1.6">Hi ${esc(m.name || "there")},</p>
<p style="font-size:15px;line-height:1.6">Checking whether you are free for
<strong>${esc(showName)}</strong>${position ? ` as <strong>${esc(position)}</strong>` : ""}.</p>
<table style="font-size:14.5px;line-height:1.7;margin:14px 0">
<tr><td style="color:#64748B;padding-right:14px">Dates</td><td><strong>${esc(dates)}</strong></td></tr>
${venue ? `<tr><td style="color:#64748B;padding-right:14px">Where</td><td>${esc(venue)}</td></tr>` : ""}
</table>
<p style="font-size:15px;line-height:1.6">This is not a booking — just checking
who is around.</p>
<p style="margin:22px 0"><a href="${esc(link)}"
 style="background:#0F1E35;color:#fff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:700;font-size:15px;display:inline-block">Answer in one tap</a></p>
<p style="font-size:12.5px;color:#94A3B8;line-height:1.6">This link is just for
you and stops working once you have answered.</p>
</div>`,
        text:
          `Hi ${m.name || "there"},\n\nAre you free for ${showName}` +
          (position ? ` as ${position}` : "") + `?\n\nDates: ${dates}\n` +
          (venue ? `Where: ${venue}\n` : "") +
          `\nThis is not a booking — just checking who is around.\n\n${link}\n`,
      };
    }));

    return json(res, 200, {
      saved: rows.length,
      sent: out.sent,
      failed: out.failed || [],
      skipped,
      missing,
      /* Said plainly because "saved 8, sent 0" is a real state — no Brevo key,
         or Brevo down — and it looks identical to success from the outside. */
      emailed: out.sent > 0,
    });
  }

  return json(res, 405, { error: "Method not allowed" });
}
