// /api/onboard
// GET  ?generate=1  — generate a shareable crew link (admin only)
// GET  ?token=xxx   — serve the crew onboarding form (anyone with the link)
// POST ?token=xxx   — save/update crew submission
//
// The token is HMAC-signed with your existing APP_SECRET — no new env vars.
// Links are valid for 60 days. Regenerate to invalidate old links.
//
// ---- what this endpoint may and may not write ------------------------------
// This is the only PUBLIC write path in the application: anyone holding a link
// can POST to it. So it writes exactly one kind of record — a person — and
// never touches the "__positions__" record that holds the master position
// list. A crew member can SUGGEST a position; only an admin, through
// /api/roster, can add one. That boundary is the whole reason the suggestion
// is stored on the person rather than appended to the list.
import { auth, isAdmin, supabaseRest, signToken, verifyToken } from "./_lib.js";
import { DEFAULT_POSITIONS } from "./roster.js";

const POS_KEY = "__positions__";
const DURATION = 1000 * 60 * 60 * 24 * 60; // 60 days

const verify = (t) => {
  const p = verifyToken(t);
  return p?.scope === "onboard" ? p : null;
};

/* Position names are admin-authored, but they still reach the browser inside
   an attribute, so they are escaped rather than trusted. */
const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/* jsonb comes back as an object, but a row written while this lived in
   Airtable may still hold a JSON string. Accept both. */
function asData(v) {
  if (v && typeof v === "object") return v;
  if (typeof v === "string") { try { return JSON.parse(v) || {}; } catch { return {}; } }
  return {};
}

/* The same list /api/roster serves, read from the same row. A failure here
   falls back to the shared default rather than to an empty form: a crew member
   staring at no positions at all would type into the Other box, and you would
   approve seventeen suggestions you already had. */
async function getPositions() {
  try {
    const rows = await supabaseRest(
      "GET", `/roster?name=eq.${encodeURIComponent(POS_KEY)}&select=data&limit=1`, null);
    const d = rows && rows[0] ? asData(rows[0].data) : null;
    if (d && Array.isArray(d.positions) && d.positions.length) return d.positions;
  } catch {}
  return DEFAULT_POSITIONS;
}

/* Match on name, exactly as the Airtable version did, so a crew member filling
   the form twice updates their record rather than creating a second one.
   The config row is excluded from the match: nobody is called __positions__,
   but this is a public endpoint and the cost of being sure is one query
   parameter. */
