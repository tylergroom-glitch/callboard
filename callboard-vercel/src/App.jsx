import React, { useState, useEffect, useRef } from "react";
import {
  currentAuth,
  logout as dbLogout,
  loginAdmin,
  loginShow,
  listEvents,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent as deleteEvent_api,
  setPassword as dbSetPassword,
} from "./db.js";

/* ============================================================
   CALLBOARD — a production hub for live-event crews.
   Share the brief with your crew + track hours, per event.
   Data lives in Airtable via a Vercel serverless proxy; access is per-show.
   ============================================================ */

const uid = () => Math.random().toString(36).slice(2, 9);
const clone = (o) =>
  typeof structuredClone === "function" ? structuredClone(o) : JSON.parse(JSON.stringify(o));

/* Data layer lives in ./db.js (talks to the Vercel API). Diagrams are link-only in the
   cloud build, so there is no local image store here. */

/* ---------- structure helpers ---------- */
const ioRow = (num, name = "", patch = "", signal = "", notes = "") => ({
  id: uid(), num: String(num), name, patch, signal, notes,
});
const ioBlock = (name, ins = [], outs = []) => ({ id: uid(), name, ins, outs });

/* backfill any fields a stored event predates, so old data never crashes */
function normalize(e) {
  if (!e) return e;
  e.venue = e.venue || { name: "", address: "", mapLink: "" };
  e.contacts = e.contacts || [];
  e.crew = e.crew || [];
  e.schedule = e.schedule || [];
  e.itinerary = e.itinerary || { hotelName: "", hotelAddress: "", stays: [], flights: [] };
  e.meals = e.meals || [];
  e.notes = e.notes || [];
  e.links = e.links || [];
  e.time = e.time || { days: [], entries: {} };
  // upgrade an AdventHealth seed saved before these tabs existed
  if (e.id === "seed-adventhealth") {
    const s = seedEvent();
    if (!e.audio) e.audio = s.audio;
    if (!e.video) e.video = s.video;
    if (!e.records) e.records = s.records;
    if (!e.diagrams) e.diagrams = s.diagrams;
  }
  e.audio = e.audio || { blocks: [ioBlock("Main")] };
  e.video = e.video || { blocks: [ioBlock("Main")] };
  e.records = e.records || [];
  e.diagrams = e.diagrams || [];
  return e;
}

/* ---------- time math ---------- */
function hoursBetween(inStr, outStr) {
  if (!inStr || !outStr) return 0;
  const [ih, im] = inStr.split(":").map(Number);
  const [oh, om] = outStr.split(":").map(Number);
  if ([ih, im, oh, om].some((n) => Number.isNaN(n))) return 0;
  let mins = oh * 60 + om - (ih * 60 + im);
  if (mins < 0) mins += 24 * 60; // overnight
  return Math.round((mins / 60) * 100) / 100;
}
const fmtHrs = (h) => (h === 0 ? "–" : String(+h.toFixed(2)));

/* ---------- blank + seed data ---------- */
function blankEvent() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: uid(),
    name: "New Event",
    client: "",
    startDate: today,
    endDate: today,
    venue: { name: "", address: "", mapLink: "" },
    contacts: [
      { id: uid(), role: "Production Manager", name: "", phone: "", email: "" },
      { id: uid(), role: "Venue CSM", name: "", phone: "", email: "" },
      { id: uid(), role: "Client", name: "", phone: "", email: "" },
    ],
    crew: [],
    schedule: [],
    itinerary: { hotelName: "", hotelAddress: "", stays: [], flights: [] },
    meals: [],
    wardrobe: "",
    notes: [],
    links: [],
    time: { days: [], entries: {} },
    audio: { blocks: [ioBlock("Main")] },
    video: { blocks: [ioBlock("Main")] },
    records: [],
    diagrams: [],
  };
}

// (cloud build: diagrams are link-only, no seeded image)

function seedEvent() {
  const crew = [
    { id: "c1", name: "Tyler Groom", position: "PM", phone: "559-280-5274", email: "tyler.groom@gmail.com" },
    { id: "c2", name: "Jose Jimenez", position: "V1/E2", phone: "209.670.9358", email: "joe1245@sbcglobal.net" },
    { id: "c3", name: "Sean Reek", position: "LED Lead w/ PTZ Setup", phone: "209.747.2705", email: "seanreek@gmail.com" },
    { id: "c4", name: "Damian Dan", position: "LED Lead", phone: "707.980.8258", email: "brendanvb@gmail.com" },
    { id: "c5", name: "Jeff Bell", position: "L1", phone: "804-314-8014", email: "jeffbelldesigns@gmail.com" },
    { id: "c6", name: "Dan Parseghian", position: "A1", phone: "201-913-7644", email: "dparse2@gmail.com" },
    { id: "c7", name: "Chris Thomas", position: "Equipment Manager", phone: "408.679.5963", email: "chris@landonaudio.com" },
  ];

  const days = [
    { id: "d1", label: "Fri 6/19" },
    { id: "d2", label: "Sat 6/20" },
    { id: "d3", label: "Sun 6/21" },
    { id: "d4", label: "Mon 6/22" },
    { id: "d5", label: "Tue 6/23" },
    { id: "d6", label: "Wed 6/24" },
    { id: "d7", label: "Thu 6/25" },
    { id: "d8", label: "Fri 6/26" },
    { id: "d9", label: "Sat 6/27" },
    { id: "d10", label: "Sun 6/28" },
  ];

  const io = (i, o) => ({ in: i, out: o });
  const entries = {
    c1: { d1: io("06:00", "18:00"), d2: io("08:00", "18:00"), d3: io("07:00", "00:30"), d4: io("06:00", "19:00"), d5: io("06:00", "16:00") },
    c7: { d1: io("06:00", "18:00"), d2: io("08:00", "18:00"), d3: io("07:00", "00:30"), d4: io("06:00", "19:00"), d5: io("06:00", "16:00") },
    c2: { d2: io("08:00", "18:00"), d3: io("10:00", "21:00"), d4: io("06:00", "19:00"), d5: io("06:00", "16:00") },
    c3: { d2: io("08:00", "18:00"), d3: io("10:00", "21:00"), d4: io("06:00", "19:00"), d5: io("06:00", "16:00") },
    c4: { d2: io("08:00", "18:00"), d3: io("10:00", "21:00"), d4: io("06:00", "19:00"), d5: io("06:00", "16:00") },
    c5: { d2: io("08:00", "18:00"), d3: io("10:00", "21:00"), d4: io("06:00", "19:00"), d5: io("06:00", "16:00") },
    c6: { d2: io("08:00", "18:00"), d3: io("10:00", "21:00"), d4: io("06:00", "19:00"), d5: io("06:00", "16:00") },
  };

  const sched = (label, date, items) => ({
    id: uid(),
    date,
    label,
    items: items.map(([time, activity]) => ({ id: uid(), time, activity })),
  });

  return {
    id: "seed-adventhealth",
    name: "AdventHealth — Utah",
    client: "AdventHealth",
    startDate: "2026-06-19",
    endDate: "2026-06-28",
    venue: {
      name: "Stein Eriksen Lodge",
      address: "7700 Stein Way, Park City, UT 84060",
      mapLink: "",
    },
    contacts: [
      { id: uid(), role: "Production Manager", name: "Tyler Groom", phone: "559-280-5274", email: "tyler.groom@gmail.com" },
      { id: uid(), role: "Metro Coordinator", name: "William Redenbaugh", phone: "530-304-2816", email: "will.r@metroaudiovisual.com" },
      { id: uid(), role: "Venue CSM", name: "", phone: "", email: "" },
      { id: uid(), role: "Client", name: "", phone: "", email: "" },
      { id: uid(), role: "Trucking", name: "Mitchel", phone: "", email: "" },
      { id: uid(), role: "Labor Contact", name: "", phone: "", email: "" },
    ],
    crew,
    schedule: [
      sched("Saturday — Load prep", "2026-06-20", [
        ["1:00 PM", "Unload 1–2 box trucks, push cases to 1st-floor Silver Room (prioritize LED walls, flown PA, flown lights)"],
        ["All day", "Travel day for AH and Metro AV"],
      ]),
      sched("Sunday — Stein Ballroom", "2026-06-21", [
        ["7:00 AM", "Move cases Silver → Stein Ballroom · breakfast starts"],
        ["8:00 AM", "Rigging call (Wasatch AV): build truss, float motors, drop 3-phase power"],
        ["10:00 AM", "Load-in call time — all Metro + AH AV"],
        ["12:00 PM", "Lunch (stagger departments)"],
        ["1:00 PM", "Drop round stage"],
        ["6:00 PM", "Dinner · audio tunes PA (quiet time)"],
        ["8:00 PM", "End of day"],
      ]),
      sched("Monday — Stein Ballroom", "2026-06-22", [
        ["7:00 AM", "Crew breakfast"],
        ["8:30 AM", "Show crew call (Metro AV, Jamin, Andy)"],
        ["11:30 AM", "Show ready"],
        ["12:00 PM", "Crew lunch"],
        ["1:00 PM", "Executive rehearsals start"],
        ["6:30 PM", "End of day"],
      ]),
    ],
    itinerary: {
      hotelName: "Chateaux at Deer Valley",
      hotelAddress: "7700 Stein Way, Park City, UT 84060",
      stays: [
        { id: uid(), crewName: "Tyler Groom", checkIn: "2026-06-19", checkOut: "2026-06-28", confirmation: "873833", notes: "Crossload 6/19 w/ Chris T." },
        { id: uid(), crewName: "Jose Jimenez", checkIn: "2026-06-20", checkOut: "2026-06-28", confirmation: "873838", notes: "" },
        { id: uid(), crewName: "Sean Reek", checkIn: "2026-06-20", checkOut: "2026-06-28", confirmation: "873837", notes: "" },
        { id: uid(), crewName: "Damian Dan", checkIn: "2026-06-20", checkOut: "2026-06-27", confirmation: "874906", notes: "" },
        { id: uid(), crewName: "Jeff Bell", checkIn: "2026-06-20", checkOut: "2026-06-23", confirmation: "873834", notes: "" },
        { id: uid(), crewName: "Dan Parseghian", checkIn: "2026-06-20", checkOut: "2026-06-23", confirmation: "873839", notes: "" },
        { id: uid(), crewName: "Chris Thomas", checkIn: "2026-06-19", checkOut: "2026-06-28", confirmation: "873836", notes: "Crossload 6/19 w/ Tyler Groom" },
      ],
      flights: [
        { id: uid(), crewName: "Dan Parseghian", date: "2026-06-20", airport: "AUS → SLC", flightNo: "DL2618", depart: "08:15", arrive: "10:13", confirmation: "H68UQX", notes: "Non-stop" },
        { id: uid(), crewName: "Dan Parseghian", date: "2026-06-23", airport: "SLC → AUS", flightNo: "DL2728", depart: "17:45", arrive: "21:32", confirmation: "", notes: "Non-stop" },
        { id: uid(), crewName: "Chris Thomas", date: "2026-06-19", airport: "SMC → SLC", flightNo: "DL1367", depart: "09:45", arrive: "12:26", confirmation: "H7H98X", notes: "Non-stop" },
        { id: uid(), crewName: "Chris Thomas", date: "2026-06-28", airport: "SLC → SMC", flightNo: "DL1582", depart: "21:30", arrive: "22:16", confirmation: "", notes: "Updated" },
        { id: uid(), crewName: "Tyler Groom", date: "2026-06-19", airport: "FAT → SLC", flightNo: "DL3786", depart: "09:48", arrive: "12:18", confirmation: "", notes: "" },
        { id: uid(), crewName: "Tyler Groom", date: "2026-06-28", airport: "SLC → FAT", flightNo: "DL3774", depart: "20:30", arrive: "21:22", confirmation: "", notes: "" },
        { id: uid(), crewName: "Sean Reek", date: "2026-06-20", airport: "SMC → SLC", flightNo: "DL1423", depart: "13:30", arrive: "16:12", confirmation: "H8CS7H", notes: "Non-stop" },
        { id: uid(), crewName: "Jose Jimenez", date: "2026-06-20", airport: "SMC → SLC", flightNo: "DL1342", depart: "17:00", arrive: "19:43", confirmation: "GOJ7XU", notes: "Non-stop" },
        { id: uid(), crewName: "Jeff Bell", date: "2026-06-20", airport: "CLT → SLC", flightNo: "DL2070", depart: "17:25", arrive: "19:47", confirmation: "HPVGTJ", notes: "Non-stop" },
        { id: uid(), crewName: "Damian Dan", date: "2026-06-27", airport: "SLC → SFO", flightNo: "DL1091", depart: "21:40", arrive: "22:49", confirmation: "GF4CNY", notes: "Non-stop" },
      ],
    },
    meals: [
      { id: uid(), date: "2026-06-21", time: "6:00 PM", type: "Crew dinner", link: "" },
      { id: uid(), date: "2026-06-22", time: "12:00 PM", type: "Crew lunch", link: "" },
    ],
    wardrobe:
      "No holes in pants/shirts. No band, brand, team, or business logos other than Metro AV. Wear the Metro AV polo or t-shirt if you have one. Need one? Email April Potter at april@metroaudiovisual.com.",
    notes: [
      { id: uid(), date: "2026-06-18", text: "(4) 5xT speakers as front fills." },
      { id: uid(), date: "2026-06-18", text: "Send monitor stands for 5XTs — 3 feet high." },
      { id: uid(), date: "2026-06-18", text: "Upgrade to Galaxy for audio." },
    ],
    links: [
      { id: uid(), label: "Production Schedule", url: "" },
      { id: uid(), label: "Load Schedule", url: "" },
      { id: uid(), label: "Equipment List", url: "" },
      { id: uid(), label: "Rigging Diagrams", url: "" },
    ],
    time: { days, entries },
    audio: {
      blocks: [
        ioBlock(
          "FOH Console",
          [ioRow(1, "Wireless HH 1", "1", "Analog"), ioRow(2, "Lectern Mic", "3", "Analog"), ioRow(3, "Playback L/R", "9-10", "Analog", "From video")],
          [ioRow(1, "Mains L", "1", "Analog"), ioRow(2, "Mains R", "2", "Analog"), ioRow(3, "Front Fills", "3", "Analog", "(4) 5XT")]
        ),
      ],
    },
    video: {
      blocks: [
        ioBlock(
          "E2",
          [ioRow(1, "PGM from ATEM", "", "3G SDI"), ioRow(2, "Resolume", "Decklink", "12G SDI", "Cross Stage")],
          [
            ioRow(1, "LED WALL 1", "", "HDMI", "1536 × 1536"),
            ioRow(2, "LED WALL 2", "", "HDMI", "1537 × 1536"),
            ioRow(3, "LED WALL 3", "", "HDMI", "1538 × 1536"),
            ioRow(4, "LED WALL 4", "", "HDMI", "1539 × 1536"),
          ]
        ),
        ioBlock(
          "ATEM Constellation 4 M/E",
          [
            ioRow(1, "GFX 1", "", "SDI", "Cross Stage"),
            ioRow(2, "Notes 1", "", "SDI", "Cross Stage"),
            ioRow(3, "GFX 2", "", "SDI", "Cross Stage"),
            ioRow(4, "Notes 2", "", "SDI", "Cross Stage"),
            ioRow(5, "ProPresenter", "", "SDI", "Cross Stage"),
          ],
          [ioRow(1, "DSM 1", "", "SDI"), ioRow(2, "DSM 2", "", "SDI"), ioRow(3, "DSM 3", "", "SDI"), ioRow(4, "DSM 4", "", "SDI"), ioRow(5, "E2", "", "SDI")]
        ),
      ],
    },
    records: [
      { id: uid(), date: "2026-06-28", crew: "Chris Thomas", type: "Post-show note", text: "2× SDI cables flagged for repair — tagged in road case 4." },
      { id: uid(), date: "2026-06-28", crew: "Tyler Groom", type: "Post-show note", text: "Forklift returned to Sunbelt; confirmation emailed." },
    ],
    diagrams: [
      { id: uid(), name: "Stein Ballroom — Stage Plot", caption: "Host on Drive/Dropbox and paste the link", kind: "link", url: "" },
      { id: uid(), name: "Rigging Plot (Vectorworks)", caption: "Full rig — hosted PDF", kind: "link", url: "" },
    ],
  };
}

