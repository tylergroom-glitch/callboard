// api/_jobs.js — reading a pasted table of past jobs.
//
// Underscore: a helper, not a route. It is separated from api/import-jobs.js
// for one reason — EVERY interesting bug in an importer is in the parsing, and
// parsing that lives inside a route can only be tested by standing up a
// database and signing a token. Here it is thirty pure functions that take a
// string and return a number, and the test suite can hammer them with the
// ugly real-world spellings ("3/5/26", "$12,500.00", "Mar 5 - 7, 2026")
// hundreds at a time.
//
// NOTHING IN THIS FILE TOUCHES A DATE OBJECT.
//   `new Date("2026-03-05")` is midnight UTC, which is the 4th of March in
//   Pacific — this app has been bitten by exactly that before, and an importer
//   that silently moves every job back a day would put a January job in last
//   year's revenue. Dates are parsed from their characters into a
//   "YYYY-MM-DD" string and never become a timestamp.

/* ---------------------------------------------------------------------------
   The table itself.
   --------------------------------------------------------------------------- */

/* Tab beats comma beats semicolon, decided from the first line only.
   A paste out of Excel, Numbers or Google Sheets is tab-separated, and that is
   how Tyler will make one — "select the rows, copy, paste" — so tabs win
   outright rather than by count. A comma inside a job name is then not a
   delimiter at all, which is the common case this ordering protects. */
export function detectDelimiter(text) {
  const first = String(text || "").replace(/\r\n?/g, "\n").split("\n").find((l) => l.trim());
  if (!first) return ",";
  if (first.indexOf("\t") >= 0) return "\t";
  const commas = (first.match(/,/g) || []).length;
  const semis = (first.match(/;/g) || []).length;
  return semis > commas ? ";" : ",";
}

/* A real CSV reader, not a split on the delimiter.
   Quoted fields may contain the delimiter, doubled quotes and newlines. Rows
   carry the 1-based line they started on, because "row 7 has no amount" is the
   only error message that helps somebody fix a paste of forty rows. */
export function parseDelimited(text, delim) {
  const s = String(text == null ? "" : text).replace(/\r\n?/g, "\n");
  const rows = [];
  let cells = [], cell = "", quoted = false, line = 1, startLine = 1;
  const endCell = () => { cells.push(cell); cell = ""; };
  const endRow = () => {
    endCell();
    if (cells.some((c) => String(c).trim() !== "")) rows.push({ line: startLine, cells });
    cells = [];
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }
    /* A quote only opens a quoted field at the START of one. Anywhere else it
       is a literal character — a show called `6" Monitor Package` in a
       tab-separated paste is not the beginning of a quoted section, and
       treating it as one swallows the rest of the table. */
    if (ch === '"' && cell === "") { quoted = true; continue; }
    if (ch === delim) { endCell(); continue; }
    if (ch === "\n") { endRow(); line++; startLine = line; continue; }
    cell += ch;
  }
  endRow();
  return rows;
}

/* ---------------------------------------------------------------------------
   Which column is which.

   Header names are matched after stripping everything that is not a letter or
   a digit, so "Start Date", "start_date", "START-DATE" and "Start date " are
   one name. The aliases are the spellings a quote, an invoice register or a
   spreadsheet actually uses — not a guess at what a tidy schema would call
   them, because the file being imported was not written by this app.
   --------------------------------------------------------------------------- */
export const FIELD_ALIASES = {
  name: ["name", "job", "jobname", "show", "showname", "event", "eventname",
         "project", "projectname", "description", "job description", "title"],
  client: ["client", "customer", "account", "company", "clientname", "customername", "for"],
  startDate: ["date", "start", "startdate", "eventdate", "jobdate", "showdate",
              "datein", "from", "begins", "loadin", "dates"],
  endDate: ["end", "enddate", "dateout", "to", "through", "ends", "loadout"],
  total: ["total", "amount", "gross", "revenue", "value", "price", "sale",
          "invoiceamount", "invoicetotal", "quotetotal", "contracttotal",
          "grandtotal", "billed", "totalamount", "amountbilled"],
  status: ["status", "state", "outcome", "result"],
  invoiceNo: ["invoice", "invoiceno", "invoicenumber", "invoice", "inv", "invno", "po", "ponumber"],
  note: ["note", "notes", "comment", "comments", "memo", "detail", "details"],
};

export const normHeader = (v) => String(v == null ? "" : v).toLowerCase().replace(/[^a-z0-9]+/g, "");

