// The show packet: one renderer per section, drawing onto the _pdf.js writer.
//
// WHAT GOES IN A PACKET
//   Only what a crew member needs at a venue. The show record carries rates
//   and a timesheet; neither belongs in a document that lands in thirty
//   inboxes and gets forwarded. buildPacket() strips the record for the CREW
//   role before any renderer sees it — the same stripShowForRole() that
//   /api/events uses, so the packet can never disagree with the screen.
//
//   That strip is BELT AND BRACES on top of renderers that never ask for those
//   fields. It is here for the day somebody adds a column to the crew table
//   and does not think about who receives this.
import { stripShowForRole } from "./_lib.js";
import { newDoc, makeWriter, ascii } from "./_pdf.js";

export const SECTIONS = [
  { key: "brief",    label: "Crew Brief" },
  { key: "schedule", label: "Schedule" },
  { key: "rundown",  label: "Run of Show" },
  { key: "audio",    label: "Audio I/O" },
  { key: "video",    label: "Video I/O" },
  { key: "pull",     label: "Pull List" },
];
export const SECTION_KEYS = SECTIONS.map((s) => s.key);

const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const nonEmpty = (row, keys) => keys.some((k) => s(row[k]));

/* EVERY list this file reads goes through here first.
 *
 * WHY, IN ONE SENTENCE: a single null in a crew array used to 500 the whole
 * endpoint, so a show with one stray row could not be messaged at all.
 *
 * The longer version. These lists come out of a JSON blob that has been
 * written by every version of this app there has ever been. A crew array can
 * hold a null where a row was cleared, `schedule` can be an object on a show
 * that predates days, `pull.loose` can be a string on a record somebody
 * imported. Nothing validates the blob on the way in and nothing ever will,
 * because the blob is the schema.
 *
 * A renderer that trusts the shape turns any one of those into a 500 — and a
 * 500 here does not mean "that section came out empty", it means Tyler cannot
 * send his crew anything at all until somebody works out which row is the bad
 * one. Coercing is not sloppiness; it is the difference between a packet with
 * one line missing and no packet.
 *
 * So: not an array -> empty. Entries that are not objects -> dropped. */
const rowsOf = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);

/* Days are sorted by DATE where there is one and by their stored order where
   there is not. A packet whose schedule is out of order is worse than no
   packet — somebody turns up on the wrong day. */
const byDate = (a, b) => {
  const da = s(a.date), db = s(b.date);
  if (da && db) return da.localeCompare(db);
  if (da) return -1;
  if (db) return 1;
  return 0;
};

/* ---------------------------------------------------------------- brief -- */
function brief(w, ev) {
  const venue = ev.venue || {};
  if (s(venue.name) || s(venue.address)) {
    w.subheading("Venue");
    if (s(venue.name)) w.para(venue.name, { bold: true, gap: 2 });
    if (s(venue.address)) w.para(venue.address, { gap: 2 });
    if (s(venue.mapLink)) w.note(venue.mapLink);
    w.gap(6);
  }

  const contacts = rowsOf(ev.contacts).filter((c) => nonEmpty(c, ["name", "role", "phone", "email"]));
  if (contacts.length) {
    w.subheading("Contacts");
    w.table(
      [{ label: "Name", key: "name", w: 2 }, { label: "Role", key: "role", w: 2, dim: true },
       { label: "Phone", key: "phone", w: 1.6 }, { label: "Email", key: "email", w: 2.8, dim: true }],
      contacts.map((c) => ({ name: s(c.name), role: s(c.role || c.title), phone: s(c.phone), email: s(c.email) })),
    );
  }

  const crew = rowsOf(ev.crew).filter((c) => s(c.name));
  if (crew.length) {
    w.subheading("Crew");
    /* Call times live per DAY per person. The packet shows the earliest one
       each person has, labelled as such, because "your call" is the number
       somebody actually needs and the full grid is the Schedule section's job. */
    const callFor = (cid) => {
      const days = rowsOf(ev.schedule).slice().sort(byDate);
      for (const d of days) {
        const t = ev.callTimes && ev.callTimes[d.id] && ev.callTimes[d.id][cid];
        if (s(t)) return s(t);
      }
      return "";
    };
    w.table(
      [{ label: "Name", key: "name", w: 2.2 }, { label: "Position", key: "position", w: 2 },
       { label: "First call", key: "call", w: 1.2 }, { label: "Phone", key: "phone", w: 1.6, dim: true },
       { label: "Email", key: "email", w: 2.6, dim: true }],
      crew.map((c) => ({
        name: s(c.name), position: s(c.position), call: callFor(c.id),
        phone: s(c.phone), email: s(c.email),
      })),
    );
  }

  const wifi = rowsOf(ev.wifi).filter((n) => nonEmpty(n, ["network", "ssid", "password"]));
  if (wifi.length) {
    w.subheading("Wi-Fi");
    w.table(
      [{ label: "Network", key: "network", w: 2 }, { label: "Password", key: "password", w: 2 },
       { label: "Notes", key: "notes", w: 3, dim: true }],
      wifi.map((n) => ({ network: s(n.network || n.ssid), password: s(n.password), notes: s(n.notes) })),
    );
  }

  if (!contacts.length && !crew.length && !s(venue.name) && !s(venue.address)) {
    w.note("Nothing has been filled in on the Brief yet.");
  }
}

