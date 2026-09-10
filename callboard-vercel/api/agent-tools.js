/* ---------------------------------------------------------------------------
   The agent's hands.

   Split into two lists on purpose, and the split is the whole safety model:

     READ_TOOLS  run immediately, as many times as the model likes.
     WRITE_TOOLS never run when the model asks. Asking records an intention;
                 you confirm it, and only then does anything happen.

   So the worst a confused or manipulated model can do is describe a change you
   are about to be shown and asked about. It cannot quietly edit a pull list.
--------------------------------------------------------------------------- */
import { supabaseRest } from "./_lib.js";

const BUSINESS_TZ = "America/Los_Angeles";
export const todayLocal = () => new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS_TZ });

const money = (n) => "$" + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString();

/* Shows are fetched a lot, and every tool call that mentions one needs the
   list to resolve a name. Cached for the life of a single request only. */
export function makeCtx() {
  return { _shows: null };
}
/* Only id, name and client. Every other file in this project selects exactly
   these three from /shows, and asking for anything else returns an error from
   PostgREST rather than an empty column — which the agent then reports as "the
   shows table is unavailable". Dates come from the show's own record instead. */
async function shows(ctx) {
  if (!ctx._shows) {
    ctx._shows = (await supabaseRest("GET", "/shows?select=id,name,client", null)) || [];
  }
  return ctx._shows;
}

/* One show, whole row. select=* is safe here in a way it would not be across
   every show at once: it is one record, and it means no column name has to be
   guessed. The event body has lived at the top level and under `data` at
   different times, so accept either. */
async function showRow(id) {
  const rows = await supabaseRest("GET", "/shows?id=eq." + encodeURIComponent(id) + "&select=*", null);
  const row = (rows && rows[0]) || {};
  const underData = !!(row.data && typeof row.data === "object");
  const ev = underData ? row.data : row;
  return { row, ev, underData };
}

/* Write the body back the same shape it was read in. Guessing here is the one
   place a wrong guess does damage rather than just failing: patching a `data`
   column onto a table that keeps the body flat would either error or bury the
   show's real contents one level down. */
async function saveShow(id, underData, ev) {
  await supabaseRest("PATCH", "/shows?id=eq." + encodeURIComponent(id),
    underData ? { data: ev } : ev);
}

/* Venue is an object — {name, address, mapLink} — in the event body, but has
   been a plain string in older records. */
function venueText(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  return [v.name, v.address].filter(Boolean).join(", ");
}
const showDates = (row, ev) => {
  const a = ev.startDate || row.startDate || row.start_date || "";
  const b = ev.endDate || row.endDate || row.end_date || a;
  return a ? a + (b && b !== a ? " to " + b : "") : "";
};

/* The model is given ids and told to use them, but people say "the Acme job".
   Resolve loosely so a near-miss finds the show instead of failing. */
async function resolveShow(ctx, ref) {
  const list = await shows(ctx);
  const q = String(ref || "").trim().toLowerCase();
  if (!q) return null;
  return (
    list.find((s) => s.id === ref) ||
    list.find((s) => String(s.name || "").toLowerCase() === q) ||
    list.find((s) => String(s.name || "").toLowerCase().includes(q)) ||
    list.find((s) => String(s.client || "").toLowerCase().includes(q)) ||
    null
  );
}

