# APA Engineering Services — Project Management System with Cost Estimation

A web application that replaces the firm's manual, spreadsheet-and-phone-call
process for quoting structural design and construction work. It is built for
**1–2 non-technical users**, so every screen is a plain form with a running
estimate beside it.

* **Frontend** — HTML5 + CSS3 (custom properties, grid/flexbox) + vanilla
  JavaScript ES modules. No build step, no framework.
* **Backend** — Node.js 20+ and Express (ES modules). The browser never talks to
  Supabase directly; it only calls `/api/*`.
* **Database, Auth, Storage** — Supabase (PostgreSQL). Row Level Security is the
  authorisation boundary.
* **Estimation basis** — Fajardo, *Simplified Construction Estimate*: the
  estimate is driven by **floor area × rate per square metre**, split across the
  eight works so the client sees a per-work breakdown.

---

## 1. Project structure

```
SoftEng/
├─ db/                              PostgreSQL scripts - run these in Supabase, in order
│  ├─ 01_schema.sql                 Tables, constraints, triggers, indexes, RPC
│  ├─ 02_rls.sql                    Row Level Security policies + role helpers
│  ├─ 03_storage.sql                Storage buckets, size/type limits, storage policies
│  └─ 04_seed.sql                   Four finish packages, per-work rates, sample materials
│
├─ server/
│  ├─ index.js                      Express app: helmet CSP, CORS, static /public, routers
│  ├─ config.js                     Reads and validates .env
│  ├─ supabase.js                   supabaseAnon / supabaseAdmin / userClient()
│  ├─ lib/
│  │  ├─ validation.js              Rule-driven validator + sanitiser (server source of truth)
│  │  ├─ estimation.js              Cost engine: computeTotals, quick + detailed breakdowns
│  │  ├─ http.js                    ok(), badRequest(), unauthorized(), notFound(), asyncHandler
│  │  └─ activity.js                Activity log writer
│  ├─ middleware/
│  │  ├─ auth.js                    requireAuth / requireAdmin, builds req.db (RLS-scoped)
│  │  ├─ rateLimit.js               In-memory sign-in guard (5 failures = 15 min lock)
│  │  └─ upload.js                  multer memory storage + file type/size rules
│  └─ routes/
│     ├─ auth.routes.js             login, refresh, logout, me, profile, change/reset password
│     ├─ users.routes.js            user management (Admin only)
│     ├─ clients.routes.js          client records
│     ├─ materials.routes.js        materials CRUD + price refresh
│     ├─ pricing.routes.js          finish packages, per-work rates, styles
│     ├─ quotations.routes.js       preview, quick, detailed, list, export, detail
│     ├─ projects.routes.js         projects, milestones, status updates
│     ├─ dashboard.routes.js        summary cards + recent activity
│     └─ uploads.routes.js          signed URL for a stored object
│
└─ public/                          Served as static files by Express
   ├─ css/styles.css                Design system (1,900+ lines) + dark mode
   ├─ js/
   │  ├─ api.js                     fetch wrapper: envelopes, ApiError, refresh-and-retry
   │  ├─ session.js                 Token storage, role helpers
   │  ├─ shell.js                   Sidebar + top bar, page guard, theme
   │  ├─ forms.js                   The form engine: readValues/validate/applyErrors/bindForm
   │  ├─ ui.js                      Toasts, modals, confirm, badges, progress, timeline, states
   │  ├─ util.js                    Labels, formatters, date helpers, escapeHtml
   │  ├─ icons.js                   Inline SVG sprite builder
   │  └─ pages/*.js                 One controller per screen
   └─ *.html                        13 screens (see §5)
```

---

## 2. Supabase setup