/* ------------------------------------------------------------- schedule -- */
function schedule(w, ev) {
  const days = rowsOf(ev.schedule).slice().sort(byDate);
  if (!days.length) { w.note("No schedule has been built yet."); return; }
  let any = false;
  for (const d of days) {
    const items = rowsOf(d.items).filter((i) => nonEmpty(i, ["time", "activity"]));
    if (!items.length && !s(d.label)) continue;
    any = true;
    w.subheading([s(d.label), s(d.date)].filter(Boolean).join("  -  ") || "Day");
    w.table(
      [{ label: "Time", key: "time", w: 1 }, { label: "Activity", key: "activity", w: 5 }],
      items.map((i) => ({ time: s(i.time), activity: s(i.activity) })),
      { empty: "Nothing scheduled for this day yet." },
    );
  }
  if (!any) w.note("No schedule has been built yet.");
}

/* ----------------------------------------------------------- run of show -- */
function rundown(w, ev) {
  const rd = ev.rundown || {};
  /* Columns are user-configurable, so the table is built from whatever this
     show actually has. Image columns are dropped: a packet is text. */
  const cols = rowsOf(rd.columns).filter((c) => c.type !== "image");
  const rdDays = rowsOf(rd.days);
  const days = rdDays.length
    ? rdDays
    : [{ id: "d1", label: "Run of Show", rows: rowsOf(rd.rows) }];

  if (!cols.length) { w.note("This show's run of show has no columns set up."); return; }

  /* Widths by kind: a cue number needs 40pt, a segment name needs room. */
  const share = (c) => (["num", "start", "dur", "end"].includes(c.type) ? 0.9 : 2.4);
  const spec = cols.map((c) => ({ label: s(c.label) || s(c.id), key: c.id, w: share(c) }));

  let any = false;
  for (const d of days) {
    const rows = rowsOf(d.rows).filter((r) => r.kind === "item");
    if (!rows.length) continue;
    any = true;
    const head = [s(d.label) || "Run of Show", s(d.date), s(d.start) ? "start " + s(d.start) : ""]
      .filter(Boolean).join("  -  ");
    w.subheading(head);
    w.table(spec, rows.map((r) => {
      const out = {};
      const cells = (r.cells && typeof r.cells === "object") ? r.cells : {};
      /* Computed columns are not stored in `cells` — they are derived on the
         screen from the day start and the durations. Rendering them blank is
         honest; inventing them here would be a second implementation of
         timing maths that could disagree with the app. */
      for (const c of cols) out[c.id] = s(cells[c.id]);
      return out;
    }));
  }
  if (!any) w.note("No segments have been added to the run of show yet.");
}

