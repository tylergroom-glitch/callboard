// POST /api/password  { id, password }  — admin only.
// Sets a show's password (stores a salted hash). Empty password removes protection.
import { json, readBody, auth, isAdmin, airtable, hashPassword } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  const p = auth(req);
  if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });

  let b;
  try {
    b = await readBody(req);
  } catch {
    return json(res, 400, { error: "Bad request" });
  }
  if (!b.id) return json(res, 400, { error: "id required" });

  try {
    const fields = { PassHash: b.password ? hashPassword(b.password) : "" };
    await airtable("PATCH", "/" + b.id, { fields });
    return json(res, 200, { ok: true, hasPassword: !!b.password });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || "Server error" });
  }
}
