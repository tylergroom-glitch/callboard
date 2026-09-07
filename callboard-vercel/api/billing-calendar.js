// /api/billing-calendar
// GET  ?generate=1        (admin) mint a new subscription link
// GET  ?links=1           (admin) list issued links, with last-used and revoked state
// POST ?revoke=<id>       (admin) revoke one, immediately
// GET  ?token=xxx         the iCalendar feed itself
//
// Two entries per live milestone: the day it should be invoiced, and the day the
// money is due. Both drop out once the invoice is sent and paid, so the calendar
// empties as you work rather than turning into a graveyard you stop reading.
//
// REVOCATION
// The signature alone is not enough to authorise a request. Every token carries
// a `jti` — an id for that particular link — and the feed refuses anything whose
// id is not on the issued list, or is marked revoked. So a leaked link can be
// killed on its own, in a second, without touching APP_SECRET and taking every
// other share link in the app down with it.
//
// It fails CLOSED. If the issued list cannot be read, no feed is served. A
// billing ledger that stays readable when the revocation check is broken is
// worse than a calendar that stops working.
//
// Tokens minted before this existed have no `jti` and are refused. That is
// deliberate: they were unrevokable, which is the thing being fixed.
//
// SETUP: run setup-billing.sql (from round 14a). No new tables, no new env vars —
// the issued list lives in the existing app_settings row.
import crypto from "node:crypto";
import { auth, isAdmin, supabaseRest, supabaseProfile, signToken, verifyToken, json, readBody } from "./_lib.js";

const DURATION = 1000 * 60 * 60 * 24 * 365;
const BUSINESS_TZ = "America/Los_Angeles";
const SETTINGS_KEY = "billing_cal_tokens";
// How stale a last-used stamp may get before we bother writing a fresh one.
// Calendar clients poll constantly; a write per poll would be pure noise.
const TOUCH_EVERY = 1000 * 60 * 60;

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS_TZ });

/* ---------------------------------------------------------------------------
   The issued list. One app_settings row: { links: [ {...} ] }
--------------------------------------------------------------------------- */
async function loadLinks() {
  const rows = await supabaseRest(
    "GET",
    "/app_settings?key=eq." + SETTINGS_KEY + "&select=value",
    null
  );
  const v = rows && rows[0] ? rows[0].value : null;
  return v && Array.isArray(v.links) ? v.links : [];
}

async function saveLinks(links) {
  await supabaseRest(
    "POST",
    "/app_settings?on_conflict=key",
    { key: SETTINGS_KEY, value: { links }, updated_at: new Date().toISOString() },
    "resolution=merge-duplicates"
  );
}

async function actorName(p) {
  if (!p) return "unknown";
  if (!p.sub) return p.scope === "admin" ? "admin (password)" : "unknown";
  try {
    const prof = await supabaseProfile(p.sub);
    return (prof && (prof.name || prof.email)) || p.sub;
  } catch (e) { return p.sub; }
}

/* Signature first, then the issued list. A valid signature only proves we minted
   it once — not that it is still allowed to work. */
async function authorise(token) {
  const p = verifyToken(token);
  if (!p || p.scope !== "billing-cal") return { ok: false, why: "Invalid or expired billing calendar link." };
  if (!p.jti) {
    return { ok: false, why: "This link was issued before revocable links existed and no longer works. Generate a new one from Billing." };
  }
  let links;
  try {
    links = await loadLinks();
  } catch (e) {
    // Fail closed. Not being able to check whether a link was revoked is not a
    // reason to serve the ledger anyway.
    return { ok: false, why: "Billing calendar is temporarily unavailable." };
  }
  const hit = links.find((l) => l && l.id === p.jti);
  if (!hit) return { ok: false, why: "This billing calendar link has been revoked." };
  if (hit.revokedAt) return { ok: false, why: "This billing calendar link was revoked on " + String(hit.revokedAt).slice(0, 10) + "." };
  return { ok: true, jti: p.jti };
}

/* Record that a link is being polled, so a link nobody uses is obvious and a
   link someone else is using is visible.

   Re-reads immediately before writing and skips the write if the link has been
   revoked in the meantime — otherwise a poll landing between a revoke's read and
   its write could resurrect the revoked entry. */
async function touch(jti) {
  try {
    const links = await loadLinks();
    const i = links.findIndex((l) => l && l.id === jti);
    if (i < 0 || links[i].revokedAt) return;
    const last = links[i].lastUsedAt ? Date.parse(links[i].lastUsedAt) : 0;
    if (Date.now() - last < TOUCH_EVERY) return;
    links[i] = { ...links[i], lastUsedAt: new Date().toISOString(), uses: (links[i].uses || 0) + 1 };
    await saveLinks(links);
  } catch (e) { /* never let bookkeeping break the feed */ }
}

