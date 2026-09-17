// api/_call.js — a crew member's call time, and the fingerprint of it.
//
// Underscore: a helper, not a route.
//
// ─────────────────────────────────────────────────────────────────────────────
// THIS FILE IS A MIRROR, AND THAT IS ITS WHOLE RISK
//
// The "Got it" feature stores a confirmation against a FINGERPRINT of the call
// it was given for, so that a confirmation goes stale when the call moves
// rather than quietly claiming someone knows about a call time they have never
// seen. That fingerprint is computed in the browser, in src/App.jsx:
//
//     callFingerprint(shownCall, event) =
//       JSON.stringify([shownCall, firstScheduleDate || event.startDate])
//
// Now the emailed packet carries a "Got it" link too, which means the SERVER
// has to produce that same string. If it differs by so much as a character,
// nothing breaks loudly: the endpoint answers 200, the row is written, and the
// Brief quietly files every email confirmation under "confirmed, but the call
// has moved" — the exact panel Tyler uses to decide who to ring. A wrong
// answer that looks right.
//
// So this is not "a server-side version of the same idea". It is a
// transliteration of three functions from src/App.jsx, kept deliberately
// literal — same comparator, same `||` fallbacks, same String() coercions,
// same JSON.stringify of a two-element array — and the test for it does not
// check it against expectations I wrote. It extracts those three functions
// from src/App.jsx itself and asserts the two implementations agree. A
// hand-written expectation would only ever prove that the server agrees with
// me, which is not the property that matters.
//
// IF YOU CHANGE THE BROWSER'S VERSION, CHANGE THIS ONE. The differential test
// is what will tell you that you forgot.
// ─────────────────────────────────────────────────────────────────────────────

/* Lifted from src/App.jsx.
   Undated days sort AFTER dated ones... no: `if (av) return -1` puts a dated
   day FIRST, so a day with no date sinks. Equal dates return 0, and both V8
   in the browser and V8 in Node sort stably, so ties keep the order they were
   entered in. That stability is load-bearing — two days on the same date with
   different call times would otherwise fingerprint differently depending on
   who sorted them. */
export function schedDaySort(a, b) {
  const av = (a && a.date) || "", bv = (b && b.date) || "";
  if (av && bv) return av < bv ? -1 : av > bv ? 1 : 0;
  if (av) return -1;
  if (bv) return 1;
  return 0;
}

/* The call time actually shown to one crew member.
 *
 * Two places it can come from, and the order matters: their own row wins, and
 * failing that it is the first per-day call time they have in the schedule,
 * reading days in date order. `find(Boolean)` skips days where they have no
 * entry — not the same as taking day one's value, which would be "" for
 * anyone who starts on day two.
 *
 * `data` here is the show's data blob, which is what src/App.jsx calls
 * `event`. Not the `shows` ROW: the row's start_date column and the blob's
 * startDate are different fields and only the blob is what the browser
 * fingerprints. */
export function callFor(crew, data) {
  if (!crew) return "";
  if (crew.callTime) return String(crew.callTime);
  const days = Array.isArray(data && data.schedule) ? [...data.schedule] : [];
  const times = data && data.callTimes;
  return days.sort(schedDaySort)
    .map((day) => (day && times && times[day.id] && times[day.id][crew.id]) || null)
    .find(Boolean) || "";
}

/* Lifted from src/App.jsx.
 *
 * Two things only: the call time, and the day the show starts. Deliberately
 * NOT the venue, the hotel or the position — fixing a typo in an address at
 * 11pm must not un-confirm sixteen people. A confirmation that expires too
 * eagerly gets ignored, and an ignored confirmation is worth the same as none.
 *
 * The array-of-two-strings shape and JSON.stringify are not decoration: this
 * string is compared character for character against ones the browser wrote,
 * so the quoting and the brackets are part of the format. */
export function callFingerprint(shownCall, data) {
  const days = Array.isArray(data && data.schedule) ? data.schedule : [];
  const first = days.length ? [...days].sort(schedDaySort)[0] : null;
  return JSON.stringify([
    String(shownCall || ""),
    String((first && first.date) || (data && data.startDate) || ""),
  ]);
}

/* The one call the rest of the app wants: what this person's confirmation
   should be filed against, given the show as it stands right now. */
export function fingerprintFor(crew, data) {
  return callFingerprint(callFor(crew, data), data);
}

/* ─────────────────────────────────────────────────────────────────────────────
 * THE "GOT IT" LINK THAT RIDES IN THE EMAILED PACKET
 *
 * One signed link per crew member. It carries WHO, not WHAT: the show and the
 * crew id, never the call time or the fingerprint. That is deliberate — if
 * the call moves after the email goes out, the page shows the call as it
 * stands NOW and confirms that. Baking the old call into the link would have
 * someone confirm a time they were never shown, which is the precise lie the
 * fingerprint exists to prevent.
 *
 * The token is the credential; these links are unauthenticated by design,
 * exactly like the rundown share links. It grants one thing and one thing
 * only: confirming that one person's call on that one show. It carries no
 * ability to read the show, and it is not a login.
 * ───────────────────────────────────────────────────────────────────────────── */
import { signToken, verifyToken } from "./_lib.js";

export const ACK_SCOPE = "callack";

/* Ninety days. Long enough that a packet sent for a show three months out
   still works on the day, short enough that a forwarded email does not stay
   live for years. */
export const ACK_TTL_MS = 1000 * 60 * 60 * 24 * 90;

/* WHY A FIXED ORIGIN AND NOT req.headers.host.
   Every other link-minting route in this app builds its origin from the
   request, which is right for a link an admin copies and uses now. This one is
   different: it is posted into an email that sits in someone's inbox for
   weeks. A scheduled send runs from a cron, and a cron's host header is
   whatever deployment answered it — including a preview URL that stops
   existing on the next push. A link built from that would work in testing and
   be dead by the time the crew opened it. */
export const APP_ORIGIN =
  (process.env.APP_ORIGIN || "https://crewcall.touchstonecreativegroup.com")
    .replace(/\/+$/, "");

export function ackToken(showId, crewId) {
  return signToken({
    scope: ACK_SCOPE,
    show: String(showId || ""),
    crew: String(crewId || ""),
    exp: Date.now() + ACK_TTL_MS,
  });
}

export function ackLink(showId, crewId) {
  return APP_ORIGIN + "/api/call-ack?t=" + encodeURIComponent(ackToken(showId, crewId));
}

/* Returns { show, crew } or null. Null covers a forged signature, a token
   minted for something else entirely, an expired one, and one missing either
   half of the identity — the caller does not get to tell those apart, and does
   not need to. */
export function readAckToken(token) {
  const p = verifyToken(token);
  if (!p || p.scope !== ACK_SCOPE) return null;
  const show = String(p.show || "");
  const crew = String(p.crew || "");
  if (!show || !crew) return null;
  return { show, crew };
}