1. **Create the project** at <https://supabase.com>. Note the project URL.
2. **Run the SQL scripts**, in this exact order, in the Supabase SQL editor:
   `db/01_schema.sql` → `db/02_rls.sql` → `db/03_storage.sql` → `db/04_seed.sql`.
   Each script is idempotent, so re-running it is safe.
   * `01` creates `profiles`, `clients`, `finish_packages`, `package_work_rates`,
     `materials`, `style_options`, `quotations`, `quotation_items`, `projects`,
     `project_status_updates`, `activity_log`, `price_refresh_log`, the
     `handle_new_user()` trigger, and the `next_doc_number()` RPC.
   * `02` adds the SECURITY DEFINER helpers `current_user_role()` and `is_admin()`
     plus every RLS policy. **Staff cannot read or write `finish_packages`,
     `package_work_rates`, `materials` or `price_refresh_log`, and cannot touch
     another user's profile.**
   * `03` creates the three **private** buckets and their storage policies.
   * `04` seeds the four finish packages with per-work rates and sample materials.
3. **Create the first Administrator**: Authentication → Users → *Add user* →
   set the email and password, and add this user metadata:

   ```json
   { "full_name": "Owner Name", "role": "admin", "position": "Owner" }
   ```

   The `on_auth_user_created` trigger mirrors the new user into `profiles` with
   the role from that metadata. **Every later account created from the app's User
   Management screen gets `role = 'staff'` unless the Admin picks otherwise.**
4. **Auth settings**: Authentication → Providers → Email — turn *Confirm email*
   off for a small internal tool so staff can sign in immediately, and keep
   *Minimum password length* at 8. Add your site URL under
   Authentication → URL Configuration so the "Forgot password?" link resolves.
5. **Keys**: Project Settings → API. Copy the project URL, the `anon` public key
   and the `service_role` secret key into `.env` (next section). The service-role
   key stays on the server; it is never referenced from anything in `public/`.

---

## 3. Environment variables

Copy `.env.example` to `.env` and fill it in. `.gitignore` excludes `.env`.

| Variable | Required | What it is |
| --- | --- | --- |
| `PORT` | no (default `3000`) | Port the Express server listens on. |
| `NODE_ENV` | no (default `development`) | `production` hides stack traces in API errors. |
| `SUPABASE_URL` | **yes** | `https://<project-ref>.supabase.co`. |
| `SUPABASE_ANON_KEY` | **yes** | Public anon key. Used for sign-in and for user-scoped (RLS) queries. |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes** | Secret. Bypasses RLS. Used **only** for Auth admin operations (create/delete user, set password). |
| `APP_SECRET` | no | Random string, reserved for signing. |
| `ALLOWED_ORIGINS` | no | Comma-separated CORS allowlist. Defaults to localhost. |
| `MAX_UPLOAD_MB` | no (default `5`) | Upload ceiling, mirrored by the bucket limits in `db/03_storage.sql`. |

If any of the three Supabase values are missing, `server/supabase.js` stops at
startup with a readable list of what is wrong instead of failing later.

---

