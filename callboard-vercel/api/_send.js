// Building and sending a crew message. ONE definition, two callers.
//
// WHY THIS IS ITS OWN FILE
//   /api/show-message sends when Tyler presses Send. /api/send-scheduled
//   sends when the clock says so. They must produce the SAME email — same
//   audience rules, same packet, same footer, same refusals — or "schedule
//   it" quietly becomes a second, subtly different feature that nobody
//   tests and that disagrees with the one people have looked at.
//
//   Same reasoning as api/_pipe.js, which exists because a readiness figure
//   computed in two places is a readiness figure you cannot trust.
//
// THE RULE THE WHOLE FILE IS BUILT AROUND, RESTATED
//
//   WHO CAN BE EMAILED IS DECIDED FROM THE SHOW, NEVER FROM THE CALLER.
//
//   `recipients` is a FILTER over the show's own crew list, not an address
//   book. This matters more here than it did in the route, because a
//   scheduled row sits in a table for days before it is used: if the stored
//   list were treated as an address book, a row written on Monday would still
//   be emailing somebody on Thursday who was taken off the show on Tuesday.
//   Re-filtering at send time is what makes "remove them from the show" mean
//   what it looks like it means.
import { supabaseRest, sendBrevoBatch, logActivity } from "./_lib.js";
import { buildPacket, SECTION_KEYS } from "./_packet.js";
import { ackLink, APP_ORIGIN } from "./_call.js";

/* Brevo takes 20MB per request INCLUDING the base64 attachment, which is
   about a third bigger than the bytes. Vercel caps a function response at
   4.5MB, which is what bounds the preview. */
export const MAX_PDF_BYTES = 6 * 1024 * 1024;
export const MAX_PREVIEW_BYTES = 3 * 1024 * 1024;

export const str = (v, n) => String(v === null || v === undefined ? "" : v).trim().slice(0, n);
export const emailKey = (v) => String(v || "").trim().toLowerCase();

const esc = (v) => String(v === null || v === undefined ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const BUSINESS_TZ = "America/Los_Angeles";

export function stampNow(at) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ, day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit",
  }).format(at ? new Date(at) : new Date());
}

export function cleanSections(list) {
  return (Array.isArray(list) ? list : [])
    .map((x) => str(x, 40))
    .filter((x) => SECTION_KEYS.includes(x));
}

export async function loadShow(id) {
  const rows = await supabaseRest(
    "GET", "/shows?id=eq." + encodeURIComponent(id) + "&select=id,name,client,start_date,end_date,data", null);
  return (rows && rows[0]) || null;
}

/* Everyone on this show who can actually be emailed, plus everyone who cannot.
   Both halves are returned: "sent to 9 people" is only useful next to "and 3
   have no email address on the crew list". */
export function audience(showData) {
  const crew = (showData && Array.isArray(showData.crew) ? showData.crew : [])
    .filter((c) => c && typeof c === "object" && str(c.name, 200));
  const withEmail = [];
  const withoutEmail = [];
  const seen = new Set();
  for (const c of crew) {
    const key = emailKey(c.email);
    if (!key) { withoutEmail.push(str(c.name, 200)); continue; }
    /* One person can hold two positions on a show — two crew rows, one human.
       Emailing them the same packet twice is a small thing that makes the app
       look broken. */
    if (seen.has(key)) continue;
    seen.add(key);
    /* `id` rides along now because each person's "Got it" link is signed for
       their crew id. Note it is the FIRST of their rows that wins: one human
       holding two positions gets one email and confirms once, which is what
       the dedupe above already decided. */
    withEmail.push({ id: str(c.id, 100), email: key, name: str(c.name, 200), position: str(c.position, 120) });
  }
  return { withEmail, withoutEmail };
}

/* The filter. Returns who is actually being written to, and which requested
   addresses were dropped because they are not on this show. */
export function applyFilter(withEmail, requested) {
  const asked = Array.isArray(requested) ? requested.map(emailKey).filter(Boolean) : null;
  return {
    chosen: asked ? withEmail.filter((c) => asked.includes(c.email)) : withEmail,
    rejected: asked ? asked.filter((a) => !withEmail.some((c) => c.email === a)) : [],
  };
}

