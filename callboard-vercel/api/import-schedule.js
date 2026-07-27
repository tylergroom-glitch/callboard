// POST /api/import-schedule
// Accepts { text: "<pasted agenda>" }  OR  { pdf: "<base64 string>" }
// Passes it to the Claude API, which returns a structured daily schedule:
//   { days: [ { label, date, items: [ { time, activity } ] } ] }
//
// Reuses ANTHROPIC_API_KEY (already set for the quote importer). No new env vars.
import { json, readBody, auth } from "./_lib.js";

const PROMPT = `You are parsing an event agenda / run-of-show into a structured daily schedule for an AV production team.

Return ONLY a valid JSON object — no markdown fences, no explanation, no other text.

JSON structure:
{
  "days": [
    {
      "label": "Short day label, e.g. 'Monday — Load-in' or 'Show Day' or 'General Session'",
      "date": "YYYY-MM-DD, or empty string if the agenda does not clearly state a date",
      "items": [
        { "time": "8:00 AM", "activity": "Crew call / load-in" }
      ]
    }
  ]
}

RULES:
- Group lines under the day/date they belong to. If the agenda has no separate days, put everything in ONE day with label "Schedule" and date "".
- "time": the clock time for that line, normalized to a readable format like "8:00 AM", "5:30 PM", or 24-hour "13:30" if that's how the source is written. If a line has a time range, use the start time. If a line has no time, use "".
- "activity": the description of what happens at that time. Keep it concise but complete.
- Preserve the original chronological order of lines within each day.
- Only set "date" if the agenda clearly states an actual calendar date; otherwise use "".
- Do not invent items. Only include what is in the agenda.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  const p = auth(req);
  if (!p) return json(res, 401, { error: "Not signed in" });

  if (!process.env.ANTHROPIC_API_KEY) {
    return json(res, 500, {
      error: "ANTHROPIC_API_KEY is not set. Add it to your Vercel environment variables.",
    });
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { error: "Bad request body" });
  }

  const hasText = typeof body.text === "string" && body.text.trim().length > 0;
  const hasPdf = typeof body.pdf === "string" && body.pdf.length > 0;
  if (!hasText && !hasPdf) return json(res, 400, { error: "Paste an agenda or upload a PDF." });

  const content = hasPdf
    ? [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: body.pdf } },
        { type: "text", text: PROMPT },
      ]
    : [{ type: "text", text: PROMPT + "\n\n═══ AGENDA ═══\n" + body.text.slice(0, 40000) }];

  try {
    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-opus-4-6",
        max_tokens: 4096,
        messages: [{ role: "user", content }],
      }),
    });

    if (!apiRes.ok) {
      const err = await apiRes.json().catch(() => ({}));
      return json(res, 502, { error: "Claude API error: " + (err?.error?.message || apiRes.status) });
    }

    const data = await apiRes.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return json(res, 502, { error: "Could not parse the agenda. Try cleaning it up or pasting plain text." });
    }

    if (!Array.isArray(parsed.days)) {
      return json(res, 502, { error: "Unexpected response structure. Try again." });
    }

    // sanitize
    const days = parsed.days
      .map((d) => ({
        label: String(d.label || "Schedule").slice(0, 120),
        date: /^\d{4}-\d{2}-\d{2}$/.test(d.date || "") ? d.date : "",
        items: Array.isArray(d.items)
          ? d.items.map((it) => ({
              time: String(it.time || "").slice(0, 40),
              activity: String(it.activity || "").slice(0, 500),
            }))
          : [],
      }))
      .filter((d) => d.items.length || d.label);

    return json(res, 200, { days });
  } catch (e) {
    return json(res, 500, { error: e.message || "Server error" });
  }
}
