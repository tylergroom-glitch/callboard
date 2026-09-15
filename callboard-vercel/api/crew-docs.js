// /api/crew-docs — NDAs and W-9s. Once per person, not per show.
//
//   ADMIN (TCG only)
//   GET  ?status=1                       every roster member and what they owe
//   POST ?request=1 {rosterId, docType}  issue (or reissue) a request, email it
//   POST ?requestAll=1 {docType}         issue to everyone who has not signed
//   GET  ?view=<id>                      short-lived URL to read a signed doc
//   POST ?void=<id>                      retire a signed document
//
//   THE CREW MEMBER (holds a link, needs no account)
//   GET  ?token=xxx                      their own page — nothing else
//   POST ?token=xxx&upload=1             a one-time upload URL, scoped to them
//   POST ?token=xxx  {method,...}        record the signature
//
// SETUP: run sql/setup-crew-docs.sql, then upload a blank NDA in Settings.
//
// ---------------------------------------------------------------------------
// WHAT THIS ROUTE IS PROTECTING
//
// A W-9 carries a taxpayer identification number — for a sole proprietor, that
// is their Social Security number. These files are the most sensitive things
// in the database, and the crew-facing half of this route is reachable by
// anyone holding a link. So:
//
//   * The folder a token may write to is derived from the TOKEN, never from
//     anything the caller sends. A request body naming a roster id would be a
//     request to write into somebody else's folder.
//   * Reading a document is TCG-admin only. A token holder can prove what they
//     owe; it can never fetch a file back, not even their own.
//   * A token is single-use AND time-limited: the HMAC proves it was not
//     forged, the row proves it has not already been spent. Either alone is
//     not enough — an HMAC-only token replays forever until it expires.
//
// The gate below is the same class of thing as canManageShow(p, null) and the
// AV Studio approval that failed open on a NULL. Both were "the check looked
// right". Read the tests before changing any of it.
// ---------------------------------------------------------------------------
import crypto from "node:crypto";
import {
  json, readBody, auth, isAdmin, supabaseRest,
  signToken, verifyToken, signUpload, signView, UPLOAD_EXT,
  sendBrevoEmail, sendBrevoBatch,
} from "./_lib.js";

const BUCKET = "crewdocs";
const COLS = "id,roster_id,doc_type,status,method,file_path,file_name,file_size," +
             "signed_at,signed_name,request_token,requested_at,expires_at";
const DOC_TYPES = { nda: "NDA", w9: "W-9" };
const LINK_DAYS = 30;

const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
/* Reserved prefix for the blank forms. Underscore-first so it can never
   collide with a roster uuid, which is what the crew upload path is built
   from — the two namespaces cannot overlap by construction rather than by
   anyone remembering. */
const templatePath = (docType) => "_templates/" + docType + ".pdf";
const label = (t) => DOC_TYPES[t] || t;

/* The token proves three things and carries nothing else: who, which document,
   and until when. No name, no email — a link forwarded to the wrong person
   should leak nothing about the right one. */
function issueToken(rosterId, docType) {
  return signToken({
    scope: "crewdoc",
    rid: rosterId,
    doc: docType,
    // A nonce, so reissuing to the same person for the same document produces a
    // genuinely different token rather than an identical string that the old
    // email would still satisfy.
    n: crypto.randomUUID(),
    exp: Date.now() + LINK_DAYS * 24 * 60 * 60 * 1000,
  });
}

/* Two checks, and BOTH are required.

   verifyToken says the string was signed by us and has not expired. That alone
   would let a link be replayed forever inside its window — including over a
   document that has since been signed. The row says this exact token is still
   the live request, and submitting nulls it.

   Returns the row, never just a boolean: everything downstream needs the
   roster id from the ROW, so there is no path where a caller's idea of who
   they are is consulted. */
