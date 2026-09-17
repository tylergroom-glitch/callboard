// /api/show-message — message everyone on a show, with a PDF packet attached.
//
//   POST ?show=<id>&preview=1    build the packet and hand it back, send nothing
//   POST ?show=<id>              build it and send it now
//   POST ?show=<id>              ...or, with `sendAt` in the body, schedule it
//   GET  ?show=<id>&history=1    what has been sent and what is waiting to go
//   POST ?show=<id>&cancel=<id>  call back a scheduled message before it goes
//
//   body: { subject, message, sections: [...], to: ["email", ...], sendAt }
//
// ---------------------------------------------------------------------------
// THE RULE THIS FILE IS BUILT AROUND
//
//   WHO CAN BE EMAILED IS DECIDED FROM THE SHOW, NEVER FROM THE REQUEST.
//
//   `to` is a FILTER over the show's own crew list, not an address book. An
//   address that is not on the show is dropped, silently as far as the caller
//   is concerned and loudly in the response. Without that, an authenticated
//   admin token turns this endpoint into an open relay that sends mail from
//   Touchstone's domain to anywhere — which is a deliverability problem, a
//   reputation problem, and somebody else's spam complaint.
//
//   The rule and the machinery both live in api/_send.js now, because
//   /api/send-scheduled has to obey them identically.
// ---------------------------------------------------------------------------
//
// WHAT A SCHEDULED MESSAGE ACTUALLY STORES
//   The instruction, not the email. Subject, body, which sections to attach,
//   which people to filter to — and NOT the PDF. A packet built on Monday and
//   sent on Thursday is a Monday packet: the schedule moved, two people were
//   swapped, the pull list grew, and the crew would be holding a document that
//   disagrees with the app with no way to know it. It is built fresh at send
//   time. That is the whole reason this is worth having.
//
// SETUP: needs BREVO_API_KEY, which already exists.
//        Scheduling needs sql/setup-activity.sql and a cron on
//        /api/send-scheduled. Sending now works without either.
import { json, readBody, auth, canManageShow, supabaseRest, logActivity } from "./_lib.js";
import { SECTIONS } from "./_packet.js";
import {
  str, stampNow, cleanSections, loadShow, audience, applyFilter,
  makePacket, packetFileName, deliverMessage, PacketError,
  MAX_PREVIEW_BYTES,
} from "./_send.js";

/* How far ahead a message may be scheduled. Not a technical limit — a
   sanity one. A send set for 2031 is a typo, and finding out in 2031 is
   not a recovery. */
const MAX_AHEAD_DAYS = 120;

/* The dispatcher runs on a cron, so a message can only go at a cron tick.
   Scheduling something for 90 seconds from now would sit there looking broken
   until the next run. Below this, it is refused with the reason. */
const MIN_AHEAD_MS = 5 * 60 * 1000;

const SCHED_COLS = "id,show_id,subject,message,sections,recipients,send_at,status," +
                   "created_at,created_by,sent_at,result";

const label = (key) => (SECTIONS.find((x) => x.key === key) || {}).label || key;

/* A stored row, as the composer wants to read it. Note `recipients` goes out
   as a count, not a list: the history panel is a record of what happened, and
   nobody needs thirty-five addresses rendered into it. */
function schedOut(r) {
  return {
    id: r.id,
    subject: r.subject,
    message: r.message || "",
    sections: (Array.isArray(r.sections) ? r.sections : []).map(label),
    sectionKeys: Array.isArray(r.sections) ? r.sections : [],
    to: Array.isArray(r.recipients) ? r.recipients.length : null,
    sendAt: r.send_at,
    status: r.status,
    createdAt: r.created_at,
    createdBy: r.created_by || null,
    sentAt: r.sent_at || null,
    result: (r.result && typeof r.result === "object") ? r.result : null,
  };
}

/* The table is only there once the SQL has been run. Everything that touches
   it says so in words rather than showing a blank panel or a raw PostgREST
   message about a relation. */
function notSetUp(e) {
  const msg = String((e && e.message) || "");
  return e && (e.status === 404 || /does not exist|relation .*scheduled_messages/i.test(msg));
}

