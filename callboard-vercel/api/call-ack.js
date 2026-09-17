// /api/call-ack — "Got it" on the call sheet.
//
//   GET  ?show=<id>   who on this show has confirmed their call
//   POST ?show=<id>   confirm mine   { crewId, ackOf }
//
// SETUP: run sql/setup-call-acks.sql.
//
// ---------------------------------------------------------------------------
// WHY THIS IS NOT A FIELD ON THE CREW ROW
//
// A show is one record, and the app writes that whole record back on every
// change. Every crew member's browser holds its own copy. On the morning of a
// job they all read their call within a few minutes of each other — so two
// confirmations through the normal save path would each write a whole copy
// back, and the second would erase the first along with anything Tyler changed
// in between. One row per confirmation, written straight to its own table,
// removes that rather than narrowing the window.
//
// WHY A CONFIRMATION CAN GO STALE
//
// The question this feature answers is "has this person seen their call". If
// the call then MOVES, yesterday's confirmation is worse than none: it says
// they know about something they have never seen. So a confirmation records a
// fingerprint of the call as it stood, and the app asks again when the call no
// longer matches. A confirmation that cannot expire would make the screen
// lie on exactly the day it matters — the day the schedule changed.
//
// WHO MAY DO WHAT
//
// Anyone who can open the show can confirm, and can see the list. That is the
// same bar as reading the call sheet itself, which is where all of this
// information already is. What it may NOT do is write a confirmation for a
// crew id that is not on the show — checked against the show's own crew list,
// not taken on trust from the request.
// ---------------------------------------------------------------------------
import { json, readBody, auth, isAdmin, canAccessShow, memberRole, supabaseRest } from "./_lib.js";

const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);

/* The show's crew list, read from the show itself.

   This exists so `crewId` cannot be trusted from the request body. Without it,
   anyone able to open a show could file confirmations for people who are not
   on it, and the admin view would show names nobody recognises. */
async function crewOf(showId) {
  const rows = await supabaseRest(
    "GET", "/shows?id=eq." + encodeURIComponent(showId) + "&select=data&limit=1", null);
  const row = rows && rows[0];
  if (!row) return null;
  const d = (row.data && typeof row.data === "object") ? row.data
    : (() => { try { return JSON.parse(row.data || "{}"); } catch { return {}; } })();
  return Array.isArray(d.crew) ? d.crew : [];
}

/* Reading the call sheet is the bar. `canAccessShow` covers a TCG admin and a
   show-password holder; an account holder's membership is a lookup, which is
   why this is async. */
async function mayOpen(p, showId) {
  if (!p || !showId) return false;
  if (canAccessShow(p, showId)) return true;
  return !!(await memberRole(p, showId));
}

export default async function handler(req, res) {
  const p = auth(req);
  if (!p) return json(res, 401, { error: "Not signed in" });

  const q = req.query || {};
  const showId = str(q.show, 100);
  if (!showId) return json(res, 400, { error: "Missing show" });

  try {
    if (!(await mayOpen(p, showId))) return json(res, 403, { error: "Not allowed" });

    if (req.method === "GET") {
      const rows = await supabaseRest(
        "GET", "/call_acks?event_id=eq." + encodeURIComponent(showId) +
          "&select=crew_id,crew_name,acked_at,ack_of&limit=500", null);
      return json(res, 200, {
        acks: (rows || []).map((r) => ({
          crewId: r.crew_id, crewName: r.crew_name || "",
          ackedAt: r.acked_at, ackOf: r.ack_of || "",
        })),
      });
    }

    if (req.method === "POST") {
      const b = await readBody(req);
      const crewId = str(b && b.crewId, 100);
      if (!crewId) return json(res, 400, { error: "Missing crewId" });

      const crew = await crewOf(showId);
      if (crew === null) return json(res, 404, { error: "No such show" });
      const member = crew.find((c) => c && String(c.id) === crewId);
      /* Not on the show, no confirmation. The name is taken from the crew row
         rather than the request for the same reason. */
      if (!member) return json(res, 400, { error: "That person is not on this show." });

      const now = new Date().toISOString();
      /* Upsert on (event_id, crew_id): tapping twice, or confirming again
         after the call moved, updates the one row rather than adding another.
         The unique index is what makes the second tap safe even if it lands
         before the first has finished. */
      await supabaseRest(
        "POST", "/call_acks?on_conflict=event_id,crew_id",
        {
          event_id: showId,
          crew_id: crewId,
          crew_name: str(member.name, 200),
          ack_of: str(b && b.ackOf, 300),
          acked_at: now,
          updated_at: now,
        },
        "resolution=merge-duplicates");

      return json(res, 200, { ok: true, ackedAt: now });
    }

    return json(res, 405, { error: "Method not allowed" });
  } catch (e) {
    return json(res, e.status || 500, { error: (e && e.message) || "Server error" });
  }
}