## 4. Running the project

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # same, with --watch for auto-restart
```

Open <http://localhost:3000> — you are redirected to `login.html`.
Sign in with the Administrator account created in step 3, choose the **Admin**
role on the sign-in form (the role radio is verified against `profiles` after
authentication, so signing in as the wrong role fails on purpose).

Health check: `GET /api/health`.

### Deployment notes
* `NODE_ENV=production` in production; the API then hides stack traces.
* Serve behind HTTPS. `helmet` sets a strict Content-Security-Policy:
  `script-src 'self'` — **every page's JavaScript must live in an external file**;
  inline `<script>` blocks are blocked by design.
* Uploads are private buckets; the app hands out short-lived signed URLs
  (1 hour) rather than public links.

---

## 5. How each module works

### 5.1 Authentication and role-based access control
The sign-in form posts email, password and the selected role to
`POST /api/auth/login`. The server signs in with the anon key, loads the
`profiles` row, and **rejects the sign-in if the profile's role does not match
the radio the user picked**, if the account is deactivated, or if there is no
profile. Success returns the Supabase access/refresh tokens, which the browser
stores (`sessionStorage`, or `localStorage` when *Remember me* is on). Every
later call sends `Authorization: Bearer <token>`; `requireAuth` validates it and
builds an RLS-scoped Supabase client for that request, so the database — not the
UI — decides what the user may see. Five failed attempts for the same
email + IP lock sign-in for 15 minutes, and the failure message never reveals
whether the email or the password was wrong.

Sidebar entries are filtered by role (`shell.js` → `ADMIN_ONLY_PAGES`), and any
Admin-only route also carries `requireAdmin` on the server. User Management and
Materials & Prices (editing) are the two areas Staff cannot reach.

### 5.2 Quick Quotation (generalized)
`quotation-quick.html`. The client's name, a floor area and a finish package
(`standard`, `elegant`, `luxury`, `bare`) are enough. As soon as the area is
≥ 10 sqm, the page posts the current selection to
`POST /api/quotations/preview/quick` and re-renders the sticky total panel with a
per-work breakdown; updates are debounced 400 ms and stale responses are dropped.
Submitting saves the quotation (with the site plan in the `site-plans` bucket),
allocates a reference number through the `next_doc_number()` RPC
(`QTE-2026-0001`), and redirects to the print-ready Quotation Detail page.

Estimate: `floor area × package rate for each work`, then optional labour
(default 15%) and contingency.

### 5.3 Customized Quotation (detailed)
`quotation-detailed.html`. Same eight works, but the user picks a **material**
for each one (each option shows brand, unit price and a thumbnail) and a
**style/variant** where one exists. Every change re-posts to
`POST /api/quotations/preview/detailed` and updates the sticky live total plus
the per-work breakdown, so the client watches the price move as choices change.

Estimate: `floor area × (base work rate × material cost factor × style
multiplier)`, then the same labour and contingency layer. A contingency slider
(0–20%) and an *Include labour cost* switch apply on top.

### 5.4 Materials and prices
`materials.html` reads its catalogue from the `materials` table, which is the
system's local mirror of Wilcon Depot pricing. Each row carries `supplier`
(defaults to `Wilcon Depot`), `source_url` (the link to the product page on
wilcon.com.ph), `thumbnail_url`, `unit`, `unit_price` and `last_updated_at`; the
page shows the newest `last_updated_at` as a **"Prices last updated"** stamp.
Admins get a **Refresh prices** button (`POST /api/materials/refresh`), which
re-stamps every active material, writes a row into `price_refresh_log` with
`source = 'wilcon'` and `status = 'manual'`, and logs the activity. Staff can
read the catalogue but cannot edit it or trigger a refresh. When the live Wilcon
feed is wired up later, the same table is the import target — nothing else in
the app needs to change.

### 5.5 Project status tracking
`projects.html` lists projects with status badge and progress bar;
`project-detail.html` shows the milestone timeline;
`project-status-update.html` records a milestone — status, milestone name,
progress %, date, time logged, a site photo and remarks. Saving posts to
`POST /api/projects/:id/updates` and immediately recalculates the project's
`progress_percent` and `status`, so the list, the detail timeline and the
dashboard all move together. Photo uploads go to the `progress-photos` bucket
and reopen through signed URLs.

### 5.6 Dashboard and records
`index.html` shows summary cards (total quotations, active projects, completed
projects, pipeline value), recent activity from `activity_log`, and the most
recent quotations and projects. `quotations.html` and `projects.html` both have
a search + filter bar — keyword, status, date range and finish package — backed
by `readFilters()` on the server so filtering happens in SQL, not in the browser.
Quotations can be opened in a print layout (`quotation-detail.html?id=…`) and
exported to PDF with the browser's *Print → Save as PDF* using the print
stylesheet.

---

## 6. Form → controls and validation map

The same rules are declared three times on purpose: in the browser (`forms.js`
rule objects), on the server (`server/lib/validation.js`), and as database
constraints. The browser copy is for speed and friendliness; the server and the
database are the ones that actually enforce.

### MAJOR FORM 1 — Quick Quotation Request (`quotation-quick.html`)

| # | Control | Type | Rules |
| --- | --- | --- | --- |
| 1 | Client full name `client_name` | text | required; 2–60 chars |
| 2 | Email `client_email` | email | required; email pattern |
| 3 | Contact number `client_phone` | tel | required; `09XXXXXXXXX` or `+639XXXXXXXXX` |
| 4 | Project name `project_name` | text | optional; ≤ 160 chars |
| 5 | Project location `project_location` | text | required; 3–160 chars |
| 6 | Project type `project_type` | select | required; one of the 8 `PROJECT_TYPES` |
| 7 | Floor area `floor_area_sqm` | number | required; 10–5000 sqm |
| 8 | Number of floors `number_of_floors` | number | required; whole number 1–20 |
| 9 | Finish package `finish_package` | radio ×4 | required; `standard` \| `elegant` \| `luxury` \| `bare` |
| 10 | Works included `works_included[]` | checkbox ×8 | at least one; values from `WORK_TYPES` |
| 11 | Target start date `target_start_date` | date | optional; cannot be in the past |
| 12 | Site plan `site_plan` | file | optional; PDF/JPG/PNG; ≤ 5 MB |
| 13 | Remarks `remarks` | textarea | optional; ≤ 300 chars, live counter |
| 14 | `csrf_token`, `created_by`, `quotation_reference`, `price_source_at` | hidden | carried with the submission |
| — | Buttons | — | **Generate Quotation** (submit, Ctrl+Enter) · **Clear Form** (reset, confirms if the form is dirty) |

### MAJOR FORM 2 — Customized Quotation (`quotation-detailed.html`)

| # | Control | Type | Rules |
| --- | --- | --- | --- |
| 1 | Client `client_select` | select | required; an existing client or `__new__` |
| 2 | New client name `client_name` | text | required only when adding a new client; 2–60 chars |
| 3 | New client email `client_email` | email | optional; email pattern |
| 4 | New client phone `client_phone` | tel | optional; PH pattern |
| 5 | Project name `project_name` | text | required; 2–160 chars |
| 6 | Floor area `floor_area_sqm` | number | required; 10–5000 sqm |
| 7 | Base finish level `base_finish_level` | select | required; one of the seeded package codes |
| 8 | Material per work `materials.<work>` ×8 | select | required for each of the eight works; must be a real material id |
| 9 | Style/variant per work `styles.<work>` ×8 | radio | optional; ≤ 60 chars |
| 10 | Contingency `contingency_pct` | range 0–20 | required; 0–20, default 5 |
| 11 | Include labour cost `include_labor` | switch | boolean; `labor_pct` carried as a hidden field (15) |
| 12 | Quotation validity date `validity_date` | date | optional; cannot be in the past |
| 13 | Attachments `attachment` | file | optional; PDF/JPG/PNG/DOCX/XLSX; ≤ 5 MB |
| 14 | Notes `remarks` | textarea | optional; ≤ 300 chars |
| 15 | `quotation_id`, `price_source_at`, `created_by`, `csrf_token`, `client_id` | hidden | carried with the submission |
| — | Buttons | — | **Save Detailed Quotation** (submit, Ctrl+Enter) · **Reset Selections** (reset, confirms if dirty) |

### SUPPORTING FORM 1 — Sign in (`login.html`)

| # | Control | Type | Rules |
| --- | --- | --- | --- |
| 1 | Email `email` | email | required; email pattern |
| 2 | Password `password` | password | required; 8–72 chars |
| 3 | Show password | checkbox (`aria-pressed` button) | toggles the input type only |
| 4 | Role `role` | radio ×2 | required; `admin` \| `staff`; re-verified in `profiles` after sign-in |
| 5 | Remember me `remember` | switch | chooses `localStorage` over `sessionStorage` |
| 6 | `csrf_token`, `login_timestamp` | hidden | per-page-load nonce and timestamp |
| — | Buttons | — | **Sign In** (submit) · **Clear** (reset); "Forgot password?" opens a modal → `POST /api/auth/forgot-password` |

Failure behaviour: a single generic banner, a maximum of 5 attempts, then a
15-minute lock counted per email + IP.

### SUPPORTING FORM 2 — Project Status Update (`project-status-update.html`)

| # | Control | Type | Rules |
| --- | --- | --- | --- |
| 1 | Project `project_id` | select | required; an existing project |
| 2 | Current status `status` | radio ×3 | required; `planning` \| `ongoing` \| `completed`; `completed` forces progress to 100% |
| 3 | Updated by `updated_by` | text, read-only | filled from the signed-in profile; the real author is `updated_by_id` (hidden) |
| 4 | Milestone name `milestone_name` | text | required; 2–120 chars |
| 5 | Progress `progress_pct` | range 0–100, step 5 | required; whole number 0–100, live value |
| 6 | Milestone date `milestone_date` | date | required; a real calendar date |
| 7 | Time logged `time_logged` | time | optional; `HH:MM` (24-hour) |
| 8 | Progress photo `progress_photo` | file | optional; image only (JPG/PNG/WEBP); ≤ 5 MB |
| 9 | Remarks `remarks` | textarea | optional; ≤ 1000 chars, live counter |
| 10 | Notify owner `notify_owner` | switch | boolean, defaults to off |
| 11 | `updated_by_id` | hidden | the signed-in profile id, carried with the submission |
| — | Buttons | — | **Save Status Update** (submit) · **Cancel** (returns to the project) |

The reply includes the project's recalculated `progress_percent` and `status`, so
the list, the detail timeline and the dashboard all refresh from one save.

---

## 7. Accessibility and UX conventions

* Every control has a real `<label for>`; hints are visible text, not
  placeholder-only; required fields carry `*` **and** the word "required".
* Errors appear inline under the field, in the field's own language, are wired
  with `aria-describedby` + `aria-invalid`, and are also collected into an
  `role="alert"` summary at the top of the form. Submission is blocked, focus
  moves to the first invalid control, and the typed values are never cleared.
* Related controls sit in `<fieldset>` + `<legend>` groups; long forms are split
  into steps or collapsible sections with a step indicator.
* Keyboard: a logical tab order (the sticky total panel is `tabindex="-1"`-free
  and read-only), a visible focus ring on every interactive element, a
  *Skip to content* link, and Ctrl/Cmd+Enter to submit the two quotation forms.
* Toasts are `aria-live="polite"`; form errors are `assertive`.
* Colour: navy/slate primary with an amber accent, all combinations at
  4.5:1 or better. Status is never colour-only — badges always carry text.
* Loading, empty and error states exist for every list and card, and destructive
  actions (delete a quotation, delete a project, clear a dirty form) go through
  a confirmation dialog.

---

## 8. Git workflow

`main` is always deployable. Day-to-day work happens on short feature branches
off `main`.

```
main
├─ feature/quick-quotation-form
├─ feature/materials-price-refresh
├─ fix/ph-phone-validation
└─ chore/readme-and-test-checklist
```

Branch prefixes: `feature/`, `fix/`, `chore/`, `docs/`, `refactor/`.
Commit messages follow Conventional Commits:

```
feat(quotations): add quick quotation preview endpoint
fix(auth): reject sign-in when the selected role does not match the profile
docs(readme): document the storage buckets and their limits
test(forms): cover floor-area boundary values 10 and 5000
```

One logical change per commit; description in the imperative mood. Merges into
`main` use `--no-ff` so the feature boundary stays visible. Tag releases
(`v1.0.0`) once a milestone is verified against `TEST-CHECKLIST.md`.

Never commit `.env` — only `.env.example`. If a key is ever committed, rotate it
in Supabase immediately; the service-role key bypasses all RLS.
