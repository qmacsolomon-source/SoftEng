# Laboratory Activity 7 — Form Controls in the Final Project

**Project:** Project Management with Cost Estimation System — APA Engineering Services
**Repository:** https://github.com/qmacsolomon-source/SoftEng

All forms share one form engine (`public/js/forms.js`). The browser validates for speed and the server
(`server/lib/validation.js`) re-validates every value, so invalid data is stopped in both places.
Every form posts to an Express endpoint and the data is stored in Supabase (PostgreSQL).

## Forms implemented

| # | Type | Form | Page / script | Endpoint | Stored in |
|---|------|------|---------------|----------|-----------|
| 1 | **Major** | Quick Quotation | `quotation-quick.html` / `quotation-quick.js` (also the 3-step wizard in `quotation-detail.html`) | `POST /api/quotations/quick` | `quotations`, `quotation_items`, `site-plans` bucket |
| 2 | **Major** | Project Status Update | `project-status-update.html` / `project-status-update.js` | `POST /api/projects/:id/updates` | `project_status_updates`, `progress-photos` bucket |
| 3 | Supporting | Sign in | `login.html` / `login.js` | `POST /api/auth/login` | Supabase Auth session |
| 4 | Supporting | Create Project | `projects.html` / `projects.js` | `POST /api/projects` | `projects` |

Also available (extra credit): Customized Quotation, Add/Edit Material, Create User, Profile, Change Password.

## Form controls used (8–10+ per form)

| Form | Controls |
|------|----------|
| Quick Quotation | Textbox (client, project, location), Email, Tel, Dropdown (project type), Number (floor area, floors), Date (start), Radio (finish package), Checkbox (works included), File upload (site plan), Textarea (remarks), Hidden fields, Submit + Reset buttons |
| Project Status Update | Radio (status), Textbox (milestone), Slider (progress %), Date, Time, File upload (photo), Textarea (remarks), Checkbox (notify), Dropdown, Hidden field, Submit button |
| Sign in | Email, Password (+ Show/Hide button), Radio (Admin / Staff), Checkbox (Remember me), 2 Hidden fields (CSRF nonce, timestamp), Submit + Reset buttons |
| Create Project | Textbox (name, client, location), Dropdown (status), Number (progress, floor area, contract amount), Date (start, target end), Submit + Cancel buttons |

## Validation

| Rule | Example |
|------|---------|
| Required fields | client name, email, phone, location, project type, floor area, finish package |
| Format | email pattern; Philippine mobile `09xxxxxxxxx` / `+639xxxxxxxxx`; real calendar dates; `HH:MM` time |
| Limits | floor area 10–5,000 sqm; floors 1–20; contingency 0–20 %; progress 0–100 %; name 2–60 chars; remarks ≤ 300 chars; password 8–72 chars |
| Files | PDF/JPG/PNG only, ≤ 5 MB |
| Error messaging | inline message under each field (`role="alert"`), `aria-invalid`, an error summary at the top, focus moved to the first bad field |
| Submission prevention | invalid forms are never sent; values the user typed are kept |
| Server-side | the same rules are re-checked on the server; failures come back as per-field errors and are shown on the form |

## UX and accessibility

- Every input has a `<label for>`; required fields are marked and say so in text, not only with `*`.
- Placeholders and helper text (`aria-describedby`) on fields where the format is not obvious.
- Natural DOM order gives a logical keyboard tab order; no positive `tabindex` values are used (they break
  tab order). `tabindex="-1"` is used deliberately to move focus to the error summary and to each wizard step
  heading, and the skip link jumps to the main content. All buttons, radios and the slider are keyboard operable.
- Descriptive button labels: *Generate Quotation*, *Clear Form*, *Sign In*, *Clear*, *Save Status Update*, *Create project*, *Send reset link*.
- Live regions announce errors and success to screen readers.

## Functionality

- Sign in calls the real API; the role radio is verified against the user's profile, and five failed attempts
  lock the account for 15 minutes.
- Quotations are priced on the server from database rates, saved, given a reference like `QTE-2026-0001`,
  and shown on the Quotation Detail page. Site plans are stored in a private bucket.
- Status updates change the project's progress and status and appear on its timeline and the dashboard.
- Created projects appear immediately in the Projects list.

## Software-engineering workflow

- **Version control:** feature branches and pull requests (see PR #1 `feat/form-controls-implementation`).
- **Documentation:** `README.md` (setup and architecture) and this file.
- **Testing:** `TEST-CHECKLIST.md` lists valid-input and invalid-input cases for each form (e.g. V-Q1, I-Q2).

## Change made for this activity

The previous commit had replaced real behaviour with UI-only mocks (a fake login that redirected without
authenticating, a mocked session in `session.js` that treated every visitor as an admin, and a quotation wizard that
only displayed "demo" success). These were removed: `session.get()` reads the real stored session again, the login
form uses `/api/auth/login`, and the wizard now posts to `/api/quotations/quick`.
