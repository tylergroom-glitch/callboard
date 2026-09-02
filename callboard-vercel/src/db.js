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
  setAuth({ scope: r.scope, token: r.token, showId: r.show.id, showName: r.show.name, level: r.level || "crew" });
  return r;
}
export async function loginSupabase(supabaseToken) {
  const r = await api("POST", "/api/auth", { mode: "supabase", supabaseToken });
  setAuth({ scope: r.scope, token: r.token, is_tcg: r.is_tcg });
  return { scope: r.scope, token: r.token, is_tcg: r.is_tcg };
}

export const runMigration = () => api("POST", "/api/migrate");
export const listProfiles = () => api("GET", "/api/members?profiles=1");
export const listShowMembers = (showId) => api("GET", "/api/members?showId=" + encodeURIComponent(showId));
export const saveShowMember = (payload) => api("POST", "/api/members", payload);
export const removeShowMember = (showId, userId) => api("DELETE", "/api/members?showId=" + encodeURIComponent(showId) + "&userId=" + encodeURIComponent(userId));
export const listEvents = () => api("GET", "/api/events");
export const getEvent = (id) => api("GET", "/api/events?id=" + encodeURIComponent(id));
export const createEvent = (payload) => api("POST", "/api/events", payload);
export const updateEvent = (id, payload) => api("PATCH", "/api/events?id=" + encodeURIComponent(id), payload);
export const deleteEvent = (id) => api("DELETE", "/api/events?id=" + encodeURIComponent(id));
export const setPassword = (id, password) => api("POST", "/api/password", { id, password });
// Set any of the three per-show access passwords. Only the keys you include are
// changed: omit a key to leave it as-is, or pass "" to remove that level.
// passwords = { crewPassword? }  — editor/admin tiers removed; use account roles
export const setShowPasswords = (id, passwords) => api("POST", "/api/password", { id, ...passwords });

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
// Post-show survey: a signed, show-scoped link crew can fill out. Responses are
// stored on that show's record, so they stay with the show year over year.
export const generateSurveyLink = (id) =>
  api("GET", "/api/survey?generate=1&id=" + encodeURIComponent(id));
export const generateScheduleFillLink = (id) =>
  api("GET", "/api/schedule-fill?generate=1&id=" + encodeURIComponent(id));
export const generateCalendarLink = () =>
  api("GET", "/api/calendar?generate=1");
export const generateShowCalendarLink = (id) =>
  api("GET", "/api/calendar?generate=1&id=" + encodeURIComponent(id));
// Department-scoped rundown share link (admin): visible/editable columns per link.
export const generateRundownShareLink = (id, shareId) =>
  api("GET", "/api/rundown-share?generate=1&id=" + encodeURIComponent(id) + "&share=" + encodeURIComponent(shareId));
export const generateRundownOutputLink = (id) =>
  api("GET", "/api/rundown-share?generate=1&output=1&id=" + encodeURIComponent(id));
export const previewInventoryImport = (sheetUrl) =>
  api("POST", "/api/import-inventory", { sheetUrl, preview: true });
export const confirmInventoryImport = (sheetUrl) =>
  api("POST", "/api/import-inventory", { sheetUrl, confirm: true });

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
// Import an agenda / run-of-show and turn it into schedule days (paste text or a PDF).
export const importAgenda = (payload) => api("POST", "/api/import-schedule", payload);

/* ============================================================
   QUOTING — Stage 1: catalog, clients, venues.
   All admin-gated on the server. Crew never receive pricing.
   ============================================================ */

// Pricing catalog (admin only, both reading and writing).
export const listCatalog = () => api("GET", "/api/pricing");
export const saveCatalogItem = (item) => api("POST", "/api/pricing", { item });
export const deleteCatalogItem = (id) =>
  api("DELETE", "/api/pricing?id=" + encodeURIComponent(id));
// Upsert many at once. Matched on name, so re-importing updates rates
// rather than creating duplicates, and existing packages are left intact.
export const bulkCatalogImport = (items) => api("POST", "/api/pricing", { bulk: items });
// Read a Current RMS quote PDF and hand back rows to preview. Saves nothing.
export const importCatalogPdf = (pdf) => api("POST", "/api/import-catalog", { pdf });

// Clients — a row with no parentId is a company; rows with a parentId are
// contacts / divisions under it.
export const listClients = () => api("GET", "/api/directory?kind=clients");
export const saveClient = (row) => api("POST", "/api/directory?kind=clients", row);
export const deleteClient = (id) =>
  api("DELETE", "/api/directory?kind=clients&id=" + encodeURIComponent(id));

// Venues.
export const listVenues = () => api("GET", "/api/directory?kind=venues");
export const saveVenue = (row) => api("POST", "/api/directory?kind=venues", row);
export const deleteVenue = (id) =>
  api("DELETE", "/api/directory?kind=venues&id=" + encodeURIComponent(id));

/* ---------- Quotes (admin only; crew never load these) ---------- */
export const listQuotes = () => api("GET", "/api/quotes");
export const getQuote = (id) => api("GET", "/api/quotes?id=" + encodeURIComponent(id));
export const listQuoteRevisions = (familyId) =>
  api("GET", "/api/quotes?family=" + encodeURIComponent(familyId));
export const createQuote = (payload) => api("POST", "/api/quotes", payload);
export const saveQuote = (id, payload) =>
  api("PATCH", "/api/quotes?id=" + encodeURIComponent(id), payload);
// Status changes work even on a locked version (that is how you mark it won).
export const setQuoteStatus = (id, status) =>
  api("PATCH", "/api/quotes?id=" + encodeURIComponent(id) + "&status=" + encodeURIComponent(status));
// Duplicate a quote as the next version, back in draft.
// Save just the payment schedule. Deposits get ticked paid after a quote has
// been sent, so this deliberately works on a locked version.
export const saveQuotePayments = (id, deposits) =>
  api("PATCH", "/api/quotes?id=" + encodeURIComponent(id) + "&payments=1", { deposits });
// Link a won quote to the show it was turned into. Safe on locked quotes.
export const linkQuoteToShow = (id, eventId) =>
  api("PATCH", "/api/quotes?id=" + encodeURIComponent(id) + "&eventId=" + encodeURIComponent(eventId));
export const reviseQuote = (id) =>
  api("POST", "/api/quotes?revise=" + encodeURIComponent(id));
export const deleteQuote = (id) =>
  api("DELETE", "/api/quotes?id=" + encodeURIComponent(id));

// Terms and conditions — one shared block appended to every quote PDF.
export const getQuoteTerms = () => api("GET", "/api/quotes?terms=1");
export const saveQuoteTerms = (text) => api("POST", "/api/quotes?terms=1", { text });

// Platform-wide TCG admin. Invites the person if they have no account yet.
export const setTcgAdmin = (body) =>
  api("POST", "/api/members?tcg=1", { redirectTo: window.location.origin + "?setpw=1", ...body });

// Branded T&C PDF. "meta" fetches just name/page count; no arg fetches the bytes.
export const getQuoteTermsPdfMeta = () => api("GET", "/api/quotes?termsPdf=meta");
export const getQuoteTermsPdf = () => api("GET", "/api/quotes?termsPdf=1");
export const saveQuoteTermsPdf = (payload) => api("POST", "/api/quotes?termsPdf=1", payload);
export const deleteQuoteTermsPdf = () => api("DELETE", "/api/quotes?termsPdf=1");
