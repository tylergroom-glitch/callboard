// /api/members — manage who is on a show and their role. TCG or the show's producer.
// GET ?profiles=1        list all accounts (invite picker) — TCG only
// POST ?tcg=1 { email|userId, isTcg }   grant/revoke platform-wide TCG admin — TCG only
// GET ?showId=<id>       list members of a show
// POST { showId, email|userId, role, areas }   add/update a member
// DELETE ?showId=&userId=                       remove a member
import { json, readBody, auth, isAdmin, memberRole, supabaseRest, supabaseProfile, inviteUser, sendBrevoEmail } from "./_lib.js";

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
    // ---- platform-wide TCG admin flag ----
    // Not tied to any show: this is the switch that opens Pipeline, Quotes,
    // Catalog and P&L across every show.
    if (req.method === "POST" && q.tcg) {
      if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
      const b = await readBody(req);
      const isTcg = b.isTcg === true;
      let userId = b.userId;
      let invited = false;

      if (!userId && b.email) {
        const email = String(b.email).trim();
        const rows = await supabaseRest("GET", "/profiles?email=eq." + encodeURIComponent(email) + "&select=id&limit=1", null);
        userId = rows && rows[0] ? rows[0].id : null;
        if (!userId) {
          if (!isTcg) return json(res, 404, { error: "No account found for " + email });
          try {
            const u = await inviteUser(email, b.redirectTo);
            userId = u && u.id ? u.id : null;
            invited = !!userId;
          } catch (e) {
            return json(res, e.status || 500, { error: "Could not invite " + email + ": " + (e.message || "error") });
          }
        }
      }
      if (!userId) return json(res, 400, { error: "An email is required." });

      // Don't let an admin lock themselves out of the backend.
      if (!isTcg && userId === p.sub) {
        return json(res, 400, { error: "You can't remove your own admin access. Ask another admin to do it." });
      }

      await supabaseRest("PATCH", "/profiles?id=eq." + encodeURIComponent(userId), { is_tcg: isTcg }, "return=minimal");

      if (isTcg && !invited) {
        const prof = await supabaseProfile(userId);
        const toEmail = b.email || (prof ? prof.email : null);
        if (toEmail) {
          const host = req.headers.host || "";
          const appUrl = (host.startsWith("localhost") ? "http://" : "https://") + host + "/";
          await sendBrevoEmail({
            to: toEmail,
            subject: "You\u2019ve been given admin access on Crew Call",
            html: "<div style=\"font-family:sans-serif;font-size:15px;color:#1a2233;line-height:1.5\">" +
              "<p>You now have <b>full admin access</b> on Crew Call \u2014 every show, plus Pipeline, Quotes and the Catalog.</p>" +
              "<p style=\"color:#6b7688;font-size:13px\">If you\u2019re already signed in, sign out and back in for it to take effect.</p>" +
              "<p><a href=\"" + appUrl + "\" style=\"display:inline-block;background:#0077B6;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600\">Open Crew Call</a></p></div>",
          });
        }
      }
      return json(res, 200, { ok: true, userId, invited });
    }

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
      // Was this person already on the show? (role change vs. first add)
      const existing = await supabaseRest("GET", "/show_members?show_id=eq." + encodeURIComponent(showId) + "&user_id=eq." + encodeURIComponent(userId) + "&select=user_id&limit=1", null);
      const isNew = !(existing && existing.length);
      const rec = { show_id: showId, user_id: userId, role, areas: b.areas || {} };
      await supabaseRest("POST", "/show_members?on_conflict=show_id,user_id", rec, "return=minimal,resolution=merge-duplicates");
      // Notify on first add only. New accounts already get the Supabase invite;
      // existing accounts get a "you were added" email. Role changes: no email.
      if (isNew && !invited) {
        let toEmail = b.email;
        if (!toEmail) { const prof = await supabaseProfile(userId); toEmail = prof ? prof.email : null; }
        if (toEmail) {
          const showName = b.showName || "a show";
          const roleLabel = role === "producer" ? "Producer / Lead" : role === "dept_editor" ? "Department editor" : "Crew";
          const host = req.headers.host || "";
          const appUrl = (host.startsWith("localhost") ? "http://" : "https://") + host + "/";
          await sendBrevoEmail({
            to: toEmail,
            subject: "You\u2019ve been added to " + showName + " on Crew Call",
            html: "<div style=\"font-family:sans-serif;font-size:15px;color:#1a2233;line-height:1.5\">" +
              "<p>You\u2019ve been added to <b>" + showName + "</b> as <b>" + roleLabel + "</b> on Crew Call.</p>" +
              "<p><a href=\"" + appUrl + "\" style=\"display:inline-block;background:#0077B6;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600\">Open Crew Call</a></p>" +
              "<p style=\"color:#6b7688;font-size:13px\">If the button doesn\u2019t work, go to " + appUrl + "</p></div>",
          });
        }
      }
      return json(res, 200, { ok: true, userId, invited, isNew });
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
