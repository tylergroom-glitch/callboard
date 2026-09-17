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

// Global crew roster. TCG-admin only to read since v1.30.0 — it carries every
// crew member's pay, phone and emergency contact. The positions list is the one
// open route, because it is a list of job titles and is about nobody.
export const listRoster = () => api("GET", "/api/roster");
// Who arrived through the public onboarding link and has not been reviewed.
// A short record — no DOB, passport or phone. See api/roster.js.
export const listNewCrew = () => api("GET", "/api/roster?new=1");
export const markCrewReviewed = (id) =>
  api("POST", "/api/roster?reviewed=" + encodeURIComponent(id));
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
/* Every show's costing in one request, for the company-wide roll-up. The
   roll-up cannot read these figures off the show record — they have not lived
   there since costing moved to its own table. */
export const getAllCosting = () => api("GET", "/api/costing?all=1");

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
// Saved gear presets — bundles of groups and their line items, admin-only.
export const listQuotePresets = () => api("GET", "/api/quotes?presets=1");
export const saveQuotePreset = (name, notes, data) =>
  api("POST", "/api/quotes?presets=1", { name, notes, data });
export const deleteQuotePreset = (id) =>
  api("DELETE", "/api/quotes?presets=1&id=" + encodeURIComponent(id));

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

/* ---------- Past jobs: bulk import, and the year's revenue ----------

   `previewJobImport` WRITES NOTHING. It reads a pasted table and hands back
   every row with what it made of it, what is already in the app, and what it
   would create. Nothing exists until `commitJobImport` is called.

   The rows handed to commit are the RAW values, not the review screen's
   verdict: the server re-reads every one of them and re-checks every duplicate
   against the database as it is at that moment. That is what makes pressing
   Import twice safe, and it means these two calls can be minutes apart without
   the second one acting on a stale picture. */
export const previewJobImport = (text) =>
  api("POST", "/api/import-jobs?preview=1", { text });
export const commitJobImport = (rows, note, source) =>
  api("POST", "/api/import-jobs?commit=1", { rows, note, source });
export const listJobImports = () => api("GET", "/api/import-jobs");

/* Read ONE quote PDF. Writes nothing — not a show, not a quote, not a client.
   It hands back what the PDF says plus which directory rows look like a match,
   and the browser calls it once per file so a bad ninth PDF is a row on the
   review screen rather than a failed batch of twenty-five. */
export const readQuotePdf = (pdf, fileName) =>
  api("POST", "/api/import-pdf", { pdf, fileName });
/* Takes an import back out — but only the jobs that have had nothing hung on
   them since. Anything with receipts, tasks, invoices or crew is kept and
   named in the response. */
export const undoJobImport = (batchId) =>
  api("POST", "/api/import-jobs?undo=" + encodeURIComponent(batchId));

/* The year's gross, by month and by client, with costs against it.
   Gross is what was WON, not what has been collected — billing answers the
   other question. */
export const getYearRevenue = (year) =>
  api("GET", "/api/reporting?revenue=1&year=" + encodeURIComponent(year));

// Platform-wide TCG admin. Invites the person if they have no account yet.
export const setTcgAdmin = (body) =>
  api("POST", "/api/members?tcg=1", { redirectTo: window.location.origin + "?setpw=1", ...body });

/* ============================================================
   BILLING — invoice milestones, approval, delivery, payments.
   Admin only on every route. Crew never load any of this.
   ============================================================ */

// Every invoice across every show, list columns only — what the Billing home reads.
export const listBilling = () => api("GET", "/api/billing");
// One show's invoices in full, plus its adjustments.
export const getShowBilling = (eventId) =>
  api("GET", "/api/billing?eventId=" + encodeURIComponent(eventId));
export const getInvoice = (id) => api("GET", "/api/billing?id=" + encodeURIComponent(id));