export const READ_TOOLS = {
  list_shows: {
    spec: {
      name: "list_shows",
      description: "Every show on the books with its id, client and dates. Call this first when the user names a show, to get its id.",
      input_schema: { type: "object", properties: {} },
    },
    run: async (ctx) => {
      const list = await shows(ctx);
      if (!list.length) return "No shows yet.";
      return list.map((s) => `${s.id} | ${s.name}${s.client ? " | " + s.client : ""}`).join("\n");
    },
  },

  get_show: {
    spec: {
      name: "get_show",
      description: "A summary of one show: venue, dates, crew, and how much is on each list. Use before answering questions about a specific job.",
      input_schema: {
        type: "object",
        properties: { show: { type: "string", description: "Show id, or its name" } },
        required: ["show"],
      },
    },
    run: async (ctx, input) => {
      const s = await resolveShow(ctx, input.show);
      if (!s) return "No show matches that. Call list_shows.";
      const { row, ev } = await showRow(s.id);
      const cases = (ev.pull && ev.pull.cases) || (Array.isArray(ev.pull) ? ev.pull : []);
      const items = cases.reduce((n, c) => n + ((c.items || []).length), 0);
      const crew = (ev.crew || []).length;
      const todos = (ev.todos || []).filter((t) => !t.done).length;
      const dates = showDates(row, ev);
      return [
        `${s.name}${s.client ? " for " + s.client : ""}`,
        dates ? `Dates: ${dates}` : "Dates: not set",
        venueText(ev.venue) ? `Venue: ${venueText(ev.venue)}` : "",
        `Crew: ${crew}`,
        `Pull list: ${cases.length} cases, ${items} items`,
        `Open to-dos: ${todos}`,
        ev.brief ? `Brief: ${String(ev.brief).slice(0, 600)}` : "",
      ].filter(Boolean).join("\n");
    },
  },

  get_pull_list: {
    spec: {
      name: "get_pull_list",
      description: "The cases and items on a show's pull list. Use before adding gear, so you can say whether something is already there and which case it belongs in.",
      input_schema: {
        type: "object",
        properties: { show: { type: "string" } },
        required: ["show"],
      },
    },
    run: async (ctx, input) => {
      const s = await resolveShow(ctx, input.show);
      if (!s) return "No show matches that.";
      const { ev } = await showRow(s.id);
      const cases = (ev.pull && ev.pull.cases) || (Array.isArray(ev.pull) ? ev.pull : []);
      if (!cases.length) return "That show has no pull list yet.";
      return cases.map((c) =>
        `[${c.category || "Misc"}] ${c.case}: ` +
        ((c.items || []).map((i) => `${i.qty || ""}x ${i.item}`.trim()).join(", ") || "empty")
      ).join("\n");
    },
  },

  get_crew: {
    spec: {
      name: "get_crew",
      description: "Who is on a show, their positions and call times.",
      input_schema: { type: "object", properties: { show: { type: "string" } }, required: ["show"] },
    },
    run: async (ctx, input) => {
      const s = await resolveShow(ctx, input.show);
      if (!s) return "No show matches that.";
      const { ev } = await showRow(s.id);
      const crew = ev.crew || [];
      if (!crew.length) return "No crew on that show yet.";
      return crew.map((c) => `${c.name || "(unnamed)"} — ${c.role || c.position || "no position"}${c.call ? " — call " + c.call : ""}`).join("\n");
    },
  },

  list_tasks: {
    spec: {
      name: "list_tasks",
      description: "The user's open to-do items, general and per-show.",
      input_schema: { type: "object", properties: {} },
    },
    run: async () => {
      const rows = await supabaseRest("GET", "/tasks?status=eq.open&select=*&order=due.asc.nullslast&limit=200", null);
      if (!rows || !rows.length) return "Nothing open.";
      return rows.map((t) =>
        `${t.review ? "[unconfirmed] " : ""}${t.title}${t.due ? " — due " + t.due : ""}${t.event_id ? " — show " + t.event_id : " — general"}`
      ).join("\n");
    },
  },

  get_billing: {
    spec: {
      name: "get_billing",
      description: "Invoices and what is outstanding. Omit `show` for everything across all shows.",
      input_schema: { type: "object", properties: { show: { type: "string" } } },
    },
    run: async (ctx, input) => {
      let filter = "";
      if (input && input.show) {
        const s = await resolveShow(ctx, input.show);
        if (!s) return "No show matches that.";
        filter = "&event_id=eq." + encodeURIComponent(s.id);
      }
      const rows = await supabaseRest(
        "GET", "/billing_invoices?select=*" + filter + "&order=scheduled_due_date.asc.nullslast&limit=300", null);
      if (!rows || !rows.length) return "No invoices.";
      const today = todayLocal();
      return rows.slice(0, 80).map((r) => {
        const amt = r.actual_amount != null ? Number(r.actual_amount) : Number(r.scheduled_amount || 0);
        const paid = Number(r.paid_amount || 0);
        const bal = Math.round((amt - paid) * 100) / 100;
        const late = r.scheduled_due_date && r.scheduled_due_date < today && bal > 0;
        return `${r.label || r.milestone_type} — ${money(amt)}` +
               (paid ? `, paid ${money(paid)}` : "") +
               (bal > 0 ? `, outstanding ${money(bal)}` : ", settled") +
               (r.scheduled_due_date ? `, due ${r.scheduled_due_date}` : "") +
               (late ? " — OVERDUE" : "") +
               ` [${r.status || "draft"}]`;
      }).join("\n");
    },
  },
};

/* Every one of these produces an intention, never a change. `describe` is what
   the user is shown before they confirm, so it has to be specific enough to
   judge — "add 4 items to Acme AGM" is not good enough to say yes to. */
