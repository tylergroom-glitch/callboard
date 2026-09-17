// /api/send-scheduled — the cron that sends messages whose time has come.
//
//   GET /api/send-scheduled          the real run (needs the CRON_SECRET header)
//   GET /api/send-scheduled?dry=1    admin only: what WOULD go, and to how many.
//                                    Sends nothing, claims nothing, changes
//                                    nothing.
//
// Both need a header. There is no path that sends and skips the secret —
// without that this is a public URL that emails thirty-five people on demand.
// Same two-ways-in shape as api/nudge.js.
//
// SETUP: run sql/setup-activity.sql, then add to vercel.json:
//   { "path": "/api/send-scheduled", "schedule": "*/5 * * * *" }
// Vercel invokes crons ONLY on production deployments, and vercel.json must be
// at the REPOSITORY ROOT.
//
// ---------------------------------------------------------------------------
// EXACTLY ONCE, AND WHY IT IS NOT "AT LEAST ONCE"
//
//   Every row is CLAIMED before it is sent:
//
//     PATCH /scheduled_messages?id=eq.X&status=eq.pending  -> {status:'sending'}
//
//   Postgres serialises that update. Two overlapping cron runs both issue it;
//   one changes a row and gets it back, the other changes nothing and gets an
//   empty array, and the loser moves on. The claim is the lock.
//
//   A row left in 'sending' is a run that died mid-flight — the function was
//   killed, or Brevo took the batch and the response never came back. It is
//   NOT retried and it is NOT swept up on the next run.
//
//   That is a deliberate choice, and the reasoning is worth keeping: nobody
//   here can tell whether Brevo accepted the batch before the process died.
//   Retrying is a coin flip between "sent late" and "sent twice", and sending
//   thirty-five people the same packet twice is the outcome that costs Tyler
//   something. So the row stops, the composer shows it as stuck, and a human
//   who can actually check an inbox decides.
//
// WHAT IT SENDS
//   The packet is built HERE, now, from the show as it stands at this moment —
//   never stored at schedule time. And the recipient list is re-applied as a
//   FILTER over the show's current crew, so somebody taken off the show on
//   Wednesday does not get Thursday's packet. Both live in api/_send.js,
//   shared with the Send button, so the two cannot drift.
import { json, auth, isAdmin, supabaseRest, logActivity } from "./_lib.js";
import { loadShow, deliverMessage, audience, applyFilter, str, PacketError } from "./_send.js";

/* How many to send in one cron run. A cap rather than a queue: the function
   has a wall-clock limit, and a run that is killed halfway leaves claimed rows
   nobody will retry (see above). Anything not sent this tick goes on the next
   one five minutes later, which is well inside what "scheduled for 9am" means. */
const BATCH = 5;

const COLS = "id,show_id,subject,message,sections,recipients,send_at,status,created_by";

async function finish(id, patch) {
  try {
    await supabaseRest("PATCH", "/scheduled_messages?id=eq." + encodeURIComponent(id),
      patch, "return=minimal");
  } catch (e) {
    /* The mail has already gone. Failing to write the outcome is bad — the row
       stays 'sending' and shows as stuck — but it is not a reason to throw,
       because throwing here would abandon the rest of the batch too. */
    console.log("[send-scheduled] could not record outcome for " + id + ": " + ((e && e.message) || e));
  }
}

