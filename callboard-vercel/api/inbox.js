// /api/inbox — the way things get in without you typing them.
//
//   POST /api/inbox?k=<INBOX_SECRET>   Brevo inbound parsing  (forwarded email)
//
// EMAIL is capture. You forward a client's message and it becomes an item
// waiting to be confirmed. One way, no reply, no conversation.
//
// SMS was removed in v1.29.0. It never delivered a single outbound message —
// the A2P campaign was rejected twice and Twilio blocked every reply at the
// carrier boundary with error 30034 — and Telegram now does the conversational
// half properly. If it ever comes back, it comes back as its own endpoint
// rather than a second branch in here.
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
//   INBOX_SECRET        required. Any long random string; it goes in the Brevo
//                       webhook URL as ?k=...
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

async function loadSettings() {
  try {
    const rows = await supabaseRest("GET", "/app_settings?key=eq." + SETTINGS_KEY + "&select=value", null);
    const v = rows && rows[0] ? rows[0].value : null;
    return { senders: Array.isArray(v && v.senders) ? v.senders : [] };
  } catch (e) { return null; }   // null means "could not check" — fails closed below
}

/* Compared whole and lowercased. The loose last-ten-digits phone matching that
   used to live here went with SMS; a saved phone number simply never matches
   now, which is the correct answer rather than a silent half-working one. */
function senderAllowed(from, senders) {
  const raw = String(from || "").trim().toLowerCase();
  if (!raw) return false;
  return senders.some((s) => String(s || "").trim().toLowerCase() === raw);
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
    return replyOk(res);
  }

  // ---- capture, before anything clever ------------------------------------
  const fallbackTitle =
    (msg.subject && !/^(fwd?|re)\s*:/i.test(msg.subject) ? msg.subject : "") ||
    firstMeaningfulLine(msg.body) ||
    msg.subject ||
    "Forwarded email";

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

  return replyOk(res);
}

/* Brevo just wants a 2xx. */
function replyOk(res) {
  return json(res, 200, { ok: true });
}
