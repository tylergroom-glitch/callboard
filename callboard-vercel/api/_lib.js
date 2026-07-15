// Shared helpers for the serverless API. Files starting with "_" are not routes.
import crypto from "node:crypto";

const {
  AIRTABLE_TOKEN,
  AIRTABLE_BASE_ID,
  AIRTABLE_TABLE = "Events",
  ADMIN_PASSWORD,
  APP_SECRET,
} = process.env;

export const env = {
  ADMIN_PASSWORD,
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
