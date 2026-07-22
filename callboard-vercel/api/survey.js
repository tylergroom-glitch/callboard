// /api/survey
// GET  ?generate=1&id=<showId>  — generate a shareable survey link (show admin only)
// GET  ?token=xxx               — serve the post-show survey form (anyone with the link)
// POST ?token=xxx               — append a response to that show's record
//
// The token is HMAC-signed with your existing APP_SECRET — no new env vars, and it
// carries the show id, so a response can only ever land on the show it was made for.
// Links are valid for 365 days. Regenerate to invalidate old links.
import { auth, canManageShow, airtable, signToken, verifyToken } from "./_lib.js";

const DURATION = 1000 * 60 * 60 * 24 * 365; // 365 days

const verify = (t) => {
  const p = verifyToken(t);
  return p && p.scope === "survey" && p.id ? p : null;
};

const esc = (s) =>
  String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function loadShow(id) {
  const rec = await airtable("GET", "/" + id);
  const f = rec.fields || {};
  let data = {};
  try {
    data = f.Data ? JSON.parse(f.Data) : {};
  } catch {
    data = {};
  }
  return { name: f.Name || "", data };
}

function html(content, extra = "") {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TCG Post-Show Survey</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#F2F4F8;min-height:100vh;padding:24px 16px 48px}
.card{max-width:580px;margin:0 auto;background:#fff;border-radius:16px;box-shadow:0 2px 16px rgba(0,0,0,.08);overflow:hidden}
.hdr{background:#0F1E35;padding:22px 24px;color:#fff}
.hdr-logo{font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#9FB3CE;margin-bottom:6px}
.hdr-title{font-size:20px;font-weight:700}
.hdr-sub{font-size:13px;color:#9FB3CE;margin-top:4px}
.body{padding:24px}
.fld{display:flex;flex-direction:column;gap:6px;margin-bottom:18px}
.fld label{font-size:13.5px;font-weight:600;color:#334155}
.fld .hint{font-size:12px;color:#94A3B8;font-weight:400}
.fld input,.fld textarea{border:1px solid #D8DEE7;border-radius:8px;padding:11px 12px;font-size:14px;color:#1E293B;outline:none;width:100%;background:#fff;font-family:inherit;resize:vertical}
.fld textarea{min-height:92px;line-height:1.5}
.fld input:focus,.fld textarea:focus{border-color:#2563EB;box-shadow:0 0 0 3px rgba(37,99,235,.1)}
.fld input::placeholder,.fld textarea::placeholder{color:#94A3B8}
.submit{width:100%;background:#0F1E35;color:#fff;border:none;border-radius:10px;padding:14px;font-size:15px;font-weight:700;cursor:pointer;margin-top:4px}
.submit:hover{background:#1a2f50}
.submit:disabled{opacity:.55;cursor:not-allowed}
.msg{text-align:center;padding:40px 24px}
.msg-icon{font-size:48px;margin-bottom:16px}
.msg-title{font-size:20px;font-weight:700;color:#0F1E35;margin-bottom:8px}
.msg-body{font-size:14px;color:#64748B;line-height:1.6}
.err{background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:10px 14px;font-size:13px;color:#DC2626;margin-top:12px;display:none}
</style></head><body>
<div class="card">${content}</div>
${extra}
</body></html>`;
}

function formPage(token, showName) {
  return html(
    `
<div class="hdr">
  <div class="hdr-logo">Touchstone Creative Group</div>
  <div class="hdr-title">Post-Show Survey</div>
  <div class="hdr-sub">${esc(showName)}</div>
</div>
<div class="body">
  <div class="fld">
    <label>Your name <span class="hint">(optional)</span></label>
    <input id="name" placeholder="First Last">
  </div>
  <div class="fld">
    <label>1. What things went well?</label>
    <textarea id="q1" placeholder="Wins, what clicked, what we should keep doing…"></textarea>
  </div>
  <div class="fld">
    <label>2. What would you like to see next year?</label>
    <textarea id="q2" placeholder="Changes, improvements, ideas for next time…"></textarea>
  </div>
  <div class="fld">
    <label>3. Any gear that would help in the future?</label>
    <textarea id="q3" placeholder="Equipment that would have made the job easier…"></textarea>
  </div>
  <div class="fld">
    <label>4. Anything we were missing?</label>
    <textarea id="q4" placeholder="Gaps in gear, crew, info, logistics…"></textarea>
  </div>
  <div id="err" class="err"></div>
  <button class="submit" id="sub">Submit survey</button>
</div>`,
    `<script>
document.getElementById('sub').onclick=async()=>{
  var get=function(id){return document.getElementById(id).value;};
  var q1=get('q1'),q2=get('q2'),q3=get('q3'),q4=get('q4');
  var err=document.getElementById('err');
  if(!q1.trim()&&!q2.trim()&&!q3.trim()&&!q4.trim()){
    err.textContent='Please answer at least one question.';err.style.display='block';return;
  }
  var btn=document.getElementById('sub');
  btn.disabled=true;btn.textContent='Sending…';err.style.display='none';
  try{
    var r=await fetch('/api/survey?token=${token}',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name:get('name'),q1:q1,q2:q2,q3:q3,q4:q4})});
    var j=await r.json();
    if(!r.ok)throw new Error(j.error||'Error');
    document.querySelector('.body').innerHTML='<div class="msg"><div class="msg-icon">✅</div><div class="msg-title">Thank you!</div><div class="msg-body">Your feedback has been saved with this show, and will be on hand when we plan it next year.</div></div>';
  }catch(e){
    err.textContent=e.message||'Something went wrong. Try again.';
    err.style.display='block';
    btn.disabled=false;btn.textContent='Submit survey';
  }
};
</script>`
  );
}

export default async function handler(req, res) {
  const token = req.query && req.query.token;
  const generate = req.query && req.query.generate;

  /* generate link — show admin only */
  if (generate) {
    if (req.method !== "GET") {
      res.status(405).end();
      return;
    }
    const id = req.query && req.query.id;
    const p = auth(req);
    if (!id) {
      res.status(400).setHeader("Content-Type", "application/json").end(JSON.stringify({ error: "id required" }));
      return;
    }
    if (!canManageShow(p, id)) {
      res.status(403).setHeader("Content-Type", "application/json").end(JSON.stringify({ error: "Admin only" }));
      return;
    }
    const t = signToken({ scope: "survey", id, exp: Date.now() + DURATION });
    const host = req.headers.host || "";
    const protocol = host.startsWith("localhost") ? "http" : "https";
    res
      .status(200)
      .setHeader("Content-Type", "application/json")
      .end(JSON.stringify({ url: `${protocol}://${host}/api/survey?token=${t}` }));
    return;
  }

  /* everything else needs a valid survey token */
  const p = token ? verify(token) : null;
  if (!p) {
    res
      .status(403)
      .setHeader("Content-Type", "text/html")
      .end(
        html(
          `<div class="body"><div class="msg"><div class="msg-icon">🔒</div><div class="msg-title">Link invalid or expired</div><div class="msg-body">Ask your production manager for a new survey link.</div></div></div>`
        )
      );
    return;
  }

  /* GET — serve the form */
  if (req.method === "GET") {
    let showName = "";
    try {
      const s = await loadShow(p.id);
      showName = s.name;
    } catch {}
    res.status(200).setHeader("Content-Type", "text/html").end(formPage(token, showName));
    return;
  }

  /* POST — append the response to the show */
  if (req.method === "POST") {
    let body;
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      res.status(400).setHeader("Content-Type", "application/json").end(JSON.stringify({ error: "Bad request" }));
      return;
    }

    const trim = (v, max) => String(v == null ? "" : v).slice(0, max).trim();
    const entry = {
      id: Math.random().toString(36).slice(2, 9),
      name: trim(body.name, 120),
      q1: trim(body.q1, 4000),
      q2: trim(body.q2, 4000),
      q3: trim(body.q3, 4000),
      q4: trim(body.q4, 4000),
      submittedAt: new Date().toISOString(),
    };
    if (!entry.q1 && !entry.q2 && !entry.q3 && !entry.q4) {
      res
        .status(400)
        .setHeader("Content-Type", "application/json")
        .end(JSON.stringify({ error: "Please answer at least one question." }));
      return;
    }

    try {
      const show = await loadShow(p.id);
      const data = show.data || {};
      if (!Array.isArray(data.surveys)) data.surveys = [];
      data.surveys.push(entry);
      await airtable("PATCH", "/" + p.id, {
        fields: { Data: JSON.stringify(data), UpdatedAt: new Date().toISOString() },
      });
      res.status(200).setHeader("Content-Type", "application/json").end(JSON.stringify({ ok: true }));
    } catch (e) {
      res
        .status(500)
        .setHeader("Content-Type", "application/json")
        .end(JSON.stringify({ error: e.message || "Server error" }));
    }
    return;
  }

  res.status(405).end();
}
