// Shared helpers for the serverless API. Files starting with "_" are not routes.
import crypto from "node:crypto";

const {
  ADMIN_PASSWORD,
  ADMIN_PASSWORD_2,
  APP_SECRET,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SECRET_KEY,
  BREVO_API_KEY,
  BREVO_SENDER_EMAIL,
  BREVO_SENDER_NAME,
} = process.env;

export const env = {
  ADMIN_PASSWORD,
  ADMIN_PASSWORD_2,
  /* Airtable is gone entirely as of v1.29.0 — no token, no base id, no
     helpers, no migration endpoint. Nothing here reads or writes anything but
     Supabase. */
  hasConfig: !!(APP_SECRET && ADMIN_PASSWORD),
};
export const TOKEN_TTL = 1000 * 60 * 60 * 12; // 12 hours

export function json(res, status, obj) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

export async function readBody(req) {
  if (req.body) return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

export function sha256(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}
export function hashPassword(pw) {
  return sha256((APP_SECRET || "") + ":" + pw);
}

export function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", APP_SECRET || "").update(body).digest("base64url");
  return body + "." + sig;
}
export function verifyToken(token) {
  if (!token) return null;
  /* EXACTLY two segments.

     `const [body, sig] = token.split(".")` silently discards everything after
     the second dot, and the HMAC is computed over `body` alone — so
     "<valid token>.<anything at all>" verified, and every caller that echoed
     the token back got the attacker's suffix along with it. On /api/onboard
     that suffix landed inside a <script> block: a crew member handed a
     doctored version of their own link saw the real form on the real domain
     while everything they typed — date of birth, passport expiry, Known
     Traveler number, emergency contacts — could be read by the injected code.

     Fixed here rather than at the sinks, because every signed-link route in
     the app shares this function and the next one written would inherit it. */
  const parts = String(token).split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  const expect = crypto.createHmac("sha256", APP_SECRET || "").update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let p;
  try {
    p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (p.exp && Date.now() > p.exp) return null;
  return p;
}

/* Constant-time comparison for shared secrets.

   `a === b` on a secret returns as soon as two bytes differ, so how long it
   takes leaks how much of the guess was right. verifyToken has always done
   this properly with timingSafeEqual; the admin password and the cron secret
   were compared with ===. Realistically neither is remotely exploitable over
   the internet against a serverless function — the noise dwarfs the signal —
   but there is no reason for two ways of doing the same thing, and the safe
   one is not harder. */
export function sameSecret(a, b) {
  const x = Buffer.from(String(a == null ? "" : a));
  const y = Buffer.from(String(b == null ? "" : b));
  // Lengths differ -> not equal, and timingSafeEqual would throw on them.
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

export function bearer(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}
export function auth(req) {
  return verifyToken(bearer(req));
}
export function isAdmin(p) {
  return !!p && (p.is_tcg === true || p.scope === "admin");
}
export function canAccessShow(p, id) {
  return !!p && (isAdmin(p) || (p.scope === "show" && p.id === id));
}
// Show "manager" = a TCG admin, OR a show token whose password was that
// show's ADMIN password. Managers may open the P&L and Roster tabs.
//
// NOTE: these all go through isAdmin() rather than testing p.scope directly.
// Account tokens minted by /api/auth carry { sub, is_tcg } and no `scope` at
// all — the scope is only sent to the browser, never signed into the token.
// Testing p.scope === "admin" here therefore never matched a signed-in TCG
// admin, which 403'd them out of costing, share links and surveys.
export function isShowManager(p) {
  return !!p && (isAdmin(p) || (p.scope === "show" && p.level === "admin"));
}
export function canManageShow(p, id) {
  return !!p && (isAdmin(p) || (p.scope === "show" && p.id === id && p.level === "admin"));
}
// --- Account membership (Supabase show_members) ---
export async function memberRole(p, showId) {
  if (!p || !p.sub || !showId) return null;
  try {
    const rows = await supabaseRest("GET", "/show_members?user_id=eq." + encodeURIComponent(p.sub) + "&show_id=eq." + encodeURIComponent(showId) + "&select=role,areas&limit=1", null);
    return rows && rows[0] ? rows[0] : null;
  } catch { return null; }
}
export async function memberShowIds(p) {
  if (!p || !p.sub) return [];
  try {
    const rows = await supabaseRest("GET", "/show_members?user_id=eq." + encodeURIComponent(p.sub) + "&select=show_id", null);
    return (rows || []).map((r) => r.show_id);
  } catch { return []; }
}

/* NOTE ON THE NAME. `airtable()` below talks to SUPABASE, not Airtable. It is
   a shim: it presents the old Airtable-shaped {id, fields} interface over the
   `shows` table, so calendar.js, password.js and survey.js did not have to be
   rewritten during the migration. The name is now actively misleading and
   should be changed to something like showsTable() — deliberately NOT done in
   this round, because those three files have no test coverage and a rename
   there would be an untested change riding along with a deletion. */
function showToRecord(row) {
  return {
    id: row.id,
    fields: {
      Name: row.name || "",
      Client: row.client || "",
      StartDate: row.start_date || "",
      EndDate: row.end_date || "",
      Data: typeof row.data === "string" ? row.data : JSON.stringify(row.data || {}),
      PassHash: row.pass_hash || "",
    },
  };
}
export async function airtable(method, path = "", body) {
  if (method === "GET" && path.startsWith("/")) {
    const id = path.slice(1).split("?")[0];
    const rows = await supabaseRest("GET", "/shows?id=eq." + encodeURIComponent(id) + "&select=*", null);
    if (!rows || !rows[0]) { const e = new Error("Show not found"); e.status = 404; throw e; }
    return showToRecord(rows[0]);
  }
  if (method === "GET") {
    const rows = await supabaseRest("GET", "/shows?select=*&order=start_date.asc.nullslast", null);
    return { records: (rows || []).map(showToRecord) };
  }
  if (method === "POST") {
    const f = (body && body.fields) || {};
    let data = {};
    try { data = f.Data ? JSON.parse(f.Data) : {}; } catch { data = {}; }
    const rec = { name: f.Name || "", client: f.Client || "", start_date: f.StartDate || null, end_date: f.EndDate || null, data, pass_hash: f.PassHash || null };
    const rows = await supabaseRest("POST", "/shows", rec, "return=representation");
    return showToRecord(rows[0]);
  }
  if (method === "PATCH") {
    const id = path.slice(1).split("?")[0];
    const f = (body && body.fields) || {};
    const patch = { updated_at: new Date().toISOString() };
    if (f.Data !== undefined) { try { patch.data = JSON.parse(f.Data); } catch { patch.data = {}; } }
    if (f.Name !== undefined) patch.name = f.Name;
    if (f.Client !== undefined) patch.client = f.Client;
    if (f.StartDate !== undefined) patch.start_date = f.StartDate || null;
    if (f.EndDate !== undefined) patch.end_date = f.EndDate || null;
    if (f.PassHash !== undefined) patch.pass_hash = f.PassHash || null;
    await supabaseRest("PATCH", "/shows?id=eq." + encodeURIComponent(id), patch);
    return {};
  }
  if (method === "DELETE") {
    const id = path.slice(1).split("?")[0];
    await supabaseRest("DELETE", "/shows?id=eq." + encodeURIComponent(id), null);
    return {};
  }
  return {};
}

export function summary(rec) {
  const f = rec.fields || {};
  return {
    id: rec.id,
    name: f.Name || "",
    client: f.Client || "",
    startDate: f.StartDate || "",
    endDate: f.EndDate || "",
    hasPassword: !!f.PassHash,
    hasEditor: !!f.EditorHash,
    hasAdmin: !!f.AdminHash,
  };
}

// ---- Supabase account helpers (Stage 3a token exchange) ----
// Validate a Supabase access token by asking Supabase who it belongs to.
export async function supabaseUser(token) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !token) return null;
  try {
    const r = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { Authorization: "Bearer " + token, apikey: SUPABASE_ANON_KEY },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}
// Read a profile row (is_tcg, name, email) using the secret key.
export async function supabaseProfile(uid) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !uid) return null;
  try {
    const r = await fetch(SUPABASE_URL + "/rest/v1/profiles?id=eq." + encodeURIComponent(uid) + "&select=is_tcg,name,email", {
      headers: { apikey: SUPABASE_SECRET_KEY, Authorization: "Bearer " + SUPABASE_SECRET_KEY },
    });
    if (!r.ok) return null;
    const rows = await r.json();
    return (rows && rows[0]) || null;
  } catch {
    return null;
  }
}

