// POST /api/import-catalog   { pdf: "<base64>" }
//
// Reads a Current RMS (or similar) quote PDF and pulls out one row per
// billable line: name, department, day rate. It does NOT write anything —
// it just hands the rows back so the wizard can show you a preview you can
// fix before anything is saved.
//
// Returns { items: [ { name, department, rate } ] }
//
// SETUP: needs ANTHROPIC_API_KEY in Vercel (you already have it for
// /api/import-quote). Nothing else.
import { json, readBody, auth, isAdmin } from "./_lib.js";

const PROMPT = `You are reading an AV / live-event rental quote PDF in order to build a PRICING CATALOG.

Return ONLY a valid JSON object. No markdown fences, no explanation, no other text.

Shape:
{
  "items": [
    { "name": "Item name exactly as written", "department": "Video", "rate": 125 }
  ]
}

RULES

1. One entry per DISTINCT line item in the quote. If the same item appears in several
   sections, include it ONCE only.

2. "name" — the item description, cleaned up:
   - strip any leading quantity ("4 x Shure SM58" -> "Shure SM58")
   - strip trailing day counts, dates, subtotals or section names
   - keep the make/model wording as written so it stays recognisable

3. "rate" — the PER DAY, PER UNIT price. This is the one to get right:
   - if the quote shows a unit/daily rate column, use that number
   - if it only shows a line total, divide by (quantity x number of days)
   - plain number only. No currency symbol, no commas, no quotes
   - if you genuinely cannot work out a rate, use 0

4. "department" — exactly one of: Audio, Video, Lighting, Power, Scenic, Misc
   - Audio    speakers, amps, mics, consoles, IEM, DI, comms, audio cable
   - Video    cameras, displays, LED wall, switchers, media servers, PTZ,
              playback, projectors, video cable
   - Lighting moving lights, wash, consoles, hazers, dimmers, lighting cable
   - Power    distro, generators, shore power, Soca, power cable
   - Scenic   truss, motors, rigging hardware, staging, drape, pipe and base
   - Misc     expendables, cases, stands, mounts, anything else

5. INCLUDE labor lines (Camera Op, V1, Show Caller, Production Manager, etc).
   Put them in the department that matches the role, or Misc if unclear.
   Their "rate" is the day rate for that role.

6. SKIP entirely: trucking, mileage, freight, travel, per diem, hotel,
   subtotals, taxes, surcharges, discounts, and any total lines.

7. Be exhaustive. Every real billable line should appear. Do not summarise.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  const p = auth(req);
  if (!p) return json(res, 401, { error: "Not signed in" });
  if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });

  if (!process.env.ANTHROPIC_API_KEY)
    return json(res, 500, { error: "ANTHROPIC_API_KEY is not set. Add it in Vercel and redeploy." });

  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { error: "Bad request body" });
  }
  if (!body.pdf) return json(res, 400, { error: "No PDF data provided" });

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
        max_tokens: 8192,
        messages: [
          {
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: body.pdf } },
              { type: "text", text: PROMPT },
            ],
          },
        ],
      }),
    });

    if (!apiRes.ok) {
      const err = await apiRes.json().catch(() => ({}));
      return json(res, 502, { error: "Claude API error: " + ((err && err.error && err.error.message) || apiRes.status) });
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
      return json(res, 502, { error: "Could not read the AI response. Try again." });
    }
    if (!Array.isArray(parsed.items))
      return json(res, 502, { error: "Unexpected response from the AI. Try again." });

    const DEPTS = ["Audio", "Video", "Lighting", "Power", "Scenic", "Misc"];
    const items = parsed.items
      .map((it) => {
        const name = String((it && it.name) || "").trim();
        if (!name) return null;
        const d = String((it && it.department) || "").trim();
        const dept = DEPTS.find((x) => x.toLowerCase() === d.toLowerCase()) || "Misc";
        const n = parseFloat(String(it.rate == null ? "" : it.rate).replace(/[^0-9.\-]/g, ""));
        return { name, department: dept, rate: isFinite(n) ? Math.round(n * 100) / 100 : 0 };
      })
      .filter(Boolean);

    return json(res, 200, { items });
  } catch (e) {
    return json(res, 500, { error: e.message || "Server error" });
  }
}
