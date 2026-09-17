// /api/expenses — costs and receipts, per show AND company-wide.
//
//   GET    ?show=<id>                 expenses on a show
//   GET    ?overhead=1&from=&to=      company overhead (no show)
//   GET    ?year=2026                 everything in a year, for the accountant
//   POST   ?show=<id> | ?overhead=1   create one, or many  { rows: [...] }
//   PATCH  ?id=<id>                   edit one
//   DELETE ?id=<id>                   SOFT delete — the receipt survives
//   POST   ?upload=1                  mint a signed upload URL for a receipt
//   GET    ?receipt=<id>              mint a short-lived signed view URL
//
// SETUP: run sql/setup-expenses.sql (renames show_expenses -> expenses, adds
// tax_category + deleted_at, creates the private `receipts` bucket).
//
// TWO PURPOSES, AND THE SECOND ONE SETS THE RULES
//   1. The P&L — these figures feed the per-show actuals and the year roll-up.
//   2. TAX SUBSTANTIATION — the receipt image is the evidence, not a
//      convenience.
//
//   That is why DELETE is soft. Removing a row must never be the act that
//   destroys the record behind it. Nothing in this file issues a hard delete,
//   of a row or of a stored object.
//
// THE PERMISSION TRAP THIS FILE EXISTS TO AVOID
//   Every other cost endpoint derives permission from the show —
//   canManageShow(p, id). An OVERHEAD row has no show. Copying that gate
//   without thinking gives you a check that is called with id = undefined and
//   quietly does nothing. Overhead therefore gates on isAdmin(p) explicitly,
//   and showGate() below refuses to run at all without a show id.
import crypto from "node:crypto";
import { json, readBody, auth, isAdmin, canManageShow, supabaseRest,
         signUpload, signView, UPLOAD_EXT, logActivity } from "./_lib.js";

// Storage credentials now live in _lib.js with the helpers that use them.

/* Validated here rather than by a CHECK constraint, because Tyler's accountant
   will hand him a different list and that must be a deploy, not a migration.
   `meals` is split from per_diem/misc on purpose — business meals carry
   different tax treatment, and a cost buried in "misc" cannot be given it.
   `equipment` is split from `supplies` for the same reason: a console is a
   capital purchase, gaff tape is not. */
export const CATEGORIES = [
  "labor", "sub_rental", "trucking", "per_diem", "travel",
  "meals", "equipment", "supplies", "misc",
];
export const TAX_CATEGORIES = [
  "advertising", "car_and_truck", "insurance", "legal_professional",
  "office", "rent", "repairs", "supplies", "taxes_licenses", "travel",
  "meals", "utilities", "wages", "equipment", "other",
];

const COLS =
  "id,show_id,spent_on,vendor,category,tax_category,description,amount," +
  "receipt_path,billable,source,note,created_at,updated_at";

const LIVE = "deleted_at=is.null";

/* Money in, money stored. Rejects anything that is not a finite number so a
   stray "" or "abc" cannot become 0 and quietly understate a P&L. */
