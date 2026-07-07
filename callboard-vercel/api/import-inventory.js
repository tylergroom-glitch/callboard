// /api/import-inventory
// POST { sheetUrl, preview: true }   → parse sheet, return preview (no changes)
// POST { sheetUrl, confirm: true }   → delete all sheet-sourced cases, import fresh
//
// Admin only. Requires the sheet to be shared "Anyone with the link can view."
import { json, readBody, auth, isAdmin, airtableTable } from "./_lib.js";

const TABLE  = process.env.AIRTABLE_INVENTORY_TABLE || "Inventory";
const SRC    = "sheet"; // _source tag written to every sheet-imported case's Data JSON

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

/* ---- Airtable helpers ---- */
async function getSheetSourceIds() {
  const ids = []; let offset;
  do {
    const d = await airtableTable(TABLE, "GET", offset ? `?offset=${offset}` : "");
    for (const r of d.records) {
      let data = {};
      try { data = r.fields.Data ? JSON.parse(r.fields.Data) : {}; } catch {}
      if (data._source === SRC) ids.push(r.id);
    }
    offset = d.offset;
  } while (offset);
  return ids;
}

async function batchDelete(ids) {
  for (let i = 0; i < ids.length; i += 10) {
    const qs = ids.slice(i, i + 10).map(id => `records[]=${id}`).join("&");
    await airtableTable(TABLE, "DELETE", `?${qs}`);
  }
}

async function batchCreate(cases) {
  const records = cases.map(c => ({
    fields: {
      Name: c.name,
      Category: c.category,
      Data: JSON.stringify({ drawers: [], items: c.items, _source: SRC }),
    }
  }));
  for (let i = 0; i < records.length; i += 10) {
    await airtableTable(TABLE, "POST", "", { records: records.slice(i, i + 10) });
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
      const oldIds = await getSheetSourceIds();
      if (oldIds.length) await batchDelete(oldIds);
      await batchCreate(cases);
      return json(res, 200, { ok: true, created: cases.length, replaced: oldIds.length, items: totalItems });
    }

    return json(res, 400, { error: "Specify preview:true or confirm:true" });
  } catch (e) {
    return json(res, 500, { error: e.message || "Server error" });
  }
}
