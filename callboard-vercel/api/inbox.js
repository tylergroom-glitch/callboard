// /api/inbox — the way things get in without you typing them.
//
//   POST /api/inbox?k=<INBOX_SECRET>   Brevo inbound parsing  (forwarded email)
//   POST /api/inbox                    Twilio SMS webhook     (text message)
//
// The two channels do deliberately different things, because you use them
// differently:
//
//   EMAIL is capture. You forward a client's message and it becomes an item
//   waiting to be confirmed. One way, no reply, no conversation.
//   TEXT is a conversation. It goes to the assistant, which can look things up
//   and answer, and which asks before it changes anything — over SMS that
//   question is just a text you reply "yes" to.
//
// The email half lands a row in `tasks` with review = true, waiting Nothing here ever creates a confirmed task, and
// nothing here ever touches a quote, an invoice or a show. The worst a bad
// message can do is put a line in a list you are going to read anyway.
//
// CAPTURE FIRST, PARSE SECOND. The message is written to the database before
// Claude is called. If the model is down, slow, misconfigured or the key is
// missing, the item is still there with the raw text — you just do the sorting
// yourself. Losing a client's "don't forget to add..." because a model call
// failed would be far worse than filing it under the wrong show.
//
// SETUP: run setup-tasks.sql. Environment variables:
//   INBOX_SECRET        required for email. Any long random string; it goes in
//                       the Brevo webhook URL as ?k=...
//   TWILIO_AUTH_TOKEN   required for SMS. Requests are rejected unless their
//                       X-Twilio-Signature matches.
//   ANTHROPIC_API_KEY   optional. Without it, items still arrive, unparsed.
//   INBOX_MODEL         optional, defaults to claude-haiku-4-5-20251001.
import crypto from "node:crypto";
import { json, supabaseRest } from "./_lib.js";
import { runTurn, confirmPending, cancelPending } from "./agent.js";

const SETTINGS_KEY = "inbox_settings";
const MODEL = process.env.INBOX_MODEL || "claude-haiku-4-5-20251001";
const BUSINESS_TZ = "America/Los_Angeles";
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS_TZ });

/* Length-safe comparison. A plain === on a secret leaks how much of it you
   got right through timing, and this endpoint is public by necessity. */
function sameSecret(a, b) {
  const x = Buffer.from(String(a || ""), "utf8");
  const y = Buffer.from(String(b || ""), "utf8");
  if (x.length !== y.length || x.length === 0) return false;
  return crypto.timingSafeEqual(x, y);
}

/* Twilio signs every request: base64 HMAC-SHA1 over the full URL followed by
   each POST parameter, sorted by name, key and value concatenated. Without
   this the SMS endpoint is an open door for anyone who finds the URL. */
function twilioSignatureValid(req, params) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const given = req.headers["x-twilio-signature"];
  if (!token || !given) return false;
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const url = proto + "://" + req.headers.host + req.url;
  let base = url;
  Object.keys(params).sort().forEach((k) => { base += k + params[k]; });
  const mine = crypto.createHmac("sha1", token).update(Buffer.from(base, "utf8")).digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(mine), Buffer.from(String(given)));
  } catch (e) { return false; }
}

async function loadSettings() {
  try {
    const rows = await supabaseRest("GET", "/app_settings?key=eq." + SETTINGS_KEY + "&select=value", null);
    const v = rows && rows[0] ? rows[0].value : null;
    return { senders: Array.isArray(v && v.senders) ? v.senders : [] };
  } catch (e) { return null; }   // null means "could not check" — fails closed below
}

/* An email is compared whole and lowercased; a phone number by its last ten
   digits, so +15595551234, 15595551234 and (559) 555-1234 all match. */
function senderAllowed(from, senders) {
  const raw = String(from || "").trim().toLowerCase();
  if (!raw) return false;
  const digits = raw.replace(/[^0-9]/g, "");
  return senders.some((s) => {
    const t = String(s || "").trim().toLowerCase();
    if (!t) return false;
    if (t.indexOf("@") >= 0) return t === raw;
    const td = t.replace(/[^0-9]/g, "");
    return td.length >= 10 && digits.length >= 10 && td.slice(-10) === digits.slice(-10);
  });
}

/* Forwarded mail arrives wrapped in headers and quoted text. Take the first
   line that looks like a human wrote it, for the title. */
function firstMeaningfulLine(text) {
  const lines = String(text || "").split(/\r?\n/);
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    if (/^(>|-{3,}|_{3,})/.test(l)) continue;
    if (/^(from|to|cc|bcc|sent|date|subject|reply-to)\s*:/i.test(l)) continue;
    if (/^begin forwarded message/i.test(l)) continue;
    if (l.length < 3) continue;
    return l.slice(0, 300);
  }
  return "";
}

async function askClaude(msg, shows) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const list = shows.slice(0, 120)
    .map((s) => `${s.id}\t${s.name}${s.client ? " (" + s.client + ")" : ""}`).join("\n");
  const prompt =
