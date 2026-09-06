// /api/billing — invoice milestones, approval, delivery and payments.
// TCG admin only, on every route, without exception.
//
// GET                          every invoice, list columns only
// GET  ?id=                    one invoice in full, with payments and history
// GET  ?eventId=               one show's invoices, plus its adjustments
// POST ?generate=1 {quoteId}   create/refresh milestones from an accepted quote
// PATCH ?id=                   save QuickBooks details and actual values
// PATCH ?id=&status=<s>        one workflow transition, rules enforced here
// POST ?id=&payment=1          record a payment
// DELETE ?id=&paymentId=       remove one
// POST ?id=&void=1 {reason}    void, keeping the record
// GET/POST/DELETE ?adjustments=1   phase 2 screen, endpoint built now
//
// SETUP: run setup-billing.sql first. No new env vars.
//
// The rule this file exists to enforce: what the quote scheduled and what the
// invoice actually said are different columns, and the second never overwrites
// the first. Everything else here is bookkeeping around that.
import { json, readBody, auth, isAdmin, supabaseRest, supabaseProfile } from "./_lib.js";

// Overdue is a question about a calendar day, and the calendar day that matters
// is the one you are standing in. A UTC server between 5pm and midnight Pacific
// is already on tomorrow's date, so plain toISOString() would flag invoices
// overdue up to seven hours early — every single evening.
const BUSINESS_TZ = "America/Los_Angeles";
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS_TZ });

const STATUSES = [
  "scheduled",        // exists, not yet within the preparation window
  "ready_to_create",  // create it in QuickBooks now
  "drafted_in_qb",    // QB details saved, not yet submitted
  "waiting_approval",
  "needs_changes",
  "approved",
  "sent",
  "voided",
];

// How far ahead a milestone starts asking to be created.
const PREP_WINDOW_DAYS = 14;

const LIST_COLS =
  "id,event_id,quote_id,quote_version,milestone_key,sort_order,milestone_type,label,pct," +
  "scheduled_amount,planned_send_date,scheduled_due_date,quote_total_at_generation," +
  "qb_number,qb_link,actual_amount,actual_invoice_date,actual_due_date,status," +
  "submitted_at,approved_at,approved_by,sent_at,recipient,payments,variance_amount," +
  "reconciliation_status,void_at,void_reason,disputed,updated_at";

function num(v) {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : 0;
}
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* ---------------------------------------------------------------------------
   Milestone maths.

   This mirrors qtDepositRows() and qtDueDate() in src/App.jsx. Keep the two in
   step — same reason api/quotes.js keeps its own copy of lineTotal(). The
   browser draws the schedule, the server is what writes it down, and the server
   does not get to trust numbers a browser sent it.

   The last row takes the remainder rather than its own percentage, so the
   milestones always sum to the quote exactly. 75/25 of $84,085.00 gives
   $63,063.75 and $21,021.25; thirds of $10,000.01 give 3333.00, 3333.00,
   3334.01. There is no rounding drift to reconcile later because none is
   allowed to happen.
--------------------------------------------------------------------------- */
function depositAmounts(deposits, grand) {
  const all = Array.isArray(deposits) ? deposits : [];
  const amounts = all.map(() => null);
  const lastIdx = all.length - 1;
  for (let i = 0; i < all.length; i++) {
    if (i === lastIdx) continue;
    amounts[i] = money(grand * (num(all[i].pct) / 100));
  }
  if (lastIdx >= 0) {
    const before = amounts.slice(0, lastIdx).reduce((t, x) => t + (x || 0), 0);
    amounts[lastIdx] = money(grand - before);
  }
  return amounts;
}

function shiftDate(iso, days) {
  if (!iso) return null;
  try {
    const d = new Date(iso + "T12:00:00Z");
    if (isNaN(d.getTime())) return null;
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  } catch (e) { return null; }
}

// start = load-in, end = strike. A relative milestone on a show with no dates
// yet simply has no date, which is honest: it is not due until the show is real.
function dueDateFor(d, startDate, endDate) {
  if (!d) return null;
  const t = d.trigger || "date";
  if (t === "signature") return null;
  if (t === "before_loadin") return shiftDate(startDate, -Math.abs(num(d.offset)));
  if (t === "after_strike") return shiftDate(endDate, Math.abs(num(d.offset)));
  return d.dueDate || null;
}

