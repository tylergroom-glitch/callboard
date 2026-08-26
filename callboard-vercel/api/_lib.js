// Shared helpers for the serverless API. Files starting with "_" are not routes.
import crypto from "node:crypto";

const {
  AIRTABLE_TOKEN,
  AIRTABLE_BASE_ID,
  AIRTABLE_TABLE = "Events",
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
  hasConfig: !!(AIRTABLE_TOKEN && AIRTABLE_BASE_ID && APP_SECRET && ADMIN_PASSWORD),
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
  const [body, sig] = token.split(".");
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
  return !!p && (p.scope === "admin" || (p.scope === "show" && p.id === id));
}
// Show "manager" = the account admin, OR a show token whose password was that
// show's ADMIN password. Managers may open the P&L and Roster tabs.
export function isShowManager(p) {
  return !!p && (p.scope === "admin" || (p.scope === "show" && p.level === "admin"));
}
export function canManageShow(p, id) {
  return !!p && (p.scope === "admin" || (p.scope === "show" && p.id === id && p.level === "admin"));
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

const AT_BASE = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;
export async function airtableRaw(table, method, path = "", body) {
  const url = `${AT_BASE}/${encodeURIComponent(table)}` + path;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data?.error?.message || data?.error?.type || "Airtable error");
    e.status = res.status;
    throw e;
  }
  return data;
}
// Roster / Templates / Inventory now live in Supabase tables. This shim keeps the
// old Airtable-shaped interface so roster.js / templates.js / inventory.js work unchanged.
const SB_TABLE_MAP = { Roster: "roster", Templates: "templates", Inventory: "inventory" };
function rowToRec(row) {
  const fields = { Name: row.name || "" };
  if (row.data !== undefined) fields.Data = typeof row.data === "string" ? row.data : JSON.stringify(row.data || {});
  if (row.category !== undefined && row.category !== null) fields.Category = row.category;
  return { id: row.id, fields };
}
function fieldsToRow(f) {
  f = f || {};
  const row = {};
  if (f.Name !== undefined) row.name = f.Name;
  if (f.Data !== undefined) { try { row.data = JSON.parse(f.Data); } catch { row.data = {}; } }
  if (f.Category !== undefined) row.category = f.Category;
  return row;
}
function colOf(field) { return field === "Name" ? "name" : field === "Category" ? "category" : String(field).toLowerCase(); }
export async function airtableTable(table, method, path = "", body) {
  const sb = SB_TABLE_MAP[table] || String(table).toLowerCase();
  if (method === "GET" && path.startsWith("/")) {
    const id = path.slice(1).split("?")[0];
    const rows = await supabaseRest("GET", "/" + sb + "?id=eq." + encodeURIComponent(id) + "&select=*", null);
    if (!rows || !rows[0]) { const e = new Error("Not found"); e.status = 404; throw e; }
    return rowToRec(rows[0]);
  }
  if (method === "GET") {
    let q = "/" + sb + "?select=*";
    const m = path.match(/filterByFormula=([^&]+)/);
    if (m) {
      const formula = decodeURIComponent(m[1]);
      const nm = formula.match(/\{(\w+)\}='([^']*)'/);
      if (nm) q += "&" + colOf(nm[1]) + "=eq." + encodeURIComponent(nm[2]);
    }
    const rows = await supabaseRest("GET", q, null);
    return { records: (rows || []).map(rowToRec) };
  }
  if (method === "POST") {
    const rows = await supabaseRest("POST", "/" + sb, fieldsToRow(body && body.fields), "return=representation");
    return rowToRec(rows[0]);
  }
  if (method === "PATCH") {
    const id = path.slice(1).split("?")[0];
    await supabaseRest("PATCH", "/" + sb + "?id=eq." + encodeURIComponent(id), fieldsToRow(body && body.fields));
    return {};
  }
  if (method === "DELETE") {
    const id = path.slice(1).split("?")[0];
    await supabaseRest("DELETE", "/" + sb + "?id=eq." + encodeURIComponent(id), null);
    return {};
  }
  return {};
}
// Events table calls now go to the Supabase `shows` table. This shim keeps the
// old Airtable-shaped interface so every existing caller works unchanged.
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
    if (allowed.has(k)) { merged[k] = incoming[k]; continue; }   // whole tab allowed
    return { ok: false, bad: [k] };                       // out of scope
  }
  return { ok: true, data: merged };
}