async function resolveToken(token) {
  const p = verifyToken(token);
  if (!p || p.scope !== "crewdoc" || !p.rid || !DOC_TYPES[p.doc]) return null;
  const rows = await supabaseRest(
    "GET",
    "/crew_documents?request_token=eq." + encodeURIComponent(token) +
      "&select=" + COLS + "&limit=1", null);
  const row = rows && rows[0];
  if (!row) return null;                       // spent, revoked, or never ours
  if (row.status === "signed") return null;    // already done; not reopenable
  /* Belt and braces. The row was found BY the token, so these cannot disagree
     unless something has gone very wrong — and if it ever does, refusing is
     the only safe answer. */
  if (row.roster_id !== p.rid || row.doc_type !== p.doc) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

async function rosterName(rosterId) {
  try {
    const rows = await supabaseRest(
      "GET", "/roster?id=eq." + encodeURIComponent(rosterId) + "&select=id,name,data&limit=1", null);
    const r = rows && rows[0];
    if (!r) return null;
    const d = (r.data && typeof r.data === "object") ? r.data
      : (() => { try { return JSON.parse(r.data || "{}"); } catch { return {}; } })();
    return { id: r.id, name: r.name || "", email: str(d.email, 200) };
  } catch { return null; }
}

function linkFor(req, token) {
  const host = req.headers.host || "";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  return protocol + "://" + host + "/api/crew-docs?token=" + token;
}

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function requestEmail({ name, docType, url }) {
  const what = label(docType);
  return {
    subject: "Please sign your " + what + " — Touchstone Creative Group",
    html:
      "<div style=\"font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#23201F\">" +
      "<div style=\"height:5px;background:linear-gradient(90deg,#00699F,#00A4D7);border-radius:3px;margin-bottom:22px\"></div>" +
      "<p style=\"font-size:15px;margin:0 0 14px\">Hi " + esc(name || "there") + ",</p>" +
      "<p style=\"font-size:14px;line-height:1.6;margin:0 0 18px\">Before your next job with us we need your <b>" +
      esc(what) + "</b> on file. It takes about a minute on your phone — you can sign on screen, " +
      "or upload a signed copy if you would rather.</p>" +
      "<p style=\"margin:0 0 22px\"><a href=\"" + esc(url) + "\" style=\"display:inline-block;background:#00699F;color:#fff;" +
      "text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:7px\">Sign your " + esc(what) + "</a></p>" +
      "<p style=\"font-size:12.5px;color:#8A8683;line-height:1.6;margin:0\">This link is just for you and stops working in " +
      LINK_DAYS + " days. If it has expired, reply to this email and we will send another.</p>" +
      "</div>",
    text: "Hi " + (name || "there") + " — before your next job we need your " + what +
          " on file. Sign here (about a minute): " + url +
          "\n\nThis link is just for you and expires in " + LINK_DAYS + " days.",
  };
}

/* ------------------------------------------------------------------ admin */

async function listStatus() {
  const [crew, docs] = await Promise.all([
    supabaseRest("GET", "/roster?name=neq." + encodeURIComponent("__positions__") +
      "&select=id,name,data&order=name.asc&limit=2000", null),
    supabaseRest("GET", "/crew_documents?select=" + COLS + "&limit=5000", null),
  ]);
  const byPerson = {};
  for (const d of docs || []) {
    if (!byPerson[d.roster_id]) byPerson[d.roster_id] = {};
    byPerson[d.roster_id][d.doc_type] = {
      id: d.id,
      status: d.status,
      method: d.method,
      signedAt: d.signed_at,
      signedName: d.signed_name,
      fileName: d.file_name,
      // The token itself is never sent to the browser. Whether one is
      // outstanding is all the screen needs, and a token in a JSON response is
      // a token in a browser cache.
      requested: !!d.request_token,
      requestedAt: d.requested_at,
      expiresAt: d.expires_at,
    };
  }
  return (crew || []).map((r) => {
    const d = (r.data && typeof r.data === "object") ? r.data
      : (() => { try { return JSON.parse(r.data || "{}"); } catch { return {}; } })();
    return {
      id: r.id,
      name: r.name || "",
      email: str(d.email, 200),
      docs: byPerson[r.id] || {},
    };
  });
}

async function issueRequest(req, rosterId, docType, who) {
  const person = await rosterName(rosterId);
  if (!person) return { error: "No one on the roster with that id." };
  if (!person.email) return { error: (person.name || "That person") + " has no email address on the roster." };

  const token = issueToken(rosterId, docType);
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + LINK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  /* One row per person per document, so this is an upsert on that pair.
     Reissuing REPLACES the outstanding token, which is what invalidates the
     previous email — a person should never have two live links to the same
     document. */
  await supabaseRest(
    "POST", "/crew_documents?on_conflict=roster_id,doc_type",
    {
      roster_id: rosterId, doc_type: docType, status: "requested",
      request_token: token, requested_at: now, requested_by: str(who, 200),
      expires_at: expires, updated_at: now,
    },
    "resolution=merge-duplicates");

  const url = linkFor(req, token);
  const mail = requestEmail({ name: person.name, docType, url });
  const sent = await sendBrevoEmail({ to: person.email, toName: person.name, ...mail });
  /* The URL is NOT returned.

     It carries a live single-use token that opens this person's signing page
     and mints an upload URL into their folder — a bearer credential. Handing
     it back in a JSON body puts it in the browser's memory, in devtools, in a
     screenshot, in a support ticket. It also contradicted the rule stated at
     the top of this file, which is how it got written: the rule was in a
     comment and not in the code. The screen never read it. */
  return { ok: true, sent, email: person.email, name: person.name };
}

/* ------------------------------------------------------------------ route */

export default async function handler(req, res) {
  const q = req.query || {};
  const token = q.token;

  try {
    /* =====================================================================
       THE CREW-FACING HALF. No account, no session — a link and nothing else.
       Every branch derives the person from the ROW the token resolved to.
       ===================================================================== */
    if (token) {
      /* A token is a crew credential and nothing else. If the query ALSO names
         an admin verb, refuse rather than quietly serving the crew page
         instead — a request that gets a different resource than it asked for
         is how you end up unsure which half of a route ran. Nothing here is
         reachable with a token today, but "it happens to be safe" is a worse
         guarantee than "it is refused". */
      for (const k of ["status", "view", "request", "requestAll", "void", "template"]) {
        if (q[k]) return json(res, 403, { error: "Not allowed" });
      }
      const row = await resolveToken(token);
      if (!row) {
        if (req.method === "GET") {
          res.status(403).setHeader("Content-Type", "text/html").end(expiredPage());
          return;
        }
        return json(res, 403, { error: "This link is no longer valid. Ask for a new one." });
      }

      /* ---- the blank document ----
         Read-only, and a blank form is not private — but it is still served
         through a short-lived signed URL rather than a public bucket, because
         making this one thing public would mean a public bucket, and the
         signed NDAs live in the same place. */
      if (req.method === "GET" && q.blank) {
        try {
          const url = await signView(BUCKET, templatePath(row.doc_type));
          return json(res, 200, { url });
        } catch {
          return json(res, 404, { error: "The blank " + label(row.doc_type) + " has not been uploaded yet." });
        }
      }

      // ---- their page ----
      if (req.method === "GET") {
        const person = await rosterName(row.roster_id);
        res.status(200).setHeader("Content-Type", "text/html")
          .end(signPage({ token, docType: row.doc_type, name: person ? person.name : "" }));
        return;
      }

      if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

      // ---- a one-time upload URL, scoped to THEM ----
      if (q.upload) {
        const b = await readBody(req);
        const ext = UPLOAD_EXT[str(b && b.contentType, 100)];
        if (!ext) return json(res, 400, { error: "That has to be a PDF, JPEG or PNG." });
        /* THE LINE THAT MATTERS. The folder comes from row.roster_id — read out
           of the database by the token — and never from the request body. If a
           caller could name the folder, a link issued to one person would write
           into another's. */
        const name = row.roster_id + "/" + row.doc_type + "/" + crypto.randomUUID() + "." + ext;
        return json(res, 200, await signUpload(BUCKET, name));
      }

      // ---- record the signature ----
      const b = await readBody(req);
      const method = b && b.method === "drawn" ? "drawn" : b && b.method === "upload" ? "upload" : null;
      if (!method) return json(res, 400, { error: "Tell me how this was signed." });

      const path = str(b.path, 500);
      if (!path) return json(res, 400, { error: "Nothing was uploaded." });
      /* The client hands back the path it was given. Check it is one we issued
         to THIS person rather than trusting it — otherwise a crafted path
         attaches somebody else's file to this row. */
      if (path.indexOf(row.roster_id + "/" + row.doc_type + "/") !== 0) {
        return json(res, 400, { error: "That file does not belong to this request." });
      }

      const typed = str(b.signedName, 200);
      if (!typed) return json(res, 400, { error: "Please type your name." });

      const now = new Date().toISOString();
      const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
      await supabaseRest(
        "PATCH", "/crew_documents?id=eq." + encodeURIComponent(row.id),
        {
          status: "signed", method, file_path: path,
          file_name: str(b.fileName, 300), file_size: Number(b.fileSize) || null,
          signed_at: now, signed_name: typed,
          signed_ip: fwd.slice(0, 60), signed_agent: str(req.headers["user-agent"], 300),
          /* Spend the token. The link is dead the moment it is used, so a
             forwarded email cannot overwrite a document already signed. */
          request_token: null, updated_at: now,
        });
      return json(res, 200, { ok: true });
    }

    /* =====================================================================
       THE ADMIN HALF.
       ===================================================================== */
    const p = auth(req);
    if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });

    if (req.method === "GET" && q.status) {
      return json(res, 200, { crew: await listStatus() });
    }

    if (req.method === "GET" && q.view) {
      const rows = await supabaseRest(
        "GET", "/crew_documents?id=eq." + encodeURIComponent(String(q.view)) +
          "&select=file_path&limit=1", null);
      const row = rows && rows[0];
      if (!row || !row.file_path) return json(res, 404, { error: "Nothing signed on that one yet." });
      return json(res, 200, { url: await signView(BUCKET, row.file_path) });
    }

    /* ---- the blank NDA / W-9 Tyler uploads once ----
       Kept in the same bucket under a reserved prefix. A crew token can never
       reach it: the crew upload path is built from roster_id, and a uuid never
       begins with an underscore. */
    if (req.method === "POST" && q.template) {
      const b = await readBody(req);
      const docType = str(b && b.docType, 20);
      if (!DOC_TYPES[docType]) return json(res, 400, { error: "Unknown document type." });
      if (str(b && b.contentType, 100) !== "application/pdf") {
        return json(res, 400, { error: "The blank document has to be a PDF." });
      }
      /* upsert: the blank form lives at one fixed name, so uploading a revised
         one is a second write to the same path. Without this Supabase answers
         409 and the screen reports the same "upload did not finish" as a
         genuinely broken upload. */
      return json(res, 200, await signUpload(BUCKET, templatePath(docType), { upsert: true }));
    }

    if (req.method === "GET" && q.template) {
      const docType = str(q.template, 20);
      if (!DOC_TYPES[docType]) return json(res, 400, { error: "Unknown document type." });
      try {
        return json(res, 200, { url: await signView(BUCKET, templatePath(docType)) });
      } catch {
        return json(res, 200, { url: null });
      }
    }

    if (req.method === "POST" && q.request) {
      const b = await readBody(req);
      const docType = str(b && b.docType, 20);
      if (!DOC_TYPES[docType]) return json(res, 400, { error: "Unknown document type." });
      const rosterId = str(b && b.rosterId, 60);
      if (!rosterId) return json(res, 400, { error: "Who for?" });
      const out = await issueRequest(req, rosterId, docType, p.sub || p.scope || "");
      if (out.error) return json(res, 400, out);
      return json(res, 200, out);
    }

    if (req.method === "POST" && q.requestAll) {
      const b = await readBody(req);
      const docType = str(b && b.docType, 20);
      if (!DOC_TYPES[docType]) return json(res, 400, { error: "Unknown document type." });
      const crew = await listStatus();
      const targets = crew.filter((c) => {
        const d = c.docs[docType];
        return c.email && (!d || d.status !== "signed");
      });
      if (!targets.length) return json(res, 200, { ok: true, sent: [], failed: [] });

      /* TWO round trips for the whole roster, not two per person.

         Done one at a time, thirty-five people is seventy sequential HTTP
         calls inside a function with a timeout — and a timeout half way
         through leaves some asked and some not, with no way to tell which. So:
         every row in one upsert, every email in one send. */
      const now = new Date().toISOString();
      const expires = new Date(Date.now() + LINK_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const issuedBy = str(p.sub || p.scope || "", 200);
      const plan = targets.map((c) => {
        const token = issueToken(c.id, docType);
        return {
          person: c,
          token,
          row: {
            roster_id: c.id, doc_type: docType, status: "requested",
            request_token: token, requested_at: now, requested_by: issuedBy,
            expires_at: expires, updated_at: now,
          },
        };
      });

      /* The rows go FIRST and the emails second. A link that works before the
         email arrives is harmless; an email carrying a link with no row behind
         it is a person clicking through to "this is no longer valid". */
      await supabaseRest(
        "POST", "/crew_documents?on_conflict=roster_id,doc_type",
        plan.map((x) => x.row), "resolution=merge-duplicates");

      const out = await sendBrevoBatch(plan.map((x) => ({
        to: x.person.email, toName: x.person.name,
        ...requestEmail({ name: x.person.name, docType, url: linkFor(req, x.token) }),
      })));

      const bad = new Set(out.failed || []);
      return json(res, 200, {
        ok: true,
        sent: plan.filter((x) => !bad.has(x.person.email)).map((x) => x.person.name),
        failed: plan.filter((x) => bad.has(x.person.email))
          .map((x) => ({ name: x.person.name, why: "the email did not send" })),
      });
    }

    if (req.method === "POST" && q.void) {
      /* Retire rather than delete. The file stays in the bucket and the audit
         trail survives — "we used to hold a signed NDA for this person" is a
         thing you may one day need to be able to say. */
      const now = new Date().toISOString();
      await supabaseRest(
        "PATCH", "/crew_documents?id=eq." + encodeURIComponent(String(q.void)),
        { status: "void", request_token: null, updated_at: now });
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: "Method not allowed" });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || "Server error" });
  }
}

