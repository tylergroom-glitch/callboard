// /api/avstudio-access
//
//   POST /api/avstudio-access   { eventId, email, name, note }
//
// Someone looking at a show's AV Studio drawing inside Crew Call asks to be
// allowed to edit it.
//
// WHAT THIS IS NOT
//   It is not single sign-on and it does not grant anything. It files a
//   request. Approving is still a button you press in AV Studio, with the
//   address in front of you. Nothing here can put a name on an editor list.
//
// THE TRUST MODEL, because it is the whole point of the file
//   - Who may ask is decided by Crew Call's own auth: canAccessShow(). Exactly
//     the people who can already see the tab, which by your choice includes
//     crew signed in with a show password.
//   - WHICH PROJECT they are asking about is never sent by the browser. It is
//     read here, server-side, out of the view link stored on the show. A
//     client that could name the project could ask about any project.
//   - The email is self-declared, and that is fine, because it grants nothing.
//     It is a line in a list you read before deciding. It is recorded next to
//     who was signed in when they typed it.
//
// SETUP
//   Run setup-access-bridge.sql on the AV STUDIO Supabase project, then set:
//     AVSTUDIO_SUPABASE_URL   https://xxxx.supabase.co
//     AVSTUDIO_ANON_KEY       its publishable / anon key
//   The anon key is the one safe to hand out — it is already in AV Studio's
//   front end. Never put AV Studio's service key here; nothing in this file
//   needs it and it would turn a request form into a skeleton key.
//
// Without those two variables the endpoint still works: the request is
// recorded in Crew Call and you are still pinged. Only the row in AV Studio's
// own panel is skipped, and the response says so.

import { json, readBody, auth, isAdmin, memberRole, supabaseRest, supabaseProfile, telegramNotify } from "./_lib.js";

const MAX_NOTE = 140;

/* The token out of a stored AV Studio link. Same shape AV Studio itself reads:
   #view=TOKEN, optionally with other hash parameters around it. */
