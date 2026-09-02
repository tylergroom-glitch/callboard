// /api/schedule-fill
// GET  ?generate=1&id=<showId>  — generate a client schedule-fill link (show admin only)
// GET  ?token=xxx               — serve the schedule editor form (anyone with the link)
// POST ?token=xxx               — replace that show's production schedule with the submitted one
//
// Token is HMAC-signed with APP_SECRET and carries the show id, so edits can only ever
// land on the show the link was made for. Valid 365 days; regenerate to invalidate.
import { auth, canManageShow, supabaseRest, signToken, verifyToken } from "./_lib.js";

const DURATION = 1000 * 60 * 60 * 24 * 365;

const verify = (t) => {
  const p = verifyToken(t);
  return p && p.scope === "schedulefill" && p.id ? p : null;
};

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function j(res, code, obj) {
  res.status(code).setHeader("Content-Type", "application/json").end(JSON.stringify(obj));
}

// Reads straight from Supabase with the service key. Share links are
// unauthenticated by design — the HMAC token is the credential — so this
// deliberately bypasses RLS and is only ever reached after verify().
async function loadShow(id) {
  const rows = await supabaseRest("GET", "/shows?id=eq." + encodeURIComponent(id) + "&select=name,data", null);
  const row = rows && rows[0];
  if (!row) { const e = new Error("Show not found"); e.status = 404; throw e; }
  const data = row.data && typeof row.data === "object" ? row.data : {};
  return { name: row.name || "", data };
}

async function saveShowData(id, data) {
  await supabaseRest(
    "PATCH",
    "/shows?id=eq." + encodeURIComponent(id),
    { data, updated_at: new Date().toISOString() },
    "return=minimal"
  );
}

