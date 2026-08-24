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
  return !!p && p.scope === "admin";
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

const AT_BASE = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;
export async function airtableTable(table, method, path = "", body) {
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
// Events table (default). Kept for existing callers.
export async function airtable(method, path = "", body) {
  return airtableTable(AIRTABLE_TABLE, method, path, body);
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