async function upsert(name, data) {
  const enc = encodeURIComponent(name);
  const rows = await supabaseRest(
    "GET",
    `/roster?name=eq.${enc}&name=neq.${encodeURIComponent(POS_KEY)}&select=id,data&limit=1`,
    null
  );
  const now = new Date().toISOString();
  if (rows && rows[0]) {
    /* MERGE, never replace. This form does not ask about rate, rateType or
       notes — those are yours, set in the app — so writing a fresh object would
       erase them the moment somebody re-submitted to correct their phone
       number. Only the keys the form actually collected are overlaid. */
    const merged = { ...asData(rows[0].data), ...data };
    await supabaseRest("PATCH", `/roster?id=eq.${encodeURIComponent(rows[0].id)}`,
      { name, data: merged, updated_at: now });
  } else {
    await supabaseRest("POST", "/roster", { name, data, updated_at: now }, "return=minimal");
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
.opt{font-weight:500;color:#94A3B8}
.submit{width:100%;background:#0F1E35;color:#fff;border:none;border-radius:10px;padding:14px;font-size:15px;font-weight:700;cursor:pointer;margin-top:20px}
.submit:hover{background:#1a2f50}
.submit:disabled{opacity:.55;cursor:not-allowed}
.msg{text-align:center;padding:40px 24px}
.msg-icon{font-size:48px;margin-bottom:16px}
.msg-title{font-size:20px;font-weight:700;color:#0F1E35;margin-bottom:8px}
.msg-body{font-size:14px;color:#64748B;line-height:1.6}
.hint{font-size:12.5px;color:#64748B;line-height:1.55;margin:-2px 0 12px}
.hint.sm{font-size:11.5px;margin:2px 0 0}
.err{background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:10px 14px;font-size:13px;color:#DC2626;margin-top:12px;display:none}
/* position chips — tappable, and big enough to hit on a phone */
.chips{display:flex;flex-wrap:wrap;gap:7px}
.chip{display:inline-flex;align-items:center;gap:6px;border:1px solid #D8DEE7;border-radius:20px;padding:7px 13px;font-size:13px;font-weight:600;color:#475569;cursor:pointer;background:#fff;user-select:none;line-height:1.2}
.chip input{position:absolute;opacity:0;width:0;height:0;margin:0}
.chip:has(input:checked){background:#0F1E35;border-color:#0F1E35;color:#fff}
.chip:has(input:focus-visible){box-shadow:0 0 0 3px rgba(37,99,235,.25)}
.check{display:flex;align-items:flex-start;gap:10px;font-size:13.5px;color:#334155;font-weight:600;line-height:1.45;cursor:pointer;padding:11px 13px;border:1px solid #D8DEE7;border-radius:10px;background:#fff}
.check input{width:18px;height:18px;flex:0 0 auto;margin-top:1px;accent-color:#0F1E35}
.check span{font-weight:500;color:#64748B;display:block;font-size:12.5px;margin-top:2px}
/* privacy */
.priv{margin-top:22px;border-top:1px solid #E2E8F0;padding-top:16px}
.priv-lead{font-size:12.5px;color:#475569;line-height:1.6}
.priv details{margin-top:8px}
.priv summary{font-size:12.5px;font-weight:700;color:#2563EB;cursor:pointer;padding:4px 0}
.priv-body{font-size:12px;color:#64748B;line-height:1.65;margin-top:8px}
.priv-body h4{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#94A3B8;margin:14px 0 5px}
.priv-body ul{margin:0 0 0 17px}
.priv-body li{margin:3px 0}
@media(max-width:480px){.grid{grid-template-columns:1fr}}
</style></head><body>
<div class="card">${content}</div>
${extra}
</body></html>`;
}

/* The privacy notice lives on the page rather than behind a link, because a
   link to a policy is a link nobody opens. The one-line summary is the part
   that gets read; the detail is there for anyone who wants it. */
function privacyBlock() {
  return `
  <div class="priv">
    <div class="priv-lead">
      <strong>How we use this.</strong> To book your travel, get you on a call sheet and
      look after you on site. We never sell your information and never share your mobile
      number for marketing.
    </div>
    <details>
      <summary>Read the full privacy notice</summary>
      <div class="priv-body">
        <h4>Why the ID details</h4>
        Airlines require the name, date of birth and gender on a ticket to match your ID
        exactly &mdash; a TSA rule, not ours. We use those three for booking travel and
        nothing else, and never in any decision about whether you get work.

        <h4>The sensitive ones</h4>
        <ul>
          <li><strong>Dietary restrictions</strong> go to catering as counts and requirements
              &mdash; &ldquo;one vegetarian, one nut allergy&rdquo; &mdash; never as a list of
              names and conditions.</li>
          <li><strong>Your Known Traveler Number</strong> is used when booking your flights
              and nowhere else.</li>
        </ul>
        The travel fields are optional &mdash; leave any of them blank and the only
        consequence is we may come back to you before booking a flight. The
        fields marked with a red asterisk are the ones we cannot book you
        without.

        <h4>What we never ask for here</h4>
        Not your passport number &mdash; only the expiry date. Not your Social Security
        number. Not your bank details. Not your address. If a job later needs any of those,
        we will ask separately and say why.

        <h4>Who sees it</h4>
        <ul>
          <li>The people at Touchstone who staff and run shows.</li>
          <li>Venues and clients &mdash; usually just your name and position, for a credential.</li>
          <li>Airlines, hotels and transport, when we are booking for you.</li>
          <li>Our accountant and payroll provider, for paying you.</li>
        </ul>

        <h4>Text messages</h4>
        If you give us your mobile we may text you about jobs &mdash; call times, schedule
        changes, gear questions. Message frequency varies. Message and data rates may
        apply. Reply STOP to stop all texts or HELP for help. Stopping texts does not
        affect your work with us. Your number is never shared with third parties.

        <h4>How long we keep it</h4>
        While you work with us, and as long afterwards as we might call you for another
        job. Travel details for as long as we may be booking for you &mdash; ask and we
        clear them sooner. Payment and tax records for as long as the law requires.

        <h4>Changing or deleting it</h4>
        Email [YOUR SUPPORT EMAIL] and ask. You can see what we hold, correct it, delete
        it, clear just the travel details, or stop the texts. No form, no reason needed,
        and we reply within 30 days.

        <h4>Security</h4>
        This is a private, invite-only system. The link you used expires after 60 days and
        we can revoke it sooner. If anything involving your information goes wrong, we
        will tell you promptly.
      </div>
    </details>
  </div>`;
}

function formPage(token, positions) {
  const chips = positions.map((p, i) =>
    `<label class="chip"><input type="checkbox" class="posbox" value="${esc(p)}" id="pos${i}">${esc(p)}</label>`
  ).join("");

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
    <div class="fld full">
      <label>Positions <span class="req">*</span> <span class="opt">&mdash; tap all that you work</span></label>
      <div class="chips">${chips}</div>
      <input id="positionOther" placeholder="Something else? Type it here" style="margin-top:9px">
      <div class="hint sm">Anything you type goes to your production manager to add to the list.</div>
    </div>
    <div class="fld"><label>Phone <span class="req">*</span></label><input id="phone" type="tel" placeholder="(555) 000-0000"></div>
    <div class="fld full"><label>Email <span class="req">*</span></label><input id="email" type="email" placeholder="you@email.com"></div>
    <div class="fld"><label>Your rate <span class="req">*</span></label>
      <input id="rateAsk" inputmode="decimal" placeholder="650"></div>
    <div class="fld"><label>Per</label>
      <select id="rateAskType"><option value="day">Day</option><option value="hourly">Hour</option></select>
    </div>
    <div class="fld full"><div class="hint sm">What you normally charge. This is a starting point for a
      conversation, not a booking &mdash; whatever we have already agreed with you stands.</div></div>
  </div>
  <div class="sect">Personal &amp; travel</div>
  <div class="hint">Airlines check these against your ID, so the name, birthday and gender have to match it exactly — not a nickname or a shortened first name. We only use them to book your travel.</div>
  <div class="grid">
    <div class="fld full">
      <label class="check"><input type="checkbox" id="travelIntl">
        <div>Willing and able to travel internationally
          <span>Tick this only if you hold a valid passport and can travel abroad for work.</span>
        </div>
      </label>
    </div>
    <div class="fld full"><label>Name exactly as printed on your ID</label><input id="legalName" placeholder="Leave blank if it is the same as above"></div>
    <div class="fld"><label>Birthday</label><input id="birthday" type="date"></div>
    <div class="fld"><label>Gender on your ID</label>
      <select id="gender"><option value="">—</option><option value="M">M</option><option value="F">F</option><option value="X">X</option></select>
    </div>
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
    <div class="fld"><label>Name <span class="req">*</span></label><input id="emergencyName" placeholder="Contact name"></div>
    <div class="fld"><label>Phone <span class="req">*</span></label><input id="emergencyPhone" type="tel" placeholder="(555) 000-0000"></div>
  </div>
  <div id="err" class="err"></div>
  <button class="submit" id="sub">Submit my info</button>
  ${privacyBlock()}
</div>`,
  `<script>
document.getElementById('sub').onclick=async()=>{
  const name=document.getElementById('name').value.trim();
  const show=function(m,id){var e=document.getElementById('err');e.textContent=m;e.style.display='block';
    var f=id&&document.getElementById(id); if(f){f.focus();f.scrollIntoView({block:'center',behavior:'smooth'});} };
  const digits=function(id){return document.getElementById(id).value.replace(/[^0-9]/g,'')};
  const picked=Array.prototype.slice.call(document.querySelectorAll('.posbox')).filter(function(b){return b.checked});
  if(!name){show('Name is required.','name');return;}
  if(!picked.length&&!document.getElementById('positionOther').value.trim()){show('Please choose at least one position, or type one in the box.','positionOther');return;}
  if(digits('phone').length<10){show('A phone number with at least 10 digits is required.','phone');return;}
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(document.getElementById('email').value.trim())){show('A valid email address is required.','email');return;}
  if(!(parseFloat(document.getElementById('rateAsk').value.replace(/[^0-9.]/g,''))>0)||/-\s*[0-9]/.test(document.getElementById('rateAsk').value)){show('Please give your rate as a number.','rateAsk');return;}
  if(!document.getElementById('emergencyName').value.trim()){show('An emergency contact name is required.','emergencyName');return;}
  if(digits('emergencyPhone').length<10){show('An emergency contact phone with at least 10 digits is required.','emergencyPhone');return;}
  const btn=document.getElementById('sub');
  btn.disabled=true;btn.textContent='Saving…';
  document.getElementById('err').style.display='none';
  const get=id=>document.getElementById(id).value;
  const positions=Array.prototype.slice.call(document.querySelectorAll('.posbox'))
    .filter(function(b){return b.checked}).map(function(b){return b.value});
  try{
    const r=await fetch('/api/onboard?token=${token}',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name,positions:positions,positionOther:get('positionOther'),
        travelIntl:document.getElementById('travelIntl').checked,
        phone:get('phone'),email:get('email'),
        rateAsk:get('rateAsk'),rateAskType:get('rateAskType'),
        legalName:get('legalName'),gender:get('gender'),
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
    const bad = (m) => { res.status(400).setHeader("Content-Type","application/json").end(JSON.stringify({error:m})); };
    if (!name) { bad("Name is required."); return; }

    try {
      const known = await getPositions();

      /* Only positions that are really on the list are accepted. Without this,
         a crafted POST could put any string on a person's record and it would
         show up in the roster as though an admin had created it. The "Other"
         box below is the sanctioned way in, and it goes somewhere else. */
      const chosen = (Array.isArray(body.positions) ? body.positions : [])
        .map((p) => String(p || "").trim())
        .filter((p) => known.includes(p))
        .slice(0, 20);

      const suggestRaw = String(body.positionOther || "").trim().slice(0, 60);

      /* Typing a position that already exists is not a suggestion, it is a
         clumsy way of ticking the chip — so treat it as one. Without this,
         someone who types "Rigger" instead of tapping it is told to choose a
         position when they plainly just did. */
      const alreadyKnown = suggestRaw
        ? known.find((k) => k.toLowerCase() === suggestRaw.toLowerCase()) : null;
      if (alreadyKnown && !chosen.some((c) => c.toLowerCase() === alreadyKnown.toLowerCase())) {
        chosen.push(alreadyKnown);
      }

      /* A real suggestion: something not on the list and not already ticked.
         Stored ON THE PERSON, never appended to the master list — adding to
         that list is an admin action through /api/roster, and this is a public
         endpoint. */
      const suggest = suggestRaw && !alreadyKnown &&
        !chosen.some((c) => c.toLowerCase() === suggestRaw.toLowerCase())
          ? suggestRaw : "";

      /* Digits and one decimal point. A crew member typing "$650/day" should
         not end up stored as a string the roster cannot compare or sort, and a
         blank stays blank rather than becoming 0 — which would read as
         "works for free" rather than "did not say". */
      const rateSrc = String(body.rateAsk == null ? "" : body.rateAsk);
      /* Checked BEFORE stripping: removing every non-digit turns "-500" into
         "500", which is how a negative rate would have got through. */
      const rateNegative = /-\s*[0-9]/.test(rateSrc);
      const rateRaw = rateSrc.replace(/[^0-9.]/g, "");
      const rateNum = rateRaw ? Number(rateRaw) : NaN;
      const rateAsk = !rateNegative && Number.isFinite(rateNum) && rateNum > 0
        ? String(Math.round(rateNum * 100) / 100) : "";

      /* Enforced HERE as well as in the browser. This endpoint is public — a
         POST can arrive without ever having loaded the form, so client-side
         validation is a courtesy and this is the actual rule. */
      const digits = String(body.phone || "").replace(/[^0-9]/g, "");
      const email = String(body.email || "").trim();
      const emName = String(body.emergencyName || "").trim();
      const emPhone = String(body.emergencyPhone || "").replace(/[^0-9]/g, "");

      /* A position OR something typed in the Other box. Requiring a ticked chip
         alone would trap anyone whose role is not on the list yet — they would
         have no way to submit at all. */
      if (!chosen.length && !suggest) { bad("Please choose at least one position, or type one in the box."); return; }
      if (digits.length < 10) { bad("A phone number with at least 10 digits is required."); return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { bad("A valid email address is required."); return; }
      if (!rateAsk) { bad("Please give your rate as a number."); return; }
      if (!emName) { bad("An emergency contact name is required."); return; }
      if (emPhone.length < 10) { bad("An emergency contact phone with at least 10 digits is required."); return; }

      await upsert(name, {
        positions: chosen,
        // Kept so anything still reading the old single field keeps working.
        position: chosen[0] || "",
        positionSuggest: suggest,
        travelIntl: body.travelIntl === true,
        phone: body.phone || "",
        email: body.email || "",
        /* What they ASK for, deliberately not `rate`. `rate` is what you have
           agreed to pay and is set in the app; nothing arriving through a
           public form is allowed to change it. The roster shows the two side by
           side so a difference is visible rather than silent. */
        rateAsk: rateAsk,
        rateAskType: body.rateAskType === "hourly" ? "hourly" : "day",
        legalName: body.legalName || "",
        gender: body.gender || "",
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
