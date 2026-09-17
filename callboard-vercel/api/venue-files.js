// /api/venue-files — photos, Vectorworks plots and PDFs attached to a venue.
//
//   GET    ?venue=<id>              what is attached to this venue
//   POST   ?venue=<id>&sign=1       mint an upload URL        { fileName, fileSize }
//   POST   ?venue=<id>              record an uploaded file   { path, fileName, ... }
//   GET    ?view=<file id>          a short-lived URL to open one
//   DELETE ?id=<file id>            remove one
//
// SETUP: run sql/setup-venue-files.sql, and create the `venuefiles` bucket.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE ONE RULE THIS FILE EXISTS TO ENFORCE
//
//   PHOTOS ARE FOR EVERYONE. DRAWINGS ARE NOT.
//
//   A crew member should be able to see the loading dock, the power tie-in and
//   where to park — that is how they arrive at the right door at the right
//   time, and withholding it helps nobody. A venue's Vectorworks plot and its
//   tech-spec PDFs are a different thing and stay with Tyler and his managers.
//
//   That split only means anything if THE KIND OF FILE CANNOT BE CHOSEN BY
//   WHOEVER IS UPLOADING IT. If a caller could post `kind: "photo"` alongside a
//   .vwx, every crew member could read every drawing, and nothing would look
//   wrong from the outside. So `kind` is never read from the request. It is
//   derived, here, from the file's own name, at the two moments that matter:
//   when the upload URL is minted, and again when the row is written.
//
//   Twice, deliberately. The signing step decides where the file may go; the
//   recording step decides what the row says. A caller who skipped the first
//   and posted straight to the second would otherwise pick their own answer.
//
// WHY UPLOADS DO NOT PASS THROUGH THIS FUNCTION
//   A Vectorworks venue file runs to tens or hundreds of megabytes. A Vercel
//   function takes 4.5MB of request body and has a timeout. So the browser is
//   handed a signed URL and PUTs straight to Supabase — the bytes never come
//   here, and the service key never leaves.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "node:crypto";
import { json, readBody, auth, isAdmin, supabaseRest, signUpload, signView, storageReq } from "./_lib.js";

export const BUCKET = "venuefiles";

const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);

/* 200 MB. Tyler's venue plots run 50–200 MB, so this is the size of the job
   rather than a round number. The bucket enforces its own limit too — this one
   is here to refuse before a twenty-minute upload rather than after it. */
export const MAX_BYTES = 200 * 1024 * 1024;

/* ─────────────────────────────────────────────────────────────────────────────
 * WHAT MAY BE UPLOADED, AND HOW IT IS DECIDED
 *
 * BY FILE EXTENSION, NOT BY CONTENT TYPE. The rest of this app checks the MIME
 * type the browser reports, which works for JPEG, PNG and PDF. It cannot work
 * here: `.vwx` has no registered media type, so browsers send it as
 * `application/octet-stream` or as nothing at all. Trusting that field would
 * mean either rejecting every Vectorworks file or accepting anything at all.
 *
 * Neither is a real check on what the bytes are — nothing here can be — which
 * is exactly why the bucket is private, why nothing is ever served from a
 * public URL, and why a stored file is only ever handed back as a download.
 * ───────────────────────────────────────────────────────────────────────────── */
const KINDS = {
  photo: ["jpg", "jpeg", "png", "heic", "heif", "webp"],
  plot: ["vwx", "vwxp", "dwg", "dxf"],
  doc: ["pdf"],
};

export function extOf(fileName) {
  const base = String(fileName || "").split(/[\\/]/).pop();
  const i = base.lastIndexOf(".");
  /* `lastIndexOf` so that "plot.v2.vwx" reads as vwx, and `i > 0` so that a
     dotfile with no extension does not read as one. */
  return i > 0 ? base.slice(i + 1).toLowerCase() : "";
}

/* The whole access rule, in one function. Returns null for anything not on a
   list, which is a refusal — there is no "other" bucket that quietly accepts
   whatever turns up. */
export function kindOf(fileName) {
  const ext = extOf(fileName);
  if (!ext) return null;
  for (const [kind, list] of Object.entries(KINDS)) {
    if (list.includes(ext)) return kind;
  }
  return null;
}

export const ACCEPTED = Object.values(KINDS).flat();

/* Who may see what. Photos to anyone signed in; everything else admin only. */
export const visibleTo = (kind, p) => kind === "photo" || isAdmin(p);

const COLS = "id,venue_id,kind,file_path,file_name,file_size,mime,thumb_path," +
             "caption,uploaded_by,created_at";