/* ============================================================
   UI primitives
   ============================================================ */
function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Panel({ title, sub, action, children }) {
  return (
    <section className="panel">
      <div className="panel-h">
        <div>
          <h2 className="panel-title">{title}</h2>
          {sub && <p className="panel-sub">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function AddBtn({ onClick, children }) {
  return (
    <button className="add" onClick={onClick} type="button">
      + {children}
    </button>
  );
}
function RemoveBtn({ onClick, title = "Remove" }) {
  return (
    <button className="remove" onClick={onClick} title={title} type="button" aria-label={title}>
      ×
    </button>
  );
}

/* ============================================================
   App
   ============================================================ */
function Callboard({ auth, onLogout }) {
  const isAdmin = auth.scope === "admin";
  const [ready, setReady] = useState(false);
  const [events, setEvents] = useState([]); // summaries
  const [currentId, setCurrentId] = useState(null);
  const [event, setEvent] = useState(null);
  const [tab, setTab] = useState("home");
  const [status, setStatus] = useState("idle"); // idle | saving | saved | error
  const [toast, setToast] = useState("");
  const [loadError, setLoadError] = useState("");
  const loadingRef = useRef(false);
  const saveTimer = useRef(null);
  const statusTimer = useRef(null);

  /* initial load — admin lists every show; crew get only their unlocked show */
  useEffect(() => {
    (async () => {
      try {
        if (isAdmin) {
          let list = await listEvents();
          if (!list.length) {
            const seed = seedEvent();
            const created = await createEvent({
              name: seed.name, client: seed.client, startDate: seed.startDate, endDate: seed.endDate, data: seed,
            });
            list = [created];
          }
          const firstId = list[0].id;
          const first = normalize(await getEvent(firstId));
          loadingRef.current = true;
          setEvents(list);
          setCurrentId(firstId);
          setEvent(first);
        } else {
          const id = auth.showId;
          const ev = normalize(await getEvent(id));
          loadingRef.current = true;
          setEvents([{ id, name: ev.name, client: ev.client, startDate: ev.startDate, endDate: ev.endDate }]);
          setCurrentId(id);
          setEvent(ev);
        }
        setReady(true);
      } catch (e) {
        setLoadError(e.message || "Could not load. Try signing in again.");
        setReady(true);
      }
    })();
  }, []);

  /* autosave current event (debounced) → PATCH the Airtable record via our API */
  useEffect(() => {
    if (!event) return;
    if (loadingRef.current) {
      loadingRef.current = false;
      return;
    }
    setStatus("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await updateEvent(event.id, {
          data: event, name: event.name, client: event.client, startDate: event.startDate, endDate: event.endDate,
        });
        setEvents((prev) =>
          prev.map((e) =>
            e.id === event.id
              ? { ...e, name: event.name, client: event.client, startDate: event.startDate, endDate: event.endDate }
              : e
          )
        );
        setStatus("saved");
        clearTimeout(statusTimer.current);
        statusTimer.current = setTimeout(() => setStatus("idle"), 1400);
      } catch (e) {
        setStatus("error");
      }
    }, 900);
    return () => clearTimeout(saveTimer.current);
  }, [event]);

  function summary(e) {
    return { id: e.id, name: e.name, client: e.client, startDate: e.startDate, endDate: e.endDate };
  }

  const update = (fn) =>
    setEvent((prev) => {
      const e = clone(prev);
      fn(e);
      return e;
    });

  const flash = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 1900);
  };

  async function switchEvent(id) {
    if (id === currentId) return;
    try {
      const e = normalize(await getEvent(id));
      loadingRef.current = true;
      setCurrentId(id);
      setEvent(e);
      setTab("home");
    } catch (err) {
      flash(err.message || "Couldn't open that show");
    }
  }

  async function newEvent() {
    const name = window.prompt("Name this show:", "New Event");
    if (name === null) return;
    const pw = window.prompt(
      "Set a password for this show (crew use it to open the show).\nLeave blank for no password:",
      ""
    );
    try {
      const e = blankEvent();
      e.name = name || "New Event";
      const created = await createEvent({
        name: e.name, client: e.client, startDate: e.startDate, endDate: e.endDate, data: e, password: pw || "",
      });
      e.id = created.id;
      setEvents((prev) => [...prev, created]);
      loadingRef.current = true;
      setCurrentId(e.id);
      setEvent(e);
      setTab("home");
      flash(pw ? "Show created with password" : "Show created");
    } catch (err) {
      flash(err.message || "Couldn't create show");
    }
  }

  async function duplicateEvent() {
    if (!event) return;
    const e = clone(event);
    e.name = event.name + " (copy)";
    e.time = { days: event.time.days.map((d) => ({ ...d })), entries: {} };
    e.records = [];
    e.diagrams = (e.diagrams || []).map((d) => ({ ...d, id: uid() }));
    try {
      const created = await createEvent({
        name: e.name, client: e.client, startDate: e.startDate, endDate: e.endDate, data: e, password: "",
      });
      e.id = created.id;
      setEvents((prev) => [...prev, created]);
      loadingRef.current = true;
      setCurrentId(e.id);
      setEvent(e);
      setTab("home");
      flash("Duplicated — set its password under Show access");
    } catch (err) {
      flash(err.message || "Couldn't duplicate");
    }
  }

  async function deleteEvent() {
    if (!event) return;
    if (!window.confirm(`Delete "${event.name}"? This removes it for everyone and can't be undone.`)) return;
    try {
      await deleteEvent_api(event.id);
      const next = events.filter((e) => e.id !== event.id);
      setEvents(next);
      if (next.length) {
        const e = normalize(await getEvent(next[0].id));
        loadingRef.current = true;
        setCurrentId(next[0].id);
        setEvent(e);
      } else {
        const seed = blankEvent();
        const created = await createEvent({
          name: seed.name, client: seed.client, startDate: seed.startDate, endDate: seed.endDate, data: seed, password: "",
        });
        seed.id = created.id;
        loadingRef.current = true;
        setEvents([created]);
        setCurrentId(seed.id);
        setEvent(seed);
      }
      setTab("home");
    } catch (err) {
      flash(err.message || "Couldn't delete");
    }
  }

  async function changeShowPassword() {
    const pw = window.prompt(
      "Set a new password for this show.\nLeave blank to remove password protection:",
      ""
    );
    if (pw === null) return;
    try {
      await dbSetPassword(currentId, pw);
      setEvents((prev) => prev.map((e) => (e.id === currentId ? { ...e, hasPassword: !!pw } : e)));
      flash(pw ? "Password updated" : "Password removed");
    } catch (err) {
      flash(err.message || "Couldn't update password");
    }
  }

  function copyBrief() {
    const t = briefText(event);
    try {
      navigator.clipboard.writeText(t);
      flash("Brief copied — paste it to your crew");
    } catch {
      flash("Copy failed on this device");
    }
  }

  if (!ready)
    return (
      <div className="cb">
        <style>{CSS}</style>
        <div className="loading">Loading the callboard…</div>
      </div>
    );
  if (loadError || !event)
    return (
      <div className="cb">
        <style>{CSS}</style>
        <div className="loading">
          {loadError || "No show loaded."}
          <div style={{ marginTop: 16 }}>
            <button className="btn" onClick={onLogout}>Back to sign in</button>
          </div>
        </div>
      </div>
    );

  const dateRange =
    event.startDate && event.endDate ? `${prettyDate(event.startDate)} – ${prettyDate(event.endDate)}` : "Dates TBD";

  return (
    <div className="cb">
      <style>{CSS}</style>

      {/* top control bar */}
      <div className="topbar">
        <div className="brand">
          <span className="brand-tab">CALL</span>
          <span className="brand-rest">BOARD</span>
        </div>
        {isAdmin ? (
          <>
            <div className="evt-picker">
              <select value={currentId || ""} onChange={(e) => switchEvent(e.target.value)}>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {(e.hasPassword ? "🔒 " : "") + (e.name || "Untitled event")}
                  </option>
                ))}
              </select>
            </div>
            <div className="top-actions">
              <button className="btn" onClick={newEvent}>+ New</button>
              <button className="btn ghost" onClick={duplicateEvent}>Duplicate</button>
              <button className="btn ghost" onClick={changeShowPassword}>Show access</button>
              <button className="btn danger ghost" onClick={deleteEvent}>Delete</button>
            </div>
          </>
        ) : (
          <div className="evt-picker locked">
            <span className="lock-name">{event ? event.name : ""}</span>
          </div>
        )}
        <div className="top-right">
          <div className={"savechip " + status}>
            {status === "saving"
              ? "Saving…"
              : status === "saved"
              ? "Saved ✓"
              : status === "error"
              ? "Save failed"
              : isAdmin
              ? "Admin"
              : "Crew"}
          </div>
          <button className="btn ghost signout" onClick={onLogout} title="Sign out">Sign out</button>
        </div>
      </div>

      {/* body: the home board, or a single section page */}
      {tab === "home" ? (
        <HomeScreen event={event} update={update} go={setTab} copyBrief={copyBrief} dateRange={dateRange} />
      ) : (
        <>
          <div className="pagebar">
            <button className="backbtn" onClick={() => setTab("home")}>
              <span className="chev">‹</span> All sections
            </button>
            <div className="pagebar-title">{SECTION_LABEL[tab] || ""}</div>
            <div className="pagebar-evt" title={event.name}>{event.name}</div>
          </div>
          <main className="content">
            {tab === "brief" && <BriefTab event={event} update={update} />}
            {tab === "schedule" && <ScheduleTab event={event} update={update} />}
            {tab === "itinerary" && <ItineraryTab event={event} update={update} />}
            {tab === "notes" && <NotesTab event={event} update={update} />}
            {tab === "audio" && <IOTab event={event} update={update} kind="audio" />}
            {tab === "video" && <IOTab event={event} update={update} kind="video" />}
            {tab === "diagrams" && <DiagramsTab event={event} update={update} />}
            {tab === "records" && <RecordsTab event={event} update={update} />}
            {tab === "hours" && <HoursTab event={event} update={update} />}
          </main>
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/* ============================================================
   HOME BOARD — colored tiles that open each section
   ============================================================ */
const SECTIONS = [
  { key: "brief", label: "Brief", desc: "Venue, contacts, crew", color: "#F3B24A" },
  { key: "schedule", label: "Schedule", desc: "Daily run of show", color: "#7E93EC" },
  { key: "itinerary", label: "Itinerary", desc: "Hotels & flights", color: "#46C5B8" },
  { key: "notes", label: "Meals & Notes", desc: "Catering, pre-con notes", color: "#F0895C" },
  { key: "video", label: "Video I/O", desc: "Video patch sheets", color: "#D97CC0" },
  { key: "audio", label: "Audio I/O", desc: "Audio patch sheets", color: "#9C9AA6" },
  { key: "diagrams", label: "Diagrams", desc: "Stage plots & rigging", color: "#EC6A63" },
  { key: "records", label: "Records", desc: "Post-show & incidents", color: "#D9B857" },
  { key: "hours", label: "Hours", desc: "Crew timesheet", color: "#6FD08A" },
];
const SECTION_LABEL = SECTIONS.reduce((m, s) => ((m[s.key] = s.label), m), {});

function TileIcon({ name }) {
  const p = { width: 30, height: 30, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (name) {
    case "brief":
      return (<svg {...p}><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4h6v3H9z" /><path d="M8 11h8M8 15h8" /></svg>);
    case "schedule":
      return (<svg {...p}><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M4 9h16M8 3v4M16 3v4" /></svg>);
    case "itinerary":
      return (<svg {...p}><path d="M3 13l18-7-7 18-2.5-7.5L3 13z" /></svg>);
    case "notes":
      return (<svg {...p}><path d="M6 3v8a3 3 0 0 0 6 0V3M9 3v18" /><path d="M17 3c-1.5 1-2 3-2 5s.5 3 2 3v10" /></svg>);
    case "video":
      return (<svg {...p}><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M8 21h8M12 17v4" /></svg>);
    case "audio":
      return (<svg {...p}><path d="M6 4v16M12 4v16M18 4v16" /><circle cx="6" cy="9" r="2" /><circle cx="12" cy="15" r="2" /><circle cx="18" cy="8" r="2" /></svg>);
    case "diagrams":
      return (<svg {...p}><path d="M4 19L14 4l6 15z" /><path d="M4 19h16" /></svg>);
    case "records":
      return (<svg {...p}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></svg>);
    case "hours":
      return (<svg {...p}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>);
    default:
      return null;
  }
}

function tileStat(key, event) {
  switch (key) {
    case "brief": return `${event.crew.length} crew`;
    case "schedule": return `${event.schedule.length} day${event.schedule.length === 1 ? "" : "s"}`;
    case "itinerary": return `${event.itinerary.flights.length} flights · ${event.itinerary.stays.length} stays`;
    case "notes": return `${event.notes.length} notes · ${event.meals.length} meals`;
    case "video": return `${event.video.blocks.length} device${event.video.blocks.length === 1 ? "" : "s"}`;
    case "audio": return `${event.audio.blocks.length} device${event.audio.blocks.length === 1 ? "" : "s"}`;
    case "diagrams": return `${event.diagrams.length} file${event.diagrams.length === 1 ? "" : "s"}`;
    case "records": return `${event.records.length} record${event.records.length === 1 ? "" : "s"}`;
    case "hours": {
      let t = 0;
      for (const c of event.crew)
        for (const d of event.time.days) {
          const en = event.time.entries?.[c.id]?.[d.id];
          if (en) t += hoursBetween(en.in, en.out);
        }
      return `${fmtHrs(t)} hrs logged`;
    }
    default: return "";
  }
}

function HomeScreen({ event, update, go, copyBrief, dateRange }) {
  return (
    <div className="home">
      <header className="hero">
        <div className="hero-main">
          <input
            className="evt-name-input"
            value={event.name}
            onChange={(e) => update((ev) => (ev.name = e.target.value))}
            placeholder="Event name"
          />
          <div className="evt-meta">
            <span>{event.client || "Client TBD"}</span>
            <span className="dot">•</span>
            <span>{dateRange}</span>
            <span className="dot">•</span>
            <span>{event.venue.name || "Venue TBD"}</span>
          </div>
        </div>
        <button className="btn amber copy" onClick={copyBrief}>Copy brief for crew</button>
      </header>

      <div className="board-label">Sections</div>
      <div className="tilegrid">
        {SECTIONS.map((s) => (
          <button key={s.key} className="tile" style={{ background: s.color }} onClick={() => go(s.key)}>
            <span className="tile-ico"><TileIcon name={s.key} /></span>
            <span className="tile-label">{s.label}</span>
            <span className="tile-desc">{s.desc}</span>
            <span className="tile-stat">{tileStat(s.key, event)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   BRIEF TAB — event details, venue, contacts, crew, links
   ============================================================ */
function BriefTab({ event, update }) {
  return (
    <div className="stack">
      <Panel title="Event details">
        <div className="grid2">
          <Field label="Client">
            <input value={event.client} onChange={(e) => update((ev) => (ev.client = e.target.value))} placeholder="Client name" />
          </Field>
          <Field label="Venue">
            <input value={event.venue.name} onChange={(e) => update((ev) => (ev.venue.name = e.target.value))} placeholder="Venue name" />
          </Field>
          <Field label="Start date">
            <input type="date" value={event.startDate} onChange={(e) => update((ev) => (ev.startDate = e.target.value))} />
          </Field>
          <Field label="End date">
            <input type="date" value={event.endDate} onChange={(e) => update((ev) => (ev.endDate = e.target.value))} />
          </Field>
          <Field label="Venue address">
            <input value={event.venue.address} onChange={(e) => update((ev) => (ev.venue.address = e.target.value))} placeholder="Street, city, state" />
          </Field>
          <Field label="Map link">
            <input value={event.venue.mapLink} onChange={(e) => update((ev) => (ev.venue.mapLink = e.target.value))} placeholder="https://…" />
          </Field>
        </div>
      </Panel>

      <Panel
        title="Key contacts"
        sub="Production, venue, client, vendors"
        action={
          <AddBtn
            onClick={() =>
              update((ev) => ev.contacts.push({ id: uid(), role: "", name: "", phone: "", email: "" }))
            }
          >
            Contact
          </AddBtn>
        }
      >
        <div className="rows">
          <div className="rowhead contact-grid">
            <span>Role</span><span>Name</span><span>Phone</span><span>Email</span><span />
          </div>
          {event.contacts.map((c, i) => (
            <div className="row contact-grid" key={c.id}>
              <input value={c.role} placeholder="Role" onChange={(e) => update((ev) => (ev.contacts[i].role = e.target.value))} />
              <input value={c.name} placeholder="Name" onChange={(e) => update((ev) => (ev.contacts[i].name = e.target.value))} />
              <input value={c.phone} placeholder="Phone" onChange={(e) => update((ev) => (ev.contacts[i].phone = e.target.value))} />
              <input value={c.email} placeholder="Email" onChange={(e) => update((ev) => (ev.contacts[i].email = e.target.value))} />
              <RemoveBtn onClick={() => update((ev) => ev.contacts.splice(i, 1))} />
            </div>
          ))}
          {!event.contacts.length && <Empty>No contacts yet. Add your PM, venue CSM, and client.</Empty>}
        </div>
      </Panel>

      <Panel
        title="Crew roster"
        sub="These people also appear in the Hours timesheet"
        action={
          <AddBtn
            onClick={() =>
              update((ev) => ev.crew.push({ id: uid(), name: "", position: "", phone: "", email: "" }))
            }
          >
            Crew member
          </AddBtn>
        }
      >
        <div className="rows">
          <div className="rowhead crew-grid">
            <span>Name</span><span>Position</span><span>Phone</span><span>Email</span><span />
          </div>
          {event.crew.map((c, i) => (
            <div className="row crew-grid" key={c.id}>
              <input value={c.name} placeholder="Name" onChange={(e) => update((ev) => (ev.crew[i].name = e.target.value))} />
              <input value={c.position} placeholder="Position" onChange={(e) => update((ev) => (ev.crew[i].position = e.target.value))} />
              <input value={c.phone} placeholder="Phone" onChange={(e) => update((ev) => (ev.crew[i].phone = e.target.value))} />
              <input value={c.email} placeholder="Email" onChange={(e) => update((ev) => (ev.crew[i].email = e.target.value))} />
              <div className="row-tools">
                <button
                  className="movebtn"
                  title="Move up"
                  disabled={i === 0}
                  onClick={() =>
                    update((ev) => {
                      const a = ev.crew;
                      const t = a[i - 1];
                      a[i - 1] = a[i];
                      a[i] = t;
                    })
                  }
                >
                  ▲
                </button>
                <button
                  className="movebtn"
                  title="Move down"
                  disabled={i === event.crew.length - 1}
                  onClick={() =>
                    update((ev) => {
                      const a = ev.crew;
                      const t = a[i + 1];
                      a[i + 1] = a[i];
                      a[i] = t;
                    })
                  }
                >
                  ▼
                </button>
                <RemoveBtn onClick={() => update((ev) => ev.crew.splice(i, 1))} />
              </div>
            </div>
          ))}
          {!event.crew.length && <Empty>No crew yet. Add people here — they’ll show up in Hours automatically.</Empty>}
        </div>
      </Panel>

      <div className="grid2 top">
        <Panel
          title="Wardrobe"
          action={null}
        >
          <textarea
            className="area"
            rows={5}
            value={event.wardrobe}
            placeholder="Dress code, logos, what to bring…"
            onChange={(e) => update((ev) => (ev.wardrobe = e.target.value))}
          />
        </Panel>

        <Panel
          title="Links"
          action={<AddBtn onClick={() => update((ev) => ev.links.push({ id: uid(), label: "", url: "" }))}>Link</AddBtn>}
        >
          <div className="rows">
            {event.links.map((l, i) => (
              <div className="row link-grid" key={l.id}>
                <input value={l.label} placeholder="Label" onChange={(e) => update((ev) => (ev.links[i].label = e.target.value))} />
                <input value={l.url} placeholder="https://…" onChange={(e) => update((ev) => (ev.links[i].url = e.target.value))} />
                <RemoveBtn onClick={() => update((ev) => ev.links.splice(i, 1))} />
              </div>
            ))}
            {!event.links.length && <Empty>Add links to schedules, gear lists, diagrams.</Empty>}
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* ============================================================
   SCHEDULE TAB — daily run of show
   ============================================================ */
function ScheduleTab({ event, update }) {
  const addDay = () =>
    update((ev) =>
      ev.schedule.push({ id: uid(), label: "New day", date: ev.startDate, items: [{ id: uid(), time: "", activity: "" }] })
    );
  return (
    <div className="stack">
      <div className="tab-lead">
        <p>Daily run of show. Add a day for each date, then list call times and activities.</p>
        <AddBtn onClick={addDay}>Day</AddBtn>
      </div>

      {event.schedule.map((day, di) => (
        <Panel
          key={day.id}
          title={
            <input
              className="daytitle"
              value={day.label}
              onChange={(e) => update((ev) => (ev.schedule[di].label = e.target.value))}
              placeholder="Day label"
            />
          }
          action={
            <div className="day-tools">
              <input
                type="date"
                className="daydate"
                value={day.date || ""}
                onChange={(e) => update((ev) => (ev.schedule[di].date = e.target.value))}
              />
              <RemoveBtn title="Remove day" onClick={() => update((ev) => ev.schedule.splice(di, 1))} />
            </div>
          }
        >
          <div className="rows">
            {day.items.map((it, ii) => (
              <div className="row sched-grid" key={it.id}>
                <input
                  className="time-in-text"
                  value={it.time}
                  placeholder="Time"
                  onChange={(e) => update((ev) => (ev.schedule[di].items[ii].time = e.target.value))}
                />
                <input
                  value={it.activity}
                  placeholder="Activity"
                  onChange={(e) => update((ev) => (ev.schedule[di].items[ii].activity = e.target.value))}
                />
                <RemoveBtn onClick={() => update((ev) => ev.schedule[di].items.splice(ii, 1))} />
              </div>
            ))}
          </div>
          <AddBtn onClick={() => update((ev) => ev.schedule[di].items.push({ id: uid(), time: "", activity: "" }))}>
            Line
          </AddBtn>
        </Panel>
      ))}
      {!event.schedule.length && (
        <Panel title="Run of show">
          <Empty>No days yet. Add your first day to start the schedule.</Empty>
        </Panel>
      )}
    </div>
  );
}

/* ============================================================
   ITINERARY TAB — hotels + flights
   ============================================================ */
function CrewSelect({ crew, value, onChange }) {
  const named = crew.filter((c) => c.name);
  const missing = value && !named.some((c) => c.name === value);
  return (
    <select value={value || ""} onChange={onChange}>
      <option value="">— Crew member —</option>
      {named.map((c) => (
        <option key={c.id} value={c.name}>
          {c.name}
        </option>
      ))}
      {missing && <option value={value}>{value}</option>}
    </select>
  );
}

function ItineraryTab({ event, update }) {
  const it = event.itinerary;
  const addAllCrewStays = () =>
    update((ev) => {
      const have = new Set(ev.itinerary.stays.map((s) => s.crewName).filter(Boolean));
      ev.crew.forEach((c) => {
        if (c.name && !have.has(c.name)) {
          ev.itinerary.stays.push({ id: uid(), crewName: c.name, checkIn: ev.startDate, checkOut: ev.endDate, confirmation: "", notes: "" });
        }
      });
    });
  return (
    <div className="stack">
      <Panel title="Hotel">
        <div className="grid2">
          <Field label="Hotel">
            <input value={it.hotelName} placeholder="Hotel name" onChange={(e) => update((ev) => (ev.itinerary.hotelName = e.target.value))} />
          </Field>
          <Field label="Address">
            <input value={it.hotelAddress} placeholder="Address" onChange={(e) => update((ev) => (ev.itinerary.hotelAddress = e.target.value))} />
          </Field>
        </div>
      </Panel>

      <Panel
        title="Room stays"
        action={
          <div className="panel-actions">
            <AddBtn onClick={addAllCrewStays}>All crew</AddBtn>
            <AddBtn
              onClick={() =>
                update((ev) =>
                  ev.itinerary.stays.push({ id: uid(), crewName: "", checkIn: ev.startDate, checkOut: ev.endDate, confirmation: "", notes: "" })
                )
              }
            >
              Stay
            </AddBtn>
          </div>
        }
      >
        <div className="rows">
          <div className="rowhead stay-grid">
            <span>Name</span><span>Check-in</span><span>Check-out</span><span>Conf #</span><span>Notes</span><span />
          </div>
          {it.stays.map((s, i) => (
            <div className="row stay-grid" key={s.id}>
              <CrewSelect crew={event.crew} value={s.crewName} onChange={(e) => update((ev) => (ev.itinerary.stays[i].crewName = e.target.value))} />
              <input type="date" value={s.checkIn || ""} onChange={(e) => update((ev) => (ev.itinerary.stays[i].checkIn = e.target.value))} />
              <input type="date" value={s.checkOut || ""} onChange={(e) => update((ev) => (ev.itinerary.stays[i].checkOut = e.target.value))} />
              <input value={s.confirmation} placeholder="Conf" onChange={(e) => update((ev) => (ev.itinerary.stays[i].confirmation = e.target.value))} />
              <input value={s.notes} placeholder="Notes" onChange={(e) => update((ev) => (ev.itinerary.stays[i].notes = e.target.value))} />
              <RemoveBtn onClick={() => update((ev) => ev.itinerary.stays.splice(i, 1))} />
            </div>
          ))}
          {!it.stays.length && <Empty>No room stays yet.</Empty>}
        </div>
      </Panel>

      <Panel
        title="Flights"
        sub="For flight changes, route through your travel coordinator"
        action={
          <AddBtn
            onClick={() =>
              update((ev) =>
                ev.itinerary.flights.push({ id: uid(), crewName: "", date: ev.startDate, airport: "", flightNo: "", depart: "", arrive: "", confirmation: "", notes: "" })
              )
            }
          >
            Flight
          </AddBtn>
        }
      >
        <div className="rows scroll-x">
          <div className="rowhead flight-grid">
            <span>Name</span><span>Date</span><span>Route</span><span>Flight</span><span>Depart</span><span>Arrive</span><span>Conf</span><span>Notes</span><span />
          </div>
          {it.flights.map((f, i) => (
            <div className="row flight-grid" key={f.id}>
              <CrewSelect crew={event.crew} value={f.crewName} onChange={(e) => update((ev) => (ev.itinerary.flights[i].crewName = e.target.value))} />
              <input type="date" value={f.date || ""} onChange={(e) => update((ev) => (ev.itinerary.flights[i].date = e.target.value))} />
              <input value={f.airport} placeholder="A → B" onChange={(e) => update((ev) => (ev.itinerary.flights[i].airport = e.target.value))} />
              <input value={f.flightNo} placeholder="DL0000" onChange={(e) => update((ev) => (ev.itinerary.flights[i].flightNo = e.target.value))} />
              <input type="time" value={f.depart || ""} onChange={(e) => update((ev) => (ev.itinerary.flights[i].depart = e.target.value))} />
              <input type="time" value={f.arrive || ""} onChange={(e) => update((ev) => (ev.itinerary.flights[i].arrive = e.target.value))} />
              <input value={f.confirmation} placeholder="Conf" onChange={(e) => update((ev) => (ev.itinerary.flights[i].confirmation = e.target.value))} />
              <input value={f.notes} placeholder="Notes" onChange={(e) => update((ev) => (ev.itinerary.flights[i].notes = e.target.value))} />
              <RemoveBtn onClick={() => update((ev) => ev.itinerary.flights.splice(i, 1))} />
            </div>
          ))}
          {!it.flights.length && <Empty>No flights yet.</Empty>}
        </div>
      </Panel>
    </div>
  );
}

/* ============================================================
   MEALS & NOTES TAB
   ============================================================ */
function NotesTab({ event, update }) {
  return (
    <div className="stack">
      <Panel
        title="Meals"
        action={
          <AddBtn onClick={() => update((ev) => ev.meals.push({ id: uid(), date: ev.startDate, time: "", type: "", link: "" }))}>
            Meal
          </AddBtn>
        }
      >
        <div className="rows">
          <div className="rowhead meal-grid">
            <span>Date</span><span>Time</span><span>Meal</span><span>Link</span><span />
          </div>
          {event.meals.map((m, i) => (
            <div className="row meal-grid" key={m.id}>
              <input type="date" value={m.date || ""} onChange={(e) => update((ev) => (ev.meals[i].date = e.target.value))} />
              <input value={m.time} placeholder="Time" onChange={(e) => update((ev) => (ev.meals[i].time = e.target.value))} />
              <input value={m.type} placeholder="Breakfast / lunch / dinner" onChange={(e) => update((ev) => (ev.meals[i].type = e.target.value))} />
              <input value={m.link} placeholder="Menu link" onChange={(e) => update((ev) => (ev.meals[i].link = e.target.value))} />
              <RemoveBtn onClick={() => update((ev) => ev.meals.splice(i, 1))} />
            </div>
          ))}
          {!event.meals.length && <Empty>No meals scheduled.</Empty>}
        </div>
      </Panel>

      <Panel
        title="Notes"
        sub="Pre-con notes, gear reminders, changes"
        action={<AddBtn onClick={() => update((ev) => ev.notes.push({ id: uid(), date: new Date().toISOString().slice(0, 10), text: "" }))}>Note</AddBtn>}
      >
        <div className="rows">
          {event.notes.map((n, i) => (
            <div className="row note-grid" key={n.id}>
              <input type="date" value={n.date || ""} onChange={(e) => update((ev) => (ev.notes[i].date = e.target.value))} />
              <input value={n.text} placeholder="Note" onChange={(e) => update((ev) => (ev.notes[i].text = e.target.value))} />
              <RemoveBtn onClick={() => update((ev) => ev.notes.splice(i, 1))} />
            </div>
          ))}
          {!event.notes.length && <Empty>No notes yet.</Empty>}
        </div>
      </Panel>
    </div>
  );
}

/* ============================================================
   AUDIO / VIDEO I/O TAB — patch sheets (one or more devices)
   ============================================================ */
function IOList({ event, update, kind, block, bi, side }) {
  // side: "ins" (Source) or "outs" (Destination)
  const rows = block[side];
  const label = side === "ins" ? "Source" : "Destination";
  const addRow = () =>
    update((ev) => ev[kind].blocks[bi][side].push(ioRow(rows.length + 1)));
  return (
    <div className="io-side">
      <div className="io-side-h">{side === "ins" ? "Inputs" : "Outputs"}</div>
      <div className="rows scroll-x">
        <div className="rowhead io-grid">
          <span>#</span><span>{label}</span><span>Patch</span><span>Signal</span><span>Notes</span><span />
        </div>
        {rows.map((r, ri) => (
          <div className="row io-grid" key={r.id}>
            <input className="io-num" value={r.num} onChange={(e) => update((ev) => (ev[kind].blocks[bi][side][ri].num = e.target.value))} />
            <input value={r.name} placeholder={label} onChange={(e) => update((ev) => (ev[kind].blocks[bi][side][ri].name = e.target.value))} />
            <input value={r.patch} placeholder="Patch" onChange={(e) => update((ev) => (ev[kind].blocks[bi][side][ri].patch = e.target.value))} />
            <input value={r.signal} placeholder="Signal" onChange={(e) => update((ev) => (ev[kind].blocks[bi][side][ri].signal = e.target.value))} />
            <input value={r.notes} placeholder="Notes" onChange={(e) => update((ev) => (ev[kind].blocks[bi][side][ri].notes = e.target.value))} />
            <RemoveBtn onClick={() => update((ev) => ev[kind].blocks[bi][side].splice(ri, 1))} />
          </div>
        ))}
        {!rows.length && <Empty>No {side === "ins" ? "inputs" : "outputs"} yet.</Empty>}
      </div>
      <AddBtn onClick={addRow}>{side === "ins" ? "Input" : "Output"}</AddBtn>
    </div>
  );
}

function IOTab({ event, update, kind }) {
  const data = event[kind];
  const title = kind === "audio" ? "Audio" : "Video";
  const addBlock = () => update((ev) => ev[kind].blocks.push(ioBlock("New device")));
  return (
    <div className="stack">
      <div className="tab-lead">
        <p>{title} in / out patch. Add a device for each console, switcher, or processor, then list its inputs and outputs.</p>
        <AddBtn onClick={addBlock}>Device</AddBtn>
      </div>

      {data.blocks.map((block, bi) => (
        <Panel
          key={block.id}
          title={
            <input
              className="daytitle"
              value={block.name}
              placeholder="Device / console"
              onChange={(e) => update((ev) => (ev[kind].blocks[bi].name = e.target.value))}
            />
          }
          action={<RemoveBtn title="Remove device" onClick={() => update((ev) => ev[kind].blocks.splice(bi, 1))} />}
        >
          <div className="io-cols">
            <IOList event={event} update={update} kind={kind} block={block} bi={bi} side="ins" />
            <IOList event={event} update={update} kind={kind} block={block} bi={bi} side="outs" />
          </div>
        </Panel>
      ))}
      {!data.blocks.length && (
        <Panel title={title + " I/O"}>
          <Empty>No devices yet. Add one to start the patch sheet.</Empty>
        </Panel>
      )}
    </div>
  );
}

/* ============================================================
   DIAGRAMS TAB — upload images or link hosted files
   ============================================================ */
function DiagramsTab({ event, update }) {
  const addLink = () =>
    update((ev) => ev.diagrams.push({ id: uid(), name: "", caption: "", kind: "link", url: "" }));
  return (
    <div className="stack">
      <div className="tab-lead">
        <p>
          Link your diagrams — stage plots, rigging, signal flow. Host the file (Google Drive, Dropbox,
          Vectorworks Cloud…), set sharing to “anyone with the link,” and paste it here so the whole crew can open it.
        </p>
        <AddBtn onClick={addLink}>Diagram link</AddBtn>
      </div>
      <Panel title="Diagrams">
        <div className="rows">
          <div className="rowhead diagramlink-grid">
            <span>Name</span><span>Link</span><span>Caption</span><span />
          </div>
          {event.diagrams.map((d, i) => (
            <div className="row diagramlink-grid" key={d.id}>
              <input value={d.name} placeholder="Diagram name" onChange={(e) => update((ev) => (ev.diagrams[i].name = e.target.value))} />
              <input
                value={d.url || ""}
                placeholder="https://…"
                onChange={(e) =>
                  update((ev) => {
                    ev.diagrams[i].url = e.target.value;
                    ev.diagrams[i].kind = "link";
                  })
                }
              />
              <input value={d.caption} placeholder="Caption (optional)" onChange={(e) => update((ev) => (ev.diagrams[i].caption = e.target.value))} />
              <div className="diagram-open">
                {d.url ? (
                  <a href={d.url} target="_blank" rel="noreferrer">Open ↗</a>
                ) : (
                  <span className="dim">—</span>
                )}
                <RemoveBtn onClick={() => update((ev) => ev.diagrams.splice(i, 1))} />
              </div>
            </div>
          ))}
          {!event.diagrams.length && <Empty>No diagrams yet. Add a link to a hosted stage plot or rigging file.</Empty>}
        </div>
      </Panel>
    </div>
  );
}

/* ============================================================
   RECORDS TAB — post-show notes, damage/loss, sign-offs
   ============================================================ */
function RecordsTab({ event, update }) {
  const add = () =>
    update((ev) =>
      ev.records.push({ id: uid(), date: new Date().toISOString().slice(0, 10), crew: "", type: "Post-show note", text: "" })
    );
  return (
    <div className="stack">
      <div className="tab-lead">
        <p>A running log for the show: post-show notes, damage or loss, incidents, and sign-offs the crew wants on record.</p>
        <AddBtn onClick={add}>Record</AddBtn>
      </div>
      <datalist id="record-types">
        <option value="Post-show note" />
        <option value="Damage / loss" />
        <option value="Incident" />
        <option value="Sign-off" />
        <option value="Gear repair" />
      </datalist>
      <Panel title="Records">
        <div className="rows">
          <div className="rowhead record-grid">
            <span>Date</span><span>Crew member</span><span>Type</span><span>Details</span><span />
          </div>
          {event.records.map((r, i) => (
            <div className="row record-grid" key={r.id}>
              <input type="date" value={r.date || ""} onChange={(e) => update((ev) => (ev.records[i].date = e.target.value))} />
              <input value={r.crew} placeholder="Name" onChange={(e) => update((ev) => (ev.records[i].crew = e.target.value))} />
              <input list="record-types" value={r.type} placeholder="Type" onChange={(e) => update((ev) => (ev.records[i].type = e.target.value))} />
              <input value={r.text} placeholder="What happened / what to note" onChange={(e) => update((ev) => (ev.records[i].text = e.target.value))} />
              <RemoveBtn onClick={() => update((ev) => ev.records.splice(i, 1))} />
            </div>
          ))}
          {!event.records.length && <Empty>No records yet. Add post-show notes or anything the team should log.</Empty>}
        </div>
      </Panel>
    </div>
  );
}

/* ============================================================
   HOURS TAB — timesheet
   ============================================================ */
function HoursTab({ event, update }) {
  const days = event.time.days;
  const crew = event.crew;

  const setTime = (crewId, dayId, field, val) =>
    update((ev) => {
      if (!ev.time.entries[crewId]) ev.time.entries[crewId] = {};
      if (!ev.time.entries[crewId][dayId]) ev.time.entries[crewId][dayId] = { in: "", out: "" };
      ev.time.entries[crewId][dayId][field] = val;
    });

  const entry = (crewId, dayId) => event.time.entries?.[crewId]?.[dayId] || { in: "", out: "" };
  const personTotal = (crewId) => days.reduce((s, d) => s + hoursBetween(entry(crewId, d.id).in, entry(crewId, d.id).out), 0);
  const dayTotal = (dayId) => crew.reduce((s, c) => s + hoursBetween(entry(c.id, dayId).in, entry(c.id, dayId).out), 0);
  const grand = crew.reduce((s, c) => s + personTotal(c.id), 0);

  const addDay = () => {
    const n = days.length + 1;
    update((ev) => ev.time.days.push({ id: uid(), label: "Day " + n }));
  };

  if (!crew.length)
    return (
      <Panel title="Hours">
        <Empty>Add crew members on the Brief tab first — they’ll appear here as timesheet rows.</Empty>
      </Panel>
    );

  return (
    <div className="stack">
      <div className="tab-lead">
        <p>Enter time in / out for each person, per day. Hours calculate automatically — overnight shifts included.</p>
        <AddBtn onClick={addDay}>Day</AddBtn>
      </div>

      <div className="ts-wrap">
        <table className="timesheet">
          <thead>
            <tr>
              <th className="sticky-col name-col">Crew</th>
              {days.map((d, di) => (
                <th key={d.id} className="day-col" colSpan={3}>
                  <div className="day-head">
                    <input
                      className="daylabel"
                      value={d.label}
                      onChange={(e) => update((ev) => (ev.time.days[di].label = e.target.value))}
                    />
                    <button className="remove sm" title="Remove day" onClick={() => update((ev) => ev.time.days.splice(di, 1))}>×</button>
                  </div>
                </th>
              ))}
              <th className="total-col">Total</th>
            </tr>
            <tr className="subhead">
              <th className="sticky-col name-col" />
              {days.map((d) => (
                <React.Fragment key={d.id}>
                  <th>In</th>
                  <th>Out</th>
                  <th>Hrs</th>
                </React.Fragment>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {crew.map((c) => (
              <tr key={c.id}>
                <td className="sticky-col name-col">
                  <div className="crew-name">{c.name || "—"}</div>
                  <div className="crew-pos">{c.position}</div>
                </td>
                {days.map((d) => {
                  const en = entry(c.id, d.id);
                  const h = hoursBetween(en.in, en.out);
                  return (
                    <React.Fragment key={d.id}>
                      <td>
                        <input type="time" value={en.in} onChange={(e) => setTime(c.id, d.id, "in", e.target.value)} />
                      </td>
                      <td>
                        <input type="time" value={en.out} onChange={(e) => setTime(c.id, d.id, "out", e.target.value)} />
                      </td>
                      <td className={"hrs " + (h ? "on" : "")}>{fmtHrs(h)}</td>
                    </React.Fragment>
                  );
                })}
                <td className="ptotal">{fmtHrs(personTotal(c.id))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="sticky-col name-col foot">Daily total</td>
              {days.map((d) => (
                <td key={d.id} className="dtotal" colSpan={3}>
                  {fmtHrs(dayTotal(d.id))} hrs
                </td>
              ))}
              <td className="grand">{fmtHrs(grand)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {!days.length && <Empty>No days yet. Add a day to start tracking.</Empty>}
    </div>
  );
}

/* ---------- misc ---------- */
function Empty({ children }) {
  return <div className="empty">{children}</div>;
}
function prettyDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function briefText(e) {
  const L = [];
  L.push(`${e.name.toUpperCase()}`);
  if (e.client) L.push(`Client: ${e.client}`);
  L.push(`Dates: ${prettyDate(e.startDate)} – ${prettyDate(e.endDate)}`);
  L.push(`Venue: ${e.venue.name}${e.venue.address ? " — " + e.venue.address : ""}`);
  L.push("");
  if (e.contacts.some((c) => c.name)) {
    L.push("CONTACTS");
    e.contacts.filter((c) => c.name).forEach((c) => L.push(`• ${c.role}: ${c.name}  ${c.phone}  ${c.email}`));
    L.push("");
  }
  if (e.crew.length) {
    L.push("CREW");
    e.crew.forEach((c) => L.push(`• ${c.name} — ${c.position}  ${c.phone}`));
    L.push("");
  }
  if (e.schedule.length) {
    L.push("SCHEDULE");
    e.schedule.forEach((d) => {
      L.push(`${d.label}${d.date ? " (" + prettyDate(d.date) + ")" : ""}`);
      d.items.forEach((it) => L.push(`  ${it.time}  ${it.activity}`));
    });
    L.push("");
  }
  if (e.wardrobe) {
    L.push("WARDROBE");
    L.push(e.wardrobe);
  }
  return L.join("\n");
}

/* ============================================================
   Styles
   ============================================================ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');

.cb{
  --bg:#14161B; --panel:#1B1E26; --panel2:#232733; --line:#2E3441;
  --ink:#E9ECF2; --dim:#96A0B2; --faint:#6C7688;
  --amber:#FFB020; --amber-deep:#E8971A;
  --green:#5FD08A; --danger:#FF6B6B;
  background:var(--bg); color:var(--ink);
  font-family:'Inter',system-ui,sans-serif;
  min-height:100vh; padding:0 0 60px;
  -webkit-font-smoothing:antialiased;
}
.cb *{box-sizing:border-box;}
.cb .loading{padding:80px 24px; text-align:center; color:var(--dim); font-family:'Oswald'; letter-spacing:.08em;}

/* topbar */
.cb .topbar{
  display:flex; align-items:center; gap:14px; flex-wrap:wrap;
  padding:12px 20px; background:#101218; border-bottom:1px solid var(--line);
  position:sticky; top:0; z-index:20;
}
.cb .brand{font-family:'Oswald'; font-weight:700; letter-spacing:.06em; font-size:19px; display:flex;}
.cb .brand-tab{background:var(--amber); color:#101218; padding:2px 8px; border-radius:3px 0 0 3px;}
.cb .brand-rest{background:var(--panel2); color:var(--ink); padding:2px 8px; border-radius:0 3px 3px 0;}
.cb .evt-picker{flex:1; min-width:180px;}
.cb .evt-picker select{
  width:100%; max-width:340px; background:var(--panel2); color:var(--ink);
  border:1px solid var(--line); border-radius:7px; padding:8px 10px;
  font-family:'Inter'; font-size:14px; font-weight:600;
}
.cb .top-actions{display:flex; gap:7px;}
.cb .btn{
  background:var(--panel2); color:var(--ink); border:1px solid var(--line);
  border-radius:7px; padding:8px 13px; font-size:13px; font-weight:600; cursor:pointer;
  font-family:'Inter'; transition:background .15s,border-color .15s;
}
.cb .btn:hover{background:#2B303C;}
.cb .btn.ghost{background:transparent;}
.cb .btn.amber{background:var(--amber); color:#101218; border-color:var(--amber);}
.cb .btn.amber:hover{background:var(--amber-deep);}
.cb .btn.danger{color:var(--danger); border-color:#4a2a2e;}
.cb .btn.danger:hover{background:#2a1a1d;}
.cb .savechip{
  font-size:11px; letter-spacing:.05em; color:var(--faint); font-weight:600;
  padding:4px 8px; border-radius:20px; white-space:nowrap;
}
.cb .savechip.saving{color:var(--amber);}
.cb .savechip.saved{color:var(--green);}

/* event header */
.cb .evt-head{
  display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap;
  padding:22px 24px 16px; border-bottom:1px solid var(--line);
  background:linear-gradient(180deg,#171A21,#14161B);
}
.cb .evt-name-wrap{min-width:0;}
.cb .evt-name-input{
  font-family:'Oswald'; font-weight:600; font-size:30px; letter-spacing:.01em;
  background:transparent; border:none; color:var(--ink); width:100%; padding:0;
  border-bottom:2px solid transparent; line-height:1.1;
}
.cb .evt-name-input:focus{outline:none; border-bottom-color:var(--amber);}
.cb .evt-meta{display:flex; gap:9px; align-items:center; flex-wrap:wrap; margin-top:8px; color:var(--dim); font-size:13.5px; font-weight:500;}
.cb .evt-meta .dot{color:var(--faint);}
.cb .btn.copy{flex-shrink:0;}

/* tabs */
.cb .tabs{display:flex; gap:2px; padding:0 16px; border-bottom:1px solid var(--line); overflow-x:auto;}
.cb .tab{
  background:transparent; border:none; color:var(--dim); cursor:pointer;
  font-family:'Oswald'; font-weight:600; letter-spacing:.06em; text-transform:uppercase;
  font-size:13px; padding:14px 16px 12px; border-bottom:2px solid transparent; white-space:nowrap;
}
.cb .tab:hover{color:var(--ink);}
.cb .tab.active{color:var(--amber); border-bottom-color:var(--amber);}

/* content */
.cb .content{max-width:1080px; margin:0 auto; padding:22px 20px;}
.cb .stack{display:flex; flex-direction:column; gap:18px;}
.cb .tab-lead{display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; color:var(--dim); font-size:13.5px;}
.cb .tab-lead p{margin:0;}

/* home board */
.cb .home{max-width:1000px; margin:0 auto; padding:24px 20px 40px;}
.cb .hero{display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:24px;}
.cb .hero-main{min-width:0;}
.cb .board-label{font-family:'Oswald'; font-weight:600; letter-spacing:.14em; text-transform:uppercase; font-size:12px; color:var(--faint); margin:0 2px 12px;}
.cb .tilegrid{display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:14px;}
.cb .tile{
  position:relative; text-align:left; cursor:pointer; color:#1A130B;
  border:2px solid rgba(0,0,0,.5); border-radius:16px; padding:16px 16px 14px; min-height:150px;
  display:flex; flex-direction:column; gap:2px;
  box-shadow:0 6px 16px rgba(0,0,0,.32); font-family:'Inter';
  transition:transform .13s ease, box-shadow .13s ease;
}
.cb .tile:hover{transform:translateY(-4px); box-shadow:0 12px 26px rgba(0,0,0,.42);}
.cb .tile:active{transform:translateY(-1px);}
.cb .tile:focus-visible{outline:3px solid #fff; outline-offset:2px;}
.cb .tile-ico{color:#1A130B; opacity:.9; margin-bottom:8px; display:block;}
.cb .tile-label{font-family:'Oswald'; font-weight:600; letter-spacing:.02em; font-size:22px; line-height:1.05; color:#140E06;}
.cb .tile-desc{font-size:12.5px; font-weight:500; color:rgba(20,14,6,.72);}
.cb .tile-stat{
  margin-top:auto; align-self:flex-start; font-size:11.5px; font-weight:700;
  background:rgba(0,0,0,.16); color:rgba(20,14,6,.9);
  padding:3px 9px; border-radius:20px; letter-spacing:.01em;
}

/* section page bar */
.cb .pagebar{
  display:flex; align-items:center; gap:14px; flex-wrap:wrap;
  max-width:1080px; margin:0 auto; padding:14px 20px 0;
}
.cb .backbtn{
  background:var(--panel2); color:var(--ink); border:1px solid var(--line);
  border-radius:8px; padding:8px 13px 8px 10px; font-size:13px; font-weight:600; cursor:pointer;
  font-family:'Inter'; display:inline-flex; align-items:center; gap:5px;
}
.cb .backbtn:hover{background:#2B303C; border-color:var(--amber);}
.cb .backbtn .chev{font-size:18px; line-height:1; margin-top:-1px;}
.cb .pagebar-title{font-family:'Oswald'; font-weight:600; letter-spacing:.05em; text-transform:uppercase; font-size:18px; color:var(--amber);}
.cb .pagebar-evt{margin-left:auto; color:var(--faint); font-size:13px; font-weight:500; max-width:40%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}

/* panels */
.cb .panel{background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px 16px 18px;}
.cb .panel-h{display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:14px;}
.cb .panel-title{
  font-family:'Oswald'; font-weight:600; letter-spacing:.05em; text-transform:uppercase;
  font-size:15px; margin:0; color:var(--ink);
}
.cb .panel-sub{margin:3px 0 0; font-size:12px; color:var(--faint);}
.cb .grid2{display:grid; grid-template-columns:1fr 1fr; gap:12px 16px;}
.cb .grid2.top{align-items:start;}

/* fields */
.cb .field{display:flex; flex-direction:column; gap:5px;}
.cb .field span{font-size:11px; letter-spacing:.05em; text-transform:uppercase; color:var(--faint); font-weight:600;}
.cb input, .cb textarea, .cb select{
  background:var(--panel2); border:1px solid var(--line); border-radius:7px;
  color:var(--ink); font-family:'Inter'; font-size:13.5px; padding:8px 10px; width:100%;
}
.cb input:focus, .cb textarea:focus, .cb select:focus{outline:none; border-color:var(--amber); box-shadow:0 0 0 2px rgba(255,176,32,.15);}
.cb input::placeholder, .cb textarea::placeholder{color:var(--faint);}
.cb .area{resize:vertical; line-height:1.5;}
.cb input[type=date], .cb input[type=time]{color-scheme:dark;}

/* rows */
.cb .rows{display:flex; flex-direction:column; gap:6px;}
.cb .rowhead{display:grid; gap:8px; font-size:10.5px; letter-spacing:.05em; text-transform:uppercase; color:var(--faint); font-weight:600; padding:0 2px 2px;}
.cb .row{display:grid; gap:8px; align-items:center;}
.cb .contact-grid{grid-template-columns:1.1fr 1.1fr 1fr 1.4fr 28px;}
.cb .crew-grid{grid-template-columns:1.05fr 1.05fr 0.95fr 1.3fr 82px;}
.cb .row-tools{display:flex; align-items:center; gap:2px; justify-content:flex-end;}
.cb .panel-actions{display:flex; gap:6px; align-items:center;}
.cb .movebtn{background:transparent; border:1px solid transparent; color:var(--faint); width:24px; height:28px; border-radius:6px; cursor:pointer; font-size:11px; line-height:1;}
.cb .movebtn:hover:not(:disabled){color:var(--amber); background:var(--panel2);}
.cb .movebtn:disabled{opacity:.28; cursor:default;}
.cb .link-grid{grid-template-columns:1fr 1.6fr 28px;}
.cb .sched-grid{grid-template-columns:110px 1fr 28px;}
.cb .stay-grid{grid-template-columns:1.1fr 130px 130px .8fr 1.2fr 28px;}
.cb .flight-grid{grid-template-columns:1.1fr 130px 1fr .8fr 100px 100px .8fr 1fr 28px; min-width:900px;}
.cb .meal-grid{grid-template-columns:140px 100px 1.2fr 1.2fr 28px;}
.cb .note-grid{grid-template-columns:140px 1fr 28px;}
.cb .scroll-x{overflow-x:auto;}

.cb .remove{
  background:transparent; border:1px solid transparent; color:var(--faint);
  width:26px; height:30px; border-radius:6px; cursor:pointer; font-size:18px; line-height:1;
}
.cb .remove:hover{color:var(--danger); background:#2a1a1d;}
.cb .remove.sm{width:20px; height:20px; font-size:14px;}
.cb .add{
  align-self:flex-start; margin-top:10px; background:transparent; border:1px dashed var(--line);
  color:var(--amber); border-radius:7px; padding:7px 12px; font-size:12.5px; font-weight:600; cursor:pointer;
  font-family:'Inter';
}
.cb .add:hover{border-color:var(--amber); background:rgba(255,176,32,.06);}
.cb .empty{color:var(--faint); font-size:13px; padding:14px 4px; font-style:italic;}

/* schedule specifics */
.cb .daytitle{font-family:'Oswald'; font-weight:600; letter-spacing:.04em; text-transform:uppercase; font-size:15px; background:transparent; border:none; padding:0; border-bottom:1px solid transparent; max-width:340px;}
.cb .daytitle:focus{border-bottom-color:var(--amber); box-shadow:none;}
.cb .day-tools{display:flex; gap:8px; align-items:center;}
.cb .daydate{width:130px;}
.cb .time-in-text{font-variant-numeric:tabular-nums;}

/* timesheet */
.cb .ts-wrap{overflow-x:auto; border:1px solid var(--line); border-radius:12px; background:var(--panel);}
.cb .timesheet{border-collapse:separate; border-spacing:0; width:100%; font-size:12.5px;}
.cb .timesheet th, .cb .timesheet td{padding:6px 6px; border-bottom:1px solid var(--line); text-align:center; white-space:nowrap;}
.cb .timesheet thead th{background:#101218; font-family:'Oswald'; font-weight:600; letter-spacing:.04em; color:var(--dim); font-size:11px;}
.cb .timesheet .subhead th{font-size:10px; text-transform:uppercase; color:var(--faint); padding:3px 6px;}
.cb .day-col{border-left:1px solid var(--line);}
.cb .day-head{display:flex; align-items:center; gap:4px; justify-content:center;}
.cb .daylabel{width:78px; text-align:center; background:transparent; border:none; color:var(--dim); font-family:'Oswald'; font-size:11px; padding:2px; letter-spacing:.03em;}
.cb .daylabel:focus{color:var(--amber); box-shadow:none;}
.cb .sticky-col{position:sticky; left:0; z-index:2; background:var(--panel); text-align:left;}
.cb .name-col{min-width:150px;}
.cb .timesheet thead .name-col{background:#101218;}
.cb .crew-name{font-weight:600; color:var(--ink);}
.cb .crew-pos{font-size:10.5px; color:var(--faint);}
.cb .timesheet td input{width:66px; padding:5px 4px; text-align:center; background:#191C24; font-variant-numeric:tabular-nums;}
.cb .hrs{font-variant-numeric:tabular-nums; color:var(--faint); font-weight:600; min-width:38px;}
.cb .hrs.on{color:var(--green);}
.cb .ptotal{font-variant-numeric:tabular-nums; font-weight:700; color:var(--amber); background:#191C24; border-left:1px solid var(--line);}
.cb .total-col{border-left:1px solid var(--line); min-width:52px;}
.cb .timesheet tfoot td{background:#101218; font-weight:600; border-bottom:none;}
.cb .foot{font-family:'Oswald'; letter-spacing:.04em; color:var(--dim);}
.cb .dtotal{font-variant-numeric:tabular-nums; color:var(--dim); border-left:1px solid var(--line);}
.cb .grand{font-variant-numeric:tabular-nums; color:var(--green); font-weight:700; font-size:14px; border-left:1px solid var(--line);}

/* audio / video I/O */
.cb .io-cols{display:grid; grid-template-columns:1fr 1fr; gap:16px;}
.cb .io-side{display:flex; flex-direction:column;}
.cb .io-side-h{font-family:'Oswald'; font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:var(--amber); margin-bottom:8px; padding-bottom:5px; border-bottom:1px solid var(--line);}
.cb .io-grid{grid-template-columns:44px 1.2fr .8fr .8fr 1fr 28px; min-width:420px;}
.cb .io-num{text-align:center; font-variant-numeric:tabular-nums; color:var(--dim);}

/* diagrams */
.cb .dropzone{border:1.5px dashed var(--line); border-radius:12px; background:var(--panel); transition:border-color .15s,background .15s;}
.cb .dropzone:hover{border-color:var(--amber);}
.cb .dz-inner{padding:26px 20px; text-align:center; display:flex; flex-direction:column; align-items:center; gap:6px;}
.cb .dz-title{font-family:'Oswald'; font-weight:600; letter-spacing:.04em; text-transform:uppercase; font-size:16px; color:var(--ink);}
.cb .dz-sub{font-size:12.5px; color:var(--faint); margin-bottom:6px;}
.cb .dz-actions{display:flex; gap:8px; flex-wrap:wrap; justify-content:center; margin-top:6px;}
.cb .btn:disabled{opacity:.6; cursor:default;}
.cb .diagram-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:14px;}
.cb .diagram-card{position:relative; background:var(--panel); border:1px solid var(--line); border-radius:11px; overflow:hidden; display:flex; flex-direction:column;}
.cb .diagram-preview{aspect-ratio:16/10; background:#101218; display:flex; align-items:center; justify-content:center; overflow:hidden;}
.cb .diagram-preview img{width:100%; height:100%; object-fit:contain; display:block; cursor:zoom-in;}
.cb .diagram-ph{color:var(--faint); font-size:12.5px; display:flex; flex-direction:column; align-items:center; gap:8px;}
.cb .diagram-ph.link a{color:var(--amber); font-weight:600; text-decoration:none;}
.cb .link-badge{font-family:'Oswald'; font-size:11px; letter-spacing:.1em; color:#101218; background:var(--dim); padding:2px 8px; border-radius:3px;}
.cb .diagram-ph .dim{color:var(--faint);}
.cb .diagram-body{padding:10px; display:flex; flex-direction:column; gap:6px;}
.cb .diagram-name{font-weight:600; font-size:13px;}
.cb .diagram-url{font-size:12px; color:var(--amber);}
.cb .diagram-cap{font-size:12px; color:var(--dim);}
.cb .diagram-x{
  position:absolute; top:7px; right:7px; width:26px; height:26px; border-radius:6px;
  background:rgba(16,18,24,.82); border:1px solid var(--line); color:var(--ink);
  font-size:17px; line-height:1; cursor:pointer;
}
.cb .diagram-x:hover{color:var(--danger); border-color:var(--danger);}

/* records */
.cb .record-grid{grid-template-columns:130px 1fr 130px 2fr 28px;}

/* toast */
.cb .toast{
  position:fixed; bottom:22px; left:50%; transform:translateX(-50%);
  background:var(--amber); color:#101218; font-weight:600; font-size:13.5px;
  padding:11px 18px; border-radius:9px; box-shadow:0 8px 26px rgba(0,0,0,.4); z-index:50;
}

@media (max-width:760px){
  .cb .tilegrid{grid-template-columns:1fr 1fr; gap:11px;}
  .cb .tile{min-height:128px; padding:13px 12px 12px; border-radius:14px;}
  .cb .tile-label{font-size:19px;}
  .cb .tile-desc{font-size:11.5px;}
  .cb .hero{align-items:stretch;}
  .cb .pagebar-evt{display:none;}
  .cb .io-cols{grid-template-columns:1fr;}
  .cb .record-grid{grid-template-columns:1fr 1fr;}
  .cb .rowhead.record-grid{display:none;}
  .cb .grid2{grid-template-columns:1fr;}
  .cb .contact-grid, .cb .crew-grid{grid-template-columns:1fr 1fr; grid-auto-flow:row;}
  .cb .contact-grid .remove{grid-column:2; justify-self:end;}
  .cb .crew-grid .row-tools{grid-column:1 / -1; justify-content:flex-end;}
  .cb .rowhead.contact-grid, .cb .rowhead.crew-grid{display:none;}
  .cb .stay-grid{grid-template-columns:1fr 1fr; }
  .cb .rowhead.stay-grid{display:none;}
  .cb .meal-grid{grid-template-columns:1fr 1fr;}
  .cb .rowhead.meal-grid{display:none;}
  .cb .evt-name-input{font-size:24px;}
}
@media (prefers-reduced-motion:reduce){ .cb *{transition:none !important;} }

/* login (cloud build) */
.cb .login-wrap{min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; padding:24px;}
.cb .login-card{background:var(--panel); border:1px solid var(--line); border-radius:16px; padding:26px 24px; width:100%; max-width:360px; box-shadow:0 18px 50px rgba(0,0,0,.45);}
.cb .login-brand{justify-content:flex-start; font-size:22px; margin-bottom:18px;}
.cb .login-tabs{display:flex; gap:6px; margin-bottom:14px;}
.cb .login-tab{flex:1; background:var(--panel2); border:1px solid var(--line); color:var(--dim); border-radius:8px; padding:9px; font-weight:600; font-size:13px; cursor:pointer; font-family:'Inter';}
.cb .login-tab.on{background:var(--amber); color:#101218; border-color:var(--amber);}
.cb .login-hint{color:var(--faint); font-size:12.5px; margin:0 0 14px;}
.cb .login-input{margin-bottom:12px;}
.cb .login-err{color:var(--danger); font-size:12.5px; margin-bottom:12px;}
.cb .login-go{width:100%; justify-content:center; text-align:center;}
.cb .login-foot{color:var(--faint); font-size:11px; letter-spacing:.1em; text-transform:uppercase;}

/* top-right + locked picker (cloud build) */
.cb .top-right{display:flex; align-items:center; gap:10px; margin-left:auto;}
.cb .evt-picker.locked{flex:1;}
.cb .lock-name{font-family:'Oswald'; font-weight:600; letter-spacing:.02em; font-size:16px; color:var(--ink);}
.cb .signout{white-space:nowrap;}

/* diagram links (cloud build) */
.cb .diagramlink-grid{grid-template-columns:1.1fr 1.6fr 1.1fr 100px;}
.cb .diagram-open{display:flex; align-items:center; gap:6px; justify-content:flex-end;}
.cb .diagram-open a{color:var(--amber); font-weight:600; text-decoration:none; font-size:13px;}
`;

/* ============================================================
   LOGIN + ROOT — the password gate in front of the app
   ============================================================ */
function Login({ onDone }) {
  const [mode, setMode] = useState("show"); // "show" | "admin"
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!password || busy) return;
    setBusy(true);
    setErr("");
    try {
      if (mode === "admin") {
        await loginAdmin(password);
        onDone({ scope: "admin" });
      } else {
        const r = await loginShow(password);
        onDone({ scope: "show", showId: r.show.id, showName: r.show.name });
      }
    } catch (e) {
      setErr(e.message || "Sign in failed");
      setBusy(false);
    }
  }

  return (
    <div className="cb">
      <style>{CSS}</style>
      <div className="login-wrap">
        <div className="login-card">
          <div className="brand login-brand">
            <span className="brand-tab">CALL</span>
            <span className="brand-rest">BOARD</span>
          </div>
          <div className="login-tabs">
            <button className={"login-tab " + (mode === "show" ? "on" : "")} onClick={() => setMode("show")}>Open a show</button>
            <button className={"login-tab " + (mode === "admin" ? "on" : "")} onClick={() => setMode("admin")}>Admin</button>
          </div>
          <p className="login-hint">
            {mode === "show"
              ? "Enter the password for your show. You'll only see that show."
              : "Enter the admin password to manage every show."}
          </p>
          <input
            className="login-input"
            type="password"
            value={password}
            autoFocus
            placeholder={mode === "show" ? "Show password" : "Admin password"}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          {err && <div className="login-err">{err}</div>}
          <button className="btn amber login-go" onClick={submit} disabled={busy}>
            {busy ? "Checking…" : mode === "show" ? "Open show" : "Sign in"}
          </button>
        </div>
        <div className="login-foot">Callboard · production hub</div>
      </div>
    </div>
  );
}

export default function Root() {
  const [auth, setAuth] = useState(() => currentAuth());
  if (!auth) return <Login onDone={(a) => setAuth(a)} />;
  return (
    <Callboard
      auth={auth}
      onLogout={() => {
        dbLogout();
        setAuth(null);
      }}
    />
  );
}
