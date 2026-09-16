// /api/show-message — message everyone on a show, with a PDF packet attached.
//
//   POST ?show=<id>&preview=1   build the packet and hand it back, send nothing
//   POST ?show=<id>             build it and send it
//
//   body: { subject, message, sections: [...], to: ["email", ...] }
//
// ---------------------------------------------------------------------------
// THE RULE THIS FILE IS BUILT AROUND
//
//   WHO CAN BE EMAILED IS DECIDED HERE, FROM THE SHOW, NEVER FROM THE REQUEST.
//
//   `to` is a FILTER over the show's own crew list, not an address book. An
//   address that is not on the show is dropped, silently as far as the caller
//   is concerned and loudly in the response. Without that, an authenticated
//   admin token turns this endpoint into an open relay that sends mail from
//   Touchstone's domain to anywhere — which is a deliverability problem, a
//   reputation problem, and somebody else's spam complaint.
//
//   Same shape as the `crewId` check in call-ack.js: the request may choose
//   among things the server already knows, and may not introduce new ones.
// ---------------------------------------------------------------------------
//
// WHY THE PDF IS BUILT HERE AND NOT IN THE BROWSER
//   Every other PDF in this app is stamped client-side. That cannot serve a
//   scheduled send, and two builders that must agree is how a packet starts
//   differing depending on who pressed what. See the header of _pdf.js.
//
// SETUP: needs BREVO_API_KEY, which already exists. No new SQL.
import { json, readBody, auth, canManageShow, supabaseRest,
         sendBrevoBatch, stripShowForRole } from "./_lib.js";
import { buildPacket, SECTION_KEYS, SECTIONS } from "./_packet.js";

/* Brevo takes 20MB per request INCLUDING the base64 attachment, which is
   about a third bigger than the bytes. Vercel caps a function response at
   4.5MB, which is what bounds the preview. Both are refused in words rather
   than failing as a 500 somebody has to guess at. */
const MAX_PDF_BYTES = 6 * 1024 * 1024;        // ~8MB base64, well inside Brevo
const MAX_PREVIEW_BYTES = 3 * 1024 * 1024;    // ~4MB base64, inside Vercel

const str = (v, n) => String(v === null || v === undefined ? "" : v).trim().slice(0, n);
const emailKey = (v) => String(v || "").trim().toLowerCase();

const esc = (v) => String(v === null || v === undefined ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const BUSINESS_TZ = "America/Los_Angeles";
function stampNow() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ, day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit",
  }).format(new Date());
}

async function loadShow(id) {
  const rows = await supabaseRest(
    "GET", "/shows?id=eq." + encodeURIComponent(id) + "&select=id,name,client,start_date,end_date,data", null);
  return (rows && rows[0]) || null;
}

/* Everyone on this show who can actually be emailed, plus everyone who cannot.
   Both halves are returned: "sent to 9 people" is only useful next to "and 3
   have no email address on the crew list". */
function audience(showData) {
  const crew = (showData && Array.isArray(showData.crew) ? showData.crew : [])
    .filter((c) => c && str(c.name, 200));
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
    withEmail.push({ email: key, name: str(c.name, 200), position: str(c.position, 120) });
  }
  return { withEmail, withoutEmail };
}

function bodyHtml({ showName, message, sections, stamp, pages }) {
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
    '<p style="font-size:12px;color:#777;margin:18px 0 0;border-top:1px solid #e5e5e5;padding-top:12px">' +
    "This packet is a snapshot as of " + esc(stamp) +
    ". Open Crew Call for the current version.</p></div>";
}

export default async function handler(req, res) {
  const p = auth(req);
  if (!p) return json(res, 401, { error: "Not signed in" });
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  const q = req.query || {};
  const showId = q.show ? String(q.show) : null;
  const preview = q.preview === "1" || q.preview === "true";
  if (!showId) return json(res, 400, { error: "show required" });
  if (!canManageShow(p, showId)) return json(res, 403, { error: "Not allowed" });

  try {
    const b = await readBody(req);
    const subject = str(b && b.subject, 200);
    const message = str(b && b.message, 8000);
    if (!preview && !subject) return json(res, 400, { error: "A subject is required." });

    const sections = (Array.isArray(b && b.sections) ? b.sections : [])
      .map((x) => str(x, 40))
      .filter((x) => SECTION_KEYS.includes(x));
    if (!sections.length && !message) {
      return json(res, 400, { error: "Write a message, or tick at least one section to attach." });
    }

    const show = await loadShow(showId);
    if (!show) return json(res, 404, { error: "Show not found" });
    const data = (show.data && typeof show.data === "object") ? show.data : {};
    const showName = str(show.name || data.name, 200) || "Show";

    const { withEmail, withoutEmail } = audience(data);

    /* The filter, not an address book. */
    const asked = Array.isArray(b && b.to) ? b.to.map(emailKey).filter(Boolean) : null;
    const chosen = asked ? withEmail.filter((c) => asked.includes(c.email)) : withEmail;
    const rejected = asked ? asked.filter((a) => !withEmail.some((c) => c.email === a)) : [];

    const stamp = stampNow();
    let packet = null;
    if (sections.length) {
      packet = await buildPacket(data, sections, {
        title: showName + " - Crew Packet",
        subtitle: [str(show.client || data.client, 120),
                   str((data.venue || {}).name, 160)].filter(Boolean).join("   |   "),
        stamp,
      });
      const cap = preview ? MAX_PREVIEW_BYTES : MAX_PDF_BYTES;
      if (packet.bytes.length > cap) {
        return json(res, 413, {
          error: "That packet came to " + Math.round(packet.bytes.length / 1024) +
                 " KB, which is too big to " + (preview ? "preview" : "email") +
                 ". Untick a section or two and try again.",
        });
      }
    }

    const base64 = packet ? Buffer.from(packet.bytes).toString("base64") : null;
    const fileName = showName.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-") + "-packet.pdf";

    if (preview) {
      /* Sends nothing. This is what Tyler looks at before thirty-five people
         get it, and the whole reason the endpoint has two modes. */
      return json(res, 200, {
        preview: true,
        pdf: base64, fileName,
        pages: packet ? packet.pages : 0,
        sections: packet ? packet.sections : [],
        wouldSendTo: chosen.map((c) => ({ email: c.email, name: c.name })),
        noEmail: withoutEmail,
        rejected,
      });
    }

    if (!chosen.length) {
      return json(res, 400, {
        error: withEmail.length
          ? "Nobody was selected."
          : "Nobody on this show's crew list has an email address.",
        noEmail: withoutEmail,
      });
    }

    const html = bodyHtml({
      showName, message,
      sections: packet ? packet.sections : [],
      stamp, pages: packet ? packet.pages : 0,
    });

    const { sent, failed } = await sendBrevoBatch(
      chosen.map((c) => ({ to: c.email, toName: c.name, subject, html })),
      packet ? { attachment: [{ content: base64, name: fileName }] } : {},
    );

    return json(res, 200, {
      sent, failed,
      pages: packet ? packet.pages : 0,
      sections: packet ? packet.sections : [],
      noEmail: withoutEmail,
      /* Named, not counted. An address that was asked for and not sent to is
         the one thing somebody needs to see. */
      rejected,
    });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || "Server error" });
  }
}
