// /api/show-message — message everyone on a show, with a PDF packet attached.
//
//   POST ?show=<id>&preview=1    build the packet and hand it back, send nothing
//   POST ?show=<id>              build it and send it now
//   POST ?show=<id>              ...or, with `sendAt` in the body, schedule it
//   GET  ?show=<id>&history=1    what has been sent and what is waiting to go
//   POST ?show=<id>&cancel=<id>  call back a scheduled message before it goes
//
//   body: { subject, message, sections: [...], to: ["email", ...], sendAt,
//           ackRequired }
//
// ---------------------------------------------------------------------------
// EVERY SEND IS A ROW IN scheduled_messages NOW
//
//   Despite the table's name. Send now used to write nothing: it built an
//   email, handed it to Brevo and left one line in the activity feed. That
//   meant two things were impossible — a history of what had actually been
//   sent, and a confirmation that pointed at a particular message rather than
//   at the show in general.
//
//   So Send now writes a row first, with status 'sending', and patches it to
//   'sent' or 'failed' afterwards: the same three states the scheduler uses,
//   meaning the same things. The row's id is what rides in each person's
//   confirm link.
//
//   If that row cannot be written, THE MAIL STILL GOES. What it loses is the
//   confirm button, and the response says so rather than leaving it to look
//   like the box was unticked.
// ---------------------------------------------------------------------------
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

/* `*` rather than a column list, and deliberately.
   A named list means every column added by a migration has to be added here
   too, and if the files are uploaded before the SQL is run PostgREST answers
   400 for a column that does not exist yet — which takes out the history panel
   and, in api/send-scheduled.js, the cron that sends the mail. `*` cannot fail
   that way. The rows are small and schedOut decides what actually leaves the
   server, which is where that decision belongs anyway. */
const SCHED_COLS = "*";

/* How many confirmations to read in one go for the history panel. Thirty-five
   crew across a dozen messages is four hundred rows on a busy show. */
const ACK_SCAN = 2000;

const label = (key) => (SECTIONS.find((x) => x.key === key) || {}).label || key;

/* A stored row, as the composer wants to read it. Note `recipients` goes out
   as a count, not a list: the history panel is a record of what happened, and
   nobody needs thirty-five addresses rendered into it. */
function schedOut(r, acks, crewNow) {
  const res = (r.result && typeof r.result === "object") ? r.result : null;
  const mine = (acks && acks[r.id]) || null;

  /* WHO HAS NOT CONFIRMED — the list Tyler actually acts on.
     "4 of 9" tells him to do something; it does not tell him who to ring. The
     names come from the show's crew list as it stands NOW, filtered by the
     recipient filter this message stored, minus everybody who has confirmed.

     Anyone since taken off the show simply is not in `crewNow` and so cannot
     appear here, which is right: a name on a list of people to chase has to be
     somebody who is still on the job. */
  let pendingBy = null;
  if (crewNow && typeof r.ack_required === "boolean" && r.ack_required && r.status === "sent") {
    const asked = Array.isArray(r.recipients)
      ? r.recipients.map((e) => String(e || "").trim().toLowerCase())
      : null;
    const got = new Set((mine || []).map((a) => a.id).filter(Boolean));
    pendingBy = crewNow
      .filter((c) => (asked ? asked.includes(c.email) : true))
      .filter((c) => !got.has(String(c.id)))
      .map((c) => c.name);
  }

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
    result: res,
    /* Absent on a row written before the migration, which is not the same as
       false: `undefined` lets the composer show nothing rather than claiming
       Tyler unticked a box that did not exist yet. */
    ackRequired: typeof r.ack_required === "boolean" ? r.ack_required : undefined,
    /* WHO CONFIRMED THIS MESSAGE — the whole point of the change.
       The denominator is how many the send actually reached, not how many were
       asked for: "4 of 9" against a send that only got to 7 is a number that
       makes Tyler chase two people who were never emailed. */
    confirmed: mine ? mine.length : 0,
    confirmedBy: mine ? mine.map((a) => ({ name: a.name, at: a.at, via: a.via })) : [],
    ...(pendingBy ? { pendingBy } : {}),
    sentTo: (res && typeof res.sent === "number") ? res.sent
          : (Array.isArray(r.recipients) ? r.recipients.length : null),
  };
}

