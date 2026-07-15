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

  // Each level is optional. A key that is ABSENT is left unchanged; a key set to an
  // empty string removes that level's password; any other value sets it. Legacy
  // callers that send { password } set the crew password.
  const fields = {};
  const crew = b.crewPassword !== undefined ? b.crewPassword : b.password;
  if (crew !== undefined) fields.PassHash = crew ? hashPassword(crew) : "";
  if (b.editorPassword !== undefined) fields.EditorHash = b.editorPassword ? hashPassword(b.editorPassword) : "";
  if (b.adminPassword !== undefined) fields.AdminHash = b.adminPassword ? hashPassword(b.adminPassword) : "";

  if (!Object.keys(fields).length) return json(res, 400, { error: "No passwords provided" });

  try {
    await airtable("PATCH", "/" + b.id, { fields });
    return json(res, 200, {
      ok: true,
      hasPassword: fields.PassHash !== undefined ? !!fields.PassHash : undefined,
      hasEditor: fields.EditorHash !== undefined ? !!fields.EditorHash : undefined,
      hasAdmin: fields.AdminHash !== undefined ? !!fields.AdminHash : undefined,
    });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || "Server error" });
  }
}
