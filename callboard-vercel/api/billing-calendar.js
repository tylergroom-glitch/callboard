// /api/billing-calendar
// GET ?generate=1  -> (admin) a signed subscription URL, https + webcal. Valid 1 year.
// GET ?token=xxx   -> an iCalendar feed of everything still to invoice or collect
//
// Signed with APP_SECRET, the same way the shows calendar and the share links
// are. The token authorises read access to the billing calendar and nothing else.
//
// Two entries per live milestone: the day it should be invoiced, and the day the
// money is due. Both drop out once the invoice is sent and paid, so the calendar
// empties as you work rather than turning into a graveyard you stop reading —
// which is the failure mode of every billing reminder anybody has ever built.
//
// SETUP: run setup-billing.sql. No new env vars.
import { auth, isAdmin, supabaseRest, signToken, verifyToken, json } from "./_lib.js";

const DURATION = 1000 * 60 * 60 * 24 * 365;
const BUSINESS_TZ = "America/Los_Angeles";
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS_TZ });

const verify = (t) => {
  const p = verifyToken(t);
  return p && p.scope === "billing-cal" ? p : null;
};

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

// RFC 5545 line folding.
function fold(line) {
  if (line.length <= 73) return line;
  let out = line.slice(0, 73);
  let rest = line.slice(73);
  while (rest.length) {
    out += "\r\n " + rest.slice(0, 72);
    rest = rest.slice(72);
  }
  return out;
}

const ymd = (d) => String(d || "").replace(/-/g, "");
function plusDay(d) {
  const dt = new Date(String(d) + "T00:00:00Z");
  if (isNaN(dt.getTime())) return ymd(d);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10).replace(/-/g, "");
}
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

const num = (v) => {
  const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : 0;
};
const money = (n) => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

function balanceOf(r) {
  const paid = (Array.isArray(r.payments) ? r.payments : []).reduce((t, p) => t + num(p && p.amount), 0);
  const billed = r.actual_amount == null ? num(r.scheduled_amount) : num(r.actual_amount);
  return Math.round((billed - paid) * 100) / 100;
}

function describe(r, showName, client, host) {
  const L = [];
  if (client) L.push("Client: " + client);
  L.push("Milestone: " + (r.label || r.milestone_type || ""));
  L.push("Scheduled: " + money(r.scheduled_amount));
  if (r.actual_amount != null && num(r.actual_amount) !== num(r.scheduled_amount)) {
    L.push("Invoiced: " + money(r.actual_amount) + "  (differs from the schedule)");
  } else if (r.actual_amount != null) {
    L.push("Invoiced: " + money(r.actual_amount));
  }
  const bal = balanceOf(r);
  const paid = (Array.isArray(r.payments) ? r.payments : []).reduce((t, p) => t + num(p && p.amount), 0);
  if (paid > 0.004) L.push("Paid so far: " + money(paid));
  L.push("Outstanding: " + money(bal));
  if (r.qb_number) L.push("QuickBooks invoice: " + r.qb_number);
  L.push("Status: " + (r.status || "scheduled"));
  if (r.qb_link) L.push(r.qb_link);
  if (host) L.push("https://" + host + "/");
  return L.join("\n");
}

function buildICS(rows, shows, host) {
  const name = {};
  const client = {};
  (shows || []).forEach((sh) => { name[sh.id] = sh.name || ""; client[sh.id] = sh.client || ""; });

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Touchstone Creative Group//Crew Call Billing//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "NAME:Crew Call Billing",
    "X-WR-CALNAME:Crew Call Billing",
    "X-WR-CALDESC:Invoices to raise and payments to collect",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];
  const now = stamp();
  const t = today();

  (rows || []).forEach((r) => {
    if (r.void_at) return;                       // voided is not owed
    const bal = balanceOf(r);
    if (bal <= 0.004) return;                    // settled is not owed
    const show = name[r.event_id] || r.label || "Unlinked quote";
    const cl = client[r.event_id] || "";
    const desc = describe(r, show, cl, host);
    const suffix = cl ? " (" + cl + ")" : "";

    // The day it wants raising. Gone once it has been sent — at that point the
    // only open question is the money, and that is the other entry.
    if (!r.sent_at && r.planned_send_date) {
      lines.push("BEGIN:VEVENT");
      lines.push(fold("UID:" + r.id + "-send@crewcall-billing"));
      lines.push("DTSTAMP:" + now);
      lines.push("DTSTART;VALUE=DATE:" + ymd(r.planned_send_date));
      lines.push("DTEND;VALUE=DATE:" + plusDay(r.planned_send_date));
      lines.push(fold("SUMMARY:" + esc("Invoice: " + show + " — " + (r.label || "") + " " + money(r.scheduled_amount) + suffix)));
      lines.push(fold("DESCRIPTION:" + esc(desc)));
      lines.push("END:VEVENT");
    }

    // The day the money is due.
    const due = r.actual_due_date || r.scheduled_due_date;
    if (due) {
      const over = !!r.sent_at && due < t;
      lines.push("BEGIN:VEVENT");
      lines.push(fold("UID:" + r.id + "-due@crewcall-billing"));
      lines.push("DTSTAMP:" + now);
      lines.push("DTSTART;VALUE=DATE:" + ymd(due));
      lines.push("DTEND;VALUE=DATE:" + plusDay(due));
      lines.push(fold("SUMMARY:" + esc((over ? "OVERDUE: " : "Payment due: ") + show + " — " + money(bal) + suffix)));
      lines.push(fold("DESCRIPTION:" + esc(desc)));
      lines.push("END:VEVENT");
    }
  });

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export default async function handler(req, res) {
  const q = req.query || {};

  if (q.generate) {
    if (req.method !== "GET") { res.status(405).end(); return; }
    const p = auth(req);
    if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
    const t = signToken({ scope: "billing-cal", exp: Date.now() + DURATION });
    const host = req.headers.host || "";
    const protocol = host.startsWith("localhost") ? "http" : "https";
    return json(res, 200, {
      url: `${protocol}://${host}/api/billing-calendar?token=${t}`,
      webcal: `webcal://${host}/api/billing-calendar?token=${t}`,
    });
  }

  const p = q.token ? verify(q.token) : null;
  if (!p) {
    res.status(403).setHeader("Content-Type", "text/plain").end("Invalid or expired billing calendar link.");
    return;
  }
  if (req.method !== "GET") { res.status(405).end(); return; }

  let rows = [];
  let shows = [];
  try {
    rows = await supabaseRest(
      "GET",
      "/billing_invoices?select=id,event_id,label,milestone_type,scheduled_amount,actual_amount," +
      "planned_send_date,scheduled_due_date,actual_due_date,status,sent_at,payments,void_at,qb_number,qb_link" +
      "&order=scheduled_due_date.asc.nullslast",
      null
    );
  } catch (e) { rows = []; }
  try {
    shows = await supabaseRest("GET", "/shows?select=id,name,client", null);
  } catch (e) { shows = []; }

  const ics = buildICS(rows, shows, req.headers.host || "");
  res.status(200);
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", 'inline; filename="crewcall-billing.ics"');
  res.setHeader("Cache-Control", "public, max-age=1800");
  res.end(ics);
}
