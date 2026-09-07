// /api/billing-digest
// GET  (from Vercel Cron)     send the daily digest
// GET  ?settings=1  (admin)   read the digest settings
// POST ?settings=1  (admin)   save them
// GET  ?preview=1   (admin)   render today's digest without sending it
// POST ?test=1      (admin)   send today's digest to the configured address now
//
// SETUP
//   1. Vercel -> Settings -> Environment Variables -> CRON_SECRET, a random
//      string of 16+ characters. Vercel sends it back as an Authorization
//      header on every cron invocation and this route refuses anything else.
//   2. vercel.json carries the schedule. Cron time is ALWAYS UTC — there is no
//      local timezone — so the entry is written in UTC and does not follow
//      daylight saving. See the note in vercel.json.
//   3. Turn it on from the Billing screen.
//
// WHO GETS IT
// Every TCG admin, resolved from profiles.is_tcg at send time rather than from
// a stored list. Grant someone admin and they are on the digest the next
// morning; remove them and they are off it. A copied-out list would have to be
// remembered, and the one thing nobody remembers is a list of email addresses
// in a settings screen. Extra addresses can be added for people who are not
// admins — a bookkeeper, an accountant.
//
// Cron delivery is best effort: Vercel may miss a run, and may occasionally
// fire the same one twice. So this records the date it last sent and refuses to
// send twice on the same day. A missed day is simply skipped — the digest is a
// statement of what is true this morning, not a log, so yesterday's is of no
// use today.
import { json, readBody, auth, isAdmin, supabaseRest, supabaseProfile, sendBrevoEmail } from "./_lib.js";

const BUSINESS_TZ = "America/Los_Angeles";
const SETTINGS_KEY = "billing_digest";
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS_TZ });