function milestoneType(i, n) {
  if (n <= 1) return "full";
  if (i === 0) return "deposit";
  if (i === n - 1) return "final";
  return "interim";
}

/* ---------------------------------------------------------------------------
   Everything derived. None of this is stored, because all of it goes stale.
--------------------------------------------------------------------------- */
function derive(r) {
  const payments = Array.isArray(r.payments) ? r.payments : [];
  const paid = money(payments.reduce((t, p) => t + num(p && p.amount), 0));
  const voided = !!r.void_at;

  // Before a real invoice exists, the scheduled figure is the best statement of
  // what is owed. After one exists, the actual figure is the only one that is.
  const billed = r.actual_amount == null ? money(r.scheduled_amount) : money(r.actual_amount);
  const balance = voided ? 0 : money(billed - paid);
  const due = r.actual_due_date || r.scheduled_due_date || null;
  const t = today();
  const overdue = !voided && balance > 0.004 && !!due && !!r.sent_at && due < t;

  let paymentStatus;
  if (voided) paymentStatus = "n/a";
  else if (billed > 0 && balance <= 0.004) paymentStatus = "paid";
  else if (paid > 0.004) paymentStatus = "partial";
  else if (!r.sent_at) paymentStatus = "not_due";
  else paymentStatus = "unpaid";

  // Ready to create is a fact about the calendar, not a state anybody sets.
  let status = r.status || "scheduled";
  if (status === "scheduled" && due) {
    const opens = shiftDate(due, -PREP_WINDOW_DAYS);
    if (opens && opens <= t) status = "ready_to_create";
  }

  return {
    paidTotal: paid,
    billedAmount: billed,
    balance,
    paymentStatus,
    overdue,
    daysOverdue: overdue ? Math.max(0, Math.round((Date.parse(t) - Date.parse(due)) / 86400000)) : 0,
    effectiveStatus: status,
    effectiveDueDate: due,
  };
}

function shape(r, full) {
  const d = derive(r);
  const out = {
    id: r.id,
    eventId: r.event_id || null,
    quoteId: r.quote_id || null,
    quoteFamilyId: r.quote_family_id || null,
    quoteVersion: r.quote_version || null,
    milestoneKey: r.milestone_key || null,
    sortOrder: r.sort_order || 0,

    milestoneType: r.milestone_type || "deposit",
    label: r.label || "",
    pct: Number(r.pct || 0),
    scheduledAmount: Number(r.scheduled_amount || 0),
    plannedSendDate: r.planned_send_date || "",
    scheduledDueDate: r.scheduled_due_date || "",
    quoteTotalAtGeneration: Number(r.quote_total_at_generation || 0),

    qbNumber: r.qb_number || "",
    qbLink: r.qb_link || "",
    actualAmount: r.actual_amount == null ? null : Number(r.actual_amount),
    actualInvoiceDate: r.actual_invoice_date || "",
    actualDueDate: r.actual_due_date || "",

    status: r.status || "scheduled",
    submittedAt: r.submitted_at || null,
    approvedAt: r.approved_at || null,
    approvedBy: r.approved_by || "",
    sentAt: r.sent_at || null,
    recipient: r.recipient || "",

    payments: Array.isArray(r.payments) ? r.payments : [],
    varianceAmount: r.variance_amount == null ? null : Number(r.variance_amount),
    reconciliationStatus: r.reconciliation_status || "matches",
    voidAt: r.void_at || null,
    voidReason: r.void_reason || "",
    disputed: !!r.disputed,
    updatedAt: r.updated_at || null,
    ...d,
  };
  if (full) {
    out.qbId = r.qb_id || "";
    out.qbPdfUrl = r.qb_pdf_url || "";
    out.terms = r.terms || "";
    out.customerNote = r.customer_note || "";
    out.revisionNote = r.revision_note || "";
    out.approvalWaived = !!r.approval_waived;
    out.sentBy = r.sent_by || "";
    out.varianceReason = r.variance_reason || "";
    out.history = Array.isArray(r.history) ? r.history : [];
    out.createdAt = r.created_at || null;
    out.createdBy = r.created_by || "";
  }
  return out;
}

// Who did it, in words. The token only carries an auth id, and "approved by
// 4f7c…" is not an audit trail anybody can use.
async function actorName(p) {
  if (!p) return "unknown";
  if (!p.sub) return p.scope === "admin" ? "admin (password)" : "unknown";
  try {
    const prof = await supabaseProfile(p.sub);
    return (prof && (prof.name || prof.email)) || p.sub;
  } catch (e) { return p.sub; }
}