/* ------------------------------------------------------------------ I/O -- */
function io(kind) {
  return (w, ev) => {
    const src = (ev[kind] && typeof ev[kind] === "object") ? ev[kind] : {};
    const blocks = rowsOf(src.blocks).filter(
      (b) => rowsOf(b.ins).length || rowsOf(b.outs).length);
    if (!blocks.length) { w.note("No " + kind + " I/O has been entered."); return; }
    const spec = [
      { label: "#", key: "num", w: 0.6, dim: true },
      { label: "Name", key: "name", w: 3 },
      { label: "Patch", key: "patch", w: 1.4, dim: true },
      { label: "Signal", key: "signal", w: 1.2, dim: true },
      { label: "Length", key: "length", w: 1, dim: true },
      { label: "Notes", key: "notes", w: 2.4, dim: true },
    ];
    const rows = (list) => rowsOf(list)
      .filter((r) => nonEmpty(r, ["num", "name", "patch", "signal", "notes"]))
      .map((r) => ({
        num: s(r.num), name: s(r.name), patch: s(r.patch), signal: s(r.signal),
        length: s(r.length) ? s(r.length) + " ft" : "", notes: s(r.notes),
      }));
    for (const b of blocks) {
      const ins = rows(b.ins), outs = rows(b.outs);
      if (!ins.length && !outs.length) continue;
      w.subheading(s(b.name) || "Block");
      if (ins.length) { w.para("Inputs", { size: 9, bold: true, gap: 2 }); w.table(spec, ins); }
      if (outs.length) { w.para("Outputs", { size: 9, bold: true, gap: 2 }); w.table(spec, outs); }
    }
  };
}

/* ------------------------------------------------------------ pull list -- */
function pull(w, ev) {
  const p = (ev.pull && typeof ev.pull === "object") ? ev.pull : {};
  const cases = rowsOf(p.cases).filter((c) => rowsOf(c.items).length);
  const loose = rowsOf(p.loose).filter((i) => nonEmpty(i, ["item", "qty", "notes"]));
  if (!cases.length && !loose.length) { w.note("The pull list is empty."); return; }

  const spec = [
    { label: "Qty", key: "qty", w: 0.7 },
    { label: "Item", key: "item", w: 4 },
    { label: "Drawer", key: "drawer", w: 1.2, dim: true },
    { label: "Source", key: "source", w: 1.6, dim: true },
    { label: "Notes", key: "notes", w: 2.2, dim: true },
  ];
  const line = (i) => ({
    qty: s(i.qty), item: s(i.item), drawer: s(i.drawer),
    /* "Sub Rental" on its own tells a loader nothing. Who it came from is the
       fact that matters when a case is short. */
    source: [s(i.source), s(i.rentedFrom)].filter(Boolean).join(" - "),
    notes: s(i.notes),
  });

  for (const c of cases) {
    const items = rowsOf(c.items).filter((i) => nonEmpty(i, ["item", "qty"]));
    if (!items.length) continue;
    const head = ["Case " + (s(c.caseNo) || "-"), s(c.case), s(c.category)].filter(Boolean).join("  -  ");
    w.subheading(head);
    w.table(spec, items.map(line));
  }
  if (loose.length) {
    w.subheading("Loose items");
    w.table(spec, loose.map(line));
  }
}

const RENDER = {
  brief, schedule, rundown, audio: io("audio"), video: io("video"), pull,
};

/* Build the packet. `sections` is the ticked list, in the order SECTIONS
   declares — not the order they were ticked, so every packet reads the same
   way whoever built it. Returns { bytes, pages, sections }. */
export async function buildPacket(showData, sections, meta) {
  /* THE STRIP. Everything below renders from `ev`, never from `showData`. */
  const ev = stripShowForRole((showData && typeof showData === "object") ? showData : {}, "crew") || {};

  const wanted = SECTIONS.filter((x) => (sections || []).includes(x.key));
  const d = await newDoc();
  const w = makeWriter(d, {
    title: ascii(meta.title || "Crew Packet"),
    subtitle: ascii(meta.subtitle || ""),
    stamp: ascii("As of " + meta.stamp),
  });

  for (const sec of wanted) {
    w.section(sec.label);
    RENDER[sec.key](w, ev);
  }
  w.finish();

  return {
    bytes: await d.doc.save(),
    pages: d.doc.getPages().length,
    sections: wanted.map((x) => x.label),
  };
}