/* ---------------------------------------------------------------------------
   iCalendar
--------------------------------------------------------------------------- */
const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

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

function describe(r, client, host) {
  const L = [];
  if (client) L.push("Client: " + client);
  L.push("Milestone: " + (r.label || r.milestone_type || ""));
  L.push("Scheduled: " + money(r.scheduled_amount));
  if (r.actual_amount != null && num(r.actual_amount) !== num(r.scheduled_amount)) {
    L.push("Invoiced: " + money(r.actual_amount) + "  (differs from the schedule)");
  } else if (r.actual_amount != null) {
    L.push("Invoiced: " + money(r.actual_amount));
  }
  const paid = (Array.isArray(r.payments) ? r.payments : []).reduce((t, p) => t + num(p && p.amount), 0);
  if (paid > 0.004) L.push("Paid so far: " + money(paid));
  L.push("Outstanding: " + money(balanceOf(r)));
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
    if (r.void_at) return;
    const bal = balanceOf(r);
    if (bal <= 0.004) return;
    const show = name[r.event_id] || r.label || "Unlinked quote";
    const cl = client[r.event_id] || "";
    const desc = describe(r, cl, host);
    const suffix = cl ? " (" + cl + ")" : "";

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

/* ------------------------------------------------------------------------- */
export default async function handler(req, res) {
  const q = req.query || {};

  // ---- mint a link -------------------------------------------------------
  if (q.generate) {
    if (req.method !== "GET") { res.status(405).end(); return; }
    const p = auth(req);
    if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });

    const id = crypto.randomUUID();
    const who = await actorName(p);
    let links = [];
    try { links = await loadLinks(); } catch (e) { links = []; }
    links.push({
      id,
      label: String(q.label || "").slice(0, 60) || "Billing calendar",
      createdAt: new Date().toISOString(),
      createdBy: who,
      lastUsedAt: null,
      uses: 0,
      revokedAt: null,
    });
    // Keep the list from growing without limit; revoked entries older than a
    // year are of no further use to anyone.
    const cutoff = Date.now() - DURATION;
    links = links.filter((l) => !l.revokedAt || Date.parse(l.revokedAt) > cutoff);
    await saveLinks(links);

    const t = signToken({ scope: "billing-cal", jti: id, exp: Date.now() + DURATION });
    const host = req.headers.host || "";
    const protocol = host.startsWith("localhost") ? "http" : "https";
    return json(res, 200, {
      id,
      url: `${protocol}://${host}/api/billing-calendar?token=${t}`,
      webcal: `webcal://${host}/api/billing-calendar?token=${t}`,
    });
  }

  // ---- list issued links -------------------------------------------------
  if (q.links) {
    if (req.method !== "GET") { res.status(405).end(); return; }
    const p = auth(req);
    if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
    const links = await loadLinks();
    // The token itself is deliberately never returned. It is shown once, when
    // it is minted, and after that the only thing you can do to it is revoke it.
    return json(res, 200, links.map((l) => ({
      id: l.id,
      label: l.label || "Billing calendar",
      createdAt: l.createdAt || null,
      createdBy: l.createdBy || "",
      lastUsedAt: l.lastUsedAt || null,
      uses: l.uses || 0,
      revokedAt: l.revokedAt || null,
    })));
  }

  // ---- revoke ------------------------------------------------------------
  if (q.revoke) {
    if (req.method !== "POST" && req.method !== "DELETE") { res.status(405).end(); return; }
    const p = auth(req);
    if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
    const who = await actorName(p);
    const links = await loadLinks();
    const i = links.findIndex((l) => l && l.id === q.revoke);
    if (i < 0) return json(res, 404, { error: "No such link." });
    if (links[i].revokedAt) return json(res, 200, { ok: true, alreadyRevoked: true });
    links[i] = { ...links[i], revokedAt: new Date().toISOString(), revokedBy: who };
    await saveLinks(links);
    return json(res, 200, { ok: true });
  }

  // ---- the feed ----------------------------------------------------------
  const ok = await authorise(q.token);
  if (!ok.ok) {
    res.status(403).setHeader("Content-Type", "text/plain").end(ok.why);
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

  await touch(ok.jti);

  const ics = buildICS(rows, shows, req.headers.host || "");
  res.status(200);
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", 'inline; filename="crewcall-billing.ics"');
  // A revoked link must stop working now, not when a cache decides to expire.
  res.setHeader("Cache-Control", "no-store");
  res.end(ics);
}
