// Talks to our own /api endpoints (never to Airtable directly). Holds the token in
// sessionStorage so a refresh keeps you signed in, but it clears when the tab closes.
const KEY = "cb_auth";
let auth = null;
try {
  auth = JSON.parse(sessionStorage.getItem(KEY) || "null");
} catch {}

function setAuth(a) {
  auth = a;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(a));
  } catch {}
}
export function currentAuth() {
  return auth;
}
export function logout() {
  auth = null;
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth && auth.token ? { Authorization: "Bearer " + auth.token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "Request failed (" + res.status + ")");
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function loginAdmin(password) {
  const r = await api("POST", "/api/auth", { mode: "admin", password });
  setAuth({ scope: r.scope, token: r.token });
  return r;
}
export async function loginShow(password) {
  const r = await api("POST", "/api/auth", { mode: "show", password });
  setAuth({ scope: r.scope, token: r.token, showId: r.show.id, showName: r.show.name });
  return r;
}

export const listEvents = () => api("GET", "/api/events");
export const getEvent = (id) => api("GET", "/api/events?id=" + encodeURIComponent(id));
export const createEvent = (payload) => api("POST", "/api/events", payload);
export const updateEvent = (id, payload) => api("PATCH", "/api/events?id=" + encodeURIComponent(id), payload);
export const deleteEvent = (id) => api("DELETE", "/api/events?id=" + encodeURIComponent(id));
export const setPassword = (id, password) => api("POST", "/api/password", { id, password });

// Shared pull-list templates (global library; saving/deleting is admin-only).
export const listTemplates = () => api("GET", "/api/templates");
export const createTemplate = (name, data) => api("POST", "/api/templates", { name, data });
export const deleteTemplate = (id) => api("DELETE", "/api/templates?id=" + encodeURIComponent(id));

// Global crew roster (admin manages, any signed-in user can read for autocomplete).
export const listRoster = () => api("GET", "/api/roster");
export const saveRosterMember = (name, data, id) =>
  api("POST", "/api/roster", { name, data, ...(id ? { id } : {}) });
export const deleteRosterMember = (id) =>
  api("DELETE", "/api/roster?id=" + encodeURIComponent(id));
export const getPositions = () => api("GET", "/api/roster?positions=1");
export const savePositions = (positions) =>
  api("POST", "/api/roster?positions=1", { positions });
export const generateOnboardLink = () => api("GET", "/api/onboard?generate=1");

// Per-case inventory (global catalog; admin manages, any signed-in user can pick for a show).
export const listInventory = () => api("GET", "/api/inventory");
export const saveInventoryCase = (name, category, data, id) =>
  api("POST", "/api/inventory", { name, category, data, ...(id ? { id } : {}) });
export const deleteInventoryCase = (id) =>
  api("DELETE", "/api/inventory?id=" + encodeURIComponent(id));
export const getCosting = (id) => api("GET", "/api/costing?id=" + encodeURIComponent(id));
export const saveCosting = (id, costing) => api("PATCH", "/api/costing?id=" + encodeURIComponent(id), { costing });

// Import gear from a quote PDF (passes the PDF to the Claude API for extraction).
export const importQuote = (pdf) => api("POST", "/api/import-quote", { pdf });