/* ------------------------------------------------------------------ pages */

const PAGE_CSS =
  "*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
  "background:#14161B;color:#E8E6E3;-webkit-font-smoothing:antialiased;padding:0 0 60px}" +
  ".bar{height:5px;background:linear-gradient(90deg,#00699F,#007AC1,#00A4D7)}" +
  ".wrap{max-width:560px;margin:0 auto;padding:26px 20px}" +
  "h1{font-size:22px;font-weight:800;margin:22px 0 6px}" +
  ".lead{color:#9AA0A6;font-size:14px;line-height:1.6;margin:0 0 22px}" +
  ".card{background:#1B1E24;border:1px solid #2C2F33;border-radius:12px;padding:16px;margin-bottom:14px}" +
  ".lbl{display:block;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#9AA0A6;margin:0 0 6px}" +
  ".help{font-size:12px;color:#7D838A;line-height:1.55;margin:0 0 10px}" +
  "input[type=text]{width:100%;background:#22262D;border:1px solid #2C2F33;border-radius:8px;color:#E8E6E3;" +
  "font-size:16px;padding:11px 12px}" +   /* 16px: anything smaller makes iOS zoom on focus */
  "input[type=text]:focus{outline:none;border-color:#FFB020}" +
  "canvas{width:100%;height:170px;background:#fff;border-radius:8px;touch-action:none;display:block}" +
  ".btn{display:inline-block;border:0;border-radius:9px;font-size:15px;font-weight:700;padding:13px 20px;cursor:pointer}" +
  ".btn.go{background:#FFB020;color:#1A1A1A;width:100%}" +
  ".btn.go[disabled]{opacity:.5}" +
  ".btn.ghost{background:transparent;color:#9AA0A6;border:1px solid #2C2F33;font-size:13px;padding:8px 14px}" +
  ".tabs{display:flex;gap:8px;margin-bottom:14px}" +
  ".tab{flex:1;text-align:center;background:#1B1E24;border:1px solid #2C2F33;border-radius:9px;padding:11px 8px;" +
  "font-size:13.5px;font-weight:700;color:#9AA0A6;cursor:pointer}" +
  ".tab.on{background:#22262D;color:#E8E6E3;border-color:#FFB020}" +
  ".msg{text-align:center;padding:50px 20px}" +
  ".msg .ico{font-size:38px}" +
  ".msg h2{font-size:19px;margin:14px 0 8px}" +
  ".msg p{color:#9AA0A6;font-size:14px;line-height:1.6;margin:0}" +
  ".err{background:rgba(255,107,107,.12);border:1px solid rgba(255,107,107,.35);color:#FF9B9B;" +
  "border-radius:8px;padding:10px 12px;font-size:13px;margin-bottom:12px}" +
  ".file{font-size:13px;color:#9AA0A6}";

