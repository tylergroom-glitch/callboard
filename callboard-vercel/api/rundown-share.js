// /api/rundown-share
// GET  ?generate=1&id=<showId>&share=<shareId>  — admin: get a signed link for a share profile
// GET  ?token=xxx                                — serve the department rundown view (HTML)
// GET  ?token=xxx&data=1                          — JSON snapshot for the view (planned times precomputed)
// POST ?token=xxx  { rowId, colId, value }        — edit a cell, allowed only for that share's editable columns
//
// Token is HMAC-signed with APP_SECRET and carries the show id + share id, so a link
// can only ever touch its own show, and only the columns the admin marked editable.
import { auth, canManageShow, airtable, signToken, verifyToken } from "./_lib.js";

const DURATION = 1000 * 60 * 60 * 24 * 180; // 180 days

const verify = (t) => {
  const p = verifyToken(t);
  return p && p.scope === "rundownshare" && p.id && p.share ? p : null;
};
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const j = (res, code, obj) => res.status(code).setHeader("Content-Type", "application/json").end(JSON.stringify(obj));

async function loadShow(id) {
  const rec = await airtable("GET", "/" + id);
  const f = rec.fields || {};
  let data = {};
  try { data = f.Data ? JSON.parse(f.Data) : {}; } catch { data = {}; }
  return { name: f.Name || "", data };
}

