// /api/import-inventory
// POST { sheetUrl, preview: true }   → parse sheet, return preview (no changes)
// POST { sheetUrl, confirm: true }   → replace sheet-sourced cases, import fresh
//
// Admin only. Requires the sheet to be shared "Anyone with the link can view."
//
// ---- what confirm actually deletes -----------------------------------------
// Only cases carrying _source: "sheet" in their data — i.e. ones a previous run
// of this importer created. Cases you built by hand have no _source and are
// never touched. That was true on Airtable and it is true here; on Supabase it
// is expressed as a single filtered delete rather than a scan-and-collect,
// which is both faster and harder to get wrong.
import { json, readBody, auth, isAdmin, supabaseRest } from "./_lib.js";

const SRC = "sheet"; // _source tag written to every sheet-imported case's data

/* ---- CSV parser ---- */
function parseCSV(text) {
  const rows = [];
  for (const line of text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    if (!line.trim()) continue;
    const row = []; let field = ""; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') inQ = false;
        else field += c;
      } else if (c === '"') { inQ = true; }
      else if (c === ',') { row.push(field.trim()); field = ""; }
      else field += c;
    }
    row.push(field.trim());
    rows.push(row);
  }
  return rows;
}

/* ---- Type → pull list category ---- */
function toCategory(type) {
  const t = (type || "").toLowerCase();
  if (/mic|comms|wireless|headset|clear.?com|audio|intercom/.test(t)) return "Audio";
  if (/camera|video|monitor|display|led|recorder|visual|broadcast|screen/.test(t)) return "Video";
  if (/\bpower\b|distro/.test(t)) return "Power";
  if (/light|lighting|fixture|dimmer|hazer|fogger/.test(t)) return "Lighting";
  if (/truss|rigging|motor|hoist|staging|scenic/.test(t)) return "Scenic";
  return "Misc";
}

/* ---- find column index by fuzzy header name ---- */
function colFinder(headers) {
  const norm = headers.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  return (...keys) => {
    for (const k of keys) {
      const i = norm.findIndex(h => h.includes(k));
      if (i >= 0) return i;
    }
    return -1;
  };
}

/* ---- parse CSV rows → inventory cases ---- */
function buildCases(rows) {
  if (rows.length < 2) throw new Error("Sheet appears empty.");
  const find = colFinder(rows[0]);
  const cModel = find("modelnumber", "model");
  const cBrand = find("branditem", "brand");
  const cType  = find("type");
  const cCase  = find("caserack", "case", "rack");
  const cNotes = find("notes");
  if (cModel < 0 && cBrand < 0) throw new Error("Could not find Model Number or Brand column.");
  if (cCase < 0)  throw new Error("Could not find Case/Rack column.");

  // Group rows by case, then by item description
  const caseMap = {}; // caseName → { category, items: { key → { item, qty, notes } } }

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => !c)) continue;
    const model  = (row[cModel]  || "").trim();
    const brand  = (row[cBrand]  || "").trim();
    const type   = (row[cType]   || "").trim();
    const caseName = (row[cCase]  || "").trim() || "Unassigned Gear";
    const notes  = cNotes >= 0 ? (row[cNotes] || "").trim() : "";
    if (!model && !brand) continue;

    // Build item name — prepend brand if not already in model name
    const brandLow = brand.toLowerCase();
    const modelLow = model.toLowerCase();
    const itemName = (brand && !modelLow.includes(brandLow))
      ? `${brand} ${model}`.trim()
      : model || brand;

    const cat = toCategory(type);
    const key = `${itemName}|||${type}`;

    if (!caseMap[caseName]) caseMap[caseName] = { category: cat, items: {} };
    if (!caseMap[caseName].items[key]) {
      caseMap[caseName].items[key] = { item: itemName, qty: 0, source: "TCG", notes };
    }
    caseMap[caseName].items[key].qty++;
  }

  return Object.entries(caseMap).map(([name, c]) => ({
    name,
    category: c.category,
    items: Object.values(c.items),
  }));
}

/* ---- fetch CSV from Google Sheets ---- */
async function fetchCSV(url) {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) throw new Error("Couldn't find a sheet ID in that URL.");
  const id = m[1];
  // Try export endpoint first (works when sheet is "anyone with link can view")
  const exportUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=0`;
  let res = await fetch(exportUrl);
  if (!res.ok) {
    // Fallback: published CSV
    const pubUrl = `https://docs.google.com/spreadsheets/d/${id}/pub?gid=0&single=true&output=csv`;
    res = await fetch(pubUrl);
    if (!res.ok) throw new Error(`Couldn't access the sheet (${res.status}). Make sure it's shared as "Anyone with the link can view."`);
  }
  return res.text();
}

/* ---- Supabase helpers ---- */

/* Matches on the jsonb key rather than reading every case and filtering in
   JavaScript, so a hand-built case can never be caught by a bug in a loop. */
const SHEET_FILTER = "data->>_source=eq." + SRC;

async function countSheetSourced() {
  const rows = await supabaseRest("GET", `/inventory?${SHEET_FILTER}&select=id&limit=5000`, null);
  return (rows || []).length;
}

async function deleteSheetSourced() {
  await supabaseRest("DELETE", `/inventory?${SHEET_FILTER}`, null);
}

async function batchCreate(cases) {
  const now = new Date().toISOString();
  const rows = cases.map((c) => ({
    name: c.name,
    category: c.category,
    data: { drawers: [], items: c.items, _source: SRC },
    updated_at: now,
  }));
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await supabaseRest("POST", "/inventory", rows.slice(i, i + CHUNK), "return=minimal");
  }
}

/* ---- handler ---- */
export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  const p = auth(req);
  if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });

  let body;
  try { body = await readBody(req); } catch { return json(res, 400, { error: "Bad request" }); }
  const { sheetUrl, preview, confirm: doConfirm } = body;
  if (!sheetUrl) return json(res, 400, { error: "sheetUrl required" });

  try {
    const csvText = await fetchCSV(sheetUrl);
    const rows = parseCSV(csvText);
    const cases = buildCases(rows);
    const totalItems = cases.reduce((n, c) => n + c.items.length, 0);

    if (preview) {
      return json(res, 200, {
        preview: true,
        cases: cases.length,
        items: totalItems,
        caseNames: cases.map(c => ({ name: c.name, category: c.category, count: c.items.length })),
      });
    }

    if (doConfirm) {
      /* A sheet that parses to nothing — headers present, every row skipped —
         used to delete the previous import and put nothing back. Refusing is
         the right answer: an import that would leave you with less than you
         started with is a mistake, not an instruction. */
      if (!cases.length) {
        return json(res, 400, {
          error: "That sheet produced no cases, so nothing was changed. Check the Model/Brand and Case columns have data.",
        });
      }
      const replaced = await countSheetSourced();
      if (replaced) await deleteSheetSourced();
      await batchCreate(cases);
      return json(res, 200, { ok: true, created: cases.length, replaced, items: totalItems });
    }

    return json(res, 400, { error: "Specify preview:true or confirm:true" });
  } catch (e) {
    return json(res, 500, { error: e.message || "Server error" });
  }
}
