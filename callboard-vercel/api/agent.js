// /api/agent — the thing you talk to.
//
//   POST /api/agent            { message, threadId? }   say something
//   POST /api/agent?confirm=1  { threadId }             do the pending change
//   POST /api/agent?cancel=1   { threadId }             drop it
//   POST /api/agent?reset=1    { threadId }             start again
//   GET  /api/agent            ?threadId=               read a thread back
//
// Admin only, both here and over SMS — the SMS side reuses runTurn() with the
// sender's number as the party, and that number has to be on the same
// allowlist the inbox uses.
//
// THE SAFETY MODEL, in one line: read tools run, write tools do not.
//
// When the model asks to change something, nothing is changed. The intended
// change is written to the thread's `pending` column, described in plain words,
// and handed back for a yes. Confirming is the only code path that writes to a
// show. This holds however the model was persuaded to call the tool — a client
// email full of instructions cannot do more than make you read a question.
//
// SETUP: run setup-agent.sql. Needs ANTHROPIC_API_KEY. Model is configurable
// with AGENT_MODEL.
import { json, readBody, auth, isAdmin, supabaseRest } from "./_lib.js";
import { READ_TOOLS, WRITE_TOOLS, ALL_SPECS, makeCtx, todayLocal } from "./agent-tools.js";

const MODEL = process.env.AGENT_MODEL || "claude-haiku-4-5-20251001";
// Enough for a tool call, a look, a second look and an answer. Beyond this it
// is looping rather than working, and each pass costs money and latency.
const MAX_STEPS = 6;
// Keep the last N messages. A texting thread would otherwise grow forever, and
// the model does not need last Tuesday to answer today.
const KEEP = 24;

const SYSTEM = `You are the assistant inside Touchstone Command, the production management app for Touchstone Creative Group, a corporate AV company. You are talking to Tyler, who owns it.

Today is ${"{{TODAY}}"}.

How to behave:
- Be brief. This is often read on a phone, on a loading dock. Two or three sentences, not paragraphs. No preamble, no restating the question.
- When the user names a show, call list_shows and match it. Never guess an id.
- Look before you act. Before adding gear, call get_pull_list so you can say whether it is already there and put it in a sensible case rather than making a duplicate.
- Ask when it matters. If a request is ambiguous in a way that would change what you do — which show, how many, which case — ask one short question rather than assuming. If it is ambiguous in a way that does not matter, get on with it.
- You cannot change anything on your own. Calling a write tool asks the user's permission; it does not do the thing. Say what you are about to do in the same message, and do not claim it is done.
- Never invent a show, a piece of gear, a number or a date. If you do not know, say so and offer to look.
- Money is fine to discuss — you are only ever talking to an owner.`;

/* ---------------------------------------------------------------------------
   Threads
--------------------------------------------------------------------------- */
async function loadThread(channel, party) {
  const rows = await supabaseRest(
    "GET",
    "/agent_threads?channel=eq." + encodeURIComponent(channel) +
    "&party=eq." + encodeURIComponent(party) + "&select=*&limit=1",
    null
  );
  if (rows && rows[0]) return rows[0];
  const made = await supabaseRest("POST", "/agent_threads",
    { channel, party, messages: [], pending: null }, "return=representation");
  return Array.isArray(made) ? made[0] : made;
}

async function saveThread(id, patch) {
  await supabaseRest("PATCH", "/agent_threads?id=eq." + encodeURIComponent(id),
    { ...patch, updated_at: new Date().toISOString() });
}

/* Anthropic requires that a tool_use block is answered by a tool_result in the
   very next message. Trimming blindly can cut between the two and every later
   request 400s, so drop from the front only as far as the next clean user turn. */
function trim(messages) {
  if (messages.length <= KEEP) return messages;
  let cut = messages.length - KEEP;
  while (cut < messages.length) {
    const m = messages[cut];
    const isPlainUser = m.role === "user" &&
      (typeof m.content === "string" || !(m.content || []).some((c) => c.type === "tool_result"));
    if (isPlainUser) break;
    cut++;
  }
  return messages.slice(cut);
}

async function callModel(messages) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { error: "The assistant is not configured — ANTHROPIC_API_KEY is missing." };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctl.signal,
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1200,
        system: SYSTEM.replace("{{TODAY}}", todayLocal()),
        tools: ALL_SPECS,
        messages,
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return { error: "The assistant could not be reached (" + r.status + ").", detail: detail.slice(0, 300) };
    }
    return { data: await r.json() };
  } catch (e) {
    return { error: e.name === "AbortError" ? "That took too long — try again." : "The assistant could not be reached." };
  } finally {
    clearTimeout(timer);
  }
}

