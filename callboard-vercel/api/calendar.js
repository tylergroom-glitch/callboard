// /api/calendar
// GET ?generate=1  -> (super-admin) returns a signed subscription URL (https + webcal)
// GET ?token=xxx   -> returns an iCalendar (.ics) feed of every show, each event carrying the full brief
//
// Signed with APP_SECRET; the token authorizes read access to the shows calendar. Valid 1 year.
import { auth, isAdmin, canManageShow, airtable, signToken, verifyToken, json } from "./_lib.js";

const DURATION = 1000 * 60 * 60 * 24 * 365;

const verify = (t) => {
  const p = verifyToken(t);
  return p && p.scope === "calendar" ? p : null;
};

// iCal text escaping
const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

// fold long property lines at 73 chars (RFC 5545)
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

async function allEvents() {
  const out = [];
  let offset = "";
  for (let i = 0; i < 25; i++) {
    const path = "?pageSize=100" + (offset ? "&offset=" + encodeURIComponent(offset) : "");
    const data = await airtable("GET", path);
    (data.records || []).forEach((r) => out.push(r));
    if (!data.offset) break;
    offset = data.offset;
  }
  return out;
}

function briefText(f, data, host) {
  const L = [];
  if (f.Client) L.push("Client: " + f.Client);
  const v = data.venue || {};
  if (v.name || v.address) L.push("Venue: " + [v.name, v.address].filter(Boolean).join(", "));
  const it = data.itinerary || {};
  if (it.hotelName || it.hotelAddress) L.push("Hotel: " + [it.hotelName, it.hotelAddress].filter(Boolean).join(", "));
  if (f.StartDate) L.push("Dates: " + f.StartDate + (f.EndDate && f.EndDate !== f.StartDate ? " to " + f.EndDate : ""));
  const crew = Array.isArray(data.crew) ? data.crew.filter((c) => c && (c.name || "").trim()) : [];
  if (crew.length) {
    L.push("");
    L.push("CREW (" + crew.length + "):");
    crew.forEach((c) => L.push("- " + c.name + (c.position ? " (" + c.position + ")" : "") + (c.phone ? " " + c.phone : "")));
  }
  const sched = Array.isArray(data.schedule) ? data.schedule : [];
  if (sched.length) {
    L.push("");
    L.push("SCHEDULE:");
    sched.forEach((d) => {
      L.push((d.label || "Day") + (d.date ? " (" + d.date + ")" : ""));
      (Array.isArray(d.items) ? d.items : []).forEach((i) =>
        L.push("  " + (i.time || "") + (i.end ? "-" + i.end : "") + "  " + (i.activity || "") + (i.room ? " @ " + i.room : ""))
      );
    });
  }
  L.push("");
  L.push("Open in Crew Call: https://" + host + "/");
  return L.join("\n");
}

function buildICS(records, host, calName) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Touchstone Creative Group//Crew Call//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:" + (calName || "Crew Call Shows"),
    "NAME:" + (calName || "Crew Call Shows"),
    "X-WR-CALDESC:Production briefs for all Touchstone shows",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  const now = stamp();
  records.forEach((rec) => {
    const f = rec.fields || {};
    if (!f.StartDate) return; // need a date to place it on the calendar
    let data = {};
    try { data = f.Data ? JSON.parse(f.Data) : {}; } catch { data = {}; }
    const v = data.venue || {};
    const title = (f.Name || "Untitled show") + (f.Client ? " \u2014 " + f.Client : "");
    const loc = [v.name, v.address].filter(Boolean).join(", ");
    lines.push("BEGIN:VEVENT");
    lines.push(fold("UID:" + rec.id + "@callboard"));
    lines.push("DTSTAMP:" + now);
    lines.push("DTSTART;VALUE=DATE:" + ymd(f.StartDate));
    lines.push("DTEND;VALUE=DATE:" + plusDay(f.EndDate || f.StartDate));
    lines.push(fold("SUMMARY:" + esc(title)));
    if (loc) lines.push(fold("LOCATION:" + esc(loc)));
    lines.push(fold("DESCRIPTION:" + esc(briefText(f, data, host))));
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export default async function handler(req, res) {
  const q = req.query || {};
  const token = q.token;

  if (q.generate) {
    if (req.method !== "GET") { res.status(405).end(); return; }
    const p = auth(req);
    const id = q.id;
    if (id) {
      if (!canManageShow(p, id)) return json(res, 403, { error: "Admin only" });
    } else {
      if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
    }
    const t = signToken(id ? { scope: "calendar", id, exp: Date.now() + DURATION } : { scope: "calendar", exp: Date.now() + DURATION });
    const host = req.headers.host || "";
    const protocol = host.startsWith("localhost") ? "http" : "https";
    return json(res, 200, {
      url: `${protocol}://${host}/api/calendar?token=${t}`,
      webcal: `webcal://${host}/api/calendar?token=${t}`,
    });
  }

  const p = token ? verify(token) : null;
  if (!p) { res.status(403).setHeader("Content-Type", "text/plain").end("Invalid or expired calendar link."); return; }
  if (req.method !== "GET") { res.status(405).end(); return; }

  let records = [];
  if (p.id) {
    try { records = [await airtable("GET", "/" + p.id)]; } catch (e) { records = []; }
  } else {
    try { records = await allEvents(); } catch (e) { records = []; }
  }
  const host = req.headers.host || "";
  const calName = p.id && records[0] ? (records[0].fields && records[0].fields.Name) || "Show" : "Crew Call Shows";
  const ics = buildICS(records, host, calName);
  res.status(200);
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", 'inline; filename="callboard-shows.ics"');
  res.setHeader("Cache-Control", "public, max-age=1800");
  res.end(ics);
}