// PostgREST data access (service key -> bypasses RLS; the serverless is the gate).
export async function supabaseRest(method, path, body, prefer) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) throw new Error("Supabase not configured");
  const headers = {
    apikey: SUPABASE_SECRET_KEY,
    Authorization: "Bearer " + SUPABASE_SECRET_KEY,
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(SUPABASE_URL + "/rest/v1" + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
  if (!r.ok) {
    const e = new Error((data && data.message) || "Supabase error");
    e.status = r.status; e.detail = data;
    throw e;
  }
  return data;
}

// Invite a brand-new user by email: creates the auth account (unconfirmed) and
// sends them a link to set their password. Returns the created user (has id).
export async function inviteUser(email, redirectTo) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !email) return null;
  const url = SUPABASE_URL + "/auth/v1/invite" + (redirectTo ? "?redirect_to=" + encodeURIComponent(redirectTo) : "");
  const r = await fetch(url, {
    method: "POST",
    headers: { apikey: SUPABASE_SECRET_KEY, Authorization: "Bearer " + SUPABASE_SECRET_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.msg || data.error_description || data.error || "Invite failed"); e.status = r.status; throw e; }
  return data;
}

// Send a transactional email via Brevo (used to notify people added to a show).
/* ---- Supabase Storage ------------------------------------------------------
   Storage lives at /storage/v1, not /rest/v1, so supabaseRest cannot reach it.

   This started life local to api/expenses.js with a note saying to extract it
   "when the W-9 work needs it too". That is now: crew documents are the second
   consumer, and two copies of a helper that mints signed URLs is two places to
   fix the day one of them is wrong. */