const textOf = (content) =>
  (content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();

/* ---------------------------------------------------------------------------
   One turn: the user says something, we run read tools until the model has an
   answer, and stop the moment it reaches for a write.
--------------------------------------------------------------------------- */
export async function runTurn({ channel, party, message }) {
  const thread = await loadThread(channel, party);
  const ctx = makeCtx();
  let messages = trim((thread.messages || []).concat([{ role: "user", content: String(message).slice(0, 8000) }]));

  for (let step = 0; step < MAX_STEPS; step++) {
    const out = await callModel(messages);
    if (out.error) {
      await saveThread(thread.id, { messages });
      return { threadId: thread.id, reply: out.error, pending: null, error: true };
    }
    const msg = out.data;
    messages = messages.concat([{ role: "assistant", content: msg.content }]);

    const calls = (msg.content || []).filter((c) => c.type === "tool_use");
    if (!calls.length) {
      await saveThread(thread.id, { messages, pending: null });
      return { threadId: thread.id, reply: textOf(msg.content) || "…", pending: null };
    }

    // A write anywhere in this batch stops the turn. We do not run the reads
    // alongside it and we do not run the write at all.
    const write = calls.find((c) => WRITE_TOOLS[c.name]);
    if (write) {
      const tool = WRITE_TOOLS[write.name];
      let says = null;
      try { says = await tool.describe(ctx, write.input || {}); } catch (e) { says = null; }
      if (!says) {
        // It described something that does not exist — usually an unresolvable
        // show. Feed that back rather than asking the user about nonsense.
        messages = messages.concat([{
          role: "user",
          content: [{ type: "tool_result", tool_use_id: write.id, content: "That show could not be found. Call list_shows and use an exact id.", is_error: true }],
        }]);
        continue;
      }
      const pending = { tool: write.name, input: write.input || {}, says, at: new Date().toISOString() };
      // The tool_use block is dropped from history deliberately: it was never
      // answered with a tool_result, and leaving it would break the next call.
      const history = messages.slice(0, -1).concat([{ role: "assistant", content: (textOf(msg.content) || says) }]);
      await saveThread(thread.id, { messages: history, pending });
      return { threadId: thread.id, reply: textOf(msg.content) || says, pending };
    }

    const results = [];
    for (const c of calls) {
      const tool = READ_TOOLS[c.name];
      let content;
      try {
        content = tool ? String(await tool.run(ctx, c.input || {})) : "No such tool.";
      } catch (e) {
        content = "That lookup failed: " + ((e && e.message) || "error");
      }
      results.push({ type: "tool_result", tool_use_id: c.id, content: content.slice(0, 12000) });
    }
    messages = messages.concat([{ role: "user", content: results }]);
  }

  await saveThread(thread.id, { messages });
  return { threadId: thread.id, reply: "I went round in circles on that one — try asking it a different way.", pending: null };
}

export async function confirmPending({ channel, party }) {
  const thread = await loadThread(channel, party);
  const p = thread.pending;
  if (!p) return { threadId: thread.id, reply: "There's nothing waiting to be confirmed.", pending: null };
  const tool = WRITE_TOOLS[p.tool];
  if (!tool) {
    await saveThread(thread.id, { pending: null });
    return { threadId: thread.id, reply: "That request is no longer valid.", pending: null };
  }
  let said;
  try {
    said = await tool.apply(makeCtx(), p.input || {});
  } catch (e) {
    return { threadId: thread.id, reply: "That didn't save: " + ((e && e.message) || "error"), pending: p, error: true };
  }
  const messages = (thread.messages || []).concat([
    { role: "user", content: "Confirmed." },
    { role: "assistant", content: said },
  ]);
  await saveThread(thread.id, { messages, pending: null });
  return { threadId: thread.id, reply: said, pending: null, applied: true };
}

export async function cancelPending({ channel, party }) {
  const thread = await loadThread(channel, party);
  const messages = (thread.messages || []).concat([
    { role: "user", content: "No, don't do that." },
    { role: "assistant", content: "Left it alone." },
  ]);
  await saveThread(thread.id, { messages, pending: null });
  return { threadId: thread.id, reply: "Left it alone.", pending: null };
}

/* ---------------------------------------------------------------------------
   HTTP
--------------------------------------------------------------------------- */
export default async function handler(req, res) {
  const q = req.query || {};
  const p = auth(req);
  if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
  const party = String((p && p.sub) || "admin");

  if (req.method === "GET") {
    const t = await loadThread("app", party);
    return json(res, 200, { threadId: t.id, messages: t.messages || [], pending: t.pending || null });
  }
  if (req.method !== "POST") { res.status(405).end(); return; }

  if (q.reset) {
    const t = await loadThread("app", party);
    await saveThread(t.id, { messages: [], pending: null });
    return json(res, 200, { threadId: t.id, messages: [], pending: null });
  }
  if (q.confirm) return json(res, 200, await confirmPending({ channel: "app", party }));
  if (q.cancel) return json(res, 200, await cancelPending({ channel: "app", party }));

  const body = await readBody(req);
  const message = String((body && body.message) || "").trim();
  if (!message) return json(res, 400, { error: "Say something." });
  return json(res, 200, await runTurn({ channel: "app", party, message }));
}