/* Confirmations for a page of messages, grouped by message id.
   A failure here is not a failure of the history panel: the list of what was
   sent is still worth showing without the confirmation counts on it, so this
   returns an empty map rather than throwing. That covers the window between
   uploading these files and running sql/setup-message-acks.sql, when call_acks
   has no msg_id column to filter on. */
async function acksFor(ids) {
  const out = {};
  if (!ids.length) return out;
  try {
    const rows = await supabaseRest("GET",
      "/call_acks?msg_id=in.(" + ids.map(encodeURIComponent).join(",") + ")" +
      "&select=msg_id,crew_id,crew_name,acked_at,via&order=acked_at.asc&limit=" + ACK_SCAN, null);
    for (const r of rows || []) {
      const k = String(r.msg_id || "");
      if (!k) continue;
      (out[k] = out[k] || []).push({
        id: String(r.crew_id || ""), name: r.crew_name || "", at: r.acked_at, via: r.via || "",
      });
    }
  } catch (e) {
    /* Deliberately silent to the caller. Logged so it is findable. */
    console.log("[show-message] confirmations unavailable: " + ((e && e.message) || e));
  }
  return out;
}

/* The table is only there once the SQL has been run. Everything that touches
   it says so in words rather than showing a blank panel or a raw PostgREST
   message about a relation. */
function notSetUp(e) {
  const msg = String((e && e.message) || "");
  return e && (e.status === 404 || /does not exist|relation .*scheduled_messages/i.test(msg));
}

/* A column the table does not have yet — the files uploaded before the SQL was
   run. PostgREST reports it as PGRST204 with the column named. Told apart from
   a real failure so `ack_required` can be dropped and the insert retried,
   rather than scheduling stopping working until somebody opens Supabase. */
function missingColumn(e) {
  const msg = String((e && e.message) || "");
  return /PGRST204/.test(msg) || /could not find the .*column/i.test(msg) ||
         /column .*ack_required/i.test(msg);
}

/* `creator_id` is a uuid COLUMN and `p.sub` is whatever the sign-in token
   happens to carry. They agree for every real account today, and the schedule
   path has been writing it unguarded for months without trouble.
   It is guarded now because the stakes changed: an id that is not a uuid makes
   the whole insert fail, and the insert is no longer bookkeeping — it is what
   the confirm button hangs off. Losing confirmations on a message that went
   out fine, for a column nothing reads back, is not a trade worth making. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const creatorId = (p) => (p && typeof p.sub === "string" && UUID_RE.test(p.sub)) ? p.sub : null;

async function newMessageRow(row) {
  const put = async (r) => {
    const rows = await supabaseRest("POST", "/scheduled_messages", r, "return=representation");
    return (rows && rows[0]) || null;
  };
  try {
    return await put(row);
  } catch (e) {
    if (!missingColumn(e)) throw e;
    const without = { ...row };
    delete without.ack_required;
    return await put(without);
  }
}

/* Recording the outcome on a row whose mail has already gone.
   Never throws: failing to write "sent" is bad — the row shows as stuck — but
   the email is in the world either way, and turning that into a 500 would tell
   Tyler the send failed when it did not. Same reasoning as `finish` in
   api/send-scheduled.js, and for the same reason it is a separate function. */