// Build the schedule from an accepted quote. Idempotent: it creates what is
// missing, refreshes what nobody has touched, and leaves anything already
// invoiced, sent or paid exactly where it is.
export const generateBilling = (quoteId) =>
  api("POST", "/api/billing?generate=1", { quoteId });

// QuickBooks details and actual values. Never the status — that has its own call.
export const saveInvoice = (id, payload) =>
  api("PATCH", "/api/billing?id=" + encodeURIComponent(id), payload);
// One workflow move. The server refuses the ones that would be lies.
export const setInvoiceStatus = (id, status) =>
  api("PATCH", "/api/billing?id=" + encodeURIComponent(id) + "&status=" + encodeURIComponent(status));

export const addInvoicePayment = (id, payment) =>
  api("POST", "/api/billing?id=" + encodeURIComponent(id) + "&payment=1", payment);
export const removeInvoicePayment = (id, paymentId) =>
  api("DELETE", "/api/billing?id=" + encodeURIComponent(id) + "&paymentId=" + encodeURIComponent(paymentId));

// Voiding keeps the record and needs a reason. Deleting is only allowed on a
// milestone nobody has acted on.
export const voidInvoice = (id, reason) =>
  api("POST", "/api/billing?id=" + encodeURIComponent(id) + "&void=1", { reason });
export const deleteInvoice = (id) =>
  api("DELETE", "/api/billing?id=" + encodeURIComponent(id));

// A quote whose total moved after its schedule was built. Nothing happens
// automatically — the Billing tab asks, and this does whichever you chose.
// mode: "recalc" | "final" | "change"
export const reconcileQuoteChange = (quoteId, mode) =>
  api("POST", "/api/billing?reconcile=1", { quoteId, mode });

// Daily digest settings and manual runs.
export const getDigestSettings = () => api("GET", "/api/billing-digest?settings=1");
export const saveDigestSettings = (s) => api("POST", "/api/billing-digest?settings=1", s);
export const previewDigest = () => api("GET", "/api/billing-digest?preview=1");
export const sendTestDigest = () => api("POST", "/api/billing-digest?test=1");

// Bring in what already exists: won quotes that never generated a schedule, and
// the invoice rows typed by hand on the pipeline before billing existed.
export const scanBillingImport = () => api("GET", "/api/billing?importScan=1");
export const importPipelineInvoices = (eventId) =>
  api("POST", "/api/billing?importPipeline=1", { eventId });

// Calendar links are revocable. The token is shown once, when it is minted;
// after that the only thing you can do to it is revoke it.
export const listBillingCalendarLinks = () => api("GET", "/api/billing-calendar?links=1");
export const revokeBillingCalendarLink = (id) =>
  api("POST", "/api/billing-calendar?revoke=" + encodeURIComponent(id));

// A signed, year-long subscription link for the billing calendar. Two entries per
// live milestone — the day to raise it, the day the money is due — and both drop
// out once it is paid.
export const generateBillingCalendarLink = () =>
  api("GET", "/api/billing-calendar?generate=1");

// Billable adjustments — the screen lands in phase 2, the endpoint is live now.
export const listAdjustments = (eventId) =>
  api("GET", "/api/billing?adjustments=1" + (eventId ? "&eventId=" + encodeURIComponent(eventId) : ""));
export const saveAdjustment = (row) => api("POST", "/api/billing?adjustments=1", row);
export const deleteAdjustment = (id) =>
  api("DELETE", "/api/billing?adjustments=1&id=" + encodeURIComponent(id));

// Branded T&C PDF. "meta" fetches just name/page count; no arg fetches the bytes.
export const getQuoteTermsPdfMeta = () => api("GET", "/api/quotes?termsPdf=meta");
export const getQuoteTermsPdf = () => api("GET", "/api/quotes?termsPdf=1");
export const saveQuoteTermsPdf = (payload) => api("POST", "/api/quotes?termsPdf=1", payload);
export const deleteQuoteTermsPdf = () => api("DELETE", "/api/quotes?termsPdf=1");