export async function storageReq(method, path, body, extraHeaders) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) throw new Error("Supabase not configured");
  const r = await fetch(SUPABASE_URL + "/storage/v1" + path, {
    method,
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      Authorization: "Bearer " + SUPABASE_SECRET_KEY,
      "Content-Type": "application/json",
      ...(extraHeaders || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
  if (!r.ok) {
    const e = new Error((data && data.message) || "Storage error");
    e.status = r.status;
    throw e;
  }
  return data;
}

/* Mint a one-time upload URL. The browser PUTs straight to Supabase with this,
   so the file never passes through a serverless function — no body-size limit
   and no timeout on a 10 MB phone scan — and the service key never leaves here.

   THE PREFIX IS NOT OPTIONAL. Supabase answers with a RELATIVE url —
   "/object/upload/sign/<bucket>/<path>?token=…" — with no origin and no
   /storage/v1 on the front. Supabase's own client does
   `new URL(this.url + data.url)` for exactly this reason. Handed over raw, the
   browser resolves it against the page it is on, so the upload goes to
   crewcall.touchstonecreativegroup.com, Vercel returns its 404 page, and the
   uploader is told "The upload did not finish." signView below has always
   prepended; this did not.

   `upsert` is for a path that is written more than once — the blank NDA and W-9
   live at a fixed name, so replacing one is a second write to the same path and
   Supabase answers 409 without it. A crew member's signed copy carries a uuid
   and never collides, so it does not ask for it. */
export async function signUpload(bucket, name, { upsert = false } = {}) {
  const out = await storageReq(
    "POST", "/object/upload/sign/" + bucket + "/" + name, {},
    upsert ? { "x-upsert": "true" } : undefined
  );
  const rel = out && out.url;
  return {
    path: name,
    token: out && out.token,
    url: rel ? (/^https?:\/\//i.test(rel) ? rel : SUPABASE_URL + "/storage/v1" + rel) : null,
    upsert: !!upsert,
  };
}

/* Short-lived read URL. The buckets are private; nothing is ever served from a
   public URL. Five minutes is long enough to open a document and short enough
   that a URL copied out of a browser history is useless by the time anyone
   tries it. */
export async function signView(bucket, path, expiresIn = 300) {
  const out = await storageReq("POST", "/object/sign/" + bucket + "/" + path, { expiresIn });
  return out && out.signedURL ? SUPABASE_URL + "/storage/v1" + out.signedURL : null;
}

/* What we accept as an uploaded document. Kept here so both consumers agree —
   and deliberately a allowlist of three, because "whatever the browser says it
   is" is not a file type check. */
export const UPLOAD_EXT = { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" };

export async function sendBrevoEmail({ to, toName, subject, html, text }) {
  if (!BREVO_API_KEY || !to) return false;
  const senderEmail = BREVO_SENDER_EMAIL || "crewcall@touchstonecreativegroup.com";
  const senderName = BREVO_SENDER_NAME || "Touchstone Crew Call";
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: senderEmail, name: senderName },
        to: [{ email: to, ...(toName ? { name: toName } : {}) }],
        subject,
        htmlContent: html,
        ...(text ? { textContent: text } : {}),
      }),
    });
    return r.ok;
  } catch (e) { return false; }
}