const shell = (inner) =>
  "<!doctype html><html lang=en><head><meta charset=utf-8>" +
  "<meta name=viewport content=\"width=device-width,initial-scale=1,viewport-fit=cover\">" +
  "<title>Touchstone Creative Group</title><style>" + PAGE_CSS + "</style></head><body>" +
  "<div class=bar></div>" + inner + "</body></html>";

function expiredPage() {
  return shell(
    "<div class=wrap><div class=msg><div class=ico>🔒</div>" +
    "<h2>This link is no longer valid</h2>" +
    "<p>It may have expired, or the document may already be signed. " +
    "Reply to the email you received and we will send a new one.</p></div></div>");
}

export function signPage({ token, docType, name }) {
  const what = label(docType);
  const isW9 = docType === "w9";
  /* A W-9 cannot be signed on screen: it is a form that needs a taxpayer id,
     an address and a tax classification filled in before a signature means
     anything. Offering a "sign here" box would produce a document that looks
     complete and is worthless. Upload only, deliberately. */
  return shell(
    "<div class=wrap>" +
    "<h1>Your " + esc(what) + "</h1>" +
    "<p class=lead>Hi " + esc(name || "there") + " — Touchstone needs this on file before your next job. " +
    (isW9
      ? "Download the blank form, fill it in and sign it, then upload it back here."
      : "Read it, then either sign on screen or upload a signed copy.") +
    "</p>" +
    "<div id=err></div>" +
    "<div class=card><a class=\"btn ghost\" id=blank href=\"#\">📄 Open the blank " + esc(what) + "</a>" +
    "<p class=help style=\"margin:10px 0 0\">" +
    (isW9 ? "Fill this in, sign it, then upload it below." : "Have a read before you sign it.") +
    "</p></div>" +
    (isW9 ? "" :
      "<div class=tabs><div class=\"tab on\" data-m=drawn>Sign on screen</div>" +
      "<div class=tab data-m=upload>Upload a signed copy</div></div>") +
    "<div class=card id=drawnBox" + (isW9 ? " hidden" : "") + ">" +
    "<span class=lbl>Sign here</span>" +
    "<p class=help>Use your finger or a mouse.</p>" +
    "<canvas id=pad></canvas>" +
    "<p style=\"margin:10px 0 0\"><button class=\"btn ghost\" id=clear type=button>Clear</button></p></div>" +
    "<div class=card id=upBox" + (isW9 ? "" : " hidden") + ">" +
    "<span class=lbl>Your signed copy</span>" +
    "<p class=help>A PDF or a clear photo is fine.</p>" +
    "<input type=file id=file accept=\"application/pdf,image/jpeg,image/png\">" +
    "<p class=file id=fname></p></div>" +
    "<div class=card><span class=lbl>Your full name</span>" +
    "<p class=help>Typed as your confirmation that this is you.</p>" +
    "<input type=text id=who value=\"" + esc(name || "") + "\" autocomplete=name></div>" +
    "<button class=\"btn go\" id=go>Submit my " + esc(what) + "</button>" +
    "<p class=help style=\"margin-top:14px\">We record the date and time you signed. " +
    "Your document is stored privately and is only ever seen by Touchstone.</p>" +
    "</div>" +
    "<script>" + pageScript(token, docType) + "</script>");
}

