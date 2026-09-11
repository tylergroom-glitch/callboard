// ---------------------------------------------------------------------------
// Touchstone Command — Telegram bot (round 22)
//
//   POST /api/telegram     Telegram webhook (setWebhook points here)
//
// This is a TRANSPORT, not a second agent. It unwraps Telegram's envelope and
// calls the same runTurn / confirmPending / cancelPending that the in-app Ask
// panel and the SMS channel use, so there is exactly one place where the agent
// decides anything, and exactly one place where a write is gated.
//
// ---- how a caller is proved -----------------------------------------------
// setWebhook takes a `secret_token`; Telegram then sends it back on every
// request as X-Telegram-Bot-Api-Secret-Token. That is the same shared-secret
// model the email channel runs on, but in a header rather than a URL, so it
// cannot leak through a proxy log or a browser history.
//
// The secret proves the request came from Telegram. It says nothing about WHO
// is talking, so the allowlist still decides that — by numeric Telegram user
// id, which a sender cannot choose for themselves the way a caller ID can be
// spoofed.
//
// ---- sessions --------------------------------------------------------------
// A thread is keyed by chat, and by forum topic where there is one:
//
//   tg:<chat_id>              a direct message, or a plain group
//   tg:<chat_id>:<thread_id>  one topic inside a forum supergroup
//
// So a Telegram group per show, or a topic per show, becomes its own
// conversation with its own history and its own pending change, with no UI to
// build on our side. /new clears the thread you are standing in.
// ---------------------------------------------------------------------------

import crypto from "crypto";
import { supabaseRest } from "./_lib.js";
import { runTurn, confirmPending, cancelPending, resetThread } from "./agent.js";

const SETTINGS_KEY = "inbox_settings";
const API = "https://api.telegram.org/bot";

/* Length-safe comparison. A plain === on a secret leaks how much of it you got
   right through timing, and this endpoint is public by necessity. */
function sameSecret(a, b) {
  const x = Buffer.from(String(a || ""), "utf8");
  const y = Buffer.from(String(b || ""), "utf8");
  if (x.length !== y.length || x.length === 0) return false;
  return crypto.timingSafeEqual(x, y);
}

async function loadSettings() {
  try {
    const rows = await supabaseRest(
      "GET", "/app_settings?key=eq." + SETTINGS_KEY + "&select=value", null);
    const v = rows && rows[0] ? rows[0].value : null;
    return { telegramIds: Array.isArray(v && v.telegramIds) ? v.telegramIds : [] };
  } catch (e) { return null; }   // null means "could not check" — fails closed
}

/* Ids are numeric and compared as strings, exactly. There is deliberately no
   fuzzy matching here: unlike a phone number there is only one way to write a
   Telegram id, so anything clever would only widen the door. */
function senderAllowed(userId, ids) {
  const me = String(userId || "").trim();
  if (!me) return false;
  return ids.some((x) => String(x || "").trim() === me);
}

/* Telegram caps a message at 4096 characters. Longer than that is a sign the
   answer wanted to be a screen, not a text, so it is cut rather than split. */
function clip(s) {
  const t = String(s == null ? "" : s);
  return t.length > 3900 ? t.slice(0, 3890) + "\n…" : t;
}

async function tg(method, body) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const r = await fetch(API + token + "/" + method, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return await r.json();
  } catch (e) {
    console.log("[telegram] " + method + " failed: " + ((e && e.message) || e));
    return null;
  }
}

/* A pending change gets buttons. Typed yes/no still works — a watch reply or a
   client that will not render a keyboard must not be a dead end — but tapping
   is unambiguous in a way that a stray "yes" three messages later is not. */
function replyMarkup(pending) {
  if (!pending) return undefined;
  return {
    inline_keyboard: [[
      { text: "✅ Confirm", callback_data: "ok" },
      { text: "✖️ Cancel", callback_data: "no" },
    ]],
  };
}

async function say(chatId, threadId, text, pending) {
  const body = { chat_id: chatId, text: clip(text) };
  if (threadId) body.message_thread_id = threadId;
  const markup = replyMarkup(pending);
  if (markup) body.reply_markup = markup;
  return tg("sendMessage", body);
}

const partyOf = (chatId, threadId) =>
  "tg:" + chatId + (threadId ? ":" + threadId : "");