/* Returns { map, unknown }. `map` is field -> column index.
   The FIRST column that claims a field keeps it: a sheet with both "Amount"
   and "Total" columns would otherwise have the later one silently overwrite
   the earlier, and which one won would depend on column order. */
export function mapHeaders(cells) {
  const map = {};
  const unknown = [];
  const byAlias = {};
  for (const field of Object.keys(FIELD_ALIASES)) {
    for (const a of FIELD_ALIASES[field]) {
      const k = normHeader(a);
      if (!(k in byAlias)) byAlias[k] = field;
    }
  }
  (cells || []).forEach((c, i) => {
    const k = normHeader(c);
    if (!k) return;
    const field = byAlias[k];
    if (!field) { unknown.push(String(c).trim()); return; }
    if (!(field in map)) map[field] = i;
  });
  return { map, unknown };
}

/* Is this first row a header, or is it already data?
   A header is a row that names at least a job and an amount.
 *
 * THE VERSION OF THIS THAT WAS HERE FIRST ALSO ASKED whether the amount column
 * contained an amount — "a sheet whose first data row starts with the word
 * Total is data, not a header". It read well and it could never fire, because
 * `map.total` is the index of a cell whose text matched an alias — total,
 * amount, gross, value, price — and not one of those words parses as money, so
 * the extra test was asking whether "Amount" is a number. Mutation testing
 * found it: the line could be deleted and nothing in the suite noticed,
 * because nothing could.
 *
 * It is gone rather than repaired. A guard that cannot fire is not defence in
 * depth; it is a line that makes the next person believe a case is covered.
 *
 * What actually stops a headerless paste being eaten is that its first row is
 * job names and numbers, and those match no alias at all — so `name` and
 * `total` are simply not in the map and this returns false. That is the real
 * mechanism, and it is tested. */
export function looksLikeHeader(cells) {
  const { map } = mapHeaders(cells);
  return "name" in map && "total" in map;
}

/* ---------------------------------------------------------------------------
   Money.
   --------------------------------------------------------------------------- */

/* null means "this is not a number", which is NOT the same as 0 — an unreadable
   amount has to stop the row, because a job silently imported at zero is a hole
   in the year's revenue that nothing on any screen would ever point at. */
export function parseMoney(v) {
  let s = String(v == null ? "" : v).trim();
  if (!s) return null;
  let neg = false;
  // Accounting parentheses: (1,200.00) is minus twelve hundred.
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  s = s.replace(/usd|dollars?/gi, "")
       .replace(/[$ \s,]/g, "")
       .trim();
  if (s.startsWith("-")) { neg = true; s = s.slice(1); }
  if (s.startsWith("+")) s = s.slice(1);
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(parseFloat(s) * 100) / 100;
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

export const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* ---------------------------------------------------------------------------
   Dates. Characters in, "YYYY-MM-DD" out, no Date object anywhere.
   --------------------------------------------------------------------------- */
/* Full names and the abbreviations people actually write, spelled out.
   NOT "the first three letters", which was the first version of this and which
   happily read "Marz 5, 2026" as March — a typo silently becoming a date is
   exactly the class of thing an importer must refuse rather than guess at. */
const MONTHS = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3,
  april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
  august: 8, aug: 8, september: 9, sept: 9, sep: 9,
  october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};
const monthOf = (w) => MONTHS[String(w == null ? "" : w).toLowerCase().replace(/\.$/, "")] || 0;

export const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysInMonth = (y, m) =>
  [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

const pad = (n) => (n < 10 ? "0" + n : String(n));

/* The only place a Y/M/D triple becomes a date string, so the calendar check
   cannot be skipped by one caller. 2026-02-30 is not a date and must not
   become one. */
export function ymd(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return "";
  if (y < 1990 || y > 2100) return "";
  if (m < 1 || m > 12) return "";
  if (d < 1 || d > daysInMonth(y, m)) return "";
  return y + "-" + pad(m) + "-" + pad(d);
}

/* A two-digit year. 00-69 is this century, 70-99 the last — the POSIX rule.
   Tyler's data is all 2020s, so this only ever has to not be silly. */
function fullYear(raw) {
  const s = String(raw);
  const n = parseInt(s, 10);
  if (!Number.isFinite(n)) return NaN;
  if (s.length <= 2) return n < 70 ? 2000 + n : 1900 + n;
  return n;
}

export function parseDate(v) {
  const s = String(v == null ? "" : v).trim().replace(/\s+/g, " ");
  if (!s) return "";
  let m;
  // 2026-03-05, 2026/3/5
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)))
    return ymd(+m[1], +m[2], +m[3]);
  /* 3/5/2026 — MONTH FIRST. Tyler is in California and every source document
     here is American; day-first would silently move the 3rd of May to the 5th
     of March, which is a wrong answer that looks like a right one. Ambiguous
     by nature and therefore stated out loud on the review screen. */
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/)))
    return ymd(fullYear(m[3]), +m[1], +m[2]);
  // Mar 5, 2026 / March 5th 2026
  if ((m = s.match(/^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{2,4})$/))) {
    const mo = monthOf(m[1]);
    return mo ? ymd(fullYear(m[3]), mo, +m[2]) : "";
  }
  // 5 Mar 2026 / 5th March, 2026
  if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)? ([A-Za-z]{3,9})\.?,? (\d{2,4})$/))) {
    const mo = monthOf(m[2]);
    return mo ? ymd(fullYear(m[3]), mo, +m[1]) : "";
  }
  return "";
}

