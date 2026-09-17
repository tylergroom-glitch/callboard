// A small layout engine over pdf-lib. Pages, headings, wrapped text, tables.
//
// WHY THIS EXISTS AND WHY IT IS ON THE SERVER
//   Every other PDF in this app is built in the BROWSER — crew-docs.js loads
//   pdf-lib from a CDN to stamp a signature, and the quote exporter does the
//   same. That is fine for a button somebody clicks. It cannot work for a
//   scheduled send, where no browser is open. Building the packet here means
//   ONE implementation whether Tyler presses the button or a cron does, which
//   is the same reason pnlReceiptTotal and qtDepositRows are each defined once.
//
// WHAT THIS IS NOT
//   Not a general layout engine. It does one column of content, top to bottom,
//   with tables that know how to break across pages. Anything fancier belongs
//   in a real typesetting library, and a call sheet does not need one.
//
// THE RULE THAT SHAPES IT
//   A packet is READ AT A LOADING DOCK, on a phone, in the dark, by somebody
//   who has thirty seconds. So: generous type, no colour that fails in
//   greyscale, a header on every page saying which show and which section, and
//   an "as of" stamp on every page so a packet forwarded three days later
//   cannot be mistaken for current.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { BRAND, LOGO_PNG_B64 } from "./_brand.js";

export const PAGE = { w: 612, h: 792 };          // US Letter, in points
const M = { top: 54, bottom: 52, left: 46, right: 46 };
const INK = rgb(0.09, 0.10, 0.13);
const DIM = rgb(0.42, 0.45, 0.52);
const RULE = rgb(0.80, 0.82, 0.86);

/* Brand colours, from api/_brand.js, which records the measured contrast of
   each against white. The short version: BRAND_RULE is the logo blue and is
   never allowed to carry words. */
const BRAND_INK = rgb(BRAND.ink.r, BRAND.ink.g, BRAND.ink.b);
const BRAND_MID = rgb(BRAND.mid.r, BRAND.mid.g, BRAND.mid.b);
const BRAND_RULE = rgb(BRAND.rule.r, BRAND.rule.g, BRAND.rule.b);
const BAND = rgb(BRAND.tint.r, BRAND.tint.g, BRAND.tint.b);

/* The mark, and the space it occupies in the header. */
const LOGO_H = 24;

/* WinAnsi is what the standard fonts can encode. A smart quote pasted out of
   Word, an en dash, an emoji in a note — pdf-lib THROWS on any of them rather
   than dropping the character, which would fail the whole send over one
   apostrophe in a venue name. Everything that goes on a page goes through
   here first. */
const SUBS = [
  [/[‘’‛′]/g, "'"], [/[“”‟″]/g, '"'],
  [/[–—―]/g, "-"],       [/[…]/g, "..."],
  [/[   ]/g, " "],       [/[•]/g, "-"],
  [/[−]/g, "-"],                   [/[­]/g, ""],
];
export function ascii(v) {
  let s = String(v == null ? "" : v);
  for (const [re, to] of SUBS) s = s.replace(re, to);
  /* Anything still outside WinAnsi becomes "?" rather than throwing. A packet
     with one odd character is a packet; an exception is no packet at all. */
  return s.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

export async function newDoc() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  /* The logo is embedded ONCE per document — pdf-lib reuses the same image
     object on every page, so a ten-page packet carries 10 KB of logo, not 100.
     
     And it is allowed to fail. If the bytes are ever corrupted by an edit to
     _brand.js, the packet still builds with the wordmark alone. Losing a
     picture is a cosmetic problem; a send that 500s over one is not. */
  let logo = null;
  try {
    logo = await doc.embedPng(Buffer.from(LOGO_PNG_B64, "base64"));
  } catch (e) {
    console.log("[pdf] logo not embedded: " + ((e && e.message) || e));
  }
  return { doc, font, bold, logo };
}