/* Many emails, ONE request.

   Brevo's messageVersions carries up to 1,000 individually addressed messages
   in a single call. That matters twice over here: thirty-five sequential
   sends inside a serverless function is seven to fourteen seconds of HTTP and
   a real chance of hitting the timeout half way through — leaving some people
   emailed and some not, with no record of which — and every recipient gets
   their own message, so nobody's address is ever visible to anyone else.

   Returns the count, because "did this reach everyone" is the only question
   worth asking afterwards. */
export async function sendBrevoBatch(messages, opts = {}) {
  const list = (messages || []).filter((m) => m && m.to);
  if (!BREVO_API_KEY || !list.length) return { sent: 0, failed: list.map((m) => m.to) };
  /* Attachments ride at the TOP level, not inside a version: Brevo sends the
     bytes once and applies them to every version in the call. Putting them per
     version would upload the same packet thirty-five times and blow the 20MB
     request ceiling on a crew of any size. */
  const attachment = Array.isArray(opts.attachment) && opts.attachment.length
    ? opts.attachment : null;
  const senderEmail = BREVO_SENDER_EMAIL || "crewcall@touchstonecreativegroup.com";
  const senderName = BREVO_SENDER_NAME || "Touchstone Crew Call";

  let sent = 0;
  const failed = [];
  /* Chunked at 1,000 because that is the documented ceiling per call. Nobody
     has a roster that long, but a loop that silently drops the 1,001st is the
     kind of thing discovered years later. */
  for (let i = 0; i < list.length; i += 1000) {
    const chunk = list.slice(i, i + 1000);
    try {
      const r = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          sender: { email: senderEmail, name: senderName },
          ...(attachment ? { attachment } : {}),
          // A version per person: own recipient, own subject, own body.
          messageVersions: chunk.map((m) => ({
            to: [{ email: m.to, ...(m.toName ? { name: m.toName } : {}) }],
            subject: m.subject,
            htmlContent: m.html,
            ...(m.text ? { textContent: m.text } : {}),
          })),
        }),
      });
      if (r.ok) sent += chunk.length;
      else chunk.forEach((m) => failed.push(m.to));
    } catch {
      chunk.forEach((m) => failed.push(m.to));
    }
  }
  return { sent, failed };
}

// ---- Department-scoped editing (dept_editor role) ----
export const DEPARTMENTS = ["Audio", "Video", "Lighting", "Scenic"];

// Global defaults applied to every show; a show can override per tab.
export const DEFAULT_TAB_DEPTS = { audioUnlocked: "Audio", videoUnlocked: "Video", commsUnlocked: "Audio" };
export function effectiveTabDept(perShow, tab) {
  if (perShow && Object.prototype.hasOwnProperty.call(perShow, tab)) return perShow[tab] || "";
  return DEFAULT_TAB_DEPTS[tab] || "";
}

// Which top-level show fields each tab owns. Anything not listed here is NOT
// editable by a department editor (default-deny / fails closed).
/* Fields on a crew row that are NOT the crew's business.
 *
 * A rate is roster data that happens to have been copied onto the show when
 * somebody picked the person from the roster. Locking /api/roster without
 * locking these would have been theatre: the same numbers, one endpoint over.
 *
 * Exported so events.js strips them on the way out and scopedSave puts them
 * back on the way in — those two have to agree or the second wipes what the
 * first hid. */
export const CREW_PRIVATE_FIELDS = ["rate", "rateType"];

/* Who may see them. Deliberately TCG only, matching the roster gate and the
   rule BriefTravel already states about show-admin passwords. Widening this to
   producers is one word, if you decide a producer needs per-person pay. */
export const canSeeCrewPay = (role) => role === "tcg";

/* The timesheet. Admins and producers — a producer has to verify what was
   worked; a department editor does not need everyone else's in and out times. */
export const canSeeHours = (role) => role === "tcg" || role === "producer";

/* Top-level keys removed from the show for a role that may not see them.
 *
 * Kept as a LIST rather than another bespoke branch, because the two rules
 * below (strip on read, restore on write) then cover any future field for
 * free. Adding one here is the whole change. */
export function hiddenShowFields(role) {
  const out = [];
  if (!canSeeHours(role)) out.push("time");
  return out;
}

/* Strip the private fields from a copy. Never mutates the caller's object —
   the same `data` gets written back in other code paths, and a mutation here
   would be a very quiet way to delete every rate on the show. */
export function stripCrewPay(data) {
  if (!data || !Array.isArray(data.crew)) return data;
  return { ...data, crew: data.crew.map((c) => {
    if (!c || typeof c !== "object") return c;
    const out = { ...c };
    for (const f of CREW_PRIVATE_FIELDS) delete out[f];
    return out;
  }) };
}

