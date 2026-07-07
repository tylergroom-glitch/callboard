// /api/onboard
// GET  ?generate=1  — generate a shareable crew link (admin only)
// GET  ?token=xxx   — serve the crew onboarding form (anyone with the link)
// POST ?token=xxx   — save/update crew submission
//
// The token is HMAC-signed with your existing APP_SECRET — no new env vars.
// Links are valid for 60 days. Regenerate to invalidate old links.
import { auth, isAdmin, airtableTable, signToken, verifyToken } from "./_lib.js";

const TABLE = process.env.AIRTABLE_ROSTER_TABLE || "Roster";
const POS_KEY = "__positions__";
const DURATION = 1000 * 60 * 60 * 24 * 60; // 60 days

const verify = (t) => {
  const p = verifyToken(t);
  return p?.scope === "onboard" ? p : null;
};

async function getPositions() {
  try {
    const enc = encodeURIComponent(`{Name}='${POS_KEY}'`);
    const d = await airtableTable(TABLE, "GET", `?filterByFormula=${enc}&maxRecords=1`);
    const rec = d.records?.[0];
    if (rec?.fields?.Data) return JSON.parse(rec.fields.Data);
  } catch {}
  return ["Show Caller","Technical Director","Audio Engineer (A1)","Monitor Engineer (A2)",
          "Camera Operator","Camera TD","Graphics Operator","Lighting Designer","Lighting Tech",
          "LED Tech","Record Op","Playback Operator","Rigging Supervisor","Rigger",
          "Production Manager","Stage Manager"];
}

async function upsert(name, data) {
  const enc = encodeURIComponent(`AND({Name}='${name.replace(/'/g, "\\'")}', {Name}!='${POS_KEY}')`);
  const d = await airtableTable(TABLE, "GET", `?filterByFormula=${enc}&maxRecords=1`);
  const fields = { Name: name, Data: JSON.stringify(data) };
  if (d.records?.[0]) {
    await airtableTable(TABLE, "PATCH", "/" + d.records[0].id, { fields });
  } else {
    await airtableTable(TABLE, "POST", "", { fields });
  }
}