export default async function handler(req, res) {
  const q = req.query || {};
  const dry = q.dry === "1" || q.dry === "true";

  if (dry) {
    if (!isAdmin(auth(req))) return json(res, 403, { error: "Admin only" });
  } else {
    const secret = process.env.CRON_SECRET;
    const header = req.headers.authorization || "";
    if (!secret || header !== "Bearer " + secret) {
      return json(res, 401, { error: "Unauthorized" });
    }
  }

  const nowIso = new Date().toISOString();

  let due;
  try {
    due = await supabaseRest("GET",
      "/scheduled_messages?select=" + COLS +
      "&status=eq.pending&send_at=lte." + encodeURIComponent(nowIso) +
      "&order=send_at.asc&limit=" + BATCH, null);
  } catch (e) {
    const msg = String((e && e.message) || "");
    if (e.status === 404 || /does not exist|relation .*scheduled_messages/i.test(msg)) {
      return json(res, 200, { ok: true, skipped: "scheduled_messages table not set up" });
    }
    return json(res, e.status || 500, { error: e.message || "Server error" });
  }

  if (!due || !due.length) return json(res, 200, { ok: true, sent: 0, due: 0 });

  /* ---- dry run: look, do not touch ------------------------------------ */
  if (dry) {
    const out = [];
    for (const row of due) {
      const show = await loadShow(row.show_id).catch(() => null);
      const data = (show && show.data && typeof show.data === "object") ? show.data : {};
      const { withEmail, withoutEmail } = audience(data);
      const { chosen, rejected } = applyFilter(withEmail, row.recipients);
      out.push({
        id: row.id,
        show: show ? str(show.name || data.name, 200) : "(show not found)",
        subject: row.subject,
        sendAt: row.send_at,
        wouldSendTo: chosen.length,
        noEmail: withoutEmail,
        /* Named, because "3 people on the stored list are no longer on this
           show" is the single most useful thing a dry run can tell you. */
        noLongerOnShow: rejected,
        sections: Array.isArray(row.sections) ? row.sections : [],
      });
    }
    return json(res, 200, { ok: true, dryRun: true, due: due.length, messages: out });
  }

  /* ---- the real run --------------------------------------------------- */
  let sentCount = 0;
  const results = [];

  for (const row of due) {
    /* THE CLAIM. Everything below only runs for a row this process won. */
    let claimed = null;
    try {
      const rows = await supabaseRest("PATCH",
        "/scheduled_messages?id=eq." + encodeURIComponent(row.id) + "&status=eq.pending",
        { status: "sending", claimed_at: new Date().toISOString() },
        "return=representation");
      claimed = (rows && rows[0]) || null;
    } catch (e) {
      console.log("[send-scheduled] claim failed for " + row.id + ": " + ((e && e.message) || e));
    }
    if (!claimed) {
      /* Another run got there first, or it was cancelled between the read and
         the claim. Both are correct outcomes, not errors. */
      results.push({ id: row.id, skipped: "already claimed or cancelled" });
      continue;
    }

    try {
      const show = await loadShow(row.show_id);
      if (!show) throw new Error("The show this message belongs to no longer exists.");
      const data = (show.data && typeof show.data === "object") ? show.data : {};

      const result = await deliverMessage({
        show, data,
        subject: row.subject,
        message: row.message || "",
        sections: Array.isArray(row.sections) ? row.sections : [],
        recipients: row.recipients,
        /* No token: nobody is at the keyboard. The name of whoever scheduled
           it goes in so the sentence can say so — and `system` is what keeps
           it OUT of the actor column, because they did not do this, they
           asked for it days ago. Drop `system` and a 6am automatic send is
           recorded as though Tyler sat down and pressed the button. */
        actorName: row.created_by || "",
        p: null, system: true, scheduled: true,
      });

      sentCount += result.sent;
      await finish(row.id, { status: "sent", sent_at: new Date().toISOString(), result });
      results.push({ id: row.id, sent: result.sent, failed: (result.failed || []).length });
    } catch (e) {
      const why = e instanceof PacketError
        ? e.message
        : ((e && e.message) || "Send failed");
      console.log("[send-scheduled] " + row.id + " failed: " + ((e && e.stack) || e));
      await finish(row.id, {
        status: "failed",
        sent_at: new Date().toISOString(),
        result: { error: String(why).slice(0, 500) },
      });
      /* Worth a feed entry: a scheduled send that failed is invisible
         otherwise — there is no screen anybody was looking at when it
         happened. */
      await logActivity(null, "message.failed",
        "Scheduled message failed to send: " + str(row.subject, 120),
        { showId: row.show_id, system: true });
      results.push({ id: row.id, error: String(why).slice(0, 200) });
    }
  }

  return json(res, 200, { ok: true, due: due.length, sent: sentCount, messages: results });
}
