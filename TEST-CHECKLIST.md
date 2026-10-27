# Test checklist — APA Engineering Services PMS

Run this list before tagging a release. Every case states the **input**, the
**expected result**, and how to check it. Anything that fails gets a `fix/…`
branch and a regression note here.

**Environment for a run:** a Supabase project with `db/01…04` applied and the
seed data loaded, one Admin account and one Staff account, and the server
running on `http://localhost:3000`.

| Id | Case | Input | Expected |
| --- | --- | --- | --- |
| ENV-01 | Server starts | `npm start` with a valid `.env` | Banner prints `Supabase : configured`, `GET /api/health` → `200`. |
| ENV-02 | Config guard | delete `SUPABASE_URL` from `.env`, `npm start` | A readable "configuration is incomplete" list, exit code 1 — no raw stack trace. |
| ENV-03 | Static pages | open all 13 pages | Each returns 200 and, when signed out, redirects to `/login.html`. |
| ENV-04 | No inline scripts | View source on any page | Exactly one `<script type="module" src=…>`, no inline `<script>`; the console is free of CSP violations. |

---

## 1. Valid input

| Id | Form | Input | Expected |
| --- | --- | --- | --- |
| V-Q1 | Quick Quotation | Maria Santos / maria@example.com / 09171234567 / "Two-storey residence" / Residential – New Build / 150 sqm / 2 floors / Elegant / all works / a start date next month / a 1 MB PDF / remarks | Toast with a `QTE-2026-0001`-style reference and a peso total; redirected to Quotation Detail; the breakdown lists all eight works and their amounts sum to the subtotal. |
| V-Q2 | Quick Quotation | same but **no site plan and no remarks** | Saves. Optional fields are genuinely optional. |
| V-Q3 | Quick Quotation | 2 floors, 1 floor, 20 floors | Accepted. |
| V-D1 | Customized Quotation | existing client / 120 sqm / Luxury base / a material and a style for all eight works / contingency 10% / labour on / validity +30 days / PDF attached | Toast with reference and total; total equals `area × Σ(base rate × cost factor × style multiplier)` plus 15% labour plus 10% contingency on the two. |
| V-D2 | Customized Quotation | "Add a new client…" with a valid name, then fill everything else | A `clients` row is created and linked to the quotation (`client_id` set). |
| V-D3 | Customized Quotation | contingency 0%, labour off | Total equals the plain subtotal; contingency and labour lines read ₱0.00. |
| V-L1 | Sign in | Admin email + correct password + **Admin** radio | Redirected to the dashboard; sidebar shows Users and Materials; top bar shows the name and role. |
| V-L2 | Sign in | Staff email + correct password + **Staff** radio | Dashboard loads; no Users entry; `/users.html` bounces back with a "not permitted" state. |
| V-P1 | Status update | Ongoing / "Ground floor slab poured" / 45% / today / 09:30 / a JPG / remarks / notify on | Toast; the project's progress reads 45%, its badge reads Ongoing, the new milestone is on the timeline, and the dashboard "Recent activity" gains the entry. |
| V-P2 | Status update | Completed / any milestone / 100% | Accepted; the project moves to Completed everywhere. |

## 2. Invalid input

