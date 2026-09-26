# NextLayer — dynamic landing page + admin dashboard

A dark, premium agency landing page whose **every word, link, list, image and
section** is editable from a built-in admin dashboard — no third-party auth,
no external database, no build step.

Runs on **Cloudflare Pages** (static hosting) + **Pages Functions** (API) +
**D1** (SQLite). Uploads straight from this folder.

## Layout

```
├── index.html                    # landing page (dynamic, data-* hooks)
├── admin.html                    # login + first-time setup + dashboard (/admin)
├── 404.html                      # branded not-found page
├── assets/
│   ├── app.css                   # landing styles + admin styles
│   └── app.js                    # API client, defaults, landing, admin
├── functions/api/site/[[path]].js# catch-all API router → /api/site/*
├── migrations/0001_init.sql      # D1 schema (content, messages, admins…)
├── images/                       # project visuals
├── package.json / wrangler.toml  # dev + deploy scripts (no secrets inside)
├── _headers / _redirects        # security headers + CSP (rule-free by design)
├── robots.txt / sitemap.xml      # SEO (TODO: set your real domain)
```

## How it works

- All landing content lives in **one JSON blob** (`site_content` table) and is
  edited per-section in the dashboard. Saving publishes instantly.
- `assets/app.js` ships **built-in defaults** identical to the static HTML, so
  first paint never waits for the API and the page still renders fully if the
  API is unreachable. Saved content is **deep-merged** over the defaults
  (arrays/scalars from the database win wholesale, so deletions stick).
- The contact form posts to `/api/site/messages` (honeypot + rate limited);
  messages land in the dashboard **inbox**.
- Auth is custom: PBKDF2-SHA256 (100k rounds) password hashes, random
  server-side sessions in HttpOnly cookies (7 days). First admin is created
  with a one-time `SETUP_SECRET` (which can also reset an admin).

## Setup (Cloudflare dashboard, ~10 minutes)

1. **D1 database** — Workers & Pages → D1 → Create database `nextlayer`.
   Note the database ID.
2. **Pages project** — Workers & Pages → Create → Pages → Upload assets
   (this folder) or connect the git repo. Project name: `nextlayer`.
3. **Bind D1** — Pages project → Settings → Functions → D1 database bindings:
   variable `DB`, database `nextlayer`. Save.
4. **Setup secret** — Settings → Environment variables → Add `SETUP_SECRET`
   (production): a long random string. Needed once for first-time setup.
5. **Apply the migration** (locally, one command):
   ```bash
   npm i -g wrangler
   wrangler login
   wrangler d1 migrations apply nextlayer --remote
   ```
   (If you skip this, the API self-creates the tables on first write anyway.)
6. Open `https://<your-site>/admin` → **Set up the first admin** → sign in →
   **Load demo content** → review each tab → **Save changes**.

   `/admin` needs no redirect rule: Pages serves `admin.html` at the clean URL
   natively (and 308-redirects `/admin.html` → `/admin`). Never add an
   `/admin → /admin.html 200` rewrite — it loops forever (too many redirects).

## Local development

```bash
npm install
npm run dev     # serves . with Functions + local D1 at http://localhost:8788
npm run deploy  # redeploy — set --project-name in package.json to yours first
```

With `npm run dev` the dashboard is at `/admin` (wrangler emulates Pages clean
URLs); with a plain static server, open `/admin.html` instead.

## API reference (`/api/site/*`)

| Method & path              | Auth  | Purpose                              |
|----------------------------|-------|--------------------------------------|
| `GET /content`             | –     | published content blob               |
| `POST /messages`           | –     | contact form (`name,email,message`)  |
| `POST /auth/setup`         | key   | create/reset admin                   |
| `POST /auth/login|logout`  | –     | session cookie                       |
| `GET /auth/me`             | cookie| current admin                        |
| `GET|PUT /admin/content`   | admin | read/save content blob               |
| `GET /admin/messages`      | admin | inbox (`?status=new|read|archived`)  |
| `PUT|DELETE /admin/messages/:id` | admin | status / delete                |
| `POST /admin/password`     | admin | change own password                  |
| `GET /admin/stats`         | admin | inbox count, counts, updated-at      |
| `GET|POST /admin/admins`   | admin | list / add admins                    |
| `PUT|DELETE /admin/admins/:id` | admin | edit / delete (not self)          |

Rate limits: login 8/15min, setup 10/15min, contact 5/10min per IP.

## Editing guide

- **Copy/links/images/sections** — dashboard tabs; each tab has a visibility
  toggle and a Save button. **Save all tabs** on Overview publishes everything.
- **Icons** — curated set (`code, app, pen, cpu, search, settings, sparkles,
  target, zap, layers, lock, headphones, check, arrow, x, linkedin, github,
  instagram, link`); type the name, the dashboard previews it live.
- **Project images** — drop files in `images/` and reference them
  (e.g. `images/proj-4.jpg`); set alt text per project.
- **Concurrent editing** — the content blob saves whole: if two people edit at
  once, the last save wins. Refresh before big edits.
- **Adding a field** — add it to `DEFAULTS` in `assets/app.js`, hook it in
  `index.html` (`data-c`, `data-c-href`, `data-c-src`, `data-c-mailto`,
  `data-c-ph`, `data-visible`, `data-list`), add the `data-path` input in
  `admin.html`.

## Security notes

- Secrets live in the dashboard, never in this repo (`SETUP_SECRET`, D1 binding).
- Sessions are HttpOnly + `SameSite=Lax` (+`Secure` on HTTPS); password
  changes revoke all other sessions.
- Admin pages send `noindex`; `/admin*` and `/api/*` are disallowed in robots.