export const WRITE_TOOLS = {
  add_task: {
    spec: {
      name: "add_task",
      description: "Put something on the user's to-do list. Use for reminders and admin. Not for gear.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short imperative action" },
          show: { type: "string", description: "Show id or name, if it belongs to one" },
          due: { type: "string", description: "YYYY-MM-DD" },
          priority: { type: "string", enum: ["high", "med", "low", ""] },
        },
        required: ["title"],
      },
    },
    describe: async (ctx, i) => {
      const s = i.show ? await resolveShow(ctx, i.show) : null;
      return `Add a to-do: "${i.title}"` +
             (s ? ` on ${s.name}` : " (general)") +
             (i.due ? `, due ${i.due}` : "") +
             (i.priority ? `, ${i.priority} priority` : "");
    },
    apply: async (ctx, i) => {
      const s = i.show ? await resolveShow(ctx, i.show) : null;
      await supabaseRest("POST", "/tasks", {
        title: String(i.title).slice(0, 300),
        event_id: s ? s.id : null,
        due: i.due || null,
        priority: ["high", "med", "low"].indexOf(i.priority) >= 0 ? i.priority : "",
        status: "open", review: false, source: "app",
      }, "return=representation");
      return "Added.";
    },
  },

  add_pull_items: {
    spec: {
      name: "add_pull_items",
      description: "Add gear to a show's pull list. Check get_pull_list first so you can put items in an existing case rather than making a duplicate one.",
      input_schema: {
        type: "object",
        properties: {
          show: { type: "string" },
          case_name: { type: "string", description: "Existing case name, or a new one" },
          category: { type: "string", enum: ["Audio", "Video", "Lighting", "Power", "Scenic", "Misc"] },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: { item: { type: "string" }, qty: { type: "string" } },
              required: ["item"],
            },
          },
        },
        required: ["show", "case_name", "items"],
      },
    },
    describe: async (ctx, i) => {
      const s = await resolveShow(ctx, i.show);
      if (!s) return null;
      const list = (i.items || []).map((x) => `${x.qty ? x.qty + "x " : ""}${x.item}`).join(", ");
      return `On ${s.name}, add to the "${i.case_name}" case: ${list}`;
    },
    apply: async (ctx, i) => {
      const s = await resolveShow(ctx, i.show);
      if (!s) return "That show no longer exists.";
      const { ev, underData } = await showRow(s.id);
      const pull = ev.pull && ev.pull.cases ? ev.pull : { cases: Array.isArray(ev.pull) ? ev.pull : [], loose: [] };
      const cases = pull.cases.slice();
      const uid = () => "ag" + Math.random().toString(36).slice(2, 10);
      const wanted = String(i.case_name || "").trim().toLowerCase();
      let idx = cases.findIndex((c) => String(c.case || "").trim().toLowerCase() === wanted);
      if (idx < 0) {
        cases.push({
          id: uid(),
          caseNo: cases.reduce((m, c) => Math.max(m, Number(c.caseNo) || 0), 0) + 1,
          case: i.case_name, category: i.category || "Misc", drawers: [], items: [],
        });
        idx = cases.length - 1;
      }
      const add = (i.items || []).filter((x) => String(x.item || "").trim()).map((x) => ({
        id: uid(), drawer: null, item: String(x.item).trim(), qty: x.qty == null ? "" : String(x.qty),
        source: "TCG", rentedFrom: "", notes: "", out: false, in: false,
      }));
      cases[idx] = { ...cases[idx], items: (cases[idx].items || []).concat(add) };
      await saveShow(s.id, underData, { ...ev, pull: { ...pull, cases } });
      return `Added ${add.length} item${add.length === 1 ? "" : "s"} to ${i.case_name} on ${s.name}.`;
    },
  },

  add_show_todo: {
    spec: {
      name: "add_show_todo",
      description: "Add an item to a show's own Tasks tab, the list the crew working that show see.",
      input_schema: {
        type: "object",
        properties: {
          show: { type: "string" }, title: { type: "string" },
          due: { type: "string" }, assignee: { type: "string" },
        },
        required: ["show", "title"],
      },
    },
    describe: async (ctx, i) => {
      const s = await resolveShow(ctx, i.show);
      if (!s) return null;
      return `On ${s.name}, add to that show's task list: "${i.title}"` +
             (i.assignee ? ` for ${i.assignee}` : "") + (i.due ? `, due ${i.due}` : "");
    },
    apply: async (ctx, i) => {
      const s = await resolveShow(ctx, i.show);
      if (!s) return "That show no longer exists.";
      const { ev, underData } = await showRow(s.id);
      const todos = (ev.todos || []).concat([{
        id: "ag" + Math.random().toString(36).slice(2, 10),
        title: String(i.title).slice(0, 300), assignee: i.assignee || "",
        due: i.due || "", dueTime: "", priority: "", urgent: false, done: false, notes: "",
      }]);
      await saveShow(s.id, underData, { ...ev, todos });
      return `Added to ${s.name}'s task list.`;
    },
  },
};

export const ALL_SPECS = Object.values(READ_TOOLS).map((t) => t.spec)
  .concat(Object.values(WRITE_TOOLS).map((t) => t.spec));
