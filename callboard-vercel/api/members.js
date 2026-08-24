// /api/members — manage who is on a show and their role. TCG or the show's producer.
// GET ?profiles=1        list all accounts (invite picker) — TCG only
// GET ?showId=<id>       list members of a show
// POST { showId, email|userId, role, areas }   add/update a member
// DELETE ?showId=&userId=                       remove a member
import { json, readBody, auth, isAdmin, memberRole, supabaseRest, supabaseProfile, inviteUser } from "./_lib.js";

async function canManageMembers(p, showId) {
  if (isAdmin(p)) return true;
  if (p && p.sub) { const m = await memberRole(p, showId); return !!(m && m.role === "producer"); }
  return false;
}

export default async function handler(req, res) {
  const p = auth(req);
  if (!p) return json(res, 401, { error: "Not signed in" });
  const q = req.query || {};

  try {
    if (req.method === "GET" && q.profiles) {
      if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
      const rows = await supabaseRest("GET", "/profiles?select=id,email,name,is_tcg&order=email.asc", null);
      return json(res, 200, rows || []);
    }

    if (req.method === "GET") {
      const showId = q.showId;
      if (!showId) return json(res, 400, { error: "showId required" });
      if (!(await canManageMembers(p, showId))) return json(res, 403, { error: "Not allowed" });
      const rows = await supabaseRest("GET", "/show_members?show_id=eq." + encodeURIComponent(showId) + "&select=user_id,role,areas", null);
      const members = [];
      for (const r of rows || []) {
        const prof = await supabaseProfile(r.user_id);
        members.push({ userId: r.user_id, role: r.role, areas: r.areas || {}, email: prof ? prof.email : "", name: prof ? prof.name : "" });
      }
      return json(res, 200, members);
    }

    if (req.method === "POST") {
      const b = await readBody(req);
      const showId = b.showId;
      if (!showId) return json(res, 400, { error: "showId required" });
      if (!(await canManageMembers(p, showId))) return json(res, 403, { error: "Not allowed" });
      let userId = b.userId;
      let invited = false;
      if (!userId && b.email) {
        const rows = await supabaseRest("GET", "/profiles?email=eq." + encodeURIComponent(String(b.email).trim()) + "&select=id&limit=1", null);
        userId = rows && rows[0] ? rows[0].id : null;
        if (!userId) {
          try {
            const u = await inviteUser(String(b.email).trim(), b.redirectTo);
            userId = u && u.id ? u.id : null;
            invited = !!userId;
          } catch (e) {
            return json(res, e.status || 500, { error: "Could not invite " + b.email + ": " + (e.message || "error") });
          }
        }
      }
      if (!userId) return json(res, 400, { error: "An email is required to add someone." });
      const role = ["producer", "dept_editor", "crew"].includes(b.role) ? b.role : "crew";
      const rec = { show_id: showId, user_id: userId, role, areas: b.areas || {} };
      await supabaseRest("POST", "/show_members?on_conflict=show_id,user_id", rec, "return=minimal,resolution=merge-duplicates");
      return json(res, 200, { ok: true, userId, invited });
    }

    if (req.method === "DELETE") {
      const showId = q.showId, userId = q.userId;
      if (!showId || !userId) return json(res, 400, { error: "showId and userId required" });
      if (!(await canManageMembers(p, showId))) return json(res, 403, { error: "Not allowed" });
      await supabaseRest("DELETE", "/show_members?show_id=eq." + encodeURIComponent(showId) + "&user_id=eq." + encodeURIComponent(userId), null);
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: "Method not allowed" });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || "Server error" });
  }
}