/* ============================================================
   TASKS — the account-wide to-do list, and the inbox that feeds
   it. Admin-gated on the server, both reading and writing.
   ============================================================ */
/* `owner` is "me", "none", an account id, or nothing for everybody's.
   "me" needs an ACCOUNT sign-in; with the shared admin password the server
   answers with noIdentity rather than guessing. */
export const listTasks = (status, owner) => {
  const q = [];
  if (status) q.push("status=" + encodeURIComponent(status));
  if (owner) q.push("owner=" + encodeURIComponent(owner));
  return api("GET", "/api/tasks" + (q.length ? "?" + q.join("&") : ""));
};
export const createTask = (task) => api("POST", "/api/tasks", { task });
export const updateTask = (id, patch) =>
  api("PATCH", "/api/tasks?id=" + encodeURIComponent(id), { patch });
export const deleteTask = (id) => api("DELETE", "/api/tasks?id=" + encodeURIComponent(id));
// Which addresses and numbers may file things, and whether the digest is on.
/* Expenses and receipts. The endpoint has existed and worked for weeks with
   nothing calling it — these are the calls the screen makes.

   `deleteExpense` is a SOFT delete on the server: the row leaves every list
   and the receipt stays in the bucket, because a receipt is tax evidence and
   tidying a screen must not be able to destroy it. */
export const listShowExpenses = (showId) =>
  api("GET", "/api/expenses?show=" + encodeURIComponent(showId));
export const listOverheadExpenses = (from, to) =>
  api("GET", "/api/expenses?overhead=1" +
    (from ? "&from=" + encodeURIComponent(from) : "") +
    (to ? "&to=" + encodeURIComponent(to) : ""));
export const listYearExpenses = (year) =>
  api("GET", "/api/expenses?year=" + encodeURIComponent(year));
/* Thin rows — id, show, amount, category — for every show receipt at once, so
   the roll-up can fold receipts into each show's actual cost without one
   request per show. Not summed on the server: a receipt can be excluded from
   a show's P&L by hand, and that list lives in the show's costing. */
export const listShowExpenseTotals = () =>
  api("GET", "/api/expenses?totals=1");

/* Message everyone on a show, with a PDF packet attached.

   `preview` builds the packet and hands it back WITHOUT sending — that is the
   whole point of the two modes, because the alternative is finding out what
   the packet looks like at the same moment thirty people do.

   `to` is a filter over the show's own crew list, never an address book: the
   server drops anything that is not on the show and names it in `rejected`. */
/* The Today dashboard's one new request: readiness per show, the stage track
   and the open pipeline total. Everything else on that screen still loads
   through its own endpoint, so one failure greys one panel. */
export const getDashboard = () => api("GET", "/api/dashboard");

export const previewShowMessage = (showId, body) =>
  api("POST", "/api/show-message?preview=1&show=" + encodeURIComponent(showId), body);
export const sendShowMessage = (showId, body) =>
  api("POST", "/api/show-message?show=" + encodeURIComponent(showId), body);
export const createExpenses = (rows, { showId, overhead } = {}) =>
  api("POST", "/api/expenses?" + (overhead ? "overhead=1" : "show=" + encodeURIComponent(showId)), { rows });
export const updateExpense = (id, patch) =>
  api("PATCH", "/api/expenses?id=" + encodeURIComponent(id), patch);
export const deleteExpense = (id) =>
  api("DELETE", "/api/expenses?id=" + encodeURIComponent(id));
export const signReceiptUpload = (contentType, { showId, overhead } = {}) =>
  api("POST", "/api/expenses?upload=1&" + (overhead ? "overhead=1" : "show=" + encodeURIComponent(showId)), { contentType });
export const viewReceipt = (id) =>
  api("GET", "/api/expenses?receipt=" + encodeURIComponent(id));