export function makeWriter({ doc, font, bold, logo }, { title, subtitle, stamp }) {
  const st = { page: null, y: 0, pages: 0, section: "" };

  const width = (t, size, f) => f.widthOfTextAtSize(ascii(t), size);

  function newPage() {
    st.page = doc.addPage([PAGE.w, PAGE.h]);
    st.pages += 1;
    st.y = PAGE.h - M.top;
    drawPageHead();
  }

  /* The masthead, on every page.
   *
   *     [mark]  TOUCHSTONE CREATIVE GROUP          Crew Brief
   *             Patient Square Annual Summit
   *             Event Guild  |  Salt Palace
   *     ================================================  (brand rule)
   *
   * WHY IT IS ON EVERY PAGE AND NOT JUST THE FIRST
   *   This document is read on a phone, scrolled to somewhere in the middle,
   *   and forwarded. Any page of it should say who sent it and what show it
   *   is for without scrolling back. The same reasoning already put the "as
   *   of" stamp on every page.
   *
   * The wordmark is letterspaced by hand — pdf-lib has no tracking control, so
   * each character is drawn at a computed x. It is four words at 6.5pt once
   * per page; the cost is nothing and it is the difference between a logo
   * with text next to it and something that looks like a letterhead. */
  function drawWordmark(p, x, y) {
    const size = 6.5;
    const track = 1.15;
    let cx = x;
    for (const ch of ascii(BRAND.short)) {
      p.drawText(ch, { x: cx, y, size, font: bold, color: BRAND_MID });
      cx += bold.widthOfTextAtSize(ch, size) + track;
    }
    return cx - x;
  }

  function drawPageHead() {
    const p = st.page;
    const top = st.y;
    let textX = M.left;

    if (logo) {
      const w = (logo.width / logo.height) * LOGO_H;
      p.drawImage(logo, { x: M.left, y: top - LOGO_H + 4, width: w, height: LOGO_H });
      textX = M.left + w + 9;
    }

    drawWordmark(p, textX, top - 4);
    p.drawText(ascii(title), { x: textX, y: top - 18, size: 12.5, font: bold, color: INK });
    if (subtitle) {
      p.drawText(ascii(subtitle), { x: textX, y: top - 30, size: 8.5, font, color: DIM });
    }

    /* The section name rides the top-right of every page, so a page torn off
       or scrolled to on a phone still says what it is. */
    if (st.section) {
      const w = width(st.section, 9, bold);
      p.drawText(ascii(st.section), { x: PAGE.w - M.right - w, y: top - 4, size: 9, font: bold, color: BRAND_INK });
    }

    st.y = top - 40;
    /* Two rules, one heavy and brand-coloured over one hairline. Reads as a
       deliberate letterhead edge rather than a table border, and both survive
       greyscale as two different greys. */
    p.drawLine({ start: { x: M.left, y: st.y }, end: { x: PAGE.w - M.right, y: st.y }, thickness: 2, color: BRAND_RULE });
    p.drawLine({ start: { x: M.left, y: st.y - 2.6 }, end: { x: PAGE.w - M.right, y: st.y - 2.6 }, thickness: 0.5, color: RULE });
    st.y -= 18;
  }

  const room = (need) => st.y - need >= M.bottom;
  function ensure(need) {
    if (!st.page) { newPage(); return; }
    if (!room(need)) newPage();
  }

  /* ---- text ---- */
  function wrap(text, size, f, maxW) {
    const words = ascii(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const w of words) {
      const next = line ? line + " " + w : w;
      if (f.widthOfTextAtSize(next, size) <= maxW) { line = next; continue; }
      if (line) lines.push(line);
      /* A single word wider than the column — a URL, usually. Hard-break it
         rather than letting it run off the page. */
      if (f.widthOfTextAtSize(w, size) > maxW) {
        let cur = "";
        for (const ch of w) {
          if (f.widthOfTextAtSize(cur + ch, size) > maxW) { lines.push(cur); cur = ch; }
          else cur += ch;
        }
        line = cur;
      } else line = w;
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }

  function heading(text) {
    ensure(34);
    st.page.drawText(ascii(text), { x: M.left, y: st.y - 11, size: 12, font: bold, color: BRAND_INK });
    st.y -= 22;
  }

  /* Brand blue rather than grey. The old grey subheading sat at the same
     visual weight as the table header band right beneath it, so "Venue",
     "Contacts" and "Crew" did not read as the structure of the page — they
     read as more table furniture. */
  function subheading(text) {
    ensure(24);
    st.page.drawText(ascii(text), { x: M.left, y: st.y - 9, size: 10, font: bold, color: BRAND_MID });
    st.y -= 18;
  }

  function para(text, opts = {}) {
    const size = opts.size || 10;
    const f = opts.bold ? bold : font;
    const maxW = PAGE.w - M.left - M.right;
    for (const line of wrap(text, size, f, maxW)) {
      ensure(size + 5);
      st.page.drawText(line, { x: M.left, y: st.y - size, size, font: f, color: opts.dim ? DIM : INK });
      st.y -= size + 4;
    }
    st.y -= opts.gap === undefined ? 6 : opts.gap;
  }

  function note(text) { para(text, { size: 9, dim: true, gap: 4 }); }
  function gap(n) { st.y -= n; }

  /* ---- tables ----
     cols: [{ label, key, w }] where w is a share, not points. A row is an
     object; every cell wraps, and the row is as tall as its tallest cell. The
     header repeats on every page, because a table whose second page has no
     column titles is a table nobody can read. */
  function table(cols, rows, opts = {}) {
    const size = opts.size || 9;
    const pad = 4;
    const avail = PAGE.w - M.left - M.right;
    const totalShare = cols.reduce((s, c) => s + (c.w || 1), 0);
    const widths = cols.map((c) => ((c.w || 1) / totalShare) * avail);

    const cellLines = (row) => cols.map((c, i) =>
      wrap(row[c.key] === undefined || row[c.key] === null ? "" : row[c.key], size, font, widths[i] - pad * 2));
    const rowHeight = (lines) => Math.max(...lines.map((l) => l.length)) * (size + 3) + pad * 2;

    let headerDrawn = false;
    function drawHeader() {
      ensure(size + pad * 2 + 6);
      const h = size + pad * 2;
      st.page.drawRectangle({ x: M.left, y: st.y - h, width: avail, height: h, color: BAND });
      let x = M.left;
      cols.forEach((c, i) => {
        st.page.drawText(ascii(c.label), { x: x + pad, y: st.y - h + pad + 1, size, font: bold, color: BRAND_INK });
        x += widths[i];
      });
      st.y -= h;
      headerDrawn = true;
    }

    if (!rows.length) { note(opts.empty || "Nothing listed."); return; }

    drawHeader();
    for (const row of rows) {
      const lines = cellLines(row);
      const h = rowHeight(lines);
      if (!room(h)) { newPage(); drawHeader(); }
      let x = M.left;
      lines.forEach((cellL, i) => {
        cellL.forEach((line, li) => {
          st.page.drawText(line, {
            x: x + pad, y: st.y - pad - (li + 1) * (size + 3) + 3,
            size, font, color: cols[i].dim ? DIM : INK,
          });
        });
        x += widths[i];
      });
      st.y -= h;
      st.page.drawLine({
        start: { x: M.left, y: st.y }, end: { x: PAGE.w - M.right, y: st.y },
        thickness: 0.5, color: RULE,
      });
    }
    st.y -= 10;
  }

  /* A section always starts a page. A packet is skimmed by flipping, and a
     schedule that begins two thirds down a pull list page cannot be found. */
  function section(name) {
    st.section = ascii(name);
    newPage();
    heading(name);
  }

  /* Stamped LAST, once every page exists, so the total is real rather than a
     guess. "as of" is on every page on purpose: a packet forwarded on Thursday
     must not read as Thursday's packet. */
  function finish() {
    const pages = doc.getPages();
    const y = M.bottom - 24;
    pages.forEach((p, i) => {
      /* A hairline above the footer so it reads as furniture, not as the last
         line of the content. */
      p.drawLine({ start: { x: M.left, y: y + 12 }, end: { x: PAGE.w - M.right, y: y + 12 },
                   thickness: 0.5, color: RULE });
      /* Who sent it, left. */
      p.drawText(ascii(BRAND.name), { x: M.left, y, size: 8, font: bold, color: BRAND_MID });
      /* WHEN it was true, centre. On every page on purpose: a packet forwarded
         on Thursday must not read as Thursday's packet. */
      const mid = ascii(stamp);
      const mw = font.widthOfTextAtSize(mid, 8);
      p.drawText(mid, { x: (PAGE.w - mw) / 2, y, size: 8, font, color: DIM });
      /* Where you are, right. */
      const right = ascii("page " + (i + 1) + " of " + pages.length);
      const rw = font.widthOfTextAtSize(right, 8);
      p.drawText(right, { x: PAGE.w - M.right - rw, y, size: 8, font, color: DIM });
    });
  }

  return { heading, subheading, para, note, table, section, gap, finish,
           get pages() { return st.pages; } };
}
