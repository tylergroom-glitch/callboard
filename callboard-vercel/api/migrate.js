// /api/migrate  — one-time copy of Airtable -> Supabase. POST, admin only.
// Reads Airtable (never modifies it) and upserts into Supabase on airtable_id,
// so it is safe to run more than once. Covers Events, Roster, Templates, Inventory.
//
// PREREQUISITES (run once each in the Supabase SQL editor):
//   alter table public.shows add column if not exists airtable_id text unique;
//   ...plus the roster / templates / inventory tables from setup-tables.sql.
import { json, auth, isAdmin, airtableRaw, supabaseRest } from "./_lib.js";

async function readAll(atTable) {
  const recs = [];
  let offset;
  do {
    const d = await airtableRaw(atTable, "GET", offset ? `?offset=${offset}` : "");
    for (const r of d.records || []) recs.push(r);
    offset = d.offset;
  } while (offset);
  return recs;
}

async function upsertAll(sbTable, rows, conflict) {
  let n = 0;
  const CHUNK = 25;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    await supabaseRest("POST", `/${sbTable}?on_conflict=${conflict}`, batch, "return=minimal,resolution=merge-duplicates");
    n += batch.length;
  }
  return n;
}

const parseData = (f) => {
  try { return f.Data ? JSON.parse(f.Data) : {}; } catch { return {}; }
};

export default async function handler(req, res) {
  const p = auth(req);
  if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
  if (req.method !== "POST") return json(res, 405, { error: "POST to run the migration" });

  const results = {};
  try {
    // Events -> shows
    const events = await readAll("Events");
    results.shows = await upsertAll(
      "shows",
      events.map((rec) => {
        const f = rec.fields || {};
        return {
          airtable_id: rec.id,
          name: f.Name || "",
          client: f.Client || "",
          start_date: f.StartDate || null,
          end_date: f.EndDate || null,
          data: parseData(f),
          pass_hash: f.PassHash || null,
        };
      }),
      "airtable_id"
    );

    // Roster -> roster (includes the __positions__ config record)
    const roster = await readAll("Roster");
    results.roster = await upsertAll(
      "roster",
      roster.map((rec) => ({ airtable_id: rec.id, name: (rec.fields || {}).Name || "", data: parseData(rec.fields || {}) })),
      "airtable_id"
    );

    // Templates -> templates (optional table)
    let templates = [];
    try { templates = await readAll("Templates"); } catch (e) { templates = []; }
    results.templates = await upsertAll(
      "templates",
      templates.map((rec) => ({ airtable_id: rec.id, name: (rec.fields || {}).Name || "", data: parseData(rec.fields || {}) })),
      "airtable_id"
    );

    // Inventory -> inventory (optional table; has a Category column)
    let inventory = [];
    try { inventory = await readAll("Inventory"); } catch (e) { inventory = []; }
    results.inventory = await upsertAll(
      "inventory",
      inventory.map((rec) => {
        const f = rec.fields || {};
        return { airtable_id: rec.id, name: f.Name || "", category: f.Category || "", data: parseData(f) };
      }),
      "airtable_id"
    );

    return json(res, 200, { ok: true, ...results });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || "Migration failed", detail: e.detail || null, partial: results });
  }
}