const num = (v) => {
  const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : 0;
};
const money = (n) => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const esc = (s) =>
  String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const shiftDate = (iso, days) => {
  if (!iso) return null;
  const d = new Date(iso + "T12:00:00Z");
  if (isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

async function loadSettings() {
  const rows = await supabaseRest("GET", "/app_settings?key=eq." + SETTINGS_KEY + "&select=value", null);
  const v = (rows && rows[0] && rows[0].value) || {};
  return {
    enabled: !!v.enabled,
    // Every TCG admin, unless this is turned off.
    toAdmins: v.toAdmins === undefined ? true : !!v.toAdmins,
    // Anyone else who should get it — a bookkeeper, an accountant.
    extra: Array.isArray(v.extra) ? v.extra : (v.to ? [String(v.to)] : []),
    prepDays: v.prepDays == null ? 14 : Number(v.prepDays),
    lastSentOn: v.lastSentOn || "",
  };
}

/* Resolved at send time, never stored.

   A stored copy of the admin list is a copy that goes stale the first time
   somebody joins or leaves, and nobody thinks to revisit a settings screen when
   they change who has admin. Reading profiles.is_tcg each morning means the
   digest is simply always right. */
async function resolveRecipients(s) {
  const out = [];
  if (s.toAdmins) {
    try {
      const rows = await supabaseRest("GET", "/profiles?is_tcg=eq.true&select=email,name", null);
      (rows || []).forEach((r) => { if (r && r.email) out.push({ email: String(r.email).trim(), name: r.name || "" }); });
    } catch (e) { /* fall through to the extras rather than sending nothing */ }
  }
  (s.extra || []).forEach((e) => { const v = String(e || "").trim(); if (v) out.push({ email: v, name: "" }); });

  // One person can be both an admin and typed in by hand.
  const seen = {};
  return out.filter((r) => {
    const k = r.email.toLowerCase();
    if (!k || seen[k]) return false;
    seen[k] = 1;
    return true;
  });
}

/* One message each, rather than one message with everybody in the To line. It
   costs a few more API calls and means nobody has to see who else is on it, and
   a bad address cannot take the whole send down with it. */
async function sendToAll(recipients, subject, html) {
  const failed = [];
  let sent = 0;
  for (const r of recipients) {
    const okd = await sendBrevoEmail({ to: r.email, toName: r.name, subject, html });
    if (okd) sent++; else failed.push(r.email);
  }
  return { sent, failed };
}
async function saveSettings(next) {
  await supabaseRest("POST", "/app_settings?on_conflict=key", {
    key: SETTINGS_KEY,
    value: next,
    updated_at: new Date().toISOString(),
  }, "resolution=merge-duplicates");
}

function balanceOf(r) {
  const paid = (Array.isArray(r.payments) ? r.payments : []).reduce((t, p) => t + num(p && p.amount), 0);
  const billed = r.actual_amount == null ? num(r.scheduled_amount) : num(r.actual_amount);
  return Math.round((billed - paid) * 100) / 100;
}

/* What actually needs a person today. Deliberately the same shape as the Needs
   Action queue on screen: if the email and the screen disagreed about what is
   waiting on you, you would stop trusting both. */
function bucket(rows, shows, prepDays) {
  const t = today();
  const name = {};
  const client = {};
  (shows || []).forEach((s) => { name[s.id] = s.name || ""; client[s.id] = s.client || ""; });

  const out = { create: [], approve: [], send: [], overdue: [], dueSoon: [], totals: { outstanding: 0, overdue: 0 } };
  const soon = shiftDate(t, 7);

  (rows || []).forEach((r) => {
    if (r.void_at) return;
    const bal = balanceOf(r);
    const due = r.actual_due_date || r.scheduled_due_date || null;
    const item = {
      show: name[r.event_id] || r.label || "Unlinked quote",
      client: client[r.event_id] || "",
      label: r.label || r.milestone_type || "",
      amount: bal,
      due,
      qb: r.qb_number || "",
    };

    if (r.sent_at && bal > 0.004) out.totals.outstanding += bal;

    if (r.status === "waiting_approval") { out.approve.push(item); return; }
    if (r.status === "approved") { out.send.push(item); return; }
    if (r.sent_at && bal > 0.004 && due && due < t) {
      item.days = Math.round((Date.parse(t) - Date.parse(due)) / 86400000);
      out.totals.overdue += bal;
      out.overdue.push(item);
      return;
    }
    if (r.sent_at && bal > 0.004 && due && due <= soon) { out.dueSoon.push(item); return; }
    if (!r.sent_at && !String(r.qb_number || "").trim() && due) {
      const opens = shiftDate(due, -Math.abs(prepDays || 14));
      if (opens && opens <= t) { item.amount = num(r.scheduled_amount); out.create.push(item); }
    }
  });

  out.overdue.sort((a, b) => (b.days || 0) - (a.days || 0));
  out.totals.outstanding = Math.round(out.totals.outstanding * 100) / 100;
  out.totals.overdue = Math.round(out.totals.overdue * 100) / 100;
  return out;
}

/* Section colours.

   Both a tinted background AND coloured heading text, deliberately. Plenty of
   mail clients strip background colours — Outlook's Word engine is the usual
   culprit — and when that happens the coloured text still tells the sections
   apart, so the email degrades to something readable rather than to a wall of
   identical bold lines.

   The heading sits in a one-cell table with a bgcolor attribute as well as a
   CSS background, which is the combination Outlook actually honours. Every
   colour clears 4.5:1 against both white and its own tint.

   Red is kept for overdue alone. If three sections shout, none of them does. */
const SECTION_STYLE = {
  create:   { ink: "#00699F", tint: "#E6F2F8" },  // TCG blue — routine work
  approve:  { ink: "#9A5B00", tint: "#FFF4E5" },  // amber — waiting on you
  send:     { ink: "#1B6E3C", tint: "#EAF6EE" },  // green — cleared, just go
  overdue:  { ink: "#B3261E", tint: "#FDECEA" },  // red — money that is late
  dueSoon:  { ink: "#4A5568", tint: "#F1F3F5" },  // slate — merely upcoming
};

function render(b, host) {
  const rows = (items, withDays) =>
    items.map((i) =>
      '<tr><td style="padding:5px 10px 5px 16px;">' + esc(i.show) +
      (i.client ? ' <span style="color:#888">' + esc(i.client) + "</span>" : "") +
      '</td><td style="padding:5px 10px 5px 0;color:#555">' + esc(i.label) +
      (i.qb ? " #" + esc(i.qb) : "") +
      '</td><td style="padding:5px 10px 5px 0;text-align:right;white-space:nowrap"><strong>' + money(i.amount) +
      '</strong></td><td style="padding:5px 0;color:#555;white-space:nowrap">' +
      (withDays && i.days ? i.days + " days late" : esc(i.due || "")) + "</td></tr>"
    ).join("");

  const section = (key, title, items, withDays) => {
    if (!items.length) return "";
    const c = SECTION_STYLE[key] || SECTION_STYLE.dueSoon;
    return (
      '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" ' +
      'style="border-collapse:collapse;width:100%;margin:22px 0 8px">' +
      '<tr><td bgcolor="' + c.tint + '" style="background:' + c.tint + ';border-left:4px solid ' + c.ink +
      ';padding:8px 12px;font:700 14px/1.3 -apple-system,Segoe UI,sans-serif;color:' + c.ink + '">' +
      esc(title) +
      ' <span style="font-weight:400;color:' + c.ink + ';opacity:.65">(' + items.length + ")</span>" +
      "</td></tr></table>" +
      '<table role="presentation" cellpadding="0" cellspacing="0" ' +
      'style="border-collapse:collapse;font:14px/1.4 -apple-system,Segoe UI,sans-serif;width:100%">' +
      rows(items, withDays) + "</table>"
    );
  };

  const nothing = !b.create.length && !b.approve.length && !b.send.length && !b.overdue.length && !b.dueSoon.length;

  return '<div style="max-width:640px;margin:0 auto;padding:6px 4px 24px">' +
    '<h2 style="font:700 19px/1.3 -apple-system,Segoe UI,sans-serif;color:#00699F;margin:0 0 2px">Billing — what needs you today</h2>' +
    '<p style="font:13px/1.5 -apple-system,Segoe UI,sans-serif;color:#666;margin:0 0 4px">' + esc(today()) + "</p>" +
    (nothing
      ? '<p style="font:15px/1.5 -apple-system,Segoe UI,sans-serif;color:#23201F;margin:20px 0">Nothing is waiting on you. Anything sent and unpaid is with the client.</p>'
      : section("overdue", "Overdue", b.overdue, true) +
        section("create", "Create these invoices", b.create) +
        section("approve", "Waiting for your approval", b.approve) +
        section("send", "Approved, not yet sent", b.send) +
        section("dueSoon", "Due in the next 7 days", b.dueSoon)) +
    '<p style="font:13px/1.6 -apple-system,Segoe UI,sans-serif;color:#666;margin:24px 0 0;border-top:1px solid #e5e5e5;padding-top:12px">' +
    "Outstanding " + money(b.totals.outstanding) +
    (b.totals.overdue ? " · overdue " + money(b.totals.overdue) : "") +
    (host ? '<br><a href="https://' + esc(host) + '/" style="color:#00699F">Open Crew Call</a>' : "") +
    "</p></div>";
}

async function gather(prepDays) {
  let rows = [];
  let shows = [];
  try {
    rows = await supabaseRest(
      "GET",
      "/billing_invoices?select=id,event_id,label,milestone_type,scheduled_amount,actual_amount," +
      "scheduled_due_date,actual_due_date,status,sent_at,payments,void_at,qb_number",
      null
    );
  } catch (e) { rows = []; }
  try { shows = await supabaseRest("GET", "/shows?select=id,name,client", null); } catch (e) { shows = []; }
  return bucket(rows, shows, prepDays);
}

export default async function handler(req, res) {
  const q = req.query || {};

  // ---- settings and manual runs: admin only ------------------------------
  if (q.settings || q.preview || q.test) {
    const p = auth(req);
    if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });

    if (q.settings && req.method === "GET") {
      const s = await loadSettings();
      const who = await resolveRecipients(s);
      // Whether the secret is configured matters to the UI; its value never does.
      // The resolved list goes back too, so the screen can show who it reaches
      // rather than making you take it on trust.
      return json(res, 200, { ...s, recipients: who, cronConfigured: !!process.env.CRON_SECRET });
    }
    if (q.settings && req.method === "POST") {
      const b = await readBody(req);
      const cur = await loadSettings();
      const extra = Array.isArray(b.extra)
        ? b.extra
        : String(b.extra || "").split(/[,;\s]+/);
      const next = {
        enabled: !!b.enabled,
        toAdmins: b.toAdmins === undefined ? cur.toAdmins : !!b.toAdmins,
        extra: extra.map((x) => String(x || "").trim()).filter((x) => x.indexOf("@") > 0),
        prepDays: Math.max(1, Math.min(90, Number(b.prepDays) || 14)),
        lastSentOn: cur.lastSentOn || "",
      };
      await saveSettings(next);
      return json(res, 200, { ok: true, recipients: await resolveRecipients(next) });
    }
    if (q.preview && req.method === "GET") {
      const s = await loadSettings();
      const b = await gather(s.prepDays);
      return json(res, 200, { html: render(b, req.headers.host || ""), counts: {
        create: b.create.length, approve: b.approve.length, send: b.send.length,
        overdue: b.overdue.length, dueSoon: b.dueSoon.length,
      } });
    }
    if (q.test && req.method === "POST") {
      // A test goes to whoever pressed it and nobody else. Testing a digest by
      // mailing every admin is how you teach people to ignore it.
      let me = "";
      let myName = "";
      if (p.sub) {
        try { const prof = await supabaseProfile(p.sub); me = (prof && prof.email) || ""; myName = (prof && prof.name) || ""; }
        catch (e) { me = ""; }
      }
      if (!me) return json(res, 400, { error: "Your account has no email address on it, so there is nowhere to send the test." });
      const b = await gather((await loadSettings()).prepDays);
      const okd = await sendBrevoEmail({
        to: me,
        toName: myName,
        subject: "Billing — what needs you today (test)",
        html: render(b, req.headers.host || ""),
      });
      if (!okd) return json(res, 502, { error: "Brevo would not send it. Check BREVO_API_KEY." });
      return json(res, 200, { ok: true, to: me });
    }
    return json(res, 405, { error: "Method not allowed" });
  }

  // ---- the scheduled run -------------------------------------------------
  // Vercel sends CRON_SECRET back as "Authorization: Bearer <secret>". Without
  // the check this route would be a public endpoint that emails your whole
  // receivables position to whoever asks.
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization || "";
  if (!cronSecret || authHeader !== "Bearer " + cronSecret) {
    return json(res, 401, { error: "Unauthorized" });
  }
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });

  const s = await loadSettings();
  if (!s.enabled) return json(res, 200, { ok: true, skipped: "not enabled" });
  const recipients = await resolveRecipients(s);
  if (!recipients.length) return json(res, 200, { ok: true, skipped: "nobody to send to" });

  // Cron can fire the same scheduled run twice. Sending the same digest twice is
  // how people start ignoring it.
  const t = today();
  if (s.lastSentOn === t) return json(res, 200, { ok: true, skipped: "already sent today" });

  const b = await gather(s.prepDays);
  const result = await sendToAll(recipients, "Billing — what needs you today", render(b, req.headers.host || ""));
  if (!result.sent) return json(res, 502, { error: "Brevo would not send to anybody.", failed: result.failed });

  // Marked sent if it reached anyone. One bad address should not cause the whole
  // digest to be sent again to everyone who already had it.
  await saveSettings({ ...s, lastSentOn: t });
  return json(res, 200, {
    ok: true,
    sent: result.sent,
    failed: result.failed,
    counts: { create: b.create.length, approve: b.approve.length, send: b.send.length, overdue: b.overdue.length },
  });
}