async function markRow(id, patch) {
  if (!id) return;
  try {
    await supabaseRest("PATCH", "/scheduled_messages?id=eq." + encodeURIComponent(id),
      patch, "return=minimal");
  } catch (e) {
    console.log("[show-message] could not record outcome for " + id + ": " + ((e && e.message) || e));
  }
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
      const acks = await acksFor((rows || []).map((r) => String(r.id)));
      /* The show is read once for the whole page, not once per message, and a
         failure to read it costs the "still waiting on" names and nothing
         else — the history itself is still worth showing. */
      let crewNow = null;
      try {
        const show = await loadShow(showId);
        const data = (show && show.data && typeof show.data === "object") ? show.data : null;
        if (data) crewNow = audience(data).withEmail;
      } catch (e) {
        console.log("[show-message] crew unavailable for history: " + ((e && e.message) || e));
      }
      return json(res, 200, { messages: (rows || []).map((r) => schedOut(r, acks, crewNow)) });
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

    /* "Ask for confirmation", off the composer. Absent means TRUE, because
       that is what every message sent before this existed did, and a toggle
       that silently changes the behaviour of an older client is a bug waiting
       for the one week somebody has a stale tab open. Only an explicit false
       turns it off. */
    const asked = b && Object.prototype.hasOwnProperty.call(b, "ackRequired") ? b.ackRequired : true;
    const ackRequired = !(asked === false || asked === "false" || asked === 0);

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
        const row = await newMessageRow({
          show_id: showId,
          subject, message, sections,
          /* Stored as asked. Re-applied as a filter at send time. */
          recipients: Array.isArray(b && b.to) ? chosen.map((c) => c.email) : null,
          send_at: when.toISOString(),
          created_by: actorName || null,
          creator_id: creatorId(p),
          ack_required: ackRequired,
        });
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

    /* Checked here rather than left to deliverMessage, which throws the same
       refusal a moment later. The difference is the row below: refusing first
       means a send to nobody does not leave a message row behind claiming
       something went out. */
    if (!chosen.length) {
      return json(res, 400, {
        error: withEmail.length
          ? "Nobody was selected."
          : "Nobody on this show's crew list has an email address.",
        noEmail: withoutEmail,
      });
    }

    /* EVERY SEND GETS A ROW NOW, not just the scheduled ones.
       A confirmation has to point at something. "The message Tyler sent at
       4:12 on Tuesday" was not previously a thing that existed anywhere —
       Send now built an email, handed it to Brevo and wrote one line in the
       activity feed. So there was nothing for a per-message confirmation to
       be filed against, and no history of sent messages either.

       Written BEFORE the send, because its id has to be inside the email. The
       status sequence is the same one the scheduler uses — sending, then sent
       or failed — so a process killed mid-flight leaves a row that reads as
       stuck rather than as sent, and the two paths mean the same thing by the
       same words.

       If the row cannot be written the send STILL GOES. Mail that is wanted
       now does not wait on bookkeeping. What it loses is the confirm button,
       which is said out loud in the response rather than left to look like
       Tyler unticked the box. */
    const nowIso = new Date().toISOString();
    let msgRow = null;
    try {
      msgRow = await newMessageRow({
        show_id: showId,
        subject, message, sections,
        recipients: Array.isArray(b && b.to) ? chosen.map((c) => c.email) : null,
        send_at: nowIso,
        status: "sending",
        claimed_at: nowIso,
        created_by: actorName || null,
        creator_id: creatorId(p),
        ack_required: ackRequired,
      });
    } catch (e) {
      console.log("[show-message] no message row for this send: " + ((e && e.message) || e));
    }
    const msgId = msgRow ? String(msgRow.id) : "";

    let result;
    try {
      result = await deliverMessage({
        show, data, subject, message, sections,
        recipients: b && b.to, p, actorName,
        msgId, ackRequired,
      });
    } catch (e) {
      await markRow(msgId, {
        status: "failed",
        sent_at: new Date().toISOString(),
        result: { error: String((e && e.message) || "Send failed").slice(0, 500) },
      });
      throw e;
    }

    await markRow(msgId, { status: "sent", sent_at: new Date().toISOString(), result });

    return json(res, 200, {
      ...result,
      messageId: msgId || null,
      /* True when confirmations were asked for and the machinery to track them
         is actually in place. False with ackRequired true means the database
         update has not been run yet — which the composer says in words. */
      ackTracked: ackRequired && !!msgId,
    });
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
