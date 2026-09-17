// api/_pdftext.js — getting text and coordinates out of a PDF, in Node.
//
// Underscore: a helper, not a route. It exists as its own file for one reason:
// THE WORKER PROBLEM BELOW IS THE ONLY HARD PART, and it needs to be testable
// on its own, without a database or a token or a signed request.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS ISN'T JUST getDocument()
//
//   It was, and on Vercel it failed with:
//
//     Setting up fake worker failed: "Cannot find module
//     '/var/task/callboard-vercel/node_modules/pdfjs-dist/legacy/build/pdf.'"
//
//   pdf.js is built for browsers, where the parsing runs in a Web Worker. In
//   Node it disables the real worker and loads a "fake" one — by DYNAMICALLY
//   IMPORTING the worker file from a path it works out at runtime:
//
//     GlobalWorkerOptions.workerSrc ||= "./pdf.worker.mjs";   // pdf.mjs:16747
//     const worker = await import(this.workerSrc);            // pdf.mjs:16948
//
//   That relative specifier resolves against whatever the importing module
//   turns out to be after a bundler has moved things around, which on Vercel
//   is not where the worker file lives. Hence the truncated path in the error.
//
//   Two problems, not one:
//     1. the path is computed at runtime and comes out wrong, and
//     2. because nothing references the worker file by name, a bundler has no
//        reason to include it in the deployment at all.
//
//   Setting `workerSrc` to an absolute path fixes (1) and leaves (2) to luck.
//
// THE FIX, WHICH IS A SUPPORTED ESCAPE HATCH AND NOT A WORKAROUND
//
//   pdf.mjs:16936 —
//
//     static get #mainThreadWorkerMessageHandler() {
//       return globalThis.pdfjsWorker?.WorkerMessageHandler || null;
//     }
//
//   and the fake-worker loader checks THAT FIRST, before it ever looks at
//   workerSrc. So if the worker module is already sitting on `globalThis`,
//   the failing line is never reached.
//
//   Importing it here by its LITERAL package path solves both problems at
//   once: pdf.js gets a real handler without resolving anything, and the
//   bundler sees a static specifier it can follow, so the file is actually
//   deployed.
// ─────────────────────────────────────────────────────────────────────────────

/* One process, one setup. The fake-worker loader is memoised inside pdf.js
   (`shadow(this, "_setupFakeWorkerGlobal", loader())`), so whatever is true at
   the FIRST getDocument call is true for the life of the warm instance — which
   is why this runs before any of them rather than lazily beside one. */
let ready = null;

export async function loadPdfjs() {
  if (ready) return ready;
  ready = (async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    if (!globalThis.pdfjsWorker) {
      globalThis.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    }
    return pdfjs;
  })();
  return ready;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * THE SECOND TRAP, WHICH COST A WHOLE ROUND: pdf.js REFUSES A NODE BUFFER.
 *
 *   Please provide binary data as `Uint8Array`, rather than `Buffer`.
 *
 * and the obvious guard does not catch it, because
 *
 *   Buffer.from("x") instanceof Uint8Array   ===   true
 *
 * A Buffer IS a Uint8Array — a subclass of it. So `bytes instanceof Uint8Array
 * ? bytes : new Uint8Array(bytes)` hands the Buffer straight through, and
 * pdf.js rejects it by name (it checks the subclass explicitly, because a
 * Buffer's pooled memory is not safe for it to hold onto).
 *
 * The route reads `Buffer.from(b64, "base64")`, so this is the ONLY shape that
 * ever arrives in production.
 *
 * Two things have to be true of what comes out, and a re-wrap alone only gets
 * the first:
 *
 *   1. it is a plain Uint8Array, not a subclass — hence the constructor call
 *      rather than any test on what came in, and
 *
 *   2. it owns its memory. `Buffer.from` under ~4 kB hands back a WINDOW onto
 *      a shared pool that other, unrelated Buffers are also living in. pdf.js
 *      keeps and may detach the ArrayBuffer it is given, so a window onto the
 *      pool is a way to corrupt bytes that have nothing to do with this PDF.
 *      `.slice()` on a Uint8Array copies — that is the point of it here, and
 *      why it is not a wasteful line to be tidied away later.
 * ───────────────────────────────────────────────────────────────────────────── */
export function toBytes(src) {
  if (src === null || src === undefined || typeof src !== "object") {
    throw new TypeError("PDF data must be bytes, not " + typeof src);
  }
  /* ArrayBuffer.isView covers Buffer and every typed array in one test.
     Passing a Buffer to `new Uint8Array(buf)` would COPY IT ELEMENT BY
     ELEMENT via the iterable path — correct, but O(n) the slow way — so the
     three-argument form re-wraps the same memory first. */
  const view = ArrayBuffer.isView(src)
    ? new Uint8Array(src.buffer, src.byteOffset, src.byteLength)
    : new Uint8Array(src);
  return view.slice();
}

/* Bytes in, one array of { str, x, y } per page out.
 *
 * Deliberately the ONLY thing this module returns: api/_quotepdf.js takes
 * exactly this shape and knows nothing about pdfjs, so the reader can be
 * swapped without touching the part that understands a Touchstone quote. */
export async function pdfToPages(bytes) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: toBytes(bytes),
    /* Text only. Nothing here rasterises a page, so font programs, eval and
       the font-face machinery are all switched off — less to load, less to go
       wrong, and nothing inside the PDF gets executed. */
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
  }).promise;

  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    pages.push(tc.items
      .filter((it) => it && it.str && it.str.trim())
      .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] })));
  }
  /* Closes the document and its side of the loopback port — the lifecycle call
     pdf.js documents, and free to make.
     NOT, on the evidence, a memory fix: thirty reads of this PDF in one
     process finished at 51 MB heap / 160 MB rss without it and 48 / 159 with,
     which is noise. An earlier version of this comment claimed it was what
     stopped a back-fill exhausting the instance; that was asserted, not
     measured, and it is not true. Kept because closing what you opened is
     right, not because it rescues anything. */
  try { await doc.destroy(); } catch (e) { /* nothing useful to do */ }
  return pages;
}