function viewTokenOf(url) {
  const m = /[#&]view=([\w-]+)/.exec(String(url || ""));
  return m ? m[1] : null;
}

function validEmail(s) {
  const e = String(s || "").trim().toLowerCase();
  if (e.length > 254) return null;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}

/* May this person see this show at all — and therefore its AV Studio tab.
 *
 * The same three-way test events.js uses, and it has to be: canAccessShow()
 * alone knows only admins and show-password tokens, so an ordinary account
 * token — which is how nearly everyone signs in now — would be refused. Crew
 * on a show are members of it, and membership lives in show_members. */
async function maySeeShow(p, id) {
  if (isAdmin(p)) return true;                                   // TCG admin, or the admin password
  if (p && p.scope === "show" && p.id === id) return true;        // a show password, if any are still in use
  if (p && p.sub) return !!(await memberRole(p, id));             // an account, on this show's member list
  return false;
}

/* Who Crew Call believes is asking, as opposed to what they typed. */
function askerOf(p) {
  if (!p) return "someone";
  if (p.sub) return p.is_tcg ? "a Touchstone admin" : "a signed-in account";
  if (p.scope === "admin") return "an admin";
  if (p.scope === "show") return p.level === "admin" ? "a show manager" : "crew";
  return "someone";
}

/* The address the request is filed under.
 *
 * Almost everyone signs in to Crew Call with a real account now, which means
 * the server can read their VERIFIED address off the profile. When it can, that
 * address wins and whatever the browser sent is discarded — not as a security
 * measure (nothing here grants anything either way) but because the one failure
 * mode this feature has is an address mismatch: approve jane@gmail.com, she
 * makes her AV Studio account as jane@touchstone.com, and the drawing stays
 * read-only with no error anywhere. A verified address cannot mismatch.
 *
 * The typed field survives only for a token with no account behind it — the
 * admin password, or a show password if any are still in use. */
async function identify(p, typedEmail, typedName) {
  if (p && p.sub) {
    const prof = await supabaseProfile(p.sub).catch(() => null);
    const e = prof && validEmail(prof.email);
    if (e) {
      return {
        email: e,
        name: String((prof && prof.name) || typedName || "").trim().slice(0, 80),
        verified: true,
      };
    }
  }
  return { email: validEmail(typedEmail), name: String(typedName || "").trim().slice(0, 80), verified: false };
}

async function fileInAvStudio(token, email, note, who) {
  const url = process.env.AVSTUDIO_SUPABASE_URL;
  const key = process.env.AVSTUDIO_ANON_KEY;
  if (!url || !key) return { filed: false, reason: "unconfigured" };
  try {
    const r = await fetch(String(url).replace(/\/+$/, "") + "/rest/v1/rpc/request_access_via_link", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: key,
        authorization: "Bearer " + key,
      },
      body: JSON.stringify({ p_token: token, p_email: email, p_note: note || null, p_who: who || null }),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      // A 404 here almost always means the SQL has not been run yet. Say which
      // it is in the log; the caller only ever learns "not filed".
      /* Status only. The body echoes the requester's email address, and a log line
     is a copy of personal data that outlives the request and is readable by
     anyone with Vercel access. The status is what is diagnostically useful. */
    console.log("[avstudio-access] rpc " + r.status);
      return { filed: false, reason: r.status === 404 ? "no-rpc" : "rpc-error" };
    }
    const out = data && typeof data === "object" ? data : {};
    if (out.ok === false) return { filed: false, reason: out.reason || "refused" };
    return { filed: true, already: out.already || null, project: out.project || "" };
  } catch (e) {
    console.log("[avstudio-access] rpc failed: " + ((e && e.message) || e));
    return { filed: false, reason: "unreachable" };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  const p = auth(req);
  if (!p) return json(res, 401, { error: "Sign in first." });

  let body;
  try { body = await readBody(req); } catch { return json(res, 400, { error: "Bad request" }); }

  const eventId = String((body && body.eventId) || "").trim();
  if (!eventId) return json(res, 400, { error: "Which show?" });
  if (!(await maySeeShow(p, eventId))) return json(res, 403, { error: "Not your show." });

  // A profile with no email, or a profile lookup that fails, falls back to the
  // typed address rather than blocking — nothing here grants anything, and the
  // line you read will say "self-declared address" either way. Refusing a
  // signed-in person because their profile row is thin would be the worse bug.
  const me = await identify(p, body && body.email, body && body.name);
  const email = me.email;
  if (!email) return json(res, 400, { error: "That doesn't look like an email address." });
  const name = me.name;
  const note = String((body && body.note) || "").trim().slice(0, MAX_NOTE);

  // --- the show, and the link it holds --------------------------------------
  let show;
  try {
    const rows = await supabaseRest(
      "GET", "/shows?id=eq." + encodeURIComponent(eventId) + "&select=id,name,data&limit=1", null);
    show = rows && rows[0];
  } catch (e) {
    return json(res, 500, { error: "Could not read the show." });
  }
  if (!show) return json(res, 404, { error: "Show not found." });

  const data = typeof show.data === "string" ? (() => { try { return JSON.parse(show.data); } catch { return {}; } })() : (show.data || {});
  const linkUrl = (data.avStudio && data.avStudio.url) || "";
  const token = viewTokenOf(linkUrl);
  if (!token) {
    return json(res, 400, {
      error: "This show has no AV Studio drawing linked yet, so there is nothing to request access to.",
    });
  }

  const showName = show.name || "a show";
  // Whether the address was verified is the single most useful thing on the
  // line you read before approving, so it goes in the line.
  const who = (name ? name + " · " : "") + askerOf(p) +
              (me.verified ? ", verified address" : ", self-declared address") +
              " on " + showName;

  // --- 1. AV Studio's own request panel -------------------------------------
  const av = await fileInAvStudio(token, email, note, who);

  // Already an editor or the owner: the answer is "sign in", not "wait". Say so
  // and file nothing anywhere — this is the single most likely case and turning
  // it into a task you have to dismiss would be a bug, not a feature.
  if (av.filed && (av.already === "editor" || av.already === "owner")) {
    return json(res, 200, {
      status: "already",
      message: "You can already edit this drawing — you just aren't signed in to AV Studio in this browser. Open it in AV Studio and sign in as " + email + ".",
    });
  }
  if (av.filed && av.already === "pending") {
    return json(res, 200, {
      status: "pending",
      message: "You've already asked for this one. Tyler will see it next time he opens AV Studio.",
    });
  }
  if (!av.filed && av.reason === "link") {
    return json(res, 400, {
      error: "That drawing's share link has been revoked or expired, so the request can't be matched to a project. Ask for a new link.",
    });
  }
  if (!av.filed && av.reason === "busy") {
    return json(res, 429, { error: "A lot of people have asked about this show in the last hour. Try again later." });
  }

  // --- 2. Crew Call's own to-do list ----------------------------------------
  // Filed whether or not AV Studio accepted it, and deduped here too, so the
  // request survives the SQL not having been run yet.
  const title = "AV Studio edit access — " + (name || email);
  let dupe = false;
  try {
    const open = await supabaseRest(
      "GET",
      // Only an OPEN one counts as a duplicate. Once you have dealt with a
      // request — approved or dismissed — the same person may ask again.
      "/tasks?kind=eq.avstudio-access&status=eq.open&event_id=eq." + encodeURIComponent(eventId) +
      "&title=eq." + encodeURIComponent(title) + "&select=id&limit=1",
      null);
    dupe = !!(open && open[0]);
  } catch { /* a failed dedupe check must not lose the request */ }

  if (!dupe) {
    try {
      await supabaseRest("POST", "/tasks", {
        title,
        notes: email + " asked to edit the AV Studio drawing on " + showName +
               ".\nAsked as: " + who + (note ? "\nNote: " + note : "") +
               (av.filed
                 ? "\n\nAlso waiting in AV Studio → ☁ Projects. Approve it there."
                 : "\n\nNOT filed in AV Studio (" + av.reason + ") — add " + email +
                   " as an editor from AV Studio → Share."),
        kind: "avstudio-access",
        event_id: eventId,
        status: "open",
        review: true,
        source: "app",
        updated_at: new Date().toISOString(),
      });
    } catch (e) {
      console.log("[avstudio-access] task insert failed: " + ((e && e.message) || e));
    }
  }

  // --- 3. Telegram ----------------------------------------------------------
  if (!dupe) {
    await telegramNotify(
      "🔑 AV Studio edit access\n\n" +
      (name ? name + " (" + email + ")" : email) + "\nShow: " + showName +
      (note ? "\nNote: " + note : "") + "\n\n" +
      (av.filed
        ? "Waiting in AV Studio → ☁ Projects → Approve."
        : "Not filed in AV Studio (" + av.reason + ") — add them from Share.")
    );
  }

  return json(res, 200, {
    status: "sent",
    filedInAvStudio: !!av.filed,
    message: av.filed
      ? "Sent. Once it's approved, sign in to AV Studio as " + email + " and the drawing becomes editable."
      : "Sent to Tyler. Once you're added, sign in to AV Studio as " + email + ".",
  });
}
