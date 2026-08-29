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

  // A key that is ABSENT is left unchanged; an empty string removes the password;
  // any other value sets it. Legacy callers that send { password } still work.
  //
  // editorPassword / adminPassword used to be accepted here and hashed into
  // EditorHash / AdminHash. Nothing ever stored those columns and no login path
  // issued a token above crew level, so they were silently discarded while the
  // API reported success. Edit rights and P&L access come from account roles now,
  // so those keys are ignored rather than pretending to work.
  const fields = {};
  const crew = b.crewPassword !== undefined ? b.crewPassword : b.password;
  if (crew !== undefined) fields.PassHash = crew ? hashPassword(crew) : "";

  if (!Object.keys(fields).length) return json(res, 400, { error: "No password provided" });

  try {
    await airtable("PATCH", "/" + b.id, { fields });
    return json(res, 200, {
      ok: true,
      hasPassword: fields.PassHash !== undefined ? !!fields.PassHash : undefined,
    });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || "Server error" });
  }
}