/* "Got it" on the call sheet. Its own endpoint rather than a field on the show,
   because every crew member confirms within the same few minutes and the show
   record saves whole — see api/call-ack.js. */
export const listCallAcks = (showId) =>
  api("GET", "/api/call-ack?show=" + encodeURIComponent(showId));
export const confirmCall = (showId, crewId, ackOf) =>
  api("POST", "/api/call-ack?show=" + encodeURIComponent(showId), { crewId, ackOf });

/* Crew availability. Asking, and what came back.
   The crew member's own side of this is not here: they answer on a page served
   by /api/availability itself, from a link in an email, with no sign-in and no
   bundle. See api/availability.js. */
export const listAvailability = (showId) =>
  api("GET", "/api/availability?show=" + encodeURIComponent(showId));
export const askAvailability = (showId, body) =>
  api("POST", "/api/availability?show=" + encodeURIComponent(showId), body);

/* Todoist. The sync is two-way for completions: your list goes out, ticking it
   on the phone comes back. See api/todoist.js for why it cannot silently
   drift — the short version is that reads are a bookmark and writes are
   idempotent. */
export const getTodoistStatus = () => api("GET", "/api/todoist?status=1");
export const connectTodoist = () => api("POST", "/api/todoist?connect=1");
export const disconnectTodoist = () => api("POST", "/api/todoist?disconnect=1");
export const syncTodoist = () => api("POST", "/api/todoist?sync=1");

// Send one Telegram message now and report exactly what Telegram said back.
// The only way to tell "this deployment cannot reach my phone" from "the
// schedule is not running" without reading Vercel's logs.
export const sendTestNudge = () => api("GET", "/api/nudge?test=1");
export const getInboxSettings = () => api("GET", "/api/tasks?settings=1");
export const saveInboxSettings = (settings) => api("POST", "/api/tasks?settings=1", { settings });

/* The assistant. Threads are kept server-side so a conversation
   started by text can be picked up in the app and vice versa. */
export const getAgentThread = () => api("GET", "/api/agent");
export const sendAgent = (message) => api("POST", "/api/agent", { message });
export const confirmAgent = () => api("POST", "/api/agent?confirm=1", {});
export const cancelAgent = () => api("POST", "/api/agent?cancel=1", {});
export const resetAgent = () => api("POST", "/api/agent?reset=1", {});

/* AV Studio. Crew Call holds only a view link, so the only thing it can do
   about editing rights is ask on someone's behalf. This grants nothing — it
   files a request that has to be approved inside AV Studio. */
export const requestAvStudioAccess = (payload) =>
  api("POST", "/api/avstudio-access", payload);

/* Trucking distance. Every lookup costs money and is cached server-side, so
   the browser never sees the Maps key and never decides whether to pay. */
export const lookupDistance = (to, opts = {}) =>
  api("GET", "/api/distance?to=" + encodeURIComponent(to) + (opts.fresh ? "&fresh=1" : ""));
export const getTruckOrigin = () => api("GET", "/api/distance?origin=1");
export const setTruckOrigin = (origin) => api("POST", "/api/distance?origin=1", { origin });

/* Company-wide starting rates for a new quote's trucking line. A quote that
   already carries its own rates keeps them, so changing these never reprices
   anything already sent. */
export const getTruckRates = () => api("GET", "/api/distance?rates=1");
export const setTruckRates = (rates) => api("POST", "/api/distance?rates=1", { rates });


/* Crew documents — NDAs and W-9s, once per person.

   There is deliberately no client function that fetches a request token: the
   link only ever leaves the server inside an email. */
export const getCrewDocStatus = () => api("GET", "/api/crew-docs?status=1");
export const requestCrewDoc = (rosterId, docType) =>
  api("POST", "/api/crew-docs?request=1", { rosterId, docType });
export const requestCrewDocAll = (docType) =>
  api("POST", "/api/crew-docs?requestAll=1", { docType });
