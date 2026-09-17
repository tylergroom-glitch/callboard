// /api/import-pdf — read ONE Touchstone quote PDF and say what is in it.
//
//   POST /api/import-pdf   { pdf: "<base64>", fileName: "..." }
//
// ADMIN ONLY. WRITES NOTHING — not a show, not a quote, not a client. It reads
// a PDF, looks up what is already in the directory, and hands back a proposal.
// Everything is created later by /api/import-jobs?commit=1, after Tyler has
// looked at the list.
//
// ONE PDF PER REQUEST, ON PURPOSE
//   Twenty-five PDFs is twenty-five requests from the browser, not one request
//   carrying twenty-five files. Three reasons, in order of how much they
//   matter:
//     - A batch that fails on the ninth file fails as a whole. One at a time,
//       the ninth is a row on the review screen that says what went wrong and
//       the other twenty-four are fine.
//     - Vercel caps a request body at 4.5MB. Four quote PDFs would exceed it.
//     - The person watching gets a progress count instead of a spinner.
//
// SETUP: pdfjs-dist must be in callboard-vercel/package.json. No new env vars
// — and specifically NOT ANTHROPIC_API_KEY. See the note at the top of
// api/_quotepdf.js for why this reads the PDF rather than asking an AI about
// it, and api/_pdftext.js for why getting text out of a PDF in a serverless
// function is not the one-liner it looks like.
import { json, readBody, auth, isAdmin, supabaseRest } from "./_lib.js";
import { parseQuotePdf, linesFor } from "./_quotepdf.js";
import { pdfToPages } from "./_pdftext.js";
import { dupKey, parseDate, money, bestMatch } from "./_jobs.js";

/* Base64 is about a third larger than the bytes, and Vercel's request cap is
   4.5MB. A quote PDF is a few hundred KB; anything near this limit is not one. */
export const MAX_B64 = 4 * 1024 * 1024;

export default async function handler(req, res) {
  const p = auth(req);
  if (!p) return json(res, 401, { error: "Not signed in" });
  if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  let body;
  try { body = await readBody(req); } catch (e) { return json(res, 400, { error: "Bad request body" }); }

  const b64 = String((body && body.pdf) || "");
  const fileName = String((body && body.fileName) || "").slice(0, 200);
  if (!b64) return json(res, 400, { error: "No PDF sent." });
  if (b64.length > MAX_B64)
    return json(res, 413, { error: "That PDF is too big to read in one go (4 MB limit)." });

  let pages;
  try {
    pages = await pdfToPages(Buffer.from(b64, "base64"));
  } catch (e) {
    return json(res, 422, {
      error: "That file could not be opened as a PDF." +
             (e && e.message ? " (" + String(e.message).slice(0, 160) + ")" : ""),
      fileName,
    });
  }

  const parsed = parseQuotePdf(pages);
  if (parsed.error) return json(res, 200, { fileName, ok: false, error: parsed.error });

  /* The date the quote prints is MM-DD-YYYY. parseDate is the importer's one
     date reader, shared with the paste path, so the two cannot drift apart
     about what 04-05-2026 means. */
  const startDate = parseDate(parsed.startDate);
  const endDate = parseDate(parsed.endDate) || startDate;
  const warnings = parsed.warnings.slice();
  if (parsed.startDate && !startDate) warnings.push("Couldn't read the load-in date \"" + parsed.startDate + "\".");
  if (endDate && startDate && endDate < startDate) warnings.push("The load-out date is before the load-in date.");

  /* What is already here. Four reads, one request — the browser is going to
     call this once per PDF and N+1 lookups per file would show. */
  const [clients, venues, quotes, shows] = await Promise.all([
    supabaseRest("GET", "/clients?select=id,name,parent_id,billing_address&limit=5000", null),
    supabaseRest("GET", "/venues?select=id,name,address,city,state&limit=5000", null),
    supabaseRest("GET", "/quotes?select=id,name,start_date,status&limit=5000", null),
    supabaseRest("GET", "/shows?select=id,name,start_date&limit=5000", null),
  ]);

  /* Only top-level companies are offered as a client match. A contact row
     (one with a parent) is a person at a company, and billing a job to a
     person rather than to the company is a mess to unpick later. */
  const companies = (clients || []).filter((c) => c && !c.parent_id);

  const key = dupKey(parsed.name, startDate);
  const already =
    (quotes || []).find((q) => q.name && q.start_date && dupKey(q.name, q.start_date) === key) || null;
  const alreadyShow =
    (shows || []).find((s) => s.name && s.start_date && dupKey(s.name, s.start_date) === key) || null;

  const lines = linesFor(parsed);
  const linesTotal = money(lines.reduce((t, l) => t + l.qty * l.days * l.rate, 0));

  return json(res, 200, {
    fileName,
    ok: parsed.ok && !!startDate,
    pages: pages.length,

    name: parsed.name,
    quoteNumber: parsed.quoteNumber,
    revision: parsed.revision,
    startDate,
    endDate,
    loadIn: parsed.loadIn,
    loadOut: parsed.loadOut,
    total: parsed.total,

    client: {
      name: parsed.client.name,
      address: parsed.client.address,
      match: bestMatch(parsed.client.name, companies),
    },
    venue: {
      name: parsed.venue.name,
      address: parsed.venue.address,
      city: parsed.venue.city,
      state: parsed.venue.state,
      zip: parsed.venue.zip,
      match: bestMatch(parsed.venue.name, venues || []),
    },

    categories: parsed.categories,
    lines,
    /* Two statements of one number, both returned so the screen can show them
       side by side when they disagree. `check.balances` is the categories
       against the grand total on the page; `linesBalance` is the lines this
       importer built against that same total. Either being false is a reason
       to look at the PDF, and a reason NOT to quietly import it. */
    check: { ...parsed.check, linesTotal, linesBalance: Math.abs(linesTotal - (parsed.total || 0)) < 0.005 },

    dup: already ? "quote" : alreadyShow ? "show" : "",
    dupNote: already
      ? "A quote for this job is already in the app" + (already.status ? " (" + already.status + ")" : "") + "."
      : alreadyShow
        ? "A show with this name and date already exists. Importing would make a second one."
        : "",

    warnings,
  });
}