function withHistory(row, entry) {
  const h = Array.isArray(row.history) ? row.history.slice() : [];
  h.push({ at: new Date().toISOString(), ...entry });
  return h.slice(-400); // a very long-lived invoice should not grow without limit
}

async function getRow(id) {
  const rows = await supabaseRest("GET", "/billing_invoices?id=eq." + encodeURIComponent(id) + "&select=*", null);
  if (!rows || !rows[0]) { const e = new Error("Invoice not found"); e.status = 404; throw e; }
  return rows[0];
}

/* ---------------------------------------------------------------------------
   Transition rules.

   These live on the server because a disabled button is a courtesy and this is
   money. Returns an error sentence, or null to allow.
--------------------------------------------------------------------------- */
function transitionError(row, next) {
  if (STATUSES.indexOf(next) < 0) return "Unknown status: " + next;
  if (row.void_at && next !== "voided") return "This invoice is voided. Voided invoices cannot re-enter the workflow.";
  if (next === "voided") return "Use the void action so a reason is recorded.";

  if (next === "approved") {
    if (!String(row.qb_number || "").trim()) return "Add the QuickBooks invoice number before approving.";
    if (row.actual_amount == null) return "Add the invoice amount before approving.";
  }
  if (next === "sent") {
    if (!row.approved_at && !row.approval_waived) {
      return "This invoice has not been approved. Approve it, or waive approval deliberately, before marking it sent.";
    }
    if (!String(row.qb_number || "").trim()) return "Add the QuickBooks invoice number before marking it sent.";
  }
  return null;
}

// Only the fields a caller may set. Anything else in the body is ignored.
function writable(b) {
  const out = {};
  const str = (k, col) => { if (b[k] !== undefined) out[col] = String(b[k] == null ? "" : b[k]); };
  const date = (k, col) => { if (b[k] !== undefined) out[col] = b[k] || null; };

  str("qbNumber", "qb_number");
  str("qbId", "qb_id");
  str("qbLink", "qb_link");
  str("qbPdfUrl", "qb_pdf_url");
  str("terms", "terms");
  str("customerNote", "customer_note");
  str("recipient", "recipient");
  str("revisionNote", "revision_note");
  str("varianceReason", "variance_reason");
  str("label", "label");

  date("actualInvoiceDate", "actual_invoice_date");
  date("actualDueDate", "actual_due_date");
  date("plannedSendDate", "planned_send_date");
  date("scheduledDueDate", "scheduled_due_date");

  if (b.actualAmount !== undefined) out.actual_amount = b.actualAmount === "" || b.actualAmount == null ? null : money(b.actualAmount);
  if (b.disputed !== undefined) out.disputed = !!b.disputed;
  if (b.approvalWaived !== undefined) out.approval_waived = !!b.approvalWaived;
  if (b.reconciliationStatus !== undefined) {
    const ok = ["matches", "review", "adjusted", "reconciled"];
    if (ok.indexOf(b.reconciliationStatus) >= 0) out.reconciliation_status = b.reconciliationStatus;
  }
  return out;
}

// The variance the brief asks to be visible: scheduled vs what was really billed.
function varianceOf(row) {
  if (row.actual_amount == null) return null;
  return money(num(row.actual_amount) - num(row.scheduled_amount));
}