export const viewCrewDoc = (id) =>
  api("GET", "/api/crew-docs?view=" + encodeURIComponent(id));
export const voidCrewDoc = (id) =>
  api("POST", "/api/crew-docs?void=" + encodeURIComponent(id));
export const getDocTemplate = (docType) =>
  api("GET", "/api/crew-docs?template=" + encodeURIComponent(docType));
export const signDocTemplateUpload = (docType) =>
  api("POST", "/api/crew-docs?template=1", { docType, contentType: "application/pdf" });

/* ---- the activity feed -------------------------------------------------- */
/* Newest first. Unscoped is admin-only; narrowed to a show it follows the
   ordinary show-access rule. */
export const getActivity = ({ showId, limit } = {}) =>
  api("GET", "/api/activity?" + [
    showId ? "show=" + encodeURIComponent(showId) : "",
    limit ? "limit=" + encodeURIComponent(limit) : "",
  ].filter(Boolean).join("&"));

/* ---- scheduled messages ------------------------------------------------- */
/* Same endpoint as an immediate send — the only difference is `sendAt` in the
   body. Deliberately not a separate function calling a separate route: one
   composer, one set of rules, one place a refusal can come from. */
export const scheduleShowMessage = (showId, body) =>
  api("POST", "/api/show-message?show=" + encodeURIComponent(showId), body);
export const listShowMessages = (showId) =>
  api("GET", "/api/show-message?history=1&show=" + encodeURIComponent(showId));
export const cancelShowMessage = (showId, id) =>
  api("POST", "/api/show-message?show=" + encodeURIComponent(showId) +
      "&cancel=" + encodeURIComponent(id), {});

/* ---- appearance --------------------------------------------------------- */
export const getAppearance = () => api("GET", "/api/appearance");
export const saveAppearance = (patch) => api("PUT", "/api/appearance", patch);

/* ---- backups ------------------------------------------------------------
   The manifest goes through api() like everything else. The download cannot:
   api() calls res.json(), and a backup is gzipped bytes, so it is fetched
   here and handed to the browser as a file. */
export const getBackupManifest = () => api("GET", "/api/backup?manifest=1");

export async function downloadBackup(table) {
  const path = "/api/backup" + (table ? "?table=" + encodeURIComponent(table) : "");
  const res = await fetch(path, {
    headers: { ...(auth && auth.token ? { Authorization: "Bearer " + auth.token } : {}) },
  });

  /* A refusal comes back as JSON even though a success comes back as bytes.
     Read the type rather than guessing: treating a refusal as a file is how
     someone ends up with a 200-byte "backup" containing an error message and
     no idea anything went wrong. */
  if (!res.ok) {
    let msg = "Backup failed (" + res.status + ")";
    try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) {}
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }

  const blob = await res.blob();
  if (!blob.size) throw new Error("The backup came back empty. Nothing has been saved.");

  /* The filename the server chose, so the date in it is the server's date. */
  const cd = res.headers.get("content-disposition") || "";
  const m = cd.match(/filename="([^"]+)"/);
  const name = (m && m[1]) ||
    ("touchstone-backup-" + new Date().toISOString().slice(0, 10) + ".json.gz");

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  /* Revoked on a timeout rather than immediately: Safari has been known to
     cancel the download if the object URL disappears in the same tick. */
  setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 30000);
  return { name, bytes: blob.size };
}

/* ---- venue attachments ---------------------------------------------------
   Photos, Vectorworks plots and PDFs hung off a venue.

   THE UPLOAD DOES NOT GO THROUGH api(). Two reasons, and both matter for a
   180MB venue plot:

     1. The bytes go STRAIGHT TO SUPABASE on a signed URL. Anything routed
        through the app itself dies at 4.5MB.
     2. fetch() cannot report upload progress. There is no event for it. On a
        file this size that means a twenty-minute wait with nothing moving on
        screen, which is indistinguishable from a hang — so people cancel and
        try again, forever. XMLHttpRequest can, so this uses it. */
