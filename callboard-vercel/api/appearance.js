// /api/appearance — how the app looks. Right now: the sidebar wallpaper.
//
//   GET                admin only. { wallpaper, dim, updatedAt }
//   PUT  { wallpaper } admin only. A data: URL, or null to clear it.
//   PUT  { dim }       how far the scrim is turned up, 0–90.
//
// SETUP: none. It uses the existing app_settings key/value table, the same one
// that already holds the quote terms, the inbox settings and the billing
// digest config.
//
// ---------------------------------------------------------------------------
// WHY THE IMAGE IS IN THE DATABASE AND NOT IN STORAGE
//
//   The obvious home for an uploaded image is Supabase Storage, next to
//   receipts and crew documents. It is not the right one here, for a reason
//   that has nothing to do with technology: a new bucket needs creating and
//   its policies setting by hand in a dashboard, and this is a feature for
//   choosing a background. Trading a manual infrastructure step for a picture
//   is a bad trade, and a half-finished one leaves an upload button that
//   fails with a storage error nobody can act on.
//
//   api/quotes.js already stores the terms PDF this way, so the shape is not
//   new. The browser downsamples before it sends — a 4000px phone photo goes
//   up as roughly 200 KB — and anything over the cap below is refused in
//   words rather than failing as a row that is too big.
//
// WHY ADMIN ONLY, INCLUDING THE READ
//   The sidebar this decorates only exists for admins, so nobody else has
//   anywhere to put it. Serving a few hundred KB of image to a crew member
//   who will never see it is a slow page load for nothing.
import { json, readBody, auth, isAdmin, supabaseRest } from "./_lib.js";

const KEY = "appearance";

/* Roughly 700 KB of base64, which is about 500 KB of actual image. Generous
   for something the browser has already downsampled, and small enough that
   the settings row stays quick to read. */
const MAX_CHARS = 700 * 1024;

/* Only formats a browser will actually render as a background, and only as a
   data: URL. A bare https:// wallpaper would be a request to an arbitrary
   host on every admin page load, chosen by whatever wrote this row. */
const OK_PREFIX = /^data:image\/(png|jpeg|webp|avif);base64,[A-Za-z0-9+/=]+$/;

const clampDim = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 60;
  return Math.max(0, Math.min(90, Math.round(n)));
};

async function load() {
  try {
    const rows = await supabaseRest("GET", "/app_settings?key=eq." + KEY + "&select=value", null);
    const v = rows && rows[0] && rows[0].value;
    return (v && typeof v === "object") ? v : {};
  } catch {
    /* No row, or no table. Both mean "nothing has been set", which is a
       perfectly good answer and not an error worth showing anybody. */
    return {};
  }
}

const out = (v) => ({
  wallpaper: typeof v.wallpaper === "string" && v.wallpaper ? v.wallpaper : null,
  dim: clampDim(v.dim === undefined ? 60 : v.dim),
  updatedAt: v.updatedAt || null,
});

export default async function handler(req, res) {
  const p = auth(req);
  if (!p) return json(res, 401, { error: "Not signed in" });
  if (!isAdmin(p)) return json(res, 403, { error: "Admin only" });

  try {
    if (req.method === "GET") return json(res, 200, out(await load()));

    if (req.method === "PUT" || req.method === "POST") {
      const b = await readBody(req);
      const cur = await load();
      const next = { ...cur, updatedAt: new Date().toISOString() };

      if (b && Object.prototype.hasOwnProperty.call(b, "wallpaper")) {
        const w = b.wallpaper;
        if (w === null || w === "") {
          next.wallpaper = null;
        } else {
          const s = String(w);
          if (s.length > MAX_CHARS) {
            return json(res, 413, {
              error: "That image is about " + Math.round(s.length / 1024) +
                     " KB once encoded, which is bigger than the " +
                     Math.round(MAX_CHARS / 1024) + " KB limit. Try a smaller one.",
            });
          }
          if (!OK_PREFIX.test(s)) {
            return json(res, 400, {
              error: "That does not look like a PNG, JPEG, WebP or AVIF image.",
            });
          }
          next.wallpaper = s;
        }
      }

      if (b && Object.prototype.hasOwnProperty.call(b, "dim")) next.dim = clampDim(b.dim);

      await supabaseRest("POST", "/app_settings?on_conflict=key",
        { key: KEY, value: next }, "resolution=merge-duplicates,return=minimal");
      return json(res, 200, out(next));
    }

    if (req.method === "DELETE") {
      const cur = await load();
      const next = { ...cur, wallpaper: null, updatedAt: new Date().toISOString() };
      await supabaseRest("POST", "/app_settings?on_conflict=key",
        { key: KEY, value: next }, "resolution=merge-duplicates,return=minimal");
      return json(res, 200, out(next));
    }

    return json(res, 405, { error: "Method not allowed" });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || "Server error" });
  }
}