/* Kept as a string rather than a bundled module for the same reason
   /api/onboard does it: this page is served by the function itself to someone
   who may have no account, so it cannot depend on the app's build output. */
function pageScript(token, docType) {
  return (
    "var TOKEN=" + JSON.stringify(token) + ",DOC=" + JSON.stringify(docType) + ";" +
    "var mode=DOC==='w9'?'upload':'drawn',drawn=false;" +
    /* textContent, not innerHTML. Every message that reaches here today is a
   constant, but the outer catch can surface a database error, and "no
   attacker-controlled string currently reaches this sink" is a property that
   holds until someone adds an error message. */
    "function err(m){var e=document.getElementById('err');e.textContent='';" +
    "if(m){var d=document.createElement('div');d.className='err';d.textContent=m;e.appendChild(d);}" +
    "if(m)window.scrollTo(0,0);}" +
    // --- the blank document, fetched through the app so the bucket stays private
    "document.getElementById('blank').onclick=function(e){e.preventDefault();" +
    "fetch('/api/crew-docs?token='+encodeURIComponent(TOKEN)+'&blank=1')" +
    ".then(function(r){return r.json()}).then(function(d){" +
    "if(d&&d.url)window.open(d.url,'_blank');else err(d&&d.error||'The blank form is not uploaded yet — ask us for it.');})" +
    ".catch(function(){err('Could not open it just now.')});};" +
    // --- tabs
    "Array.prototype.forEach.call(document.querySelectorAll('.tab'),function(t){t.onclick=function(){" +
    "Array.prototype.forEach.call(document.querySelectorAll('.tab'),function(x){x.classList.remove('on')});" +
    "t.classList.add('on');mode=t.getAttribute('data-m');" +
    "document.getElementById('drawnBox').hidden=mode!=='drawn';" +
    "document.getElementById('upBox').hidden=mode!=='upload';};});" +
    // --- signature pad
    "var c=document.getElementById('pad'),ctx=c&&c.getContext('2d'),drawing=false;" +
    "function fit(){if(!c)return;var r=c.getBoundingClientRect(),d=window.devicePixelRatio||1;" +
    "c.width=r.width*d;c.height=r.height*d;ctx.scale(d,d);ctx.lineWidth=2.2;ctx.lineCap='round';" +
    "ctx.lineJoin='round';ctx.strokeStyle='#111';}" +
    "if(c){fit();window.addEventListener('resize',fit);}" +
    "function pos(e){var r=c.getBoundingClientRect();var t=e.touches?e.touches[0]:e;" +
    "return{x:t.clientX-r.left,y:t.clientY-r.top};}" +
    "function down(e){e.preventDefault();drawing=true;drawn=true;var p=pos(e);ctx.beginPath();ctx.moveTo(p.x,p.y);}" +
    "function move(e){if(!drawing)return;e.preventDefault();var p=pos(e);ctx.lineTo(p.x,p.y);ctx.stroke();}" +
    "function up(){drawing=false;}" +
    "if(c){c.addEventListener('pointerdown',down);c.addEventListener('pointermove',move);" +
    "window.addEventListener('pointerup',up);}" +
    "var cl=document.getElementById('clear');" +
    "if(cl)cl.onclick=function(){ctx.clearRect(0,0,c.width,c.height);drawn=false;};" +
    // --- file picker
    "var picked=null;var fi=document.getElementById('file');" +
    "if(fi)fi.onchange=function(){picked=fi.files&&fi.files[0]||null;" +
    "document.getElementById('fname').textContent=picked?picked.name:'';};" +
    // --- submit
    "document.getElementById('go').onclick=function(){var btn=this;" +
    "var who=(document.getElementById('who').value||'').trim();" +
    "if(!who){err('Please type your full name.');return;}" +
    "if(mode==='drawn'&&!drawn){err('Please sign in the box.');return;}" +
    "if(mode==='upload'&&!picked){err('Please choose your signed file.');return;}" +
    "err('');btn.disabled=true;btn.textContent='Sending…';" +
    "(mode==='drawn'?makeSigned(who):Promise.resolve(picked))" +
    ".then(function(file){return put(file);})" +
    ".then(function(info){return fetch('/api/crew-docs?token='+encodeURIComponent(TOKEN),{method:'POST'," +
    "headers:{'Content-Type':'application/json'},body:JSON.stringify({method:mode,path:info.path," +
    "fileName:info.name,fileSize:info.size,signedName:who})});})" +
    ".then(function(r){return r.json();}).then(function(d){" +
    "if(d&&d.ok){document.querySelector('.wrap').innerHTML=" +
    "'<div class=msg><div class=ico>✅</div><h2>That is done</h2>" +
    "<p>Thank you — we have it on file. You can close this page.</p></div>';}" +
    "else{err(d&&d.error||'That did not save.');btn.disabled=false;btn.textContent='Try again';}})" +
    ".catch(function(e){err((e&&e.message)||'Something went wrong.');" +
    "btn.disabled=false;btn.textContent='Try again';});};" +
    // --- stamp the drawn signature into the blank PDF, in the BROWSER.
    //     Same pdf-lib the quote exporter already uses; the server never needs
    //     a PDF library and the finished file is a real signed PDF either way.
    "function load(src){return new Promise(function(ok,no){var s=document.createElement('script');" +
    "s.src=src;s.onload=ok;s.onerror=function(){no(new Error('Could not load the PDF tools.'))};" +
    "document.head.appendChild(s);});}" +
    "function makeSigned(who){" +
    "return fetch('/api/crew-docs?token='+encodeURIComponent(TOKEN)+'&blank=1&raw=1')" +
    ".then(function(r){return r.json();}).then(function(d){" +
    "if(!d||!d.url)throw new Error('The blank document is not uploaded yet — ask us for it.');" +
    "return fetch(d.url).then(function(x){return x.arrayBuffer();});})" +
    ".then(function(bytes){" +
    "return load('https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js')" +
    ".then(function(){return PDFLib.PDFDocument.load(bytes);});})" +
    ".then(function(doc){" +
    "var png=c.toDataURL('image/png');" +
    "return doc.embedPng(png).then(function(img){" +
    "return doc.embedFont(PDFLib.StandardFonts.Helvetica).then(function(font){" +
    "var pg=doc.getPages()[doc.getPageCount()-1];" +
    "var w=200,h=w*(img.height/img.width);" +
    "if(h>70){h=70;w=h*(img.width/img.height);}" +
    "pg.drawImage(img,{x:48,y:96,width:w,height:h});" +
    "pg.drawLine({start:{x:44,y:90},end:{x:44+Math.max(w,200),y:90},thickness:.7," +
    "color:PDFLib.rgb(.5,.5,.5)});" +
    "var when=new Date().toLocaleString();" +
    "pg.drawText(who+'  ·  signed electronically  ·  '+when,{x:48,y:76,size:8,font:font," +
    "color:PDFLib.rgb(.35,.35,.35)});" +
    "return doc.save();});});})" +
    ".then(function(out){return new File([out],'signed-'+DOC+'.pdf',{type:'application/pdf'});});}" +
    // --- direct-to-storage upload. The file never goes through a function, so
    //     a 10 MB scan is fine.
    "function put(file){" +
    "return fetch('/api/crew-docs?token='+encodeURIComponent(TOKEN)+'&upload=1',{method:'POST'," +
    "headers:{'Content-Type':'application/json'},body:JSON.stringify({contentType:file.type})})" +
    ".then(function(r){return r.json();}).then(function(d){" +
    "if(!d||!d.url)throw new Error(d&&d.error||'Could not start the upload.');" +
    "return fetch(d.url,{method:'PUT',headers:{'Content-Type':file.type},body:file})" +
    /* The status is worth saying out loud even here. A crew member cannot debug
       it, but they will read it down the phone, and "did not finish (404)" is
       the difference between an afternoon and a minute. */
    ".then(function(u){if(!u.ok)throw new Error('The upload did not finish ('+u.status+'). Tell your production manager.');" +
    "return{path:d.path,name:file.name,size:file.size};});});}"
  );
}
