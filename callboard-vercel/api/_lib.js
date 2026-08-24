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