export default async function handler(req, res) {
  const p = auth(req);
  if (!p) return json(res, 401, { error: "Not signed in" });
  if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });

  const q = req.query || {};

  try {
    /* ---- billable adjustments (table now, screen in phase 2) ---- */
    if (q.adjustments) {
      if (req.method === "GET") {
        const filter = q.eventId ? "&event_id=eq." + encodeURIComponent(q.eventId) : "";
        const rows = await supabaseRest("GET", "/billing_adjustments?select=*" + filter + "&order=created_at.asc", null);
        return json(res, 200, (rows || []).map((r) => ({
          id: r.id, eventId: r.event_id, quoteId: r.quote_id, description: r.description || "",
          amount: Number(r.amount || 0), clientStatus: r.client_status || "proposed",
          applyTo: r.apply_to || "final", approvedAt: r.approved_at || null, note: r.note || "",
        })));
      }
      if (req.method === "POST") {
        const b = await readBody(req);
        const who = await actorName(p);
        const row = {
          event_id: b.eventId || null,
          quote_id: b.quoteId || null,
          description: String(b.description || "").trim(),
          amount: money(b.amount),
          client_status: ["proposed", "sent", "approved", "declined"].indexOf(b.clientStatus) >= 0 ? b.clientStatus : "proposed",
          apply_to: String(b.applyTo || "final"),
          note: String(b.note || ""),
          created_by: who,
        };
        if (b.id) {
          await supabaseRest("PATCH", "/billing_adjustments?id=eq." + encodeURIComponent(b.id), row);
          return json(res, 200, { ok: true, id: b.id });
        }
        const made = await supabaseRest("POST", "/billing_adjustments", row, "return=representation");
        return json(res, 200, { ok: true, id: (made && made[0] && made[0].id) || null });
      }
      if (req.method === "DELETE") {
        if (!q.id) return json(res, 400, { error: "id required" });
        await supabaseRest("DELETE", "/billing_adjustments?id=eq." + encodeURIComponent(q.id), null);
        return json(res, 200, { ok: true });
      }
      return json(res, 405, { error: "Method not allowed" });
    }

    /* ---- generate milestones from an accepted quote -------------------------
       Idempotent, and deliberately timid: it will create a missing row and
       refresh an untouched one, and it will not lay a finger on anything that
       has a QuickBooks number, a send date or a payment against it. That is the
       brief's "sent/paid invoices are never silently changed by a quote
       revision", enforced where the write happens rather than trusted to a UI.
    ------------------------------------------------------------------------ */
    if (q.generate) {
      if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
      const b = await readBody(req);
      const quoteId = b.quoteId;
      if (!quoteId) return json(res, 400, { error: "quoteId required" });

      const qrows = await supabaseRest("GET", "/quotes?id=eq." + encodeURIComponent(quoteId) + "&select=*", null);
      const quote = qrows && qrows[0];
      if (!quote) return json(res, 404, { error: "Quote not found" });
      if (quote.status !== "won") {
        return json(res, 400, { error: "Only an accepted quote generates a billing schedule. This one is " + (quote.status || "draft") + "." });
      }

      const data = (quote.data && typeof quote.data === "object") ? quote.data : {};
      const deposits = Array.isArray(data.deposits) ? data.deposits : [];
      if (!deposits.length) {
        return json(res, 400, { error: "This quote has no payment schedule, so there is nothing to bill. Add one on the quote first." });
      }

      const grand = money(quote.total);
      const amounts = depositAmounts(deposits, grand);

      // The invariant that makes the whole module trustworthy. If it ever fails,
      // refuse rather than write a schedule that disagrees with the quote.
      const sum = money(amounts.reduce((t, x) => t + (x || 0), 0));
      if (Math.abs(sum - grand) > 0.004) {
        return json(res, 500, { error: "Milestones summed to " + sum + " but the quote total is " + grand + ". Nothing was written." });
      }

      const existing = await supabaseRest(
        "GET",
        "/billing_invoices?quote_id=eq." + encodeURIComponent(quoteId) + "&select=*",
        null
      );
      const byKey = {};
      (existing || []).forEach((r) => { if (r.milestone_key) byKey[r.milestone_key] = r; });

      const who = await actorName(p);
      const nowIso = new Date().toISOString();
      const created = [];
      const updated = [];
      const skipped = [];

      for (let i = 0; i < deposits.length; i++) {
        const d = deposits[i] || {};
        const key = String(d.id || ("row" + i));
        const dueIso = dueDateFor(d, quote.start_date, quote.end_date);
        const base = {
          event_id: quote.event_id || null,
          quote_id: quote.id,
          quote_family_id: quote.family_id || null,
          quote_version: quote.version || null,
          milestone_key: key,
          sort_order: i,
          milestone_type: milestoneType(i, deposits.length),
          label: String(d.label || "").trim() || milestoneType(i, deposits.length),
          pct: num(d.pct),
          scheduled_amount: amounts[i] || 0,
          planned_send_date: dueIso,
          scheduled_due_date: dueIso,
          quote_total_at_generation: grand,
          updated_at: nowIso,
        };

        const prev = byKey[key];
        if (!prev) {
          const payments = [];
          let status = "scheduled";
          // A deposit already ticked paid on the quote arrives as collected, so
          // the schedule matches money you actually have rather than pretending
          // the invoice was never raised.
          if (d.paid) {
            status = "sent";
            payments.push({
              id: "seed-" + key,
              date: d.paidDate || today(),
              amount: money(d.paidAmount != null ? d.paidAmount : amounts[i]),
              method: "",
              reference: "",
              note: "Carried across from the quote's payment schedule",
              recordedBy: who,
              recordedAt: nowIso,
            });
          }
          const row = {
            ...base,
            status,
            payments,
            ...(d.paid ? { sent_at: nowIso, actual_amount: money(d.paidAmount != null ? d.paidAmount : amounts[i]) } : {}),
            created_by: who,
            history: [{ at: nowIso, by: who, action: "generated", note: "From quote v" + (quote.version || "?") }],
          };
          const made = await supabaseRest("POST", "/billing_invoices", row, "return=representation");
          created.push((made && made[0] && made[0].id) || null);
          continue;
        }

        const touched =
          String(prev.qb_number || "").trim() ||
          prev.sent_at ||
          (Array.isArray(prev.payments) && prev.payments.length) ||
          prev.void_at;
        if (touched) { skipped.push(prev.id); continue; }

        await supabaseRest("PATCH", "/billing_invoices?id=eq." + encodeURIComponent(prev.id), {
          ...base,
          history: withHistory(prev, { by: who, action: "regenerated", note: "Refreshed from quote v" + (quote.version || "?") }),
        });
        updated.push(prev.id);
      }

      return json(res, 200, {
        ok: true,
        created: created.length,
        updated: updated.length,
        skipped: skipped.length,
        total: grand,
      });
    }

    /* ---- payments ---------------------------------------------------------- */
    if (q.payment || q.paymentId) {
      if (!q.id) return json(res, 400, { error: "id required" });
      const row = await getRow(q.id);
      const who = await actorName(p);
      const payments = Array.isArray(row.payments) ? row.payments.slice() : [];

      if (req.method === "POST") {
        const b = await readBody(req);
        const amount = money(b.amount);
        if (!amount) return json(res, 400, { error: "A payment needs an amount." });
        const entry = {
          id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          date: b.date || today(),
          amount,
          method: String(b.method || ""),
          reference: String(b.reference || ""),
          note: String(b.note || ""),
          recordedBy: who,
          recordedAt: new Date().toISOString(),
        };
        payments.push(entry);
        await supabaseRest("PATCH", "/billing_invoices?id=eq." + encodeURIComponent(q.id), {
          payments,
          updated_at: new Date().toISOString(),
          history: withHistory(row, { by: who, action: "payment recorded", to: amount, note: entry.date }),
        });
        return json(res, 200, { ok: true, invoice: shape({ ...row, payments }, true) });
      }

      if (req.method === "DELETE") {
        const gone = payments.find((x) => x && x.id === q.paymentId);
        if (!gone) return json(res, 404, { error: "Payment not found" });
        const next = payments.filter((x) => x && x.id !== q.paymentId);
        await supabaseRest("PATCH", "/billing_invoices?id=eq." + encodeURIComponent(q.id), {
          payments: next,
          updated_at: new Date().toISOString(),
          history: withHistory(row, { by: who, action: "payment removed", from: gone.amount, note: gone.date || "" }),
        });
        return json(res, 200, { ok: true, invoice: shape({ ...row, payments: next }, true) });
      }
      return json(res, 405, { error: "Method not allowed" });
    }

    /* ---- void -------------------------------------------------------------
       Never a delete. A voided invoice leaves the totals and keeps its record,
       because "why is there a gap in the invoice numbers" is a question you get
       asked a year later by an accountant.
    ---------------------------------------------------------------------- */
    if (q.void) {
      if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
      if (!q.id) return json(res, 400, { error: "id required" });
      const b = await readBody(req);
      const reason = String(b.reason || "").trim();
      if (!reason) return json(res, 400, { error: "Voiding needs a reason. It is the only thing that explains the gap later." });
      const row = await getRow(q.id);
      if (row.void_at) return json(res, 400, { error: "Already voided." });
      const who = await actorName(p);
      await supabaseRest("PATCH", "/billing_invoices?id=eq." + encodeURIComponent(q.id), {
        status: "voided",
        void_at: new Date().toISOString(),
        void_reason: reason,
        updated_at: new Date().toISOString(),
        history: withHistory(row, { by: who, action: "voided", note: reason }),
      });
      return json(res, 200, { ok: true });
    }

    /* ---- reads ------------------------------------------------------------- */
    if (req.method === "GET") {
      if (q.id) {
        const row = await getRow(q.id);
        return json(res, 200, { invoice: shape(row, true) });
      }
      if (q.eventId) {
        const rows = await supabaseRest(
          "GET",
          "/billing_invoices?event_id=eq." + encodeURIComponent(q.eventId) + "&select=*&order=sort_order.asc",
          null
        );
        const adj = await supabaseRest(
          "GET",
          "/billing_adjustments?event_id=eq." + encodeURIComponent(q.eventId) + "&select=*&order=created_at.asc",
          null
        );
        return json(res, 200, {
          invoices: (rows || []).map((r) => shape(r, true)),
          adjustments: (adj || []).map((r) => ({
            id: r.id, description: r.description || "", amount: Number(r.amount || 0),
            clientStatus: r.client_status || "proposed", applyTo: r.apply_to || "final",
          })),
        });
      }
      const rows = await supabaseRest(
        "GET",
        "/billing_invoices?select=" + LIST_COLS + "&order=scheduled_due_date.asc.nullslast",
        null
      );
      return json(res, 200, (rows || []).map((r) => shape(r, false)));
    }

    /* ---- write ------------------------------------------------------------- */
    if (req.method === "PATCH") {
      if (!q.id) return json(res, 400, { error: "id required" });
      const row = await getRow(q.id);
      const who = await actorName(p);
      const nowIso = new Date().toISOString();

      // A status move is its own operation, with its own rules.
      if (q.status) {
        const next = String(q.status);
        const bad = transitionError(row, next);
        if (bad) return json(res, 400, { error: bad });

        const patch = { status: next, updated_at: nowIso };
        if (next === "waiting_approval") patch.submitted_at = nowIso;
        if (next === "approved") { patch.approved_at = nowIso; patch.approved_by = who; }
        if (next === "needs_changes") { patch.approved_at = null; patch.approved_by = ""; }
        if (next === "sent") { patch.sent_at = nowIso; patch.sent_by = who; }

        const note = next === "sent" && !row.approved_at && row.approval_waived ? "approval waived" : "";
        patch.history = withHistory(row, { by: who, action: "status", from: row.status, to: next, note });
        await supabaseRest("PATCH", "/billing_invoices?id=eq." + encodeURIComponent(q.id), patch);
        return json(res, 200, { ok: true, invoice: shape({ ...row, ...patch }, true) });
      }

      const b = await readBody(req);
      const patch = writable(b);
      if (!Object.keys(patch).length) return json(res, 400, { error: "Nothing to save" });

      const merged = { ...row, ...patch };
      const v = varianceOf(merged);
      patch.variance_amount = v;
      // A figure that no longer matches the schedule wants a human to look at
      // it. It never blocks the save — the invoice is what it is.
      if (v != null && Math.abs(v) > 0.004 && merged.reconciliation_status === "matches") {
        patch.reconciliation_status = "review";
      }
      // Saving QB details for the first time moves it off the schedule.
      if (String(patch.qb_number || "").trim() && (row.status === "scheduled" || row.status === "ready_to_create")) {
        patch.status = "drafted_in_qb";
      }
      patch.updated_at = nowIso;
      patch.history = withHistory(row, {
        by: who,
        action: "edited",
        note: Object.keys(writable(b)).join(", "),
      });

      await supabaseRest("PATCH", "/billing_invoices?id=eq." + encodeURIComponent(q.id), patch);
      return json(res, 200, { ok: true, invoice: shape({ ...row, ...patch }, true) });
    }

    if (req.method === "DELETE") {
      if (!q.id) return json(res, 400, { error: "id required" });
      const row = await getRow(q.id);
      // Deleting is only ever for a schedule nobody has acted on. Anything real
      // gets voided, which keeps the record.
      const touched =
        String(row.qb_number || "").trim() ||
        row.sent_at ||
        (Array.isArray(row.payments) && row.payments.length);
      if (touched) {
        return json(res, 400, { error: "This invoice has been raised or paid. Void it instead so the record survives." });
      }
      await supabaseRest("DELETE", "/billing_invoices?id=eq." + encodeURIComponent(q.id), null);
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: "Method not allowed" });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || "Server error" });
  }
}