export default async function handler(req, res) {
  const p = auth(req);
  if (!p) return json(res, 401, { error: "Not signed in" });

  const q = req.query || {};
  const showId = q.show ? String(q.show) : null;
  if (!showId) return json(res, 400, { error: "show required" });
  if (!canManageShow(p, showId)) return json(res, 403, { error: "Not allowed" });

  const preview = q.preview === "1" || q.preview === "true";
  const history = q.history === "1" || q.history === "true";
  const cancelId = q.cancel ? String(q.cancel) : null;

  if (req.method === "GET") {
    if (!history) return json(res, 405, { error: "Method not allowed" });
    try {
      const rows = await supabaseRest("GET",
        "/scheduled_messages?select=" + SCHED_COLS +
        "&show_id=eq." + encodeURIComponent(showId) +
        "&order=send_at.desc&limit=50", null);
      return json(res, 200, { messages: (rows || []).map(schedOut) });
    } catch (e) {
      if (notSetUp(e)) return json(res, 200, { messages: [], setup: true });
      return json(res, e.status || 500, { error: e.message || "Server error" });
    }
  }

  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  /* Read ONCE. readBody consumes the request stream, so a second call returns
     nothing — which is the kind of bug that looks like "the name is sometimes
     missing" and takes an hour to find. */
  let b = null;
  try { b = await readBody(req); } catch { b = null; }
  const actorName = str(b && b.actorName, 120);

  /* ---- call one back -------------------------------------------------- */
  if (cancelId) {
    try {
      /* Conditional on BOTH the show and the status. Scoping to the show stops
         a manager of show A cancelling show B's message with a guessed id;
         scoping to 'pending' stops a cancel racing a send that has already
         started and reporting success for mail that is on its way out. */
      const rows = await supabaseRest("PATCH",
        "/scheduled_messages?id=eq." + encodeURIComponent(cancelId) +
        "&show_id=eq." + encodeURIComponent(showId) + "&status=eq.pending",
        { status: "cancelled" }, "return=representation");
      if (!rows || !rows.length) {
        return json(res, 409, {
          error: "That message is no longer waiting to go — it has already been sent, or cancelled.",
        });
      }
      await logActivity(p, "message.cancelled",
        "Scheduled message cancelled: " + str(rows[0].subject, 120),
        { showId, actorName });
      return json(res, 200, { cancelled: true, message: schedOut(rows[0]) });
    } catch (e) {
      if (notSetUp(e)) return json(res, 503, { error: "Scheduling has not been set up yet." });
      return json(res, e.status || 500, { error: e.message || "Server error" });
    }
  }

  try {
    const subject = str(b && b.subject, 200);
    const message = str(b && b.message, 8000);
    if (!preview && !subject) return json(res, 400, { error: "A subject is required." });

    const sections = cleanSections(b && b.sections);
    if (!sections.length && !message) {
      return json(res, 400, { error: "Write a message, or tick at least one section to attach." });
    }

    const show = await loadShow(showId);
    if (!show) return json(res, 404, { error: "Show not found" });
    const data = (show.data && typeof show.data === "object") ? show.data : {};
    const showName = str(show.name || data.name, 200) || "Show";

    const { withEmail, withoutEmail } = audience(data);
    const { chosen, rejected } = applyFilter(withEmail, b && b.to);

    /* ---- preview: sends nothing --------------------------------------- */
    if (preview) {
      const packet = await makePacket({
        show, data, sections, stamp: stampNow(), cap: MAX_PREVIEW_BYTES,
      });
      return json(res, 200, {
        preview: true,
        pdf: packet ? Buffer.from(packet.bytes).toString("base64") : null,
        fileName: packetFileName(showName),
        pages: packet ? packet.pages : 0,
        sections: packet ? packet.sections : [],
        wouldSendTo: chosen.map((c) => ({ email: c.email, name: c.name })),
        noEmail: withoutEmail,
        rejected,
      });
    }

    /* ---- schedule ------------------------------------------------------ */
    const sendAtRaw = str(b && b.sendAt, 40);
    if (sendAtRaw) {
      const when = new Date(sendAtRaw);
      if (!Number.isFinite(when.getTime())) {
        return json(res, 400, { error: "That send time could not be read." });
      }
      const ms = when.getTime() - Date.now();
      if (ms < MIN_AHEAD_MS) {
        return json(res, 400, {
          error: "Scheduled sends are checked every few minutes, so pick a time at " +
                 "least 5 minutes out — or send it now.",
        });
      }
      if (ms > MAX_AHEAD_DAYS * 24 * 60 * 60 * 1000) {
        return json(res, 400, { error: "That is more than " + MAX_AHEAD_DAYS + " days away." });
      }
      /* Refused now rather than at send time. A message scheduled to nobody
         fails silently in a cron run at 6am, which is the worst possible
         moment to discover it. */
      if (!chosen.length) {
        return json(res, 400, {
          error: withEmail.length
            ? "Nobody was selected."
            : "Nobody on this show's crew list has an email address.",
          noEmail: withoutEmail,
        });
      }
      /* The packet is NOT built here. It is built at send time, from the show
         as it stands then. But it IS tested here, so a packet that cannot be
         built is refused while somebody is looking at the screen rather than
         at 6am on Thursday. The bytes are thrown away. */
      await makePacket({ show, data, sections, stamp: stampNow(), cap: MAX_PREVIEW_BYTES });

      try {
        const rows = await supabaseRest("POST", "/scheduled_messages", {
          show_id: showId,
          subject, message, sections,
          /* Stored as asked. Re-applied as a filter at send time. */
          recipients: Array.isArray(b && b.to) ? chosen.map((c) => c.email) : null,
          send_at: when.toISOString(),
          created_by: actorName || null,
          creator_id: (p && typeof p.sub === "string") ? p.sub : null,
        }, "return=representation");
        const row = (rows && rows[0]) || null;
        await logActivity(p, "message.scheduled",
          "Message scheduled for " + showName + ": " + subject,
          { showId, actorName, meta: { sendAt: when.toISOString(), to: chosen.length } });
        return json(res, 200, {
          scheduled: true,
          message: row ? schedOut(row) : null,
          willSendTo: chosen.length,
          noEmail: withoutEmail,
          rejected,
        });
      } catch (e) {
        if (notSetUp(e)) {
          return json(res, 503, {
            error: "Scheduling has not been set up yet. Run sql/setup-activity.sql in Supabase. " +
                   "Sending now still works.",
            setup: true,
          });
        }
        throw e;
      }
    }

    /* ---- send now ------------------------------------------------------ */
    const result = await deliverMessage({
      show, data, subject, message, sections,
      recipients: b && b.to, p, actorName,
    });
    return json(res, 200, result);
  } catch (e) {
    if (e instanceof PacketError) {
      console.log("[show-message] packet build failed for show " + showId + ": " +
                  ((e.cause && e.cause.stack) || e.cause || ""));
      return json(res, 500, {
        error: e.message + " Untick sections one at a time to find which one, " +
               "and send me that — the message itself will still go out with no attachment.",
      });
    }
    return json(res, e.status || 500, {
      error: e.message || "Server error",
      ...(e.noEmail ? { noEmail: e.noEmail } : {}),
    });
  }
}