/* `ackUrl` is one person's signed "Got it" link, so this is now built PER
   RECIPIENT rather than once for the batch. Everything else in it is the same
   for everybody; only the button differs. */
export function bodyHtml({ showName, message, sections, stamp, pages, ackUrl }) {
  const lines = String(message || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const paras = lines.length
    ? lines.map((p) => '<p style="font-size:15px;line-height:1.6;margin:0 0 14px">' +
        esc(p).replace(/\n/g, "<br>") + "</p>").join("")
    : "";
  const list = sections.length
    ? '<ul style="font-size:14px;line-height:1.7;color:#444;margin:0 0 16px;padding-left:20px">' +
      sections.map((s) => "<li>" + esc(s) + "</li>").join("") + "</ul>"
    : "";
  return '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px">' +
    '<h1 style="font-size:19px;margin:0 0 4px">' + esc(showName) + "</h1>" +
    paras +
    (sections.length
      ? '<p style="font-size:14px;margin:0 0 6px;color:#444"><b>Attached (' + pages +
        " page" + (pages === 1 ? "" : "s") + "):</b></p>" + list
      : "") +
    /* THE CONFIRMATION BUTTON.
       A link, not a form — an email client will not post one. It lands on a
       page that confirms on arrival, so this is one tap and done; the page
       still carries a button for anything that cannot run its script. The
       write is never the GET. See the block comment in api/call-ack.js for why
       that distinction is the whole design. */
    (ackUrl
      ? '<div style="margin:22px 0 4px"><a href="' + esc(ackUrl) + '" ' +
        'style="display:inline-block;background:#111;color:#fff;text-decoration:none;' +
        'font-size:16px;font-weight:600;padding:13px 26px;border-radius:9px">Confirm receipt</a>' +
        '<p style="font-size:12px;color:#888;margin:8px 0 0">' +
        "One tap &mdash; it confirms as soon as the page opens.</p></div>"
      : "") +
    '<p style="font-size:12px;color:#777;margin:18px 0 0;border-top:1px solid #e5e5e5;padding-top:12px">' +
    "This packet is a snapshot as of " + esc(stamp) +
    '. Open <a href="' + esc(APP_ORIGIN) + '" style="color:#555">Touchstone Command</a> ' +
    "for the latest and greatest.</p></div>";
}

/* A packet-build failure, named.
   The show `data` blob has been written by every version of this app there
   has ever been, so this is the one step that can fail on a record nobody has
   touched in a year. It is thrown as a typed error rather than bubbling as an
   anonymous 500, because "which section" is the only clue that narrows it
   down without going to the logs. */
export class PacketError extends Error {
  constructor(sections, cause) {
    super("The attachment could not be built from this show's records (" +
          sections.join(", ") + ").");
    this.name = "PacketError";
    this.sections = sections;
    this.cause = cause;
  }
}

export async function makePacket({ show, data, sections, stamp, cap }) {
  if (!sections.length) return null;
  let packet;
  try {
    packet = await buildPacket(data, sections, {
      title: str(show.name || data.name, 200) + " - Crew Packet",
      subtitle: [str(show.client || data.client, 120),
                 str((data.venue || {}).name, 160)].filter(Boolean).join("   |   "),
      stamp,
    });
  } catch (e) {
    throw new PacketError(sections, e);
  }
  if (packet.bytes.length > cap) {
    const e = new Error("That packet came to " + Math.round(packet.bytes.length / 1024) +
                        " KB, which is too big to send. Untick a section or two and try again.");
    e.status = 413;
    throw e;
  }
  return packet;
}

export function packetFileName(showName) {
  return String(showName).replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-") + "-packet.pdf";
}

/* ---------------------------------------------------------------------------
   THE SEND ITSELF.

   Everything above is shared with preview; this is the part that actually puts
   mail in the world, and it is called from exactly two places.

   `p` is the token of whoever is responsible — a real admin for Send now,
   null for the scheduler, which is why logActivity is told `system` in that
   case rather than being handed a fabricated actor.
--------------------------------------------------------------------------- */
export async function deliverMessage({ show, data, subject, message, sections, recipients, p, actorName, system, scheduled, msgId, ackRequired }) {
  const showName = str(show.name || data.name, 200) || "Show";
  const stamp = stampNow();

  const { withEmail, withoutEmail } = audience(data);
  const { chosen, rejected } = applyFilter(withEmail, recipients);

  if (!chosen.length) {
    const e = new Error(withEmail.length
      ? "Nobody was selected."
      : "Nobody on this show's crew list has an email address.");
    e.status = 400;
    e.noEmail = withoutEmail;
    throw e;
  }

  const packet = await makePacket({ show, data, sections, stamp, cap: MAX_PDF_BYTES });
  const base64 = packet ? Buffer.from(packet.bytes).toString("base64") : null;
  const fileName = packetFileName(showName);

  /* ONE BODY PER PERSON, because the confirm link is signed for one crew id.
     sendBrevoBatch already sends a messageVersion per recipient, each with its
     own htmlContent, so this costs nothing extra on the wire — the packet
     still uploads once, at the top level, for the whole batch.

     THREE THINGS CAN TAKE THE BUTTON AWAY, and they are not the same thing:

       ackRequired === false — Tyler unticked "Ask for confirmation" on this
         message. Plenty of sends are an FYI, and a confirm button on one
         trains people to ignore it on the ones that matter.

       no crew id — an old show whose crew rows predate ids. Better no button
         than a button that cannot work.

       no msgId — the message row could not be written, usually because the
         table has not been migrated yet. A link without a message id would
         still confirm, but it would file against the call rather than against
         this message, and a confirmation filed under the wrong heading is
         worse than a missing one. See the comment in api/show-message.js. */
  const wantAck = ackRequired !== false && !!msgId;
  const bodyFor = (c) => bodyHtml({
    showName, message,
    sections: packet ? packet.sections : [],
    stamp, pages: packet ? packet.pages : 0,
    ackUrl: (wantAck && c.id) ? ackLink(show.id, c.id, msgId) : "",
  });

  const { sent, failed, reason } = await sendBrevoBatch(
    chosen.map((c) => ({ to: c.email, toName: c.name, subject, html: bodyFor(c) })),
    packet ? { attachment: [{ content: base64, name: fileName }] } : {},
  );

  const result = {
    sent, failed,
    /* WHY it did not go, in Brevo's own words. Without this the screen says
       "1 did not go through" and stops, which is a dead end for whoever is
       looking at it — and the logs were silent too, because the response body
       was never read. */
    ...(reason ? { reason } : {}),
    pages: packet ? packet.pages : 0,
    sections: packet ? packet.sections : [],
    /* Whether a confirm button actually went out. The composer says so, because
       "I unticked it" and "the button silently could not be built" look
       identical from the outside and are not the same problem. */
    ackRequested: wantAck,
    noEmail: withoutEmail,
    /* Named, not counted. An address that was asked for and not sent to is
       the one thing somebody needs to see. */
    rejected,
  };

  /* One line in the feed, composed by hand from names and counts.
     Note what is NOT here: no subject line beyond its own words, no address
     list, no packet. See the rules above logActivity in _lib.js.

     ACTOR vs "SET UP BY", which are not the same person and must not be
     conflated. The actor is who DID this — and for a scheduled send that is
     nobody, so `system` keeps it null. Who arranged it days earlier belongs
     in the sentence, because "this went out on its own, and Tyler is the one
     who asked for it" is two facts and the feed should carry both. */
  await logActivity(p, scheduled ? "message.scheduled-sent" : "message.sent",
    (scheduled ? "Scheduled message sent to " : "Message sent to ") +
    sent + " on " + showName +
    (packet ? " with a " + packet.pages + "-page packet" : "") +
    (failed && failed.length ? " (" + failed.length + " did not go through)" : "") +
    (scheduled && actorName ? " - set up by " + actorName : ""),
    { showId: show.id, actorName, system, meta: { sent, failed: (failed || []).length } });

  return result;
}