/* Everything a role may not see, removed in one pass. This is what events.js
   sends; `restoreHidden` below is its exact inverse and they have to stay a
   pair. */
export function stripShowForRole(data, role) {
  if (!data || typeof data !== "object") return data;
  /* ALWAYS a copy, for every role, including one that has nothing hidden.
     Returning the caller's own object would mean a `delete` below silently
     removing a field from the show that is about to be written back
     elsewhere. Today that cannot happen — the only role holding the original
     is a TCG admin, and nothing is hidden from them, so the loop never runs —
     which is exactly the kind of safety that stops being true the first time
     somebody adds a rule. Copying unconditionally makes it testable instead of
     accidental. */
  let out = { ...data };
  if (!canSeeCrewPay(role)) out = stripCrewPay(out);
  for (const f of hiddenShowFields(role)) delete out[f];
  return out;
}

/* Put back everything the caller was not shown, from what is stored.
 *
 * THE RULE: whoever cannot SEE a field cannot WRITE it — and, just as
 * importantly, cannot DELETE it by sending back the copy they were given.
 *
 * A hidden top-level field is restored wholesale. Crew pay is restored per row
 * by id. Call this on EVERY write path before anything is compared or saved;
 * events.js has two of them and both need it. */
export function restoreHidden(storedData, incomingData, role) {
  const stored = storedData && typeof storedData === "object" ? storedData : {};
  const out = { ...(incomingData && typeof incomingData === "object" ? incomingData : {}) };
  for (const f of hiddenShowFields(role)) {
    if (stored[f] !== undefined) out[f] = stored[f];
    else delete out[f];
  }
  if (!canSeeCrewPay(role) && Array.isArray(out.crew)) {
    out.crew = preserveCrewPay(stored.crew, out.crew);
  }
  return out;
}

/* Carry the private fields over from what is stored, matched by row id.
 *
 * THE RULE: whoever cannot SEE these fields cannot WRITE them. That has to hold
 * at every write path, not just the scoped one — a producer gets fullEdit in
 * events.js, which writes `data` wholesale, and is sent a stripped payload.
 * Without this their first save would delete every rate on the show, silently.
 *
 * A row they added has no match and keeps what it came with — there is nothing
 * to preserve. A row they deleted goes, rate and all, because removing a person
 * from a show is a thing they are allowed to do. */
export function preserveCrewPay(storedCrew, incomingCrew) {
  const prior = new Map();
  for (const c of (Array.isArray(storedCrew) ? storedCrew : [])) {
    if (c && c.id) prior.set(c.id, c);
  }
  return (Array.isArray(incomingCrew) ? incomingCrew : []).map((c) => {
    if (!c || typeof c !== "object") return c;
    const was = c.id ? prior.get(c.id) : null;
    if (!was) return c;
    const out = { ...c };
    for (const f of CREW_PRIVATE_FIELDS) {
      if (was[f] !== undefined) out[f] = was[f];
      else delete out[f];
    }
    return out;
  });
}

export const TAB_FIELDS = {
  briefUnlocked: ["venue", "contacts", "crew", "meals", "wardrobe", "notes", "links"],
  scheduleUnlocked: ["schedule", "callTimes"],
  rundownUnlocked: ["rundown"],
  todosUnlocked: ["todos"],
  documentsUnlocked: ["documents"],
  commsUnlocked: ["commPatch", "commChannels", "commHidden", "commData"],
  audioUnlocked: ["audio"],
  videoUnlocked: ["video"],
  itineraryUnlocked: ["itinerary"],
  floorplansUnlocked: ["floorplans"],
  diagramsUnlocked: ["diagrams"],
};

function jsonEq(a, b) { try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; } }