const YES = /^(y|ye|yes|yep|yeah|ok|okay|do it|go|confirm|please do)[.!]?$/;
const NO = /^(n|no|nope|cancel|nvm|never mind|nevermind)[.!]?$/;

const HELP = [
  "Touchstone Command.",
  "",
  "Ask me things — \"what's on the Acme pull list\", \"what's outstanding\",",
  "\"what's on my to-do list\" — or tell me to add something and I'll ask",
  "before I change anything.",
  "",
  "/new — start this conversation over",
  "/help — this message",
  "",
  "In a group, add me to a topic per show and each one keeps its own thread.",
].join("\n");

// ---------------------------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).end(); return; }

  if (!sameSecret(req.headers["x-telegram-bot-api-secret-token"],
                  process.env.TELEGRAM_SECRET)) {
    res.status(401).end();
    return;
  }

  const update = req.body || {};

  /* Telegram retries anything that is not answered with a 2xx, and a retry of
     a message that already ran would run it twice. So every path below ends in
     a 200 once the update has been taken responsibility for. */
  const done = () => { res.status(200).json({ ok: true }); };

  const cb = update.callback_query;
  const msg = update.message || update.edited_message;

  // ---- a button was tapped -------------------------------------------------
  if (cb) {
    const from = cb.from || {};
    const chat = (cb.message || {}).chat || {};
    const threadId = (cb.message || {}).message_thread_id || null;
    const settings = await loadSettings();
    if (!settings) { res.status(503).end(); return; }
    if (!senderAllowed(from.id, settings.telegramIds)) {
      await tg("answerCallbackQuery", { callback_query_id: cb.id });
      return done();
    }
    // Stop the button's spinner before doing the work, which may take seconds.
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    const party = partyOf(chat.id, threadId);
    let out;
    try {
      out = cb.data === "ok"
        ? await confirmPending({ channel: "telegram", party })
        : await cancelPending({ channel: "telegram", party });
    } catch (e) {
      out = { reply: "Something went wrong at my end — try again in a minute." };
    }
    /* The buttons are removed from the original message so an old proposal
       cannot be confirmed twice by scrolling back to it. */
    try {
      await tg("editMessageReplyMarkup", {
        chat_id: chat.id,
        message_id: (cb.message || {}).message_id,
        reply_markup: { inline_keyboard: [] },
      });
    } catch (e) { /* cosmetic only */ }
    await say(chat.id, threadId, out.reply || "…", out.pending);
    return done();
  }

  // ---- an ordinary message -------------------------------------------------
  if (!msg || typeof msg.text !== "string") return done();

  const from = msg.from || {};
  const chat = msg.chat || {};
  const threadId = msg.message_thread_id || null;
  const text = msg.text.slice(0, 4000).trim();
  if (!text) return done();

  const settings = await loadSettings();
  if (!settings) { res.status(503).end(); return; }

  /* An unknown sender gets silence and a 200 — the same rule as email and SMS.
     Saying "you are not authorised" tells a stranger the bot is real and that
     there is a list worth getting onto. The id is logged so that adding
     yourself is a matter of reading the log rather than guessing. */
  if (!senderAllowed(from.id, settings.telegramIds)) {
    console.log("[telegram] ignored message from id=" + from.id +
                " (" + (from.username || "no username") + ") — not on the allowlist");
    return done();
  }

  const party = partyOf(chat.id, threadId);
  const cmd = text.split(/\s+/)[0].split("@")[0].toLowerCase();

  if (cmd === "/start" || cmd === "/help") {
    await say(chat.id, threadId, HELP, null);
    return done();
  }
  if (cmd === "/new") {
    try { await resetThread("telegram", party); } catch (e) { /* nothing to clear */ }
    await say(chat.id, threadId, "Cleared. What do you need?", null);
    return done();
  }

  let out;
  try {
    const t = text.toLowerCase();
    if (YES.test(t)) out = await confirmPending({ channel: "telegram", party });
    else if (NO.test(t)) out = await cancelPending({ channel: "telegram", party });
    else out = await runTurn({ channel: "telegram", party, message: text });
  } catch (e) {
    out = { reply: "Something went wrong at my end — try again in a minute." };
  }

  await say(chat.id, threadId, out.reply || "…", out.pending);
  return done();
}