function shell(inner) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Production Schedule</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#F2F4F8;min-height:100vh;padding:24px 16px 48px}
.card{max-width:720px;margin:0 auto;background:#fff;border-radius:16px;box-shadow:0 2px 16px rgba(0,0,0,.08);overflow:hidden}
.hdr{background:#0F1E35;padding:22px 24px;color:#fff}
.hdr-logo{font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#9FB3CE;margin-bottom:6px}
.hdr-title{font-size:20px;font-weight:700}
.hdr-sub{font-size:13px;color:#9FB3CE;margin-top:4px}
.body{padding:22px}
.day{border:1px solid #E2E8F0;border-radius:12px;padding:14px;margin-bottom:14px;background:#F8FAFC}
.day-top{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
.day-date{width:150px}
.day-label{flex:1;min-width:160px;font-weight:600}
.day-rm{background:#fff;border:1px solid #E2E8F0;color:#DC2626;border-radius:8px;padding:8px 10px;font-size:12px;font-weight:600;cursor:pointer}
.rows{display:flex;flex-direction:column;gap:6px;margin-bottom:8px}
.row{display:flex;gap:6px;align-items:center}
.row-time{width:110px;flex:0 0 auto}
.row-act{flex:1;min-width:0}
.row-rm{background:#fff;border:1px solid #E2E8F0;color:#94A3B8;border-radius:8px;width:34px;height:38px;font-size:18px;cursor:pointer;flex:0 0 auto}
.addrow{background:#EFF4FF;border:1px solid #BFD3FF;color:#2563EB;border-radius:8px;padding:8px 12px;font-size:13px;font-weight:600;cursor:pointer}
.addday{width:100%;background:#fff;border:1px dashed #C7D2E0;color:#334155;border-radius:10px;padding:12px;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:14px}
.day input,.row input{border:1px solid #D8DEE7;border-radius:8px;padding:9px 10px;font-size:14px;color:#1E293B;outline:none;background:#fff;font-family:inherit}
.day input:focus,.row input:focus{border-color:#2563EB;box-shadow:0 0 0 3px rgba(37,99,235,.1)}
.submit{width:100%;background:#0F1E35;color:#fff;border:none;border-radius:10px;padding:14px;font-size:15px;font-weight:700;cursor:pointer;margin-top:4px}
.submit:hover{background:#1a2f50}
.submit:disabled{opacity:.55;cursor:not-allowed}
.msg{text-align:center;padding:40px 24px}
.msg-icon{font-size:48px;margin-bottom:16px}
.msg-title{font-size:20px;font-weight:700;color:#0F1E35;margin-bottom:8px}
.msg-body{font-size:14px;color:#64748B;line-height:1.6}
.err{background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:10px 14px;font-size:13px;color:#DC2626;margin-top:12px;display:none}
</style></head><body>${inner}</body></html>`;
}

function errPage() {
  return shell(`<div class="card"><div class="body"><div class="msg"><div class="msg-icon">&#128274;</div><div class="msg-title">Link invalid or expired</div><div class="msg-body">Ask your production manager for a new schedule link.</div></div></div></div>`);
}

function page(showName, schedule) {
  const SCHED = JSON.stringify(schedule || []).split("<").join("\\u003c");
  const inner = `<div class="card">
  <div class="hdr">
    <div class="hdr-logo">Touchstone Creative Group</div>
    <div class="hdr-title">Production Schedule</div>
    <div class="hdr-sub">${showName} &mdash; add your days, times &amp; activities, then save.</div>
  </div>
  <div class="body">
    <div id="days"></div>
    <button class="addday" type="button" onclick="addDay()">+ Add day</button>
    <button class="submit" id="saveBtn" type="button" onclick="submitSchedule()">Save schedule</button>
    <div class="err" id="err"></div>
  </div>
</div>
<script>
var SCHED = ${SCHED};
function uid(){return Math.random().toString(36).slice(2,9);}
function el(tag,cls,txt){var e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e;}
function render(){
  var wrap=document.getElementById("days");wrap.innerHTML="";
  SCHED.forEach(function(day,di){
    var card=el("div","day");
    var top=el("div","day-top");
    var dateI=el("input","day-date");dateI.type="date";dateI.value=day.date||"";dateI.onchange=function(){day.date=dateI.value;};
    var labelI=el("input","day-label");labelI.placeholder="Day label (e.g. Monday \\u2014 Load-in)";labelI.value=day.label||"";labelI.oninput=function(){day.label=labelI.value;};
    var rm=el("button","day-rm","Remove day");rm.type="button";rm.onclick=function(){SCHED.splice(di,1);render();};
    top.appendChild(dateI);top.appendChild(labelI);top.appendChild(rm);
    card.appendChild(top);
    var rows=el("div","rows");
    (day.items||[]).forEach(function(it,ii){
      var row=el("div","row");
      var timeI=el("input","row-time");timeI.placeholder="Time";timeI.value=it.time||"";timeI.oninput=function(){it.time=timeI.value;};
      var actI=el("input","row-act");actI.placeholder="Activity";actI.value=it.activity||"";actI.oninput=function(){it.activity=actI.value;};
      var rrm=el("button","row-rm","\\u00d7");rrm.type="button";rrm.onclick=function(){day.items.splice(ii,1);render();};
      row.appendChild(timeI);row.appendChild(actI);row.appendChild(rrm);
      rows.appendChild(row);
    });
    card.appendChild(rows);
    var add=el("button","addrow","+ Add item");add.type="button";add.onclick=function(){if(!day.items)day.items=[];day.items.push({id:uid(),time:"",activity:""});render();};
    card.appendChild(add);
    wrap.appendChild(card);
  });
}
function addDay(){SCHED.push({id:uid(),date:"",label:"",items:[{id:uid(),time:"",activity:""}]});render();}
function showErr(m){var e=document.getElementById("err");e.textContent=m;e.style.display="block";}
function submitSchedule(){
  var btn=document.getElementById("saveBtn");btn.disabled=true;btn.textContent="Saving\\u2026";
  fetch(location.pathname+location.search,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({schedule:SCHED})})
    .then(function(r){return r.json();})
    .then(function(d){
      if(d.ok){document.body.innerHTML="<div class='card'><div class='body'><div class='msg'><div class='msg-icon'>\\u2705</div><div class='msg-title'>Schedule saved</div><div class='msg-body'>Thanks! Your production schedule has been sent to the team. You can close this window.</div></div></div></div>";}
      else{showErr(d.error||"Something went wrong.");btn.disabled=false;btn.textContent="Save schedule";}
    })
    .catch(function(){showErr("Network error \\u2014 please try again.");btn.disabled=false;btn.textContent="Save schedule";});
}
if(SCHED.length===0){SCHED.push({id:uid(),date:"",label:"",items:[{id:uid(),time:"",activity:""}]});}
render();
</script>`;
  return shell(inner);
}

export default async function handler(req, res) {
  const q = req.query || {};
  const token = q.token;

  if (q.generate) {
    if (req.method !== "GET") { res.status(405).end(); return; }
    const id = q.id;
    const p = auth(req);
    if (!id) return j(res, 400, { error: "id required" });
    if (!canManageShow(p, id)) return j(res, 403, { error: "Admin only" });
    const t = signToken({ scope: "schedulefill", id, exp: Date.now() + DURATION });
    const host = req.headers.host || "";
    const protocol = host.startsWith("localhost") ? "http" : "https";
    return j(res, 200, { url: `${protocol}://${host}/api/schedule-fill?token=${t}` });
  }

  const p = token ? verify(token) : null;
  if (!p) { res.status(403).setHeader("Content-Type", "text/html").end(errPage()); return; }

  if (req.method === "GET") {
    let show;
    try { show = await loadShow(p.id); } catch { show = { name: "", data: {} }; }
    res.status(200).setHeader("Content-Type", "text/html").end(page(esc(show.name), (show.data && show.data.schedule) || []));
    return;
  }

  if (req.method === "POST") {
    let body = {};
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch { return j(res, 400, { error: "Bad request" }); }
    const days = Array.isArray(body.schedule) ? body.schedule : [];
    const rid = () => Math.random().toString(36).slice(2, 9);
    const clean = days.slice(0, 60).map((d) => ({
      id: (d && d.id && String(d.id).slice(0, 40)) || rid(),
      date: String((d && d.date) || "").slice(0, 20),
      label: String((d && d.label) || "").slice(0, 200),
      items: (Array.isArray(d && d.items) ? d.items : []).slice(0, 300).map((it) => ({
        id: (it && it.id && String(it.id).slice(0, 40)) || rid(),
        time: String((it && it.time) || "").slice(0, 40),
        activity: String((it && it.activity) || "").slice(0, 1000),
        end: String((it && it.end) || "").slice(0, 40),
        room: String((it && it.room) || "").slice(0, 120),
        notes: String((it && it.notes) || "").slice(0, 1000),
        color: String((it && it.color) || "").slice(0, 24),
        done: !!(it && it.done),
        tasks: (Array.isArray(it && it.tasks) ? it.tasks : []).slice(0, 100).map((tk) => ({ id: (tk && tk.id && String(tk.id).slice(0, 40)) || rid(), text: String((tk && tk.text) || "").slice(0, 500), done: !!(tk && tk.done) })),
      })),
    }));
    try {
      const show = await loadShow(p.id);
      const data = show.data || {};
      data.schedule = clean;
      await saveShowData(p.id, data);
      return j(res, 200, { ok: true });
    } catch (e) {
      return j(res, 500, { error: e.message || "Server error" });
    }
  }

  res.status(405).end();
}