const SEP = /\s*(?:–|—|\bto\b|\bthrough\b|\bthru\b|-)\s*/gi;

/* One cell that might hold two dates. Returns [start, end]; end is "" when
   there is only one.
 *
 * TWO THINGS THIS HAS TO GET RIGHT, AND THEY PULL AGAINST EACH OTHER:
 *
 *   "3-5-2026" is ONE date that contains two hyphens. "3/5/2026 - 3/7/2026"
 *   is two dates separated by a hyphen. A single regex cannot tell them apart,
 *   and the first version of this tried: its lazy left-hand group matched the
 *   hyphen inside "2026-03-05" and handed back the halves "2026" and
 *   "03-05 to 2026-03-07", neither of which is a date, so a perfectly ordinary
 *   range came back empty.
 *
 *   So: the whole string is tried as a date first, and only if that fails is
 *   EVERY separator position tried in turn, keeping the first split where both
 *   halves are real dates. A split that lands inside a date produces something
 *   that does not parse and is discarded, which is the whole trick.
 */
export function splitDateRange(v) {
  const s = String(v == null ? "" : v).trim().replace(/\s+/g, " ");
  if (!s) return ["", ""];
  const whole = parseDate(s);
  if (whole) return [whole, ""];

  const splits = [];
  const re = new RegExp(SEP.source, "gi");
  let m;
  while ((m = re.exec(s))) {
    if (re.lastIndex === m.index) re.lastIndex++;          // zero-width guard
    const left = s.slice(0, m.index).trim();
    const right = s.slice(m.index + m[0].length).trim();
    if (left && right) splits.push([left, right]);
  }

  for (const [left, right] of splits) {
    const a = parseDate(left), b = parseDate(right);
    if (a && b) return [a, b];
  }

  /* "Mar 5 - 7, 2026": neither half is a date on its own. The year lives on
     the right, the month on the left, and this is the single most common way
     a person writes a two-day job — worth reassembling rather than rejecting. */
  for (const [left, right] of splits) {
    const yr = right.match(/(\d{4})\s*$/);
    const dayOnly = right.match(/^(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*\d{4}$/);
    if (!yr || !dayOnly) continue;
    const start = parseDate(left + " " + yr[1]);
    if (!start) continue;
    const end = ymd(+start.slice(0, 4), +start.slice(5, 7), +dayOnly[1]);
    if (end) return [start, end];
  }
  return ["", ""];
}

/* ---------------------------------------------------------------------------
   Status.
   --------------------------------------------------------------------------- */

/* The app has four statuses and a spreadsheet has forty words for them.
   "Cancelled" maps to LOST deliberately: a cancelled job earned nothing unless
   a fee was collected, and if one was, the honest row is the fee as the amount
   and the status set to won by hand. Guessing the other way would invent
   revenue. */
export const STATUS_WORDS = {
  won: ["won", "closedwon", "closed", "complete", "completed", "confirmed",
        "booked", "invoiced", "paid", "delivered", "done", "accepted", "yes"],
  lost: ["lost", "closedlost", "declined", "cancelled", "canceled", "nobid",
         "passed", "dead", "no"],
  sent: ["sent", "pending", "open", "outstanding", "proposal", "quoted", "bid"],
  draft: ["draft", "wip", "working"],
};

export function parseStatus(v) {
  const k = normHeader(v);
  if (!k) return "won";                 // the default: these are jobs that happened
  for (const st of Object.keys(STATUS_WORDS)) {
    if (STATUS_WORDS[st].indexOf(k) >= 0) return st;
  }
  return "";                            // unknown — the row says so rather than guessing
}

/* ---------------------------------------------------------------------------
   Identity, for spotting a job that is already in the app.
   --------------------------------------------------------------------------- */

/* Name plus start date. NOT the amount: a job whose figure was corrected
   between the spreadsheet and the app is the same job, and keying on the
   amount would let a corrected row import as a second one and double it.

   Punctuation and case are thrown away so "AdventHealth Q1 Summit" and
   "adventhealth q1 summit" are one key. */
export const normName = (v) =>
  String(v == null ? "" : v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export const dupKey = (name, startDate) => normName(name) + "|" + String(startDate || "");

/* ---------------------------------------------------------------------------
   One row, validated.
   --------------------------------------------------------------------------- */
export const MAX_ROWS = 500;

const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);

/* Takes the loose field values (from a paste, or straight from the browser on
   commit) and returns either a clean job or the reason it is not one.

   THE SERVER RUNS THIS AGAIN AT COMMIT TIME, on the raw values, rather than
   trusting what the review screen decided. The review screen is a convenience;
   the rules are here. */
export function cleanJob(raw) {
  const r = raw || {};
  const name = str(r.name, 200);
  if (!name) return { error: "No job name." };

  /* The start cell may hold the whole range. An explicit end column always
     wins over one dug out of the start cell. */
  const [s1, s2] = splitDateRange(r.startDate);
  const startDate = s1;
  if (!startDate) {
    return { error: r.startDate ? "Couldn't read the date \"" + str(r.startDate, 40) + "\"." : "No date." };
  }
  let endDate = "";
  if (str(r.endDate, 40)) {
    endDate = parseDate(r.endDate);
    if (!endDate) return { error: "Couldn't read the end date \"" + str(r.endDate, 40) + "\"." };
  } else if (s2) endDate = s2;
  if (!endDate) endDate = startDate;
  if (endDate < startDate) return { error: "The end date is before the start date." };

  const total = parseMoney(r.total);
  if (total === null) {
    return { error: r.total ? "Couldn't read the amount \"" + str(r.total, 40) + "\"." : "No amount." };
  }
  if (total < 0) return { error: "The amount is negative." };

  const status = parseStatus(r.status);
  if (!status) return { error: "Don't know the status \"" + str(r.status, 40) + "\"." };

  return {
    job: {
      name,
      client: str(r.client, 200),
      startDate,
      endDate,
      total: money(total),
      status,
      invoiceNo: str(r.invoiceNo, 60),
      note: str(r.note, 1000),
    },
  };
}

/* The whole paste, read. Returns { error } when the table itself is unusable,
   otherwise { jobs, headers, unknown }. Every row comes back — the bad ones
   carrying their reason — because a review screen that hides the rows it could
   not read is a review screen that lies about how much was imported. */
export function readTable(text) {
  const raw = String(text == null ? "" : text);
  if (!raw.trim()) return { error: "Nothing to import." };

  const delim = detectDelimiter(raw);
  const rows = parseDelimited(raw, delim);
  if (!rows.length) return { error: "Nothing to import." };

  const head = rows[0];
  if (!looksLikeHeader(head.cells)) {
    const { unknown } = mapHeaders(head.cells);
    return {
      error: "The first row has to name the columns. It needs at least a job " +
             "name column and an amount column." +
             (unknown.length ? " Saw: " + unknown.slice(0, 8).join(", ") + "." : ""),
    };
  }
  const { map, unknown } = mapHeaders(head.cells);
  if (!("startDate" in map)) {
    return { error: "There's no date column. Add one called Date." };
  }

  const body = rows.slice(1);
  if (body.length > MAX_ROWS) {
    return { error: "That's " + body.length + " rows. Import " + MAX_ROWS +
                    " or fewer at a time so the review screen stays readable." };
  }
  if (!body.length) return { error: "That's just the header row — no jobs under it." };

  const pick = (cells, field) => (field in map ? cells[map[field]] : "");
  const jobs = body.map((row) => {
    const raw2 = {
      name: pick(row.cells, "name"),
      client: pick(row.cells, "client"),
      startDate: pick(row.cells, "startDate"),
      endDate: pick(row.cells, "endDate"),
      total: pick(row.cells, "total"),
      status: pick(row.cells, "status"),
      invoiceNo: pick(row.cells, "invoiceNo"),
      note: pick(row.cells, "note"),
    };
    const out = cleanJob(raw2);
    return {
      line: row.line,
      raw: raw2,
      ...(out.job ? { ...out.job, ok: true, error: "" } : { ok: false, error: out.error }),
    };
  });

  return { jobs, headers: Object.keys(map), unknown };
}