function money(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const str = (v, max) => {
  const s = String(v === null || v === undefined ? "" : v).trim();
  return s ? s.slice(0, max) : null;
};

/* One place that decides what a writable row looks like, so POST and PATCH
   cannot drift apart. Returns { row } or { error }. */
function cleanRow(b, { showId, overhead }) {
  const amount = money(b.amount);
  if (amount === null) return { error: "An amount is required, as a number." };
  if (amount < 0) return { error: "Amount cannot be negative." };

  if (b.spent_on && !isDate(b.spent_on)) return { error: "Date must be YYYY-MM-DD." };

  const category = str(b.category, 40);
  if (category && CATEGORIES.indexOf(category) === -1) {
    return { error: "Unknown category: " + category };
  }
  const taxCategory = str(b.tax_category, 40);
  if (taxCategory && TAX_CATEGORIES.indexOf(taxCategory) === -1) {
    return { error: "Unknown tax category: " + taxCategory };
  }

  const note = str(b.note, 2000);
  /* A business meal needs who and why recorded. Refusing the save is the only
     point at which that gets written down — asked for later, it is guesswork,
     and a meal with no purpose on it is a deduction that cannot be defended. */
  if (category === "meals" && !note) {
    return { error: "Meals need a note saying who was there and why." };
  }

  return {
    row: {
      show_id: overhead ? null : showId,
      spent_on: b.spent_on || null,
      vendor: str(b.vendor, 200),
      category,
      tax_category: taxCategory,
      description: str(b.description, 500),
      amount,
      billable: b.billable === true,
      note,
      source: str(b.source, 20) || "manual",
      receipt_path: str(b.receipt_path, 500),
    },
  };
}


/* Moved to _lib.js when crew documents became the second consumer — and then
   widened HERE rather than there, because a receipt and a signed NDA are not
   the same problem.

   An iPhone photographs in HEIC. Safari usually converts to JPEG on upload,
   but not always, and when it does not the old list refused the file with
   "Receipts must be a JPEG, PNG or PDF" — which is true, unhelpful, and
   impossible for Tyler to act on while standing at a fuel pump. WebP turns up
   from Android and from anything that has been through a web app.

   Not added to UPLOAD_EXT itself: crew-docs.js signs NDAs and W-9s off that
   list, and a HEIC W-9 is a different conversation. */
const EXT_OK = {
  ...UPLOAD_EXT,
  "image/jpg": "jpg",            // non-standard, and some browsers send it
  "image/heic": "heic",
  "image/heif": "heif",
  "image/webp": "webp",
};

/* A show row is permitted by the show. An overhead row has no show to ask, so
   it is admin-only — stated once, here, rather than inferred at four call
   sites. */
function showGate(p, id) {
  if (!id) return false;              // never call canManageShow with nothing
  return canManageShow(p, id);
}

export default async function handler(req, res) {
  const p = auth(req);
  if (!p) return json(res, 401, { error: "Not signed in" });

  const q = req.query || {};
  const showId = q.show ? String(q.show) : null;
  const overhead = q.overhead === "1" || q.overhead === "true";

  try {
    // ---- mint an upload URL -----------------------------------------------
    if (req.method === "POST" && q.upload) {
      const b = await readBody(req);
      const ext = EXT_OK[String(b && b.contentType || "")];
      if (!ext) return json(res, 400, { error: "A receipt has to be a photo or a PDF." });

      const target = overhead ? null : showId;
      if (overhead ? !isAdmin(p) : !showGate(p, target)) {
        return json(res, 403, { error: "Not allowed" });
      }
      /* Years are split apart in the overhead path because that is how these
         come back out — an accountant asks for a year, not for everything. */
      const folder = target
        ? "s/" + target
        : "overhead/" + new Date().getUTCFullYear();
      const name = folder + "/" + crypto.randomUUID() + "." + ext;
      return json(res, 200, await signUpload("receipts", name));
    }

    // ---- mint a view URL --------------------------------------------------
    if (req.method === "GET" && q.receipt) {
      const rows = await supabaseRest(
        "GET",
        "/expenses?id=eq." + encodeURIComponent(String(q.receipt)) +
          "&select=show_id,receipt_path&limit=1", null);
      const row = rows && rows[0];
      if (!row || !row.receipt_path) return json(res, 404, { error: "No receipt on that expense" });
      if (row.show_id ? !showGate(p, row.show_id) : !isAdmin(p)) {
        return json(res, 403, { error: "Not allowed" });
      }
      /* Short-lived and signed. The bucket is private; nothing is ever served
         from a public URL, and the service key never leaves the server. */
      return json(res, 200, { url: await signView("receipts", row.receipt_path) });
    }

    // ---- read: every show receipt, thin, for the roll-up ------------------
    /* The company-wide P&L needs each show's receipts folded into its actual
       cost. It cannot use ?show= — that is one request per show — and it
       cannot use a pre-summed total per show either, because a receipt can be
       excluded from the P&L by hand (it is already counted in a typed row)
       and the exclusion list lives in that show's costing, not here.
       So: one row per receipt, four columns, and the caller does the maths
       with the same function the show's own P&L uses. */
    if (req.method === "GET" && (q.totals === "1" || q.totals === "true")) {
      if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
      const parts = ["select=id,show_id,amount,category", LIVE, "show_id=not.is.null"];
      if (q.from && isDate(q.from)) parts.push("spent_on=gte." + q.from);
      if (q.to && isDate(q.to)) parts.push("spent_on=lte." + q.to);
      return json(res, 200, { rows: await supabaseRest("GET", "/expenses?" + parts.join("&"), null) || [] });
    }

    // ---- read -------------------------------------------------------------
    if (req.method === "GET") {
      if (q.year || overhead) {
        if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
        const parts = ["select=" + COLS, LIVE, "order=spent_on.desc"];
        if (overhead) parts.push("show_id=is.null");
        if (q.year) {
          const y = parseInt(q.year, 10);
          if (!y || y < 2000 || y > 2100) return json(res, 400, { error: "Bad year" });
          parts.push("spent_on=gte." + y + "-01-01", "spent_on=lte." + y + "-12-31");
        } else {
          if (q.from && isDate(q.from)) parts.push("spent_on=gte." + q.from);
          if (q.to && isDate(q.to)) parts.push("spent_on=lte." + q.to);
        }
        return json(res, 200, { rows: await supabaseRest("GET", "/expenses?" + parts.join("&"), null) || [] });
      }

      if (!showGate(p, showId)) return json(res, 403, { error: "Not allowed" });
      const rows = await supabaseRest(
        "GET",
        "/expenses?show_id=eq." + encodeURIComponent(showId) +
          "&" + LIVE + "&select=" + COLS + "&order=spent_on.desc", null);
      return json(res, 200, { rows: rows || [] });
    }

    // ---- create (one, or a batch) -----------------------------------------
    if (req.method === "POST") {
      if (overhead ? !isAdmin(p) : !showGate(p, showId)) {
        return json(res, 403, { error: "Not allowed" });
      }
      const b = await readBody(req);
      const incoming = Array.isArray(b && b.rows) ? b.rows : [b];
      if (!incoming.length) return json(res, 400, { error: "Nothing to save" });
      if (incoming.length > 200) return json(res, 400, { error: "Too many rows at once (max 200)" });

      const out = [];
      for (let i = 0; i < incoming.length; i++) {
        const { row, error } = cleanRow(incoming[i] || {}, { showId, overhead });
        /* All or nothing. A bulk paste that half-saves leaves Tyler with no
           way to tell which lines landed, and the overhead column silently
           wrong is worse than a refused save. */
        if (error) return json(res, 400, { error: "Row " + (i + 1) + ": " + error });
        out.push(row);
      }
      const saved = await supabaseRest("POST", "/expenses", out, "return=representation");

      /* COUNTS AND CATEGORIES, NEVER AMOUNTS.
         This is the log's sharpest edge. An expense IS a number, so the
         tempting sentence is "Expense added: $412.50 for freight" — and that
         number would then live forever in a table nothing prunes, on a feed
         that will eventually be shown to somebody who should not see what
         Touchstone pays for things. The count and the category say that money
         moved and what kind, which is what a feed is for. The amount is one
         click away on the screen that is allowed to show it. */
      const n = (saved || []).length || out.length;
      const cats = [...new Set(out.map((r) => String(r.category || "").trim()).filter(Boolean))];
      await logActivity(p, "expense.added",
        (n === 1 ? "Expense added" : n + " expenses added") +
        (overhead ? " to overhead" : "") +
        (cats.length && cats.length <= 3 ? " (" + cats.join(", ") + ")" : ""),
        { showId: overhead ? null : showId,
          actorName: (b && String(b.actorName || "").trim()) || "",
          meta: { count: n } });

      return json(res, 200, { rows: saved || [] });
    }

    // ---- edit -------------------------------------------------------------
    if (req.method === "PATCH") {
      const id = q.id ? String(q.id) : null;
      if (!id) return json(res, 400, { error: "id required" });
      const rows = await supabaseRest(
        "GET", "/expenses?id=eq." + encodeURIComponent(id) + "&select=show_id&limit=1", null);
      const found = rows && rows[0];
      if (!found) return json(res, 404, { error: "Not found" });
      if (found.show_id ? !showGate(p, found.show_id) : !isAdmin(p)) {
        return json(res, 403, { error: "Not allowed" });
      }
      const b = await readBody(req);
      const { row, error } = cleanRow(b || {}, {
        showId: found.show_id, overhead: !found.show_id,
      });
      if (error) return json(res, 400, { error });
      row.updated_at = new Date().toISOString();
      const saved = await supabaseRest(
        "PATCH", "/expenses?id=eq." + encodeURIComponent(id), row, "return=representation");
      return json(res, 200, { row: (saved && saved[0]) || null });
    }

    // ---- soft delete ------------------------------------------------------
    if (req.method === "DELETE") {
      const id = q.id ? String(q.id) : null;
      if (!id) return json(res, 400, { error: "id required" });
      const rows = await supabaseRest(
        "GET", "/expenses?id=eq." + encodeURIComponent(id) + "&select=show_id&limit=1", null);
      const found = rows && rows[0];
      if (!found) return json(res, 404, { error: "Not found" });
      if (found.show_id ? !showGate(p, found.show_id) : !isAdmin(p)) {
        return json(res, 403, { error: "Not allowed" });
      }
      /* Soft. The row leaves every list, the receipt stays in the bucket, and
         the record can be recovered. Receipts are tax evidence; tidying a
         screen must not be able to destroy them. */
      await supabaseRest("PATCH", "/expenses?id=eq." + encodeURIComponent(id),
        { deleted_at: new Date().toISOString() });
      return json(res, 200, { ok: true, soft: true });
    }

    return json(res, 405, { error: "Method not allowed" });
  } catch (e) {
    return json(res, e.status === 403 ? 403 : 500, { error: e.message || "Failed" });
  }
}
