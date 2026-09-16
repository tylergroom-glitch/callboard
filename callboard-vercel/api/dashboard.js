// /api/dashboard — the parts of the Today screen that would otherwise be N+1.
//
//   GET /api/dashboard        admin only
//
// WHAT THIS IS FOR, AND WHAT IT DELIBERATELY IS NOT
//
//   Today already loads tasks, billing, shows, crew documents and new-crew
//   alerts, each in its own request with its own error state, so one dead
//   endpoint greys out one panel instead of the page. That is a rule worth
//   keeping and this endpoint does NOT replace it.
//
//   It serves only the things Today could not get cheaply: how ready each show
//   is, which pipeline stage it is on, and what the open pipeline is worth.
//   The Pipeline board works those out client-side by fetching every show's
//   full record one at a time, plus every won quote — fine for a screen you
//   open now and then, and unacceptable on the landing page.
//
//   So the server does the gathering, and it does it with THE SAME maths, from
//   api/_pipe.js, that the Pipeline board uses. Two copies is how one screen
//   says 78% and another says 66%.
//
// ADMIN ONLY. It spans every show, which is exactly what a show-scoped manager
// must not receive — same reasoning as /api/costing?all=1.
import { json, auth, isAdmin, supabaseRest } from "./_lib.js";
import { PIPE_MILESTONES, PIPE_TOTAL, pipeDone, pipeCurrent } from "./_pipe.js";

const BUSINESS_TZ = "America/Los_Angeles";
/* The business day, not the server's. Everything dated in this app is a
   calendar day in Pacific; a server in UTC thinks it is tomorrow from late
   afternoon onwards, which would tick "Show" a day early every evening. */
function businessToday() {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  return p; // en-CA formats as YYYY-MM-DD
}

const str = (v) => String(v === null || v === undefined ? "" : v).trim();
const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v || "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/* A position held open: a crew row with a job on it and nobody in it. That is
   what the crew editor produces when you block out the shape of a crew before
   you have booked anyone, so it is the honest definition of "unfilled" rather
   than a new field to maintain. */
function crewCounts(data) {
  const rows = (data && Array.isArray(data.crew) ? data.crew : []).filter((c) => c && typeof c === "object");
  let named = 0, unfilled = 0;
  for (const c of rows) {
    if (str(c.name)) named += 1;
    else if (str(c.position)) unfilled += 1;
  }
  return { named, unfilled };
}

export default async function handler(req, res) {
  const p = auth(req);
  if (!p) return json(res, 401, { error: "Not signed in" });
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
  if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });

  const today = businessToday();

  try {
    /* Two reads for the whole dashboard. The show `data` blob is read here and
       never leaves the server — only the counts derived from it go out, which
       is what keeps this response small enough to be a landing page. */
    const [showRows, quoteRows] = await Promise.all([
      supabaseRest("GET", "/shows?select=id,name,client,start_date,end_date,data&order=start_date.asc.nullslast", null),
      supabaseRest("GET", "/quotes?select=id,event_id,version,status,sent_at,total,data&order=version.desc", null),
    ]);

    /* Newest version per show wins, and `order=version.desc` above means the
       first one seen for a show IS the newest. */
    const quoteFor = {};
    let openTotal = 0, openCount = 0;
    for (const q of (quoteRows || [])) {
      if (!q) continue;
      const status = str(q.status);
      /* Open = still being chased. Won is revenue, lost is gone; neither is
         pipeline. */
      if (status !== "won" && status !== "lost") { openTotal += num(q.total); openCount += 1; }
      if (q.event_id && !quoteFor[q.event_id]) {
        quoteFor[q.event_id] = {
          version: q.version, status, sentAt: q.sent_at,
          data: (q.data && typeof q.data === "object") ? { deposits: q.data.deposits } : null,
        };
      }
    }

    const shows = (showRows || []).map((r) => {
      const data = (r.data && typeof r.data === "object") ? r.data : {};
      const row = {
        start: r.start_date, end: r.end_date, data,
        pipe: { milestones: (data.pipeline && data.pipeline.milestones) || {} },
      };
      const done = pipeDone(row, quoteFor[r.id], today);
      const n = PIPE_MILESTONES.reduce((s, [k]) => s + (done[k] ? 1 : 0), 0);
      return {
        id: r.id,
        name: str(r.name || data.name) || "Untitled",
        client: str(r.client || data.client),
        venue: str((data.venue || {}).name),
        start: r.start_date || "",
        end: r.end_date || "",
        ready: { done: n, total: PIPE_TOTAL, pct: Math.round((n / PIPE_TOTAL) * 100) },
        done,
        current: pipeCurrent(done),
        crew: crewCounts(data),
      };
    });

    return json(res, 200, {
      today,
      shows,
      pipeline: { openTotal: Math.round(openTotal), openCount },
      /* Totals the front end would otherwise recompute from the same rows. */
      unfilled: shows.reduce((s, x) => s + x.crew.unfilled, 0),
    });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || "Server error" });
  }
}
