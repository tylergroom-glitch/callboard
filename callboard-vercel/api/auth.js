// POST /api/auth  { mode: "admin" | "show", password }
// admin  -> token that can list/manage every show
// show   -> token scoped to the ONE show whose password matches (crew never see others)
import { json, readBody, hashPassword, signToken, supabaseRest, TOKEN_TTL, env, supabaseUser, supabaseProfile } from "./_lib.js";

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
  if (mode !== "supabase" && !password) return json(res, 400, { error: "Password required" });

  try {
    if (mode === "admin") {
      const adminOk =
        password === env.ADMIN_PASSWORD ||
        (env.ADMIN_PASSWORD_2 && password === env.ADMIN_PASSWORD_2);
      if (!adminOk) return json(res, 401, { error: "Wrong admin password" });
      return json(res, 200, { scope: "admin", token: signToken({ scope: "admin", exp: Date.now() + TOKEN_TTL }) });
    }

    if (mode === "show") {
      const hash = hashPassword(password);
      const rows = await supabaseRest("GET", "/shows?pass_hash=eq." + encodeURIComponent(hash) + "&select=id,name,client,start_date,end_date&limit=1", null);
      const row = rows && rows[0];
      if (!row) return json(res, 401, { error: "No show matches that password" });
      const show = { id: row.id, name: row.name || "", client: row.client || "", startDate: row.start_date || "", endDate: row.end_date || "", hasPassword: true };
      return json(res, 200, {
        scope: "show",
        level: "crew",
        show,
        token: signToken({ scope: "show", id: row.id, level: "crew", exp: Date.now() + TOKEN_TTL }),
      });
    }

    if (mode === "supabase") {
      const supaToken = body.supabaseToken;
      if (!supaToken) return json(res, 400, { error: "Missing session token" });
      const user = await supabaseUser(supaToken);
      if (!user || !user.id) return json(res, 401, { error: "Invalid or expired session" });
      const prof = await supabaseProfile(user.id);
      if (!prof || !prof.is_tcg) return json(res, 403, { error: "Your account is not authorized for access yet. Ask a TCG admin to enable it." });
      return json(res, 200, { scope: "admin", token: signToken({ scope: "admin", exp: Date.now() + TOKEN_TTL }) });
    }

    return json(res, 400, { error: "Unknown login mode" });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || "Server error" });
  }
}
