// The production pipeline: the nine stages, and what the app can work out for
// itself about which of them are done.
//
// WHY THIS IS ITS OWN FILE
//   Two screens need this now — the Pipeline board, which has always had it,
//   and the Today dashboard, which shows how ready each upcoming show is. The
//   dashboard cannot afford to fetch every show's full record to work it out
//   (that is one request per show on the landing page), so the server does it.
//
//   Which means the maths runs in two places. There is exactly one acceptable
//   way to do that: ONE definition, imported by both. A second copy in api/
//   that "matches" the one in App.jsx is how a show reads 78% ready on one
//   screen and 66% on another, and nobody can say which is right.
//
//   Same reasoning as pnlReceiptTotal and qtDepositRows.
//
// NOTE FOR THE FRONT END: src/App.jsx imports this file directly. It is plain
// ESM with no dependencies and no Node built-ins, deliberately, so that both
// Vite and the serverless runtime can load it unchanged.

export const PIPE_MILESTONES = [
  ["datesHeld", "Dates Held"],
  ["siteVisit", "Site Visit"],
  ["prelimQuote", "Prelim Quote"],
  ["quoteAccepted", "Quote Accepted"],
  ["crewBooked", "Crew Booked"],
  ["gearReserved", "Gear Reserved"],
  ["logistics", "Logistics"],
  ["show", "Show"],
  ["finalBilling", "Final Billing"],
];

export const PIPE_TOTAL = PIPE_MILESTONES.length;

/* What the app can infer, with the REASON for each, because a tick nobody can
   explain is a tick nobody trusts.
 *
 * `today` is passed in rather than read from the clock: the front end works in
 * the business timezone via todayLocal(), the server has its own idea of now,
 * and a function that asks the clock itself would quietly disagree across the
 * date boundary every evening. */
export function pipeDerive(row, quote, today) {
  const d = (row && row.data) || {};
  const out = {};
  const set = (k, why) => { out[k] = why; };

  if (row && row.start && row.end) set("datesHeld", "Dates are on the show");

  const crew = (d.crew || []).filter((c) => c && String(c.name || "").trim());
  if (crew.length) set("crewBooked", crew.length + " named on the crew list");

  const pull = d.pull || {};
  const gear = ((pull.cases || []).reduce((n, c) => n + ((c.items || []).length), 0)) + ((pull.loose || []).length);
  if (gear) set("gearReserved", gear + " items on the pull list");

  const it = d.itinerary || {};
  const legs = ((it.stays || []).length) + ((it.flights || []).length);
  if (String(it.hotelName || "").trim() || legs) {
    set("logistics", String(it.hotelName || "").trim() ? "Hotel on the itinerary" : legs + " travel legs booked");
  }

  if (row && row.end && today && row.end < today) set("show", "End date has passed");

  // The rest need a quote linked to this show. Shows that predate the quoting
  // system have no link until you attach one from the quote screen.
  if (quote) {
    if (quote.sentAt || quote.status !== "draft") set("prelimQuote", "Quote v" + quote.version + " sent");
    if (quote.status === "won") set("quoteAccepted", "Quote v" + quote.version + " marked won");
    const deps = (quote.data && Array.isArray(quote.data.deposits)) ? quote.data.deposits : [];
    if (quote.status === "won" && deps.length && deps.every((x) => x && x.paid)) {
      set("finalBilling", "Every payment ticked paid");
    }
  }
  return out;
}

/* A stage is done if somebody TICKED it or the app can infer it. Manual wins
   nothing here — both count — because a tick is a statement of fact and so is
   a crew list with eleven people on it. */
export function pipeDone(row, quote, today) {
  const derived = pipeDerive(row, quote, today);
  const manual = (row && row.pipe && row.pipe.milestones) || (row && row.milestones) || {};
  const out = {};
  for (const [k] of PIPE_MILESTONES) {
    out[k] = !!(manual[k] && manual[k].done) || !!derived[k];
  }
  return out;
}

/* How far along, as a fraction. This is the number behind "78% ready", and it
   is deliberately a plain count of ticked stages rather than a weighting:
   a weighting would need maintaining and would be argued with. */
export function pipeReady(row, quote, today) {
  const done = pipeDone(row, quote, today);
  const n = PIPE_MILESTONES.reduce((s, [k]) => s + (done[k] ? 1 : 0), 0);
  return { done: n, total: PIPE_TOTAL, pct: Math.round((n / PIPE_TOTAL) * 100) };
}

/* The stage a show is CURRENTLY on: the first one not done. Everything before
   it reads as complete, it reads as in progress, everything after is pending.
   A show with every stage done has no current stage, which is the honest
   answer rather than pointing at the last one forever. */
export function pipeCurrent(doneMap) {
  for (const [k] of PIPE_MILESTONES) if (!doneMap[k]) return k;
  return null;
}