| Id | Form | Input | Expected |
| --- | --- | --- | --- |
| I-Q1 | Quick Quotation | submit the empty form | Submission blocked; error summary at the top lists every missing field; the first invalid control is focused; inline messages appear under each; typed values survive. |
| I-Q2 | Quick Quotation | email `maria@@example` | Inline "Enter a valid email address" + `aria-invalid="true"`. |
| I-Q3 | Quick Quotation | phone `12345`, `091712345`, `+6391712345` | All rejected: exactly `09` + 9 digits or `+639` + 9 digits. |
| I-Q4 | Quick Quotation | client name `A` | Rejected: 2–60 characters. |
| I-Q5 | Quick Quotation | untick **every** work | Rejected: at least one work must be included. |
| I-Q6 | Quick Quotation | floor area `10` with a package chosen | Preview panel renders a real total (see B-Q1) — the guidance state only appears below 10. |
| I-Q7 | Quick Quotation | a 6 MB PDF, or a `.docx` site plan | Rejected before upload: PDF/JPG/PNG only, 5 MB maximum. |
| I-Q8 | Quick Quotation | start date yesterday | Rejected: the date cannot be in the past (the picker's `min` is today too). |
| I-Q9 | Quick Quotation | 301 characters of remarks | The counter stops at 300/300 and the field cannot go further. |
| I-D1 | Customized Quotation | leave one work without a material | Rejected with the message under **that** work block (server error key `materials.<work>`), not a generic banner. |
| I-D2 | Customized Quotation | clear the project name | Rejected: required, 2–160 characters. |
| I-D3 | Customized Quotation | validity date yesterday | Rejected: cannot be in the past. |
| I-L1 | Sign in | correct password + the **wrong role** radio | Generic failure banner. The word "role" is not named as the cause, and the account is not signed in. |
| I-L2 | Sign in | unknown email, or a wrong password | Identical generic banner for both. Which field was wrong is never revealed. |
| I-L3 | Sign in | password of 7 characters | Rejected client-side before the request is sent. |
| I-P1 | Status update | status Completed with progress 50% | Rejected: a completed project must be recorded at 100%. |
| I-P2 | Status update | a 3 MB `.pdf` as the progress photo | Rejected: images only. |
| I-P3 | Status update | progress 250 typed into the DOM | Client-side clamp plus server `int 0–100` rule both reject it. |
| I-A1 | API bypass | `POST /api/quotations/quick` with `curl` and `floor_area_sqm: 5` | `400` with `error.fields.floor_area_sqm`. The browser is not the only validator. |
| I-A2 | API bypass | `floor_area_sqm` as the string `"wide"` | `400`; a non-numeric value never reaches the database. |
| I-A3 | API bypass | a name carrying `<script>alert(1)</script>` | Stored and rendered as text — `escapeHtml` on output, control characters stripped on input. No dialog appears anywhere the record is shown. |
| I-A4 | API bypass | delete a client that a quotation references | `400`/`409` from the foreign key, not a silent orphan. |

## 3. Boundary values

| Id | Field | Values | Expected |
| --- | --- | --- | --- |
| B-Q1 | `floor_area_sqm` (quick) | 9.99 | Guidance state; no preview request is sent. |
| B-Q2 | `floor_area_sqm` (quick) | 10 and 5000 | Both accepted and priced. |
| B-Q3 | `floor_area_sqm` (quick) | 5000.01 | Rejected: maximum 5000 sqm. |
| B-Q4 | `number_of_floors` | 0, 1, 20, 21 | 0 and 21 rejected; 1 and 20 accepted. |
| B-Q5 | `client_name` | 1, 2, 60, 61 chars | 1 and 61 rejected; 2 and 60 accepted. |
| B-Q6 | `remarks` | 0, 300, 301 chars | 0 and 300 accepted; 301 blocked by `maxlength`. |
| B-Q7 | `password` (sign in) | 7, 8, 72, 73 chars | 7 and 73 rejected; 8 and 72 accepted (Supabase caps bcrypt at 72 bytes). |
| B-Q8 | `contingency_pct` | 0, 20, 21 | 0 and 20 accepted; 21 not reachable — the slider max is 20 and the server checks 0–20. |
| B-Q9 | `progress_pct` | 0, 100 | Accepted. `completed` + 100 is the only valid completion pair. |
| B-Q10 | `unit_price` on a material | 0, negative | 0 accepted, negatives rejected by the CHECK constraint. |
| B-Q11 | `cost_factor` on a material | 0.10, 5.00, 0.09, 5.01 | 0.10 and 5.00 accepted; the outside values rejected by `materials_cost_factor_ck`. |
| B-Q12 | Upload | exactly 5 MB / 5 MB + 1 byte | 5 MB accepted; the byte over is rejected by the bucket limit as well as by the API. |
| B-Q13 | Target start date | today | Accepted (today is not "in the past"). |

## 4. Keyboard-only use

Unplug the mouse, or use only Tab / Shift+Tab / Enter / Space / the arrow keys.

| Id | Where | Steps | Expected |
| --- | --- | --- | --- |
| K-01 | Any page | press Tab from the address bar | The first stop is the **Skip to content** link, and activating it moves focus into `#page`. |
| K-02 | Any page | Tab the whole document | Every control receives a visible focus ring; no focus traps and no unreachable control. |
| K-03 | Sign in | Tab order | email → password → Show → role radios (arrow keys switch) → Remember me → Sign In → Clear → Forgot password. |
| K-04 | Quick Quotation | Tab order | Client fields → project fields → package radios (arrow keys) → work checkboxes (Space) → file → remarks → Clear Form → Generate Quotation. |
| K-05 | Quick Quotation | fill it in with the keyboard, press **Ctrl+Enter** | The form submits exactly as if Generate Quotation had been clicked. |
| K-06 | Customized Quotation | press **Ctrl+Enter** | Saves. |
| K-07 | Status update | arrow-key the progress slider | `<output>` follows the thumb (`aria-live` announces it) and the DOM value matches. |
| K-08 | Any form | submit an invalid form by keyboard | Focus lands on the first invalid control, and its message is read (the summary is `role="alert"`). |
| K-09 | Any modal | Tab / Shift+Tab / Esc | Focus is trapped inside, Esc closes, and focus returns to the button that opened it. |
| K-10 | Sidebar (mobile width, ≤ 900 px) | Tab to the menu button and press Space | The drawer opens, the scrim appears, Esc closes it and focus returns to the button. |
| K-11 | Any list table | Tab to a sortable header and press Enter | The sort toggles and `aria-sort` follows. |
| K-12 | Destructive action | activate Delete on a quotation | A confirm dialog opens; **Cancel** (the default focus) changes nothing. |

Also check with a screen reader (NVDA or VoiceOver): every input announces its
label, its required state, its hint, and its error. Status badges are never
colour-only — they always carry the status as text.

## 5. Role access

Sign in as each role and try each route. The server must refuse regardless of
what the UI shows, so test the URLs directly too.

| Id | Route / page | Admin | Staff |
| --- | --- | --- | --- |
| R-01 | Dashboard, Quotations, Projects, Profile | allowed | allowed |
| R-02 | Quick Quotation, Customized Quotation | allowed | allowed |
| R-03 | Materials & Prices — view | allowed | allowed |
| R-04 | Materials & Prices — edit / deactivate a material | allowed | the controls are absent, and `PATCH /api/materials/:id` returns `403` |
| R-05 | Materials & Prices — **Refresh prices** | allowed; writes a `price_refresh_log` row | button absent; `POST /api/materials/refresh` → `403` |
| R-06 | Pricing — change a package's per-work rate, or a style multiplier | allowed; the quotation previews reflect it | `PATCH /api/pricing/…` → `403` |
| R-07 | User Management `/users.html` | allowed | the sidebar entry is hidden, the page redirects, and `GET /api/users` → `403` |
| R-08 | Create / deactivate a user | allowed | `POST /api/users` and `DELETE /api/users/:id` → `403` |
| R-09 | Delete a quotation or a project | allowed | `DELETE` → `403` and no destructive button in the UI |
| R-10 | Another user's profile row | readable/administerable | can read and update only its own row; an `UPDATE` against someone else's id changes nothing |
| R-11 | Storage | | a Staff member cannot read another user's `site-plans`, `progress-photos` or `attachments` object without a signed URL |
| R-12 | Deactivated account | — | signing in with a deactivated profile is refused with "This account has been deactivated." |
| R-13 | Lockout | — | the 6th bad attempt within the window returns the "too many failed sign-in attempts" message with a retry time; a successful sign-in clears the counter |

**RLS spot-check (SQL editor):** with a Staff user's JWT, `select * from
materials` must return rows (read allowed) while `update materials set
unit_price = 1` must affect 0 rows, and `select * from price_refresh_log` must
return nothing.

## 6. Cross-cutting checks

| Id | Check | Expected |
| --- | --- | --- |
| X-01 | Loading states | Every list shows skeleton rows, never a flash of "no records" before data arrives. |
| X-02 | Empty states | A search with no matches shows a friendly empty state with a "clear filters" action. |
| X-03 | Error states | Stop the server and reload a page: a readable error state with a **Retry** button — not a blank screen. |
| X-04 | Session expiry | Delete the stored token, then click any action: one silent refresh is attempted, then the user is sent to sign in with `?next=` preserved. |
| X-05 | Print / PDF | Print preview of Quotation Detail hides the sidebar, top bar and buttons, and shows the firm header, the cost breakdown and the total. |
| X-06 | Responsive | At 1280 px, 834 px (tablet) and 390 px (phone): no horizontal scrolling, the sidebar collapses to a drawer on small screens, and the sticky total panel becomes a normal block above the fold. |
| X-07 | Dark mode | The toggle persists across reloads, keeps ≥ 4.5:1 contrast, and status colours stay distinguishable. |
| X-08 | Filters | Keyword + status + date range + finish package combine correctly, and the result count matches the rows shown. |
| X-09 | Pagination | Page 2 of a list loads the next slice, the page indicator updates, and changing a filter resets to page 1. |
| X-10 | No input loss | Trigger a server-side validation error on either quotation form: the form still holds every value the user typed. |

---

## Suggested Git workflow

Feature branches off `main`, Conventional Commit messages, `--no-ff` merges, and
a `vX.Y.Z` tag once this checklist passes on a real Supabase project. The full
convention, branch prefixes and example messages are in
[README.md](README.md) §8.

A workable loop for this project:

```bash
git checkout main && git pull
git checkout -b fix/ph-phone-validation
# … make the change, run the relevant rows of this checklist …
git add public/js/forms.js server/lib/validation.js
git commit -m "fix(forms): accept +639 and 09 phone numbers only"
git checkout main && git merge --no-ff fix/ph-phone-validation
git tag -a v1.0.1 -m "Phone validation fix"
```