function html(status, content, extra = "") {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TCG Crew Info</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#F2F4F8;min-height:100vh;padding:24px 16px 48px}
.card{max-width:580px;margin:0 auto;background:#fff;border-radius:16px;box-shadow:0 2px 16px rgba(0,0,0,.08);overflow:hidden}
.hdr{background:#0F1E35;padding:22px 24px;color:#fff}
.hdr-logo{font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#9FB3CE;margin-bottom:6px}
.hdr-title{font-size:20px;font-weight:700}
.hdr-sub{font-size:13px;color:#9FB3CE;margin-top:4px}
.body{padding:24px}
.sect{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#94A3B8;margin:20px 0 10px;padding-bottom:6px;border-bottom:1px solid #E2E8F0}
.sect:first-of-type{margin-top:0}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.full{grid-column:1/-1}
.fld{display:flex;flex-direction:column;gap:5px}
.fld label{font-size:12px;font-weight:600;color:#475569}
.fld input,.fld select{border:1px solid #D8DEE7;border-radius:8px;padding:10px 12px;font-size:14px;color:#1E293B;outline:none;width:100%;background:#fff}
.fld input:focus,.fld select:focus{border-color:#2563EB;box-shadow:0 0 0 3px rgba(37,99,235,.1)}
.fld input::placeholder{color:#94A3B8}
.req{color:#DC2626}
.submit{width:100%;background:#0F1E35;color:#fff;border:none;border-radius:10px;padding:14px;font-size:15px;font-weight:700;cursor:pointer;margin-top:20px}
.submit:hover{background:#1a2f50}
.submit:disabled{opacity:.55;cursor:not-allowed}
.msg{text-align:center;padding:40px 24px}
.msg-icon{font-size:48px;margin-bottom:16px}
.msg-title{font-size:20px;font-weight:700;color:#0F1E35;margin-bottom:8px}
.msg-body{font-size:14px;color:#64748B;line-height:1.6}
.err{background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:10px 14px;font-size:13px;color:#DC2626;margin-top:12px;display:none}
@media(max-width:480px){.grid{grid-template-columns:1fr}}
</style></head><body>
<div class="card">${content}</div>
${extra}
</body></html>`;
}

function formPage(token, positions) {
  const posOpts = `<option value="">— Select —</option>` +
    positions.map(p => `<option value="${p}">${p}</option>`).join("") +
    `<option value="Other">Other</option>`;
  return html(200, `
<div class="hdr">
  <div class="hdr-logo">Touchstone Creative Group</div>
  <div class="hdr-title">Crew Information</div>
  <div class="hdr-sub">Fill out your details so we have everything we need for bookings.</div>
</div>
<div class="body">
  <div class="sect">Contact</div>
  <div class="grid">
    <div class="fld full"><label>Full name <span class="req">*</span></label><input id="name" placeholder="First Last" required></div>
    <div class="fld"><label>Position / role</label><select id="position">${posOpts}</select></div>
    <div class="fld"><label>Phone</label><input id="phone" type="tel" placeholder="(555) 000-0000"></div>
    <div class="fld full"><label>Email</label><input id="email" type="email" placeholder="you@email.com"></div>
  </div>
  <div class="sect">Personal &amp; travel</div>
  <div class="grid">
    <div class="fld"><label>Birthday</label><input id="birthday" type="date"></div>
    <div class="fld"><label>Shirt size</label>
      <select id="shirtSize"><option value="">—</option>
        <option>XS</option><option>S</option><option>M</option><option>L</option>
        <option>XL</option><option>2XL</option><option>3XL</option>
      </select>
    </div>
    <div class="fld"><label>Home airport</label><input id="homeAirport" placeholder="LAX, SFO, PHX…"></div>
    <div class="fld"><label>TSA PreCheck / KTN</label><input id="tsaPrecheck" placeholder="Known Traveler Number"></div>
    <div class="fld"><label>Passport expires</label><input id="passportExp" type="date"></div>
    <div class="fld"><label>Dietary restrictions</label><input id="dietary" placeholder="Vegetarian, nut allergy…"></div>
  </div>
  <div class="sect">Emergency contact</div>
  <div class="grid">
    <div class="fld"><label>Name</label><input id="emergencyName" placeholder="Contact name"></div>
    <div class="fld"><label>Phone</label><input id="emergencyPhone" type="tel" placeholder="(555) 000-0000"></div>
  </div>
  <div id="err" class="err"></div>
  <button class="submit" id="sub">Submit my info</button>
</div>`,
  `<script>
document.getElementById('sub').onclick=async()=>{
  const name=document.getElementById('name').value.trim();
  if(!name){document.getElementById('err').textContent='Name is required.';document.getElementById('err').style.display='block';return;}
  const btn=document.getElementById('sub');
  btn.disabled=true;btn.textContent='Saving…';
  document.getElementById('err').style.display='none';
  const get=id=>document.getElementById(id).value;
  try{
    const r=await fetch('/api/onboard?token=${token}',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name,position:get('position'),phone:get('phone'),email:get('email'),
        birthday:get('birthday'),shirtSize:get('shirtSize'),homeAirport:get('homeAirport'),
        tsaPrecheck:get('tsaPrecheck'),passportExp:get('passportExp'),dietary:get('dietary'),
        emergencyName:get('emergencyName'),emergencyPhone:get('emergencyPhone')})});
    const j=await r.json();
    if(!r.ok)throw new Error(j.error||'Error');
    document.querySelector('.body').innerHTML='<div class="msg"><div class="msg-icon">✅</div><div class="msg-title">All set, '+name.split(' ')[0]+'!</div><div class="msg-body">Your info has been saved. Your production manager will reach out with your call details.</div></div>';
  }catch(e){
    document.getElementById('err').textContent=e.message||'Something went wrong. Try again.';
    document.getElementById('err').style.display='block';
    btn.disabled=false;btn.textContent='Submit my info';
  }
};
</script>`);
}

export default async function handler(req, res) {
  const token = req.query?.token;
  const generate = req.query?.generate;

  /* generate link — admin only */
  if (generate) {
    if (req.method !== "GET") { res.status(405).end(); return; }
    const p = auth(req);
    if (!isAdmin(p)) { res.status(403).setHeader("Content-Type","application/json").end(JSON.stringify({error:"Admin only"})); return; }
    const t = signToken({ scope: "onboard", exp: Date.now() + DURATION });
    const host = req.headers.host || "";
    const protocol = host.startsWith("localhost") ? "http" : "https";
    const url = `${protocol}://${host}/api/onboard?token=${t}`;
    res.status(200).setHeader("Content-Type","application/json").end(JSON.stringify({ url }));
    return;
  }

  /* all other requests require a valid onboard token */
  if (!token || !verify(token)) {
    res.status(403).setHeader("Content-Type","text/html").end(
      html(403, `<div class="body"><div class="msg"><div class="msg-icon">🔒</div><div class="msg-title">Link invalid or expired</div><div class="msg-body">Ask your production manager for a new crew onboarding link.</div></div></div>`, "")
    ); return;
  }

  /* GET — serve form */
  if (req.method === "GET") {
    const positions = await getPositions();
    res.status(200).setHeader("Content-Type","text/html").end(formPage(token, positions));
    return;
  }

  /* POST — save submission */
  if (req.method === "POST") {
    let body;
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch { res.status(400).setHeader("Content-Type","application/json").end(JSON.stringify({error:"Bad request"})); return; }

    const name = (body.name || "").trim();
    if (!name) { res.status(400).setHeader("Content-Type","application/json").end(JSON.stringify({error:"Name is required"})); return; }

    try {
      await upsert(name, {
        position: body.position || "",
        phone: body.phone || "",
        email: body.email || "",
        birthday: body.birthday || "",
        shirtSize: body.shirtSize || "",
        homeAirport: body.homeAirport || "",
        tsaPrecheck: body.tsaPrecheck || "",
        passportExp: body.passportExp || "",
        dietary: body.dietary || "",
        emergencyName: body.emergencyName || "",
        emergencyPhone: body.emergencyPhone || "",
        onboardedAt: new Date().toISOString(),
      });
      res.status(200).setHeader("Content-Type","application/json").end(JSON.stringify({ok:true}));
    } catch (e) {
      res.status(500).setHeader("Content-Type","application/json").end(JSON.stringify({error:e.message||"Server error"}));
    }
    return;
  }

  res.status(405).end();
}