// Column-scoped Run of Show edit. A dept editor may change only cells in columns
// tagged to their department; column definitions, row structure, and every other
// column's cells must be unchanged. Returns { ok, data } or { ok:false, reason }.
export function scopedRundown(stored, incoming, allowedCols) {
  stored = stored || {};
  incoming = incoming || {};
  if (!jsonEq(stored.columns || [], incoming.columns || [])) return { ok: false, reason: "columns changed" };
  for (const k of new Set([...Object.keys(stored), ...Object.keys(incoming)])) {
    if (k === "rows" || k === "columns") continue;
    if (!jsonEq(stored[k], incoming[k])) return { ok: false, reason: k + " changed" };
  }
  const sRows = Array.isArray(stored.rows) ? stored.rows : [];
  const iRows = Array.isArray(incoming.rows) ? incoming.rows : [];
  if (sRows.length !== iRows.length) return { ok: false, reason: "rows added or removed" };
  const mergedRows = [];
  for (let i = 0; i < sRows.length; i++) {
    const sr = sRows[i] || {}, ir = iRows[i] || {};
    if (sr.id !== ir.id) return { ok: false, reason: "row order changed" };
    const a = { ...sr }; delete a.cells;
    const b = { ...ir }; delete b.cells;
    if (!jsonEq(a, b)) return { ok: false, reason: "row structure changed" };
    const sCells = sr.cells || {}, iCells = ir.cells || {};
    const newCells = { ...sCells };
    for (const ck of new Set([...Object.keys(sCells), ...Object.keys(iCells)])) {
      if (jsonEq(sCells[ck], iCells[ck])) continue;
      if (!allowedCols.has(ck)) return { ok: false, reason: "column " + ck };
      newCells[ck] = iCells[ck];
    }
    mergedRows.push({ ...sr, cells: newCells });
  }
  return { ok: true, data: { ...stored, rows: mergedRows } };
}

// Full Run of Show edit for a dept editor who owns the whole rundown tab, EXCEPT
// producer-only columns: their cells may never change (existing rows) and must be
// empty on any newly added row. Everything else (rows, structure) is allowed.
export function scopedRundownStructured(stored, incoming, producerCols) {
  stored = stored || {};
  incoming = incoming || {};
  if (!jsonEq(stored.columns || [], incoming.columns || [])) return { ok: false, reason: "columns changed" };
  const sById = {};
  for (const r of (stored.rows || [])) { if (r && r.id) sById[r.id] = r; }
  for (const ir of (incoming.rows || [])) {
    if (!ir) continue;
    const sr = sById[ir.id];
    for (const pc of producerCols) {
      const iv = (ir.cells || {})[pc];
      if (sr) { if (!jsonEq((sr.cells || {})[pc], iv)) return { ok: false, reason: "column " + pc }; }
      else if (iv !== undefined && iv !== "" && iv !== null) return { ok: false, reason: "column " + pc + " (new row)" };
    }
  }
  return { ok: true, data: incoming };
}

// Given the stored blob, an incoming blob, and the editor's departments, decide
// what they're allowed to save. Returns { ok, data } or { ok:false, bad:[...] }.
export function scopedSave(stored, incoming, depts) {
  stored = stored || {};
  incoming = incoming || {};
  const perShow = incoming.tabDepts || stored.tabDepts || {};
  const allowed = new Set();
  const allTabs = new Set([...Object.keys(TAB_FIELDS), ...Object.keys(DEFAULT_TAB_DEPTS), ...Object.keys(perShow)]);
  for (const tab of allTabs) {
    const d = effectiveTabDept(perShow, tab);
    const unlocked = !!((incoming && incoming[tab]) || (stored && stored[tab]));
    if ((d && depts.includes(d)) || unlocked) (TAB_FIELDS[tab] || []).forEach((k) => allowed.add(k));
  }
  // Run of Show columns: which this editor owns, and which are producer-only.
  const cols = (stored.rundown && Array.isArray(stored.rundown.columns)) ? stored.rundown.columns : [];
  const myCols = new Set();
  const producerCols = new Set();
  for (const c of cols) {
    if (!c) continue;
    if (c.dept === "__producer__") producerCols.add(c.id);
    else if (c.dept && depts.includes(c.dept)) myCols.add(c.id);
  }
  const rundownTabAccess = allowed.has("rundown");

  const keys = new Set([...Object.keys(stored), ...Object.keys(incoming)]);
  const merged = { ...stored };
  for (const k of keys) {
    if (jsonEq(stored[k], incoming[k])) continue;         // unchanged
    if (k === "rundown") {
      if (rundownTabAccess) {                             // full edit minus producer-only columns
        const r = scopedRundownStructured(stored.rundown, incoming.rundown, producerCols);
        if (!r.ok) return { ok: false, bad: ["Run of Show (" + r.reason + ")"] };
        merged.rundown = r.data;
      } else if (myCols.size) {                           // column-scoped cell edits only
        const r = scopedRundown(stored.rundown, incoming.rundown, myCols);
        if (!r.ok) return { ok: false, bad: ["Run of Show (" + r.reason + ")"] };
        merged.rundown = r.data;
      } else {
        return { ok: false, bad: ["Run of Show"] };
      }
      continue;
    }
    if (k === "crew" && allowed.has(k)) {
      // See preserveCrewPay: the other half of stripCrewPay.
      merged.crew = preserveCrewPay(stored.crew, incoming.crew);
      continue;
    }
    if (allowed.has(k)) { merged[k] = incoming[k]; continue; }   // whole tab allowed
    return { ok: false, bad: [k] };                       // out of scope
  }
  return { ok: true, data: merged };
}

