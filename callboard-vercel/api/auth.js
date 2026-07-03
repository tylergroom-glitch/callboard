// POST /api/auth  { mode: "admin" | "show", password }
// admin  -> token that can list/manage every show
// show   -> token scoped to the ONE show whose password matches (crew never see others)
import { json, readBody, hashPassword, signToken, airtable, summary, TOKEN_TTL, env } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  if (!env.hasConfig)
    return json(res, 500, { error: "Server not configured — set AIRTABLE_TOKEN, AIRTABLE_BASE_ID, ADMIN_PASSWORD and APP_SECRET." });

  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { error: "Bad request" });
  }
  const { mode, password } = body || {};
  if (!password) return json(res, 400, { error: "Password required" });

  try {
    if (mode === "admin") {
      if (password !== env.ADMIN_PASSWORD) return json(res, 401, { error: "Wrong admin password" });
      return json(res, 200, { scope: "admin", token: signToken({ scope: "admin", exp: Date.now() + TOKEN_TTL }) });
    }

    if (mode === "show") {
      const hash = hashPassword(password);
      const formula = `{PassHash}='${hash}'`;
      const data = await airtable("GET", `?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`);
      const rec = data.records && data.records[0];
      if (!rec) return json(res, 401, { error: "No show matches that password" });
      return json(res, 200, {
        scope: "show",
        show: summary(rec),
        token: signToken({ scope: "show", id: rec.id, exp: Date.now() + TOKEN_TTL }),
      });
    }

    return json(res, 400, { error: "Unknown login mode" });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || "Server error" });
  }
}