`You sort incoming messages for a live-event AV company into to-do items.

Today is ${today()}.

The shows on the books, as "id<TAB>name (client)":
${list || "(none)"}

The message:
---
From: ${msg.from}
Subject: ${msg.subject}

${String(msg.body || "").slice(0, 6000)}
---

Reply with ONLY a JSON object, no prose and no code fence:
{
  "title": "short imperative action, under 80 chars, e.g. Add rigging to the Acme quote",
  "event_id": "the id from the list above, or null if it clearly names no show",
  "kind": "quote" | "invoice" | "gear" | "crew" | "admin" | "",
  "due": "YYYY-MM-DD or null — only if the message actually states or clearly implies a date",
  "priority": "high" | "med" | "low" | "",
  "confidence": 0.0 to 1.0
}

Rules: never invent a show that is not listed. If unsure which show, use null.
Never invent a due date. Prefer "" and null over guessing.`;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctl.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const text = ((data.content || []).find((c) => c.type === "text") || {}).text || "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const out = JSON.parse(m[0]);
    // Never trust the model with an id: only ids that are really on the books.
    if (out.event_id && !shows.some((s) => s.id === out.event_id)) out.event_id = null;
    if (out.due && !/^\d{4}-\d{2}-\d{2}$/.test(String(out.due))) out.due = null;
    if (["high", "med", "low"].indexOf(out.priority) < 0) out.priority = "";
    if (["quote", "invoice", "gear", "crew", "admin"].indexOf(out.kind) < 0) out.kind = "";
    out.title = String(out.title || "").trim().slice(0, 300);
    return out;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).end(); return; }
  const body = req.body || {};
  const q = req.query || {};

  // ---- work out the channel, and prove the caller is who they claim --------
  let msg = null;
  if (body && Array.isArray(body.items)) {
    // Brevo inbound parsing. Secured by a secret in the webhook URL.
    if (!sameSecret(q.k, process.env.INBOX_SECRET)) { res.status(401).end(); return; }
    const it = body.items[0] || {};
    msg = {
      channel: "email",
      from: ((it.From || {}).Address || "").toLowerCase(),
      subject: String(it.Subject || "").slice(0, 300),
      // ExtractedMarkdownMessage is Brevo's de-signatured, de-quoted version.
      body: String(it.ExtractedMarkdownMessage || it.RawTextBody || "").slice(0, 40000),
    };
  } else if (body && (body.Body !== undefined || body.MessageSid)) {
    if (!twilioSignatureValid(req, body)) { res.status(401).end(); return; }
    const from = String(body.From || "");
    const text = String(body.Body || "").slice(0, 4000);

    const settingsSms = await loadSettings();
    if (!settingsSms) { res.status(503).end(); return; }
    if (!senderAllowed(from, settingsSms.senders)) return replyOk(res, "sms");

    // A text is a turn in a conversation, not a filing. If something is waiting
    // on a yes, a bare yes or no answers it rather than starting a new topic —
    // which is how anyone actually replies to a question by text.
    let out;
    try {
      const t = text.trim().toLowerCase();
      if (/^(y|ye|yes|yep|yeah|ok|okay|do it|go|confirm|please do)[.!]?$/.test(t)) {
        out = await confirmPending({ channel: "sms", party: from });
      } else if (/^(n|no|nope|cancel|stop|don'?t|never mind|nevermind)[.!]?$/.test(t)) {
        out = await cancelPending({ channel: "sms", party: from });
      } else {
        out = await runTurn({ channel: "sms", party: from, message: text });
      }
    } catch (e) {
      out = { reply: "Something went wrong at my end — try again in a minute." };
    }
    return replySms(res, out.reply || "…");
  } else {
    res.status(400).end(); return;
  }

  // ---- is this someone we take instructions from? -------------------------
  const settings = await loadSettings();
  // Not being able to READ the allowlist is not permission to skip it.
  if (!settings) { res.status(503).end(); return; }
  if (!senderAllowed(msg.from, settings.senders)) {
    // 200, deliberately. Telling an unknown sender that the address is real,
    // or that their message was rejected, is free reconnaissance.
    return replyOk(res, msg.channel);
  }

  // ---- capture, before anything clever ------------------------------------
  const fallbackTitle =
    (msg.subject && !/^(fwd?|re)\s*:/i.test(msg.subject) ? msg.subject : "") ||
    firstMeaningfulLine(msg.body) ||
    msg.subject ||
    (msg.channel === "sms" ? "Text message" : "Forwarded email");

  let row;
  try {
    const made = await supabaseRest("POST", "/tasks", {
      title: fallbackTitle.slice(0, 300),
      notes: "",
      status: "open",
      review: true,
      source: msg.channel,
      source_from: msg.from,
      source_subject: msg.subject,
      source_body: msg.body,
    }, "return=representation");
    row = Array.isArray(made) ? made[0] : made;
  } catch (e) {
    // Nowhere to put it — let the provider retry rather than swallow it.
    res.status(500).end(); return;
  }

  // ---- then have a go at reading it ---------------------------------------
  try {
    let shows = [];
    try { shows = await supabaseRest("GET", "/shows?select=id,name,client", null) || []; } catch (e) { shows = []; }
    const guess = await askClaude(msg, shows);
    if (guess && guess.title) {
      await supabaseRest("PATCH", "/tasks?id=eq." + encodeURIComponent(row.id), {
        title: guess.title,
        event_id: guess.event_id || null,
        kind: guess.kind || "",
        due: guess.due || null,
        priority: guess.priority || "",
        agent: guess,
        updated_at: new Date().toISOString(),
      });
    }
  } catch (e) {
    /* The item is already saved. A failed reading is a worse title, not a lost
       message, so this is deliberately swallowed. */
  }

  return replyOk(res, msg.channel);
}

/* Twilio expects TwiML and will show an error in its console for anything
   else; Brevo just wants a 2xx. An empty <Response/> means "received, say
   nothing back". */
function replyOk(res, channel) {
  if (channel === "sms") {
    res.setHeader("Content-Type", "text/xml");
    res.status(200).send("<Response></Response>");
    return;
  }
  return json(res, 200, { ok: true });
}

/* TwiML, with the assistant's answer in it. A single segment is 160
   characters, so the reply is capped to keep a chatty answer from costing four
   messages. The full conversation is always readable in the app. */
function replySms(res, text) {
  const body = String(text || "").slice(0, 600)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  res.setHeader("Content-Type", "text/xml");
  res.status(200).send("<Response><Message>" + body + "</Message></Response>");
}