// --- Outbound Telegram -------------------------------------------------------
// The webhook in telegram.js answers messages people send. This is the other
// direction: an endpoint that needs to tell you something without being asked.
//
// It reuses the inbox's allowed-sender list as the notify list, which is the
// right default — those ids are exactly the people already trusted to drive the
// assistant, and keeping one list means there is no second place to forget.
//
// Best-effort by design. A notification that fails must never fail the thing it
// was announcing, so every path here resolves rather than throws.
export async function telegramNotify(text) {
  /* Still best-effort — nothing here throws, and a notification that fails must
     never fail the thing it was announcing. What changed is that it now says
     WHY, because "sent: 0" was indistinguishable across five different causes:
     no bot token, no ids saved, the settings row missing, a wrong id, and the
     commonest one of all — a person who has never messaged the bot, which
     Telegram refuses outright because a bot may not open a conversation.

     Chasing that down meant reading Vercel logs. Now `sent` still means what it
     did and the rest of the object explains itself, which is what the test
     button in Settings reports. */
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const out = { sent: 0, configured: !!token, ids: 0, results: [], reason: "" };
  if (!token) { out.reason = "TELEGRAM_BOT_TOKEN is not set on this deployment."; return out; }
  if (!text) { out.reason = "Nothing to send."; return out; }

  let ids = [];
  try {
    const rows = await supabaseRest("GET", "/app_settings?key=eq.inbox_settings&select=value", null);
    const v = rows && rows[0] ? rows[0].value : null;
    ids = Array.isArray(v && v.telegramIds) ? v.telegramIds : [];
  } catch (e) {
    out.reason = "Could not read the settings row: " + ((e && e.message) || e);
    return out;
  }
  ids = ids.map((x) => String(x || "").trim()).filter(Boolean);
  out.ids = ids.length;
  if (!ids.length) {
    out.reason = "No Telegram ids are saved in Settings → Inbox & alerts.";
    return out;
  }

  const body = String(text).length > 3900 ? String(text).slice(0, 3890) + "\n…" : String(text);
  for (const id of ids) {
    try {
      const r = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: id, text: body }),
      });
      const j = await r.json().catch(() => null);
      if (j && j.ok) { out.sent++; out.results.push({ id, ok: true }); }
      else {
        /* Telegram's own words. "chat not found" means the id is wrong or that
           person has never started a chat with the bot; "bot was blocked by the
           user" means exactly that. Both are one-line fixes once you can see
           them, and invisible until you can. */
        const why = (j && (j.description || j.error_code)) || ("HTTP " + r.status);
        out.results.push({ id, ok: false, error: String(why) });
      }
    } catch (e) {
      out.results.push({ id, ok: false, error: (e && e.message) || String(e) });
      console.log("[notify] telegram send failed: " + ((e && e.message) || e));
    }
  }
  if (!out.sent && !out.reason) {
    out.reason = out.results.map((r) => r.id + ": " + r.error).join("; ");
  }
  return out;
}

// ---------------------------------------------------------------------------
// THE ACTIVITY LOG
//
// One line in a route: `logActivity(p, "quote.won", "Quote v3 marked won", {...})`
//
// THREE RULES, ALL OF THEM LOAD-BEARING
//
// 1. IT CANNOT FAIL THE THING IT IS RECORDING.
//    Every call swallows its own errors and returns nothing worth checking.
//    If the log table is missing, or Supabase is slow, or somebody has not
//    run the SQL yet, saving a quote still saves the quote. A logger that can
//    500 a save is a logger that takes the app down to protect its own diary.
//
//    BUT IT IS AWAITED, AND THAT IS NOT A CONTRADICTION.
//
//    The obvious shape for a logger like this is fire-and-forget: call it,
//    do not wait, return. On a long-lived server that is right. On Vercel it
//    silently does not work. The instance is FROZEN the moment the response
//    is sent, so a promise still in flight is not "finished a few
//    milliseconds later" — it is abandoned, usually before the request even
//    leaves. A feed built that way is empty most of the time and full
//    occasionally, which is the worst of both: it looks like it works.
//
//    So every call site awaits. Cost: one insert, tens of milliseconds,
//    before a response the user is already waiting on. Benefit: the entry is
//    actually there. Awaiting is only safe because of the rule above — this
//    function cannot throw, so awaiting it cannot fail the save either.
//
// 2. THE SUMMARY IS COMPOSED FROM NAMES AND COUNTS. NEVER FROM A RECORD.
//    Do not pass a row into this. Do not interpolate `JSON.stringify(body)`.
//    A rate, an hours total, a taxpayer id or a token written here is written
//    forever — this is the one table nothing ever prunes. Every call site
//    spells out its sentence by hand, which is tedious on purpose: it makes
//    "what exactly ends up in the log" answerable by reading the call.
//
//    stripLogText below is the backstop, not the plan. It flattens anything
//    that looks like a currency amount, because the most likely accident is
//    somebody one day putting a total into a sentence without thinking.
//
// 3. THE ACTOR COMES FROM THE TOKEN, NEVER FROM THE REQUEST.
//    A body that could name its own author is a log that can be lied to,
//    which is worse than no log at all. Same reasoning as the upload folder
//    in crew-docs.js.
// ---------------------------------------------------------------------------

