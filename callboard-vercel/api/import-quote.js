// POST /api/import-quote
// Accepts { pdf: "<base64 string>" }
// Passes the PDF to the Claude API which reads the quote and extracts:
//   1. gear items → for the pull list (cases + loose)
//   2. section financials → for the P&L / costing tab
// Returns { cases, loose, costing }
//
// SETUP: add ANTHROPIC_API_KEY to your Vercel environment variables.
// Recommended: in vercel.json set maxDuration: 30 for this function.
import { json, readBody, auth } from "./_lib.js";

const PROMPT = `You are parsing an AV/live-event production quote PDF to extract two things:
1. A gear/equipment pull list (physical items only, organized by case)
2. The quote grand total (for P&L)

Return ONLY a valid JSON object — no markdown fences, no explanation, no other text.

JSON structure:
{
  "cases": [
    {
      "case": "Section name from the quote",
      "category": "Video",
      "items": [
        { "item": "Item description", "qty": 1, "source": "TCG" }
      ]
    }
  ],
  "loose": [],
  "costing": {
    "billableEst": 319960
  }
}

═══ PULL LIST RULES ═══

Category values (use exactly one):
- "Video"    → cameras, displays, LED walls, video switchers, media servers, PTZ, playback computers, broadcast gear, confidence monitors, intercom packages, video cable packages
- "Audio"    → speakers, amplifiers, microphones, audio consoles, IEM, DI boxes, clear-com, audio cable packages
- "Lighting" → moving lights, wash fixtures, gobos, lighting consoles (GrandMA etc.), hazers, foggers, dimmers
- "Power"    → power distro, generators, L21-30/Soca/shore power, power cable packages
- "Scenic"   → truss, hoists/motors, beam clamps, rigging hardware, staging, drape, pipe & base
- "Misc"     → expendables, cases, stands, mounts, anything else

What to SKIP from the gear list (do not include):
- Labor line items (anything with "Labor-", "Labor ", "Pre-Production/Prep", role titles like "Cam Op", "Show Caller", "Camera TD", "Graphics Operator", "Lighting Tech", "Production Manager", "V1", "LED Tech", "Rigging Supervisor", "Record Op", "Playback")
- Travel, per diem, flights
- Trucking / shipping
- Expendables listed as a single line item

Quantity parsing: "2 x 24' x 13' LED Wall" → qty: 2, item: "24' x 13' LED Wall"
Source: always "TCG" for all gear items.

═══ P&L RULE ═══

costing.billableEst: The Grand Total of the entire quote — the final sum shown at the bottom. Plain number only, no $ or commas.`;

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
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: body.pdf },
              },
              { type: "text", text: PROMPT },
            ],
          },
        ],
      }),
    });

    if (!apiRes.ok) {
      const err = await apiRes.json().catch(() => ({}));
      return json(res, 502, {
        error: "Claude API error: " + (err?.error?.message || apiRes.status),
      });
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
      return json(res, 502, { error: "Could not parse AI response as JSON. Try again." });
    }

    if (!Array.isArray(parsed.cases)) {
      return json(res, 502, { error: "Unexpected response structure from AI. Try again." });
    }

    return json(res, 200, {
      cases: parsed.cases || [],
      loose: parsed.loose || [],
      costing: parsed.costing || null,
    });
  } catch (e) {
    return json(res, 500, { error: e.message || "Server error" });
  }
}
