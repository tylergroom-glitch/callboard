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

/* "2026-09-24" -> "Thu 24 Sep".
 *
 * Built from the STRING's own parts, never by parsing it with Date(). Passing
 * "2026-09-24" to the Date constructor makes it midnight UTC, which on a
 * server west of Greenwich is the evening BEFORE — so a check-in date would
 * print one day early for half the world and be right in testing. Constructing
 * from components is local-time by definition and cannot slip.
 *
 * An unparseable value comes back unchanged rather than as "Invalid Date":
 * a date somebody typed oddly should still show what they typed. */
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDay(v) {
  const t = s(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return t;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return t;
  const dt = new Date(y, mo - 1, d);
  if (dt.getMonth() !== mo - 1) return t;   // 31 Feb and friends
  return DOW[dt.getDay()] + " " + d + " " + MON[mo - 1];
}

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
  /* ---- what this job actually is ----
     A paragraph at the top, before any address. Somebody who has worked four
     shows this month opens this and needs one sentence telling them which one
     it is and what the client cares about. Everything below is logistics; this
     is the only part that is context. */
  const about = s(ev.clientBrief);
  if (about) {
    w.subheading("About this show");
    w.para(about, { gap: 8 });
  }

  /* ---- what to wear ----
     Its own line, not buried in a notes field, because it is the one
     instruction people get wrong and it is the one that is visible from the
     back of the room. */
  const dress = s(ev.dressCode);
  if (dress) {
    w.subheading("Dress code");
    w.para(dress, { bold: true, gap: 10 });
  }

  /* ---- the two addresses, side by side ----
     Where the show is and where the bed is. Side by side rather than stacked
     because they are the same kind of fact and the question is usually "how
     far apart are these", which a reader answers by comparing them. */
  const venue = (ev.venue && typeof ev.venue === "object") ? ev.venue : {};
  const it = (ev.itinerary && typeof ev.itinerary === "object") ? ev.itinerary : {};
  const hasVenue = s(venue.name) || s(venue.address);
  const hasHotel = s(it.hotelName) || s(it.hotelAddress);

  /* Side by side ONLY when there is something to put in both columns.
     A local show with no travel was getting a "Hotel — No hotel on the
     itinerary" column sitting next to the venue: half the width of the page
     spent saying that nothing is there. When there is no hotel the venue gets
     the block to itself, which is how it read before any of this. */
  if (hasVenue && !hasHotel) {
    w.subheading("Event venue");
    if (s(venue.name)) w.para(venue.name, { bold: true, gap: 2 });
    if (s(venue.mapLink)) w.para(venue.mapLink, { gap: 2 });
    if (s(venue.address)) w.para(venue.address, { gap: 2 });
    w.gap(8);
  } else if (hasVenue || hasHotel) {
    w.twoCol(
      /* `mapLink` is the ROOM, not a URL. The field is labelled "Room" in the
         brief editor and prompts "Ballroom A / room #"; the key is a leftover
         from when it held a map link. It was being rendered small and grey
         like a footnote, which is the wrong weight for the one line that tells
         somebody which door to walk through. It sits under the venue name,
         where people say it. */
      { head: "Event venue", lines: [
        { text: venue.name, bold: true },
        { text: venue.mapLink },
        { text: venue.address },
      ] },
      { head: "Hotel", lines: [
        { text: it.hotelName, bold: true },
        { text: it.hotelAddress },
      ] },
    );
    w.gap(4);
  }

  const contacts = rowsOf(ev.contacts).filter((c) => nonEmpty(c, ["name", "phone", "email"]));
  if (contacts.length) {
    w.subheading("Contacts");
    w.table(
      [{ label: "Name", key: "name", w: 2 }, { label: "Role", key: "role", w: 2, dim: true },
       { label: "Phone", key: "phone", w: 1.6 }, { label: "Email", key: "email", w: 2.8, dim: true }],
      contacts.map((c) => ({ name: s(c.name), role: s(c.role || c.title), phone: s(c.phone), email: s(c.email) })),
    );
  }

  /* ---- ONE crew list ----
     Name, position, call, and — for anybody the itinerary has a room for —
     their arrival, departure and confirmation number, on the same line.
     Previously this was two tables that had to be read against each other:
     find yourself in the crew list for your call time, find yourself again in
     the rooms list for your hotel dates. One row per person is the whole
     point; nobody should have to cross-reference themselves.

     Rooms are matched to crew BY NAME, trimmed and case-folded, which is what
     the My Call screen already does. A stay whose name matches nobody on the
     crew list is still shown, at the bottom, rather than silently dropped —
     that mismatch is usually a typo somebody needs to see.

     Flight details are deliberately absent: asked for and declined. */
  const crew = rowsOf(ev.crew).filter((c) => s(c.name));
  const stays = rowsOf(it.stays).filter((r) => nonEmpty(r, ["crewName", "checkIn", "checkOut", "confirmation"]));

  if (crew.length || stays.length) {
    const norm = (v) => s(v).toLowerCase();
    const stayFor = {};
    for (const r of stays) {
      const k = norm(r.crewName);
      if (k && !stayFor[k]) stayFor[k] = r;
    }

    /* NO CALL TIME COLUMN, deliberately.
       Call times live per day per person, so a single column can only show
       ONE of them — the earliest — and on a three-day show that is wrong for
       most people on most days. It was showing everyone the same 8:00 AM
       because that is the first day's call. The Schedule section carries the
       real per-day times; this table is who is on the job and when they are
       in town. */
    const spec = [
      { label: "Name", key: "name", w: 2.6 },
      { label: "Position", key: "position", w: 2.3 },
      { label: "Arrive", key: "in", w: 1.5 },
      { label: "Depart", key: "out", w: 1.5 },
      { label: "Hotel conf.", key: "conf", w: 1.7 },
    ];

    const used = new Set();
    const rows = crew.map((c) => {
      const st = stayFor[norm(c.name)];
      if (st) used.add(norm(c.name));
      return {
        name: s(c.name), position: s(c.position),
        in: st ? fmtDay(st.checkIn) : "", out: st ? fmtDay(st.checkOut) : "",
        conf: st ? s(st.confirmation) : "",
      };
    });

    /* A room booked for somebody who is not on the crew list. Shown, not
       swallowed — it is either a name typed differently in two places or
       somebody nobody added to the show, and both want looking at. */
    const orphans = stays
      .filter((r) => !used.has(norm(r.crewName)))
      .map((r) => ({
        name: s(r.crewName), position: "(not on the crew list)",
        in: fmtDay(r.checkIn), out: fmtDay(r.checkOut), conf: s(r.confirmation),
      }));

    w.subheading("Crew");
    w.table(spec, rows.concat(orphans));
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

  if (!about && !dress && !hasVenue && !hasHotel && !contacts.length && !crew.length && !stays.length) {
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
