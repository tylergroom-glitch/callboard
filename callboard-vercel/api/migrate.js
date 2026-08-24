// /api/migrate  — one-time copy of every Airtable show into the Supabase `shows` table.
// POST (admin only). Safe to run more than once: it upserts on airtable_id, so
// re-running updates existing rows instead of creating duplicates.
// Airtable is only READ here — never modified. It stays as your backup.
//
// PREREQUISITE: run this once in the Supabase SQL editor first:
//   alter table public.shows add column if not exists airtable_id text unique;
import { json, auth, isAdmin, airtable, supabaseRest } from "./_lib.js";

export default async function handler(req, res) {
  const p = auth(req);
  if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
  if (req.method !== "POST") return json(res, 405, { error: "POST to run the migration" });

  try {
    // 1) read every show from Airtable (paginated)
    const recs = [];
    let offset;
    do {
      const d = await airtable("GET", offset ? `?offset=${offset}` : "");
      for (const r of d.records || []) recs.push(r);
      offset = d.offset;
    } while (offset);

    // 2) map Airtable records -> shows rows
    const rows = recs.map((rec) => {
      const f = rec.fields || {};
      let data = {};
      try { data = f.Data ? JSON.parse(f.Data) : {}; } catch { data = {}; }
      return {
        airtable_id: rec.id,
        name: f.Name || "",
        client: f.Client || "",
        start_date: f.StartDate || null,
        end_date: f.EndDate || null,
        data,
        pass_hash: f.PassHash || null,
      };
    });

    // 3) upsert into Supabase in batches (on_conflict=airtable_id)
    let migrated = 0;
    const CHUNK = 25;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = rows.slice(i, i + CHUNK);
      await supabaseRest(
        "POST",
        "/shows?on_conflict=airtable_id",
        batch,
        "return=minimal,resolution=merge-duplicates"
      );
      migrated += batch.length;
    }

    return json(res, 200, { ok: true, migrated, total: recs.length });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || "Migration failed", detail: e.detail || null });
  }
}