/* The backstop. It runs on every summary, including ones that are already
   clean, because a filter you have to remember to apply is not a filter.
 *
 * TWO RULES, AND THE ONE THAT IS DELIBERATELY NOT HERE.
 *
 *   1. Anything carrying a currency marker: $1,200  USD 1200  1200 USD.
 *   2. A number introduced by a money word: "total 412.50", "rate: 650".
 *
 * The rule I took out was "any number with two decimal places". It sounds
 * like the safe catch-all and it is not: it eats "Call at 10.30" and
 * "Order 2.50 ft of cable", turning honest task titles into "[amount]" —
 * a log that corrupts what it records is worse than one that misses
 * something, because you cannot tell which lines were mangled.
 *
 * And it bought almost nothing. The accident this exists for is somebody
 * concatenating a field into a sentence, which produces "412.5" or "650" —
 * neither of which that rule matched anyway. Rule 2 catches the realistic
 * version, because a number worth hiding almost always has a word in front
 * of it saying what it is. */
const MONEY_WORDS = "total|totalling|amount|amounts|cost|costs|costing|rate|rates|" +
                    "paid|pay|payment|invoice|invoiced|price|priced|budget|balance|" +
                    "deposit|fee|fees|worth|charge|charged";

export function stripLogText(v) {
  return String(v == null ? "" : v)
    // $1,200.50 / USD 1200 / 1200 USD
    .replace(/(?:\$|usd\s*)\s*\d[\d,]*(?:\.\d+)?/gi, "[amount]")
    .replace(/\b\d[\d,]*(?:\.\d+)?\s*(?:usd|dollars?)\b/gi, "[amount]")
    // total 412.50 / rate: 650 / paid $0 (already caught) / budget is 12,000
    .replace(new RegExp(
      "\\b(" + MONEY_WORDS + ")\\b(\\s*(?:of|is|was|at|:|=)?\\s*)\\d[\\d,]*(?:\\.\\d+)?",
      "gi"), "$1$2[amount]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/* Who the token says is doing this.
   An account token carries { sub, is_tcg } and a name is not in it, so the
   name is passed in by the caller when it has one to hand. The shared admin
   password carries no identity at all and correctly produces nulls — the feed
   then says "someone signed in with the admin password", which is true, and
   better than attributing it to Tyler because he is usually the one. */
export function logActor(p, name) {
  const id = p && typeof p.sub === "string" ? p.sub : null;
  const nm = String(name == null ? "" : name).trim().slice(0, 120);
  return { actor: nm || null, actor_id: id };
}

/* Write one entry. Returns a promise that ALWAYS resolves.
   Call it without awaiting; if you do await it, it still cannot throw. */
export async function logActivity(p, kind, summary, opts = {}) {
  try {
    const k = String(kind || "").trim().slice(0, 60);
    const s = stripLogText(summary);
    if (!k || !s) return;
    const who = logActor(p, opts.actorName);
    const meta = (opts.meta && typeof opts.meta === "object" && !Array.isArray(opts.meta))
      ? opts.meta : {};
    await supabaseRest("POST", "/activity", {
      kind: k,
      summary: s,
      show_id: opts.showId || null,
      actor: opts.system ? null : who.actor,
      actor_id: opts.system ? null : who.actor_id,
      meta,
    }, "return=minimal");
  } catch (e) {
    /* Deliberately swallowed. See rule 1. It is logged to the function console
       so it is findable, and goes no further. */
    console.log("[activity] not recorded: " + ((e && e.message) || e));
  }
}