export const listVenueFiles = (venueId) =>
  api("GET", "/api/venue-files?venue=" + encodeURIComponent(venueId));

export const viewVenueFile = (id, thumb) =>
  api("GET", "/api/venue-files?view=" + encodeURIComponent(id) + (thumb ? "&thumb=1" : ""));

export const deleteVenueFile = (id) =>
  api("DELETE", "/api/venue-files?id=" + encodeURIComponent(id));

const signVenueUpload = (venueId, fileName, fileSize) =>
  api("POST", "/api/venue-files?sign=1&venue=" + encodeURIComponent(venueId),
      { fileName, fileSize });

const recordVenueFile = (venueId, body) =>
  api("POST", "/api/venue-files?venue=" + encodeURIComponent(venueId), body);

/* One PUT, with progress and one retry.
   `onProgress` is called with 0..1. A rejected promise here is a failed
   upload — nothing is recorded, so a half-sent file leaves no row behind. */
function putWithProgress(url, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    if (blob.type) xhr.setRequestHeader("Content-Type", blob.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      (xhr.status >= 200 && xhr.status < 300)
        ? resolve()
        : reject(new Error("The upload was refused (" + xhr.status + ")."));
    xhr.onerror = () => reject(new Error("The connection dropped during the upload."));
    xhr.onabort = () => reject(new Error("The upload was cancelled."));
    /* No timeout set on purpose: a 200MB file over venue wi-fi legitimately
       takes a long time, and a timeout here would kill uploads that were
       working. A stall shows as progress that stops moving. */
    xhr.send(blob);
  });
}

async function putRetrying(url, blob, onProgress) {
  try {
    return await putWithProgress(url, blob, onProgress);
  } catch (e) {
    /* One retry, because the common failure on a long upload is a single
       dropped connection rather than anything wrong with the file. A second
       failure is reported rather than hidden behind a third attempt — at
       these sizes, silently retrying forever wastes someone's afternoon. */
    if (onProgress) onProgress(0);
    return await putWithProgress(url, blob, onProgress);
  }
}

/* A small JPEG of a photo, made here before it is uploaded.
   Without it, opening a venue with twenty photographs pulls twenty full-size
   images — on a phone in a car park that is the difference between a feature
   people use and one they wait for and give up on.

   Returns null for anything that is not an image the browser can decode,
   which includes HEIC in some browsers. A missing thumbnail is not an error:
   the full image is still there and the list falls back to it. */
export async function makeThumb(file, max = 400) {
  if (!file || !/^image\//.test(file.type || "")) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    try { bitmap.close(); } catch (e) {}
    return await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.72));
  } catch (e) {
    return null;
  }
}

/* The whole job: ask for a URL, send the bytes, record the row.
   Nothing is recorded until the bytes are actually there, so a failed upload
   leaves the venue exactly as it was rather than a row pointing at nothing. */
export async function uploadVenueFile(venueId, file, { caption = "", onProgress } = {}) {
  const signed = await signVenueUpload(venueId, file.name, file.size);

  await putRetrying(signed.url, file, onProgress);

  /* The thumbnail goes up after the main file and its failure is survivable —
     a venue photo with no thumbnail still works. Letting it fail the whole
     upload would throw away a 200MB send over a 30KB one. */
  let thumbPath = "";
  if (signed.thumb) {
    const thumb = await makeThumb(file);
    if (thumb) {
      try { await putWithProgress(signed.thumb.url, thumb); thumbPath = signed.thumb.path; }
      catch (e) { thumbPath = ""; }
    }
  }

  return recordVenueFile(venueId, {
    path: signed.path,
    thumbPath,
    fileName: file.name,
    fileSize: file.size,
    mime: file.type || "",
    caption,
  });
}