function shape(r) {
  return {
    id: r.id,
    venueId: r.venue_id,
    kind: r.kind,
    fileName: r.file_name || "",
    fileSize: r.file_size || null,
    caption: r.caption || "",
    uploadedBy: r.uploaded_by || "",
    createdAt: r.created_at,
    hasThumb: !!r.thumb_path,
    /* file_path and thumb_path are deliberately NOT returned. They are the
       only input to a signed URL, and a client that has them has half of a
       credential. Everything the screen needs is an id and a name. */
  };
}

async function fileById(id) {
  const rows = await supabaseRest(
    "GET", "/venue_files?id=eq." + encodeURIComponent(id) + "&select=" + COLS + "&limit=1", null);
  return (rows && rows[0]) || null;
}

/* A path nobody can guess and nothing can collide with.
   The venue id leads so that everything for one venue sits together, which
   makes a manual clean-up in the dashboard possible; the uuid makes the rest
   of it unguessable even to someone who knows the venue id. */
function newPath(venueId, fileName, kind) {
  const ext = extOf(fileName);
  return venueId + "/" + kind + "/" + crypto.randomUUID() + (ext ? "." + ext : "");
}

export default async function handler(req, res) {
  const p = auth(req);
  if (!p) return json(res, 401, { error: "Not signed in" });

  const q = req.query || {};

  try {
    /* ---- open one ------------------------------------------------------- */
    if (req.method === "GET" && q.view) {
      const row = await fileById(str(q.view, 100));
      if (!row) return json(res, 404, { error: "That file is not here any more." });
      /* The check that matters. A crew member who has a file id — from a
         photo list, or by guessing — still cannot open a drawing. */
      if (!visibleTo(row.kind, p)) return json(res, 403, { error: "Not allowed" });

      const wantThumb = q.thumb && row.thumb_path;
      const path = wantThumb ? row.thumb_path : row.file_path;
      /* Five minutes. Long enough to open a 200MB download, short enough that
         a URL left in a browser history is useless by the time anyone looks. */
      const url = await signView(BUCKET, path, 300);
      if (!url) return json(res, 502, { error: "Could not open that file." });
      return json(res, 200, { url, fileName: row.file_name, kind: row.kind });
    }

    /* ---- remove one ------------------------------------------------------
       BEFORE the venue check, because a file is deleted by its id and the
       caller has no reason to know which venue it hangs off. Requiring one
       here meant a crew member trying to delete was turned away with "Missing
       venue" — refused, but for the wrong reason, which is the kind of message
       that sends someone looking for a bug that is not there. */
    if (req.method === "DELETE") {
      if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });
      const id = str(q.id, 100);
      if (!id) return json(res, 400, { error: "Missing id" });
      const row = await fileById(id);
      if (!row) return json(res, 404, { error: "That file is not here any more." });

      /* The row goes first. If the object delete then fails, the result is an
         orphaned object in a private bucket that nothing links to — untidy.
         The other order risks a row pointing at nothing, which is a broken
         link on screen every time anyone opens the venue. Untidy beats
         broken. */
      await supabaseRest("DELETE", "/venue_files?id=eq." + encodeURIComponent(id), null);
      for (const path of [row.file_path, row.thumb_path].filter(Boolean)) {
        try { await storageReq("DELETE", "/object/" + BUCKET + "/" + path); }
        catch (e) { console.log("[venue-files] object not removed: " + path + " — " + (e && e.message)); }
      }
      return json(res, 200, { ok: true });
    }

    const venueId = str(q.venue, 100);
    if (!venueId) return json(res, 400, { error: "Missing venue" });

    /* ---- what is attached ------------------------------------------------ */
    if (req.method === "GET") {
      const rows = await supabaseRest(
        "GET", "/venue_files?venue_id=eq." + encodeURIComponent(venueId) +
          "&select=" + COLS + "&order=created_at.desc&limit=500", null);
      /* Filtered HERE rather than in the query, so that adding a kind later
         cannot accidentally widen what crew see: anything not explicitly
         visible is dropped. */
      const visible = (rows || []).filter((r) => visibleTo(r.kind, p));
      return json(res, 200, {
        files: visible.map(shape),
        /* So the screen can say "and 4 drawings you cannot see" rather than
           pretending a venue has nothing on it. */
        hidden: (rows || []).length - visible.length,
      });
    }

    /* Everything below writes. Admin only — including uploading a photo,
       because a venue record is Tyler's to curate. */
    if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });

    /* ---- mint an upload URL ---------------------------------------------- */
    if (req.method === "POST" && q.sign) {
      const b = await readBody(req);
      const fileName = str(b && b.fileName, 300);
      if (!fileName) return json(res, 400, { error: "Missing fileName" });

      const kind = kindOf(fileName);
      if (!kind) {
        return json(res, 400, {
          error: "That file type is not accepted here (" +
            (extOf(fileName) ? "." + extOf(fileName) : "no extension") + "). " +
            "Accepted: " + ACCEPTED.map((e) => "." + e).join(", ") + ".",
        });
      }

      const size = Number(b && b.fileSize) || 0;
      /* Refused BEFORE the upload rather than after it. The bucket would
         refuse it too, but only once the bytes had been sent — which on a
         180MB file over venue wi-fi is twenty minutes of someone's afternoon
         spent finding out. */
      if (size > MAX_BYTES) {
        return json(res, 413, {
          error: "That file is " + Math.round(size / 1048576) + " MB. The limit here is " +
            Math.round(MAX_BYTES / 1048576) + " MB.",
        });
      }

      const path = newPath(venueId, fileName, kind);
      const signed = await signUpload(BUCKET, path);
      if (!signed || !signed.url) return json(res, 502, { error: "Could not start the upload." });

      /* A second URL for the thumbnail, minted now so the browser can send
         both without coming back. Only for photos: there is nothing to make a
         thumbnail of for a .vwx, and pretending otherwise would have the
         client uploading an empty object. */
      let thumb = null;
      if (kind === "photo") {
        const tp = path.replace(/(\.[^.]*)?$/, "") + "-thumb.jpg";
        const t = await signUpload(BUCKET, tp);
        if (t && t.url) thumb = { path: tp, url: t.url };
      }

      return json(res, 200, {
        kind, path, url: signed.url, thumb,
        /* Echoed so the client can show it, and so a mismatch between what it
           thought it was uploading and what the server decided is visible
           rather than silent. */
        accepted: ACCEPTED,
      });
    }

    /* ---- record one that has finished uploading -------------------------- */
    if (req.method === "POST") {
      const b = await readBody(req);
      const path = str(b && b.path, 500);
      const fileName = str(b && b.fileName, 300);
      if (!path || !fileName) return json(res, 400, { error: "Missing path or fileName" });

      /* DERIVED AGAIN, from the name, and never read from the body. The
         signing step above already decided this once; doing it again here is
         what stops a caller skipping that step and choosing their own answer.
         The two must agree, and they do because they are the same function. */
      const kind = kindOf(fileName);
      if (!kind) return json(res, 400, { error: "That file type is not accepted here." });

      /* The path must be one this route would have minted for this venue and
         this kind. Without it, a caller could record a row pointing at
         somebody else's object — including one in another venue's folder.
         `!== 0` and not `< 0`: the prefix has to be at the FRONT. Merely
         appearing somewhere would let "../<this venue>/plot/x.vwx" through,
         which is a path that contains the right prefix and points outside. */
      const ownedHere = (v) =>
        v.indexOf(venueId + "/" + kind + "/") === 0 &&
        /* And no climbing once inside. A prefix check alone is satisfied by
           "<venue>/plot/../../<other venue>/plot/x.vwx", which starts in the
           right place and ends somewhere else. Storage backends differ on
           whether they normalise that, so it is refused here rather than
           left to whichever one is answering. */
        v.indexOf("..") < 0;

      if (!ownedHere(path)) {
        return json(res, 400, { error: "That upload does not belong to this venue." });
      }

      const thumbPath = str(b && b.thumbPath, 500);
      if (thumbPath && !ownedHere(thumbPath)) {
        return json(res, 400, { error: "That thumbnail does not belong to this venue." });
      }

      const row = {
        venue_id: venueId,
        kind,
        file_path: path,
        file_name: fileName,
        file_size: Number(b && b.fileSize) || null,
        mime: str(b && b.mime, 200) || null,
        thumb_path: kind === "photo" && thumbPath ? thumbPath : null,
        caption: str(b && b.caption, 500),
        uploaded_by: str(p.name || p.sub, 200),
      };
      const out = await supabaseRest("POST", "/venue_files", row, "return=representation");
      const made = Array.isArray(out) ? out[0] : out;
      return json(res, 200, { ok: true, file: made ? shape(made) : null });
    }

    return json(res, 405, { error: "Method not allowed" });
  } catch (e) {
    return json(res, e.status || 500, { error: (e && e.message) || "Server error" });
  }
}