// --- time parsing (server-side so the browser view needs no regex) ---
function schedMinutes(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  let mer = null;
  const m = s.match(/(a|p)m?\.?$/);
  if (m) { mer = m[1]; s = s.slice(0, m.index); }
  let h, mi;
  if (s.includes(":")) { const pp = s.split(":"); h = parseInt(pp[0], 10); mi = parseInt(pp[1] || "0", 10); }
  else if (/^\d{3,4}$/.test(s)) { h = parseInt(s.slice(0, s.length - 2), 10); mi = parseInt(s.slice(-2), 10); }
  else if (/^\d{1,2}$/.test(s)) { h = parseInt(s, 10); mi = 0; }
  else return null;
  if (isNaN(h)) return null;
  if (mer === "p" && h < 12) h += 12;
  if (mer === "a" && h === 12) h = 0;
  return h * 60 + (mi || 0);
}
function parseDur(v) {
  if (v == null) return 0;
  const t = String(v).trim().toLowerCase();
  if (!t) return 0;
  const c = t.match(/^(\d+):(\d+)$/);
  if (c) return parseInt(c[1], 10) * 60 + parseInt(c[2], 10);
  const hm = t.match(/^(\d+)\s*h\s*(\d+)?\s*m?$/);
  if (hm) return parseInt(hm[1], 10) * 60 + (hm[2] ? parseInt(hm[2], 10) : 0);
  const ho = t.match(/^(\d+(?:\.\d+)?)\s*h$/);
  if (ho) return Math.round(parseFloat(ho[1]) * 60);
  const n = parseFloat(t.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : Math.round(n);
}

function buildData(show, rd, share) {
  const visIds = new Set(share.cols || []);
  const editSet = new Set(share.editCols || []);
  const allCols = Array.isArray(rd.columns) ? rd.columns : [];
  const colById = {};
  allCols.forEach((c) => { colById[c.id] = c; });
  const cols = (share.cols || []).map((id) => colById[id]).filter(Boolean).map((c) => ({ id: c.id, type: c.type, label: c.label, editable: editSet.has(c.id), w: (share.colW || {})[c.id] || 0 }));
  const base = schedMinutes(rd.start);
  let off = 0;
  const rows = (rd.rows || []).map((r) => {
    if (r.kind === "section") return { id: r.id, kind: "section", title: r.title || "", color: r.color || "" };
    const dmin = parseDur(r.dur);
    const pStart = base == null ? null : base + off;
    const pEnd = base == null ? null : base + off + dmin;
    off += dmin;
    const cells = {};
    if (r.cells) Object.keys(r.cells).forEach((k) => { if (visIds.has(k)) cells[k] = r.cells[k]; });
    return { id: r.id, kind: "item", dur: r.dur || "", durSec: dmin * 60, color: r.color || "", done: !!r.done, cells: cells, pStart: pStart, pEnd: pEnd };
  });
  return {
    showName: show.name, shareName: share.name || "Rundown", start: rd.start || "",
    columns: cols, rows: rows, run: rd.run || { on: false }, schedEndMin: base == null ? null : base + off,
  };
}

function errPage(msg) {
  return "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Rundown</title>" +
    "<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1115;color:#e5e7eb;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}" +
    ".b{text-align:center;max-width:340px;padding:24px}.i{font-size:34px;margin-bottom:12px}.t{font-size:17px;font-weight:700;margin-bottom:8px}.s{color:#9ca3af;font-size:14px}</style></head>" +
    "<body><div class='b'><div class='i'>\uD83D\uDD12</div><div class='t'>" + esc(msg) + "</div><div class='s'>Ask your production manager for a fresh link.</div></div></body></html>";
}

function page(token, showName, shareName) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${showName} — ${shareName}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f1115;color:#e5e7eb;padding:16px}
.top{display:flex;flex-wrap:wrap;gap:16px 24px;justify-content:space-between;align-items:center;background:#171a21;border:1px solid #262b36;border-radius:12px;padding:14px 18px;margin-bottom:14px}
.ttl{font-size:15px;font-weight:800}.ttl small{display:block;color:#9ca3af;font-weight:500;font-size:12px;margin-top:2px}
.clk{display:flex;gap:22px;align-items:center;flex-wrap:wrap}
.cbox{display:flex;flex-direction:column;align-items:flex-end}
.cseg{font-size:11px;color:#9ca3af;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ccount{font-size:26px;font-weight:800;color:#22c55e;font-variant-numeric:tabular-nums}.ccount.over{color:#f87171}
.fld{display:flex;flex-direction:column;gap:1px}.fld span{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;font-weight:700}
.fld b{font-size:16px;font-variant-numeric:tabular-nums}.fld em{font-size:12px;font-style:normal;font-weight:700;color:#9ca3af}
.fld em.lt{color:#f87171}.fld em.er{color:#22c55e}
.wrap{overflow-x:auto}
.rhead{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;font-weight:700;padding:0 6px 6px 12px}
.rrow{padding:7px 6px;border-radius:0 6px 6px 0;margin-bottom:4px}
.rsec{font-weight:800;font-size:14px;padding:9px 12px;margin:14px 0 6px;border-radius:0 6px 6px 0}
.rnum{color:#6b7280;font-weight:700;text-align:center}
.rtime{color:#9ca3af;font-variant-numeric:tabular-nums;font-size:13px}
.rlive{outline:2px solid #22c55e;outline-offset:-2px}
.rdone{opacity:.48;text-decoration:line-through}
.rin{width:100%;background:#0e1420;border:1px solid #2b3345;color:#e5e7eb;border-radius:6px;padding:7px 8px;font-size:13px;font-family:inherit}
.rin:focus{outline:none;border-color:#3b82f6}
.rth{position:relative;display:flex;align-items:center;gap:6px;overflow:hidden}
.rthlabel{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rthbtns{display:flex;gap:2px;opacity:0;transition:opacity .1s}
.rth:hover .rthbtns{opacity:1}
.rmv{background:#1c2230;border:1px solid #2b3345;color:#9ca3af;border-radius:4px;font-size:9px;line-height:1.2;padding:2px 5px;cursor:pointer}
.rmv:hover{color:#fff;border-color:#3b82f6}
.rrsz{position:absolute;top:-6px;right:-4px;width:10px;height:calc(100% + 12px);cursor:col-resize;touch-action:none;z-index:3;border-radius:2px}
.rrsz:hover{background:rgba(0,180,216,.4)}
.foot{color:#6b7280;font-size:12px;margin-top:14px;text-align:center}
.prog{height:8px;background:#1c2230;border:1px solid #2b3345;border-radius:6px;overflow:hidden;margin-bottom:14px}
.progfill{height:100%;border-radius:6px;transition:width .4s linear,background .3s}
</style></head>
<body>
<div class="top">
  <div class="ttl">${shareName}<small>${showName}</small></div>
  <div class="clk">
    <div class="cbox" id="cbox" style="display:none"><span class="cseg" id="cseg"></span><span class="ccount" id="ccount"></span></div>
    <div class="fld"><span>Time of day</span><b id="tod">—</b></div>
    <div class="fld"><span>Rundown ends</span><b id="ends">—</b><em id="late"></em></div>
  </div>
</div>
<div class="prog" id="prog" style="display:none"><div class="progfill" id="progfill"></div></div>
<div class="wrap"><div id="tbl"></div></div>
<div class="foot">Live view · updates automatically · you can edit only the highlighted columns</div>
<script>
var TOKEN=${JSON.stringify(token)};
var API="/api/rundown-share?token="+encodeURIComponent(TOKEN);
var DATA=null;
var COLORS={green:["#22C55E","rgba(34,197,94,.14)"],tan:["#D9A441","rgba(217,164,65,.14)"],blue:["#3B82F6","rgba(59,130,246,.15)"],red:["#EF4444","rgba(239,68,68,.15)"],orange:["#F97316","rgba(249,115,22,.15)"],purple:["#A855F7","rgba(168,85,247,.15)"],gray:["#64748B","rgba(100,116,139,.17)"]};
function bar(c){return (COLORS[c]&&COLORS[c][0])||"transparent";}
function bgc(c){return (COLORS[c]&&COLORS[c][1])||"transparent";}
function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function fmtTOD(min){if(min==null||isNaN(min))return "\u2014";var m=Math.round(min);m=((m%1440)+1440)%1440;var h=Math.floor(m/60),mm=m%60;var ap=h<12?"AM":"PM";var h12=h%12;if(h12===0)h12=12;return h12+":"+String(mm).padStart(2,"0")+" "+ap;}
function todClock(ms){var d=new Date(ms);var h=d.getHours();var ap=h<12?"AM":"PM";var h12=h%12||12;return h12+":"+String(d.getMinutes()).padStart(2,"0")+":"+String(d.getSeconds()).padStart(2,"0")+" "+ap;}
function fmtClock(sec){var neg=sec<0;var a=Math.abs(Math.round(sec));var m=Math.floor(a/60),ss=a%60;return (neg?"-":"")+m+":"+String(ss).padStart(2,"0");}
function fmtLate(sec){var r=Math.round(sec);if(Math.abs(r)<30)return "on time";var a=Math.abs(r),m=Math.floor(a/60),ss=a%60;var b=(m?m+"m ":"")+ss+"s";return (r>0?"+":"\u2212")+b+(r>0?" late":" early");}
function colW(c){if(c.w)return c.w+"px";return c.type==="num"?"48px":(c.type==="start"||c.type==="end")?"92px":c.type==="dur"?"72px":"minmax(120px,1fr)";}
function tmpl(){return DATA.columns.map(function(c){return colW(c);}).join(" ");}
function minw(){var s=0;DATA.columns.forEach(function(c){s+=c.w?c.w:(c.type==="num"?48:(c.type==="start"||c.type==="end")?92:c.type==="dur"?72:120);});return s+8*DATA.columns.length+20;}
function items(){return DATA.rows.filter(function(r){return r.kind==="item";});}
function segName(seg){if(!seg)return "";if(seg.cells){for(var k in seg.cells){if(seg.cells[k]&&String(seg.cells[k]).trim())return seg.cells[k];}}return "Segment";}
function render(){
  if(!DATA)return;
  var T=tmpl();var MW=minw();
  var head="<div class='rhead' style='display:grid;grid-template-columns:"+T+";gap:8px;min-width:"+MW+"px'>";
  DATA.columns.forEach(function(c){head+="<div class='rth'><span class='rthlabel'>"+esc(c.label)+"</span><span class='rthbtns'><button class='rmv' data-col='"+c.id+"' data-dir='left' title='Move left'>◀</button><button class='rmv' data-col='"+c.id+"' data-dir='right' title='Move right'>▶</button></span><span class='rrsz' data-col='"+c.id+"'></span></div>";});head+="</div>";
  var its=items();var out="";
  DATA.rows.forEach(function(r){
    if(r.kind==="section"){out+="<div class='rsec' style='min-width:"+MW+"px;border-left:4px solid "+bar(r.color)+";background:"+bgc(r.color)+"'>"+esc(r.title)+"</div>";return;}
    var live=DATA.run&&DATA.run.on&&its[DATA.run.segIdx]&&its[DATA.run.segIdx].id===r.id;
    var num=its.indexOf(r)+1;
    out+="<div class='rrow"+(live?" rlive":"")+(r.done?" rdone":"")+"' style='display:grid;grid-template-columns:"+T+";gap:8px;align-items:center;min-width:"+MW+"px;border-left:4px solid "+bar(r.color)+";background:"+(live?"rgba(34,197,94,.12)":bgc(r.color))+"'>";
    DATA.columns.forEach(function(c){
      var cell;
      if(c.type==="num")cell="<span class='rnum'>"+num+"</span>";
      else if(c.type==="start")cell="<span class='rtime'>"+(r.pStart==null?"\u2014":fmtTOD(r.pStart))+"</span>";
      else if(c.type==="end")cell="<span class='rtime'>"+(r.pEnd==null?"\u2014":fmtTOD(r.pEnd))+"</span>";
      else{var cv=c.type==="dur"?(r.dur||""):(r.cells&&r.cells[c.id]?r.cells[c.id]:"");
        if(c.editable)cell="<input class='rin' data-row='"+r.id+"' data-col='"+c.id+"' value='"+esc(cv)+"'>";
        else if(c.type==="link"&&cv)cell="<a href='"+esc(cv)+"' target='_blank' rel='noreferrer' style='color:#00B4D8;font-weight:600'>Open ↗</a>";
        else cell="<span>"+esc(cv)+"</span>";}
      out+="<div>"+cell+"</div>";
    });
    out+="</div>";
  });
  document.getElementById("tbl").innerHTML=head+out;
  var ins=document.querySelectorAll("#tbl .rin");
  ins.forEach(function(i){i.addEventListener("change",function(){save(i.getAttribute("data-row"),i.getAttribute("data-col"),i.value);});});
  document.querySelectorAll("#tbl .rmv").forEach(function(b){b.addEventListener("click",function(e){e.preventDefault();e.stopPropagation();layout(b.getAttribute("data-col"),b.getAttribute("data-dir"));});});
  document.querySelectorAll("#tbl .rrsz").forEach(function(h){h.addEventListener("pointerdown",function(e){e.preventDefault();e.stopPropagation();var th=h.parentElement;var w=th.getBoundingClientRect().width;RS={col:h.getAttribute("data-col"),startX:e.clientX,startW:w,w:Math.round(w)};});});
  clock();
}
function clock(){
  if(!DATA)return;
  var its=items();var run=DATA.run||{};var now=Date.now();
  document.getElementById("tod").textContent=todClock(now);
  var endEl=document.getElementById("ends"),lateEl=document.getElementById("late"),cbox=document.getElementById("cbox");
  var schedEnd=DATA.schedEndMin;
  if(run.on&&its[run.segIdx]){
    var seg=its[run.segIdx];var el=(now-run.segStart)/1000;var rem=seg.durSec-el;
    var poff=0;for(var i=0;i<run.segIdx;i++)poff+=its[i].durSec;
    var aoff=(run.segStart-run.showStart)/1000;var over=Math.max(0,el-seg.durSec);var late=(aoff-poff)+over;
    cbox.style.display="";document.getElementById("cseg").textContent="On air: "+segName(seg);
    var cc=document.getElementById("ccount");cc.textContent=fmtClock(rem);cc.className="ccount"+(rem<0?" over":"");
    endEl.textContent=schedEnd==null?"\u2014":fmtTOD(schedEnd+late/60);
    lateEl.textContent=fmtLate(late);lateEl.className=(late>30?"lt":late<-30?"er":"");
  }else{cbox.style.display="none";endEl.textContent=schedEnd==null?"\u2014":fmtTOD(schedEnd);lateEl.textContent="";}
  var prog=document.getElementById("prog"),pf=document.getElementById("progfill");
  if(run.on){var tot=0;its.forEach(function(x){tot+=x.durSec;});var elp=(now-run.showStart)/1000;var frac=tot>0?Math.min(1,Math.max(0,elp/tot)):0;var ov=elp>tot;prog.style.display="";pf.style.width=(frac*100)+"%";pf.style.background=ov?"#EF4444":(frac>0.85?"#F59E0B":"#00B4D8");}else{prog.style.display="none";}
}
function save(rowId,colId,value){fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({rowId:rowId,colId:colId,value:value})}).then(function(r){return r.json();}).catch(function(){});}
function load(){fetch(API+"&data=1").then(function(r){return r.json();}).then(function(d){DATA=d;render();}).catch(function(){});}
var RS=null;
function applyColW(col,w){for(var k=0;k<DATA.columns.length;k++){if(DATA.columns[k].id===col)DATA.columns[k].w=w;}var T=tmpl(),MW=minw();document.querySelectorAll("#tbl .rrow, #tbl .rhead").forEach(function(el){el.style.gridTemplateColumns=T;el.style.minWidth=MW+"px";});document.querySelectorAll("#tbl .rsec").forEach(function(el){el.style.minWidth=MW+"px";});}
function layoutColW(col,w){fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({op:"colw",colId:col,w:w})}).catch(function(){});}
function layout(col,dir){fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({op:"reorder",colId:col,dir:dir})}).then(function(){load();}).catch(function(){});}
document.addEventListener("pointermove",function(e){if(!RS)return;RS.w=Math.max(50,Math.round(RS.startW+(e.clientX-RS.startX)));applyColW(RS.col,RS.w);});
document.addEventListener("pointerup",function(){if(!RS)return;var col=RS.col,w=RS.w;RS=null;layoutColW(col,w);});
setInterval(clock,1000);
function poll(){var a=document.activeElement;if(!(a&&a.classList&&a.classList.contains("rin")))load();setTimeout(poll,(DATA&&DATA.run&&DATA.run.on)?3000:15000);}
setTimeout(poll,3000);
load();
</script>
</body></html>`;
}

export default async function handler(req, res) {
  const q = req.query || {};
  const token = q.token;

  if (q.generate) {
    if (req.method !== "GET") { res.status(405).end(); return; }
    const id = q.id, share = q.share;
    const p = auth(req);
    if (!id || !share) return j(res, 400, { error: "id and share required" });
    if (!canManageShow(p, id)) return j(res, 403, { error: "Admin only" });
    const t = signToken({ scope: "rundownshare", id, share, exp: Date.now() + DURATION });
    const host = req.headers.host || "";
    const protocol = host.startsWith("localhost") ? "http" : "https";
    return j(res, 200, { url: `${protocol}://${host}/api/rundown-share?token=${t}` });
  }

  const p = token ? verify(token) : null;
  if (!p) { res.status(403).setHeader("Content-Type", "text/html").end(errPage("Link invalid or expired")); return; }

  let show;
  try { show = await loadShow(p.id); } catch { res.status(500).setHeader("Content-Type", "text/html").end(errPage("Could not load the show")); return; }
  const rd = (show.data && show.data.rundown) || {};
  const shares = Array.isArray(rd.shares) ? rd.shares : [];
  const share = shares.find((x) => x.id === p.share);
  if (!share) { res.status(403).setHeader("Content-Type", "text/html").end(errPage("This link was turned off")); return; }

  if (req.method === "GET" && q.data) return j(res, 200, buildData(show, rd, share));
  if (req.method === "GET") { res.status(200).setHeader("Content-Type", "text/html").end(page(token, esc(show.name), esc(share.name || "Rundown"))); return; }

  if (req.method === "POST") {
    let body;
    try { const ch = []; for await (const c of req) ch.push(c); body = JSON.parse(Buffer.concat(ch).toString("utf8") || "{}"); }
    catch { return j(res, 400, { error: "Bad request" }); }
    if (body.op === "colw" || body.op === "reorder") {
      try {
        const fresh = await loadShow(p.id);
        const frd = (fresh.data && fresh.data.rundown) || {};
        const sh = (Array.isArray(frd.shares) ? frd.shares : []).find((x) => x.id === p.share);
        if (!sh) return j(res, 404, { error: "Share not found" });
        if (body.op === "colw") {
          if (!(sh.cols || []).includes(body.colId)) return j(res, 403, { error: "Not a visible column" });
          if (!sh.colW) sh.colW = {};
          sh.colW[body.colId] = Math.max(50, Math.min(900, Math.round(Number(body.w) || 120)));
        } else {
          if (!Array.isArray(sh.cols)) sh.cols = [];
          const i = sh.cols.indexOf(body.colId), dir = body.dir === "left" ? -1 : 1, nj = i + dir;
          if (i >= 0 && nj >= 0 && nj < sh.cols.length) { const [x] = sh.cols.splice(i, 1); sh.cols.splice(nj, 0, x); }
        }
        await airtable("PATCH", "/" + p.id, { fields: { Data: JSON.stringify(fresh.data), UpdatedAt: new Date().toISOString() } });
        return j(res, 200, { ok: true });
      } catch (e) { return j(res, 500, { error: e.message || "Server error" }); }
    }
    const rowId = body.rowId, colId = body.colId;
    const value = String(body.value == null ? "" : body.value).slice(0, 2000);
    const editCols = Array.isArray(share.editCols) ? share.editCols : [];
    if (!colId || !editCols.includes(colId)) return j(res, 403, { error: "That column isn't editable on this link" });
    try {
      const fresh = await loadShow(p.id);
      const frd = (fresh.data && fresh.data.rundown) || {};
      const row = (frd.rows || []).find((r) => r.id === rowId && r.kind === "item");
      if (!row) return j(res, 404, { error: "Row not found" });
      if (colId === "dur") row.dur = value;
      else { if (!row.cells) row.cells = {}; row.cells[colId] = value; }
      await airtable("PATCH", "/" + p.id, { fields: { Data: JSON.stringify(fresh.data), UpdatedAt: new Date().toISOString() } });
      return j(res, 200, { ok: true });
    } catch (e) { return j(res, 500, { error: e.message || "Server error" }); }
  }

  res.status(405).end();
}
