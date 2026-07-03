# Callboard — Vercel + Airtable (shared, password-protected)

This is the multi-user version of Callboard. Your shows live in **Airtable**, the app is hosted on **Vercel**, and a small serverless function sits in between so your Airtable key never touches the browser. Each show can have its own password, so crew only see the show they were given.

```
Crew / your browser  ──►  Vercel (React app + /api function)  ──►  Airtable
                          (holds the secret key & checks passwords)
```

**Who sees what**
- **You (admin):** one admin password. See every show, create/duplicate/delete them, set each show's password.
- **Crew:** a show password. They get that one show only — they never see the list or names of other shows.

---

## What you'll need (all free tiers)
- An **Airtable** account
- A **GitHub** account (to hold the code)
- A **Vercel** account (to host it)

Total setup is ~20 minutes. You don't need to write any code.

---

## Step 1 — Create the Airtable base

1. In Airtable, create a new base (name it **Callboard**).
2. Rename the default table to **Events**.
3. Give it exactly these fields (name and type matter):

| Field name | Type |
|---|---|
| `Name` | Single line text (this is the primary field) |
| `Client` | Single line text |
| `StartDate` | Single line text |
| `EndDate` | Single line text |
| `Data` | **Long text** |
| `PassHash` | Single line text |
| `UpdatedAt` | Single line text |

Delete any other default fields (Notes, Assignee, Status). Leave the table empty — the app creates the first show for you.

> Dates are stored as text on purpose (ISO like `2026-06-19`) to avoid timezone surprises. The app handles the formatting.

## Step 2 — Get your Airtable token and base ID

1. **Token:** Airtable → click your avatar → *Builder hub* → *Personal access tokens* → *Create token*.
   - Scopes: `data.records:read` and `data.records:write`.
   - Access: add your **Callboard** base.
   - Copy the token (starts with `pat…`). You won't see it again.
2. **Base ID:** open your base in the browser. The URL looks like `airtable.com/appXXXXXXXXXXXXXX/…`. The `appXXXXXXXXXXXXXX` part is your base ID.

## Step 3 — Put the code on GitHub

1. Create a new empty GitHub repo (e.g. `callboard`).
2. Upload this whole folder to it (drag the files into GitHub's "upload files" page, or use `git`). Make sure `.env` is **not** included (the `.gitignore` already excludes it).

## Step 4 — Deploy on Vercel

1. Go to vercel.com → *Add New… → Project* → import your `callboard` repo.
2. Vercel auto-detects Vite — leave the build settings as-is.
3. Before deploying, open **Environment Variables** and add these five:

| Name | Value |
|---|---|
| `AIRTABLE_TOKEN` | your `pat…` token |
| `AIRTABLE_BASE_ID` | your `app…` base ID |
| `AIRTABLE_TABLE` | `Events` |
| `ADMIN_PASSWORD` | a strong master password (yours) |
| `APP_SECRET` | any long random string (e.g. mash the keyboard for 40+ chars) |

4. Click **Deploy**. In ~1 minute you'll get a URL like `callboard-xxxx.vercel.app`.

> If you change env vars later, hit **Redeploy** for them to take effect.

## Step 5 — First run

1. Open your Vercel URL. You'll see a **sign-in** screen.
2. Choose **Admin**, enter your `ADMIN_PASSWORD`. On first login the app creates the **AdventHealth example** show so you can see everything working.
3. Create your real shows with **+ New** — it asks for a name and a password.
4. To change a show's password later, select it and click **Show access**. Leave the field blank to remove the password.

## How your crew log in

Give a crew member the **show's password** (not your admin password). They open the same URL, choose **Open a show**, and enter it. They land straight on that show's board and can't reach any other show.

---

## Local development (optional)

Only if you want to run it on your own machine before deploying:

```bash
npm install
npm i -g vercel
vercel link          # connect to your Vercel project
vercel env pull      # pulls your env vars into .env
vercel dev           # runs the app + /api together at localhost:3000
```

(`npm run dev` alone runs only the front-end; the `/api` calls need `vercel dev`.)

---

## Good to know / limits

- **Passwords are a real gate here** because data stays on the server — a crew member only ever receives the show whose password they entered. This is solid for keeping crews in their lane. It is **not** bank-grade security: passwords are stored as salted SHA-256 hashes (not bcrypt), and sign-in tokens last 12 hours. Use decent passwords and rotate the admin one if it leaks.
- **One editor at a time per show, ideally.** Each save writes the whole show, so if two people edit the *same* show at the *same* second, the last save wins. Different shows never collide. For a PM + crew reading and the PM editing, this is fine.
- **Diagrams are links** in this version (host on Drive/Dropbox/Vectorworks Cloud, paste the link). This keeps shows well under Airtable's field-size limits and lets everyone open the file. If you later want in-app image uploads, that's a small add using Vercel Blob storage — ask and I'll wire it in.
- **Airtable free tier** allows 1,000 records per base (that's 1,000 shows) and plenty of API calls for a crew tool.
- **Changing the admin password or APP_SECRET** signs everyone out (tokens are signed with `APP_SECRET`). Changing `APP_SECRET` also invalidates existing show password hashes — only do it before you've set show passwords, or be ready to reset them.

---

## File map

```
api/_lib.js       shared helpers: Airtable calls, password hashing, token signing
api/auth.js       login: admin password, or unlock one show by its password
api/events.js     list / read / create / update / delete shows (checks your token)
api/password.js   admin sets or clears a show's password
src/App.jsx       the app (home board + all sections) + the login screen
src/db.js         browser-side calls to /api (attaches your token)
src/main.jsx      React entry point
```

Questions or a snag during setup? Tell me what you see and I'll help debug — I built this as a first working version and expect we'll fine-tune it against your live Airtable.
