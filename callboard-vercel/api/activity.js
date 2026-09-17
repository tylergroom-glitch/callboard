// /api/activity — what has happened, newest first.
//
//   GET /api/activity              the last 30 entries across everything
//   GET /api/activity?limit=50     up to 100
//   GET /api/activity?show=<id>    just this show
//
// ADMIN ONLY for the unscoped feed. It spans every show and every client, so
// it is the same class of thing as /api/dashboard and /api/costing?all=1: a
// show-scoped manager must not receive it. Narrowed to one show, a manager of
// THAT show may read it — which is the existing canAccessShow rule, not a new
// one.
//
// WHY THIS IS READ-ONLY
//   There is no POST. Entries are written by logActivity() in _lib.js, from
//   inside the route that did the thing, where the token and the facts both
//   already are. An endpoint that accepted "record that X happened" would be
//   a log anyone signed in could write fiction into, and a log that can be
//   written to by hand is not evidence of anything.
//
// SETUP: run sql/setup-activity.sql.
import { json, auth, isAdmin, canAccessShow, supabaseRest } from "./_lib.js";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

/* The columns that go out. Written as a list rather than `select=*` so that a
   column added to this table later — and the next one WILL carry something
   somebody regrets — does not reach the browser by default. */
const COLS = "id,at,kind,summary,show_id,actor,meta";

export default async function handler(req, res) {
  const p = auth(req);
  if (!p) return json(res, 401, { error: "Not signed in" });
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });

  const q = req.query || {};
  const showId = q.show ? String(q.show) : null;

  /* Two gates, and which one applies depends on whether a show was named.
     Note the order: the unscoped feed is refused to anyone who is not an
     admin BEFORE any read happens, so a show-scoped token cannot learn the
     size of the feed from a timing difference or an error shape. */
  if (showId) {
    if (!canAccessShow(p, showId)) return json(res, 403, { error: "Not allowed" });
  } else if (!isAdmin(p)) {
    return json(res, 403, { error: "Admin only" });
  }

  let limit = parseInt(String(q.limit || ""), 10);
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  try {
    const path = "/activity?select=" + COLS +
      (showId ? "&show_id=eq." + encodeURIComponent(showId) : "") +
      "&order=at.desc&limit=" + limit;

    const rows = await supabaseRest("GET", path, null);

    return json(res, 200, {
      entries: (rows || []).map((r) => ({
        id: r.id,
        at: r.at,
        kind: r.kind,
        summary: r.summary,
        showId: r.show_id || null,
        /* Null actor is not an error and is not "Unknown": it is the shared
           admin password, or the scheduler. The UI says so in words. */
        actor: r.actor || null,
        meta: (r.meta && typeof r.meta === "object") ? r.meta : {},
      })),
    });
  } catch (e) {
    /* The one failure worth naming. Until sql/setup-activity.sql has been run
       this table does not exist, and PostgREST's own words for that are not
       something anybody should have to decode off a blank panel. */
    const msg = String((e && e.message) || "");
    if (/does not exist|relation .*activity/i.test(msg) || e.status === 404) {
      return json(res, 503, {
        error: "The activity log has not been set up yet. Run sql/setup-activity.sql in Supabase.",
        setup: true,
      });
    }
    return json(res, e.status || 500, { error: e.message || "Server error" });
  }
}
