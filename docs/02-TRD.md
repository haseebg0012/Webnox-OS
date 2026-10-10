# Webnox OS — Technical Requirements Document (TRD)

**Product:** Webnox OS · **Owner and Master:** Haseeb Gul (haseebg0012@gmail.com)
**Version:** 2.0 · **Date:** 11 October 2026 · **Repo:** `Webnox-OS`

Read with `01-PRD.md` (what to build), `04-UIUX-Design-Brief.md` (how it looks) and `05-Backend-Schema.md` (the database).

---

## 1. Stack — keep exactly this

| Layer | Choice |
|---|---|
| Frontend | Plain **HTML + CSS + vanilla JavaScript ES modules** in `public/`. No React, Vue or Next, no bundler, no build step |
| Server | **Node ≥ 20 + Express 5** in one file, `server.js`. On Vercel it runs as one serverless function; `public/**` is served by the CDN |
| Database / Auth / Files | **Supabase** — Postgres, Auth, Row Level Security, Storage |
| Browser Supabase client | `@supabase/supabase-js@2.117.2` from `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm` (pinned) |
| Hosting | **Vercel**, auto-deploy on push to `main` |
| Tests | `tests/db.test.mjs` runs the whole schema in **PGlite** (`@electric-sql/pglite`) with a stubbed `auth` schema |
| Exchange rates | `https://open.er-api.com/v6/latest/<BASE>` — free, no key, fetched in the browser, editable |
| Fonts | Geist (Google Fonts), fallback Inter and system |
| Animation | Hand-written CSS and inline SVG only. No Lottie, no GSAP, no animation library |

`package.json` scripts: `dev` = `node --env-file=.env server.js`, `start` = `node server.js`, `test` = `node tests/db.test.mjs`.
Dependencies: `@supabase/supabase-js`, `express`. Dev dependency: `@electric-sql/pglite`.

**Repo:** `Webnox-OS` — a fresh GitHub repo and a fresh Vercel project. Do **not** build on top of the EcomHub OS prototype repo.

---

## 2. Environment variables

```
SUPABASE_URL=                 # Project URL
SUPABASE_PUBLISHABLE_KEY=     # sb_publishable_… (or legacy anon key) — browser-safe
SUPABASE_SECRET_KEY=          # sb_secret_… (or service_role) — SERVER ONLY, never in public/
SITE_URL=                     # live URL, used to build invite and reset links
```

The browser receives **only** the URL and the publishable key, from `GET /api/config`. The secret key never appears in `public/`, never in a log line.

**Supabase Auth → URL configuration:** Site URL = the live URL; Redirect URL = `<live URL>/set-password.html`; Email OTP expiration = 86400.

---

## 3. Folder structure

```
server.js                   Express: config, public, members, master, brand lookup
package.json  .env.example  vercel.json
README.md                   Owner guide, Hinglish
AGENTS.md                   Developer notes, kept in sync every phase
supabase/schema.sql         ALL tables, RLS, triggers, RPCs. Idempotent, numbered PARTS
tests/db.test.mjs           PGlite test suite
docs/                       This documentation set
public/
  index.html                redirects to /app.html, or /set-password.html when the hash carries a token
  login.html                BUSINESS login — white, split, animated left panel
  master-login.html         MASTER login — blue gradient, animated, noindex, unlinked
  set-password.html
  app.html                  the single app shell for both worlds
  lead-form.html            public, no login
  logo.svg favicon.svg favicon-64.png apple-touch-icon.png
  css/
    app.css                 tokens + every component style (business/white)
    master.css              the blue theme layer, loaded only in the Master world
    auth.css                both login pages and the set-password page
  js/
    supabase.js             creates the client from /api/config
    app.js                  boot, world branch, role sidebar, hash router, sweeps after paint
    state.js                user, profile, workspace, settings, roles, perms, billing, flags
    data.js                 q(), rpc(), api() wrappers, loadMembers(), loadDirectory()
    ui.js                   esc(), icons, toast, drawer, modal, confirmDialog, busy(), copyText(), downloadCSV()
    time.js                 all date and time formatting in the workspace timezone
    tracker.js              presence heartbeat + idle detection
    timer.js                running task timer + top-bar pill
    task-drawer.js          task detail drawer + task form
    components.js           day ribbon, period picker, bar charts, stats strip, log rows
    notify.js               bell + notifications panel
    currency.js             currency picker, live rates, fmtCur(), fmtPaid()
    invoices.js             invoice editor, printable template, viewer, print/PDF
    attachments.js          finance file attachments
    team-config.js          DEPARTMENTS, DESIGNATIONS, PROJECT_ROLES, ROLE_KEYS
    lead-options.js         lead form fields and options, shared with the public form
    business.js             revenue block for dashboards
    billing.js              plan maths, cycle advance, days left, status labels
    public-form.js          public lead form logic
    auth.js                 login, master-login and set-password logic
    auth-art.js             the login animations (business scenes + master background)
    pages/
      admin-dashboard  member-home  team  tasks  my-tasks  leads  clients
      projects  project  finance  permissions  tracking  logins  logs
      settings  profile  my-activity  billing            ← workspace pages
      master-home  master-workspaces  master-workspace  master-finance
      master-activity  master-settings                   ← Master pages
```

Each page module exports `render({ el, params, arg, route, setTitle })`.

---

## 4. The two worlds

One shell, one router, two skins and two sidebars.

```
app.js boot
  → GET /api/config, create client
  → session? no → /login.html (or /master-login.html if that is where they were)
  → load profile
     ├─ is_master = true   → document.body.dataset.world = 'master'
     │                       load master.css, Master sidebar, Master routes
     └─ member             → document.body.dataset.world = 'business'
                             load workspace + settings + roles + permissions
```

`master.css` is loaded only in the Master world, so a tenant never downloads it and a business page can never accidentally turn blue. Shared components read their colours from CSS custom properties, which `master.css` overrides.

---

## 5. Login routing and workspace branding

### 5.1 Three entry points

| URL | Page | Theme |
|---|---|---|
| `/login.html` or `/login.html?w=<slug>` | Business sign-in | White, split, animated left panel |
| `/master-login` → `master-login.html` | Master sign-in | Blue gradient, animated |
| `/set-password.html?token_hash=…&type=…&w=<slug>` | Set a password | White, matches the business login |

`vercel.json` rewrites `/master-login` to `/master-login.html` so the clean URL works. The page sends `<meta name="robots" content="noindex, nofollow">`, and `robots.txt` disallows it. **No link to it exists anywhere in the product.**

### 5.2 How the business login learns which business

In this order, first hit wins:

1. **`?w=<slug>` in the URL.** Invite links, reset links and the set-password redirect always carry it.
2. **`localStorage.webnox_last_workspace`** — written after a successful sign-in on that device.
3. **Email lookup.** The form is two-step: email → **Continue** → the page calls `POST /api/public/workspace-brand` and, if that email belongs to an active workspace, shows its name and logo above the password field.

With none of the three, the page shows the Webnox OS brand and the same layout.

### 5.3 `POST /api/public/workspace-brand`

Request `{ email }`. Response `{ name, logo_url, slug }` for an active workspace, or `{}` for anything else — unknown email, inactive member, suspended or archived workspace, **and for the Master account**.

Rules: rate-limited by IP (10 a minute), never returns a count, an error code or a timing difference that distinguishes those cases, and never confirms that the Master exists. It returns branding only — never an email, a name of a person, or anything about the business beyond its public name and logo.

### 5.4 Cross-login refusals
- A business member who signs in at `/master-login` is signed out with: *"These details don't work here."*
- The Master signing in at `/login.html` is refused with the same sentence.

Both are the same neutral message. Neither mentions a Master, an admin, or a different page.

### 5.5 Suspension at sign-in
- Member of a suspended workspace: signed out with *"This workspace is suspended. Please ask your admin."*
- Admin of a suspended workspace: signed in, no sidebar, the **Billing** page only.
- Archived workspace: everyone is signed out with *"This workspace is closed."*

---

## 6. Multi-tenancy

### 6.1 Model
One Supabase project, one schema, every business row carrying a `workspace_id uuid not null`. Separate Supabase projects per business are **not** used: they cannot be billed, watched or upgraded from one place.

### 6.2 Identity
- `profiles.workspace_id` — the one workspace a user belongs to. One email, one workspace. No switcher.
- `profiles.is_master boolean` — true only for the Master, whose `workspace_id` is **null**.

### 6.3 Helpers (security definer)

```sql
current_workspace()   -- the signed-in user's profiles.workspace_id
is_master()           -- true only for the Master account
is_admin()            -- the one admin account OF THE CURRENT WORKSPACE
is_manager()          -- admin or manager role, within the current workspace
is_manager_id(uuid)
workspace_has_role(text)
master_can_read(uuid) -- is_master() and full_access on that workspace
```

Every helper from the prototype (`perm()`, `pm_perm()`, `can_client()`, `can_invoice()`, `can_project()`, `can_money()`, `can_storage_file()`, `can_finance_file()` …) is rewritten to compare inside `current_workspace()`.

### 6.4 RLS pattern, every policy without exception

```sql
using ( workspace_id = current_workspace() )
```

Master policies are **separate and read-only**, limited to `workspaces`, `workspace_roles`, `subscriptions`, `subscription_payments`, `master_access_log`, plus a safe member view, `activity_logs` and `user_sessions`. Business tables get a Master policy only when full access is on. Salary rows get none at all.

### 6.5 `workspace_id` is never sent by the browser
A `before insert` trigger on every scoped table sets it from `current_workspace()`, and raises on a mismatch.

### 6.6 Per-workspace counters
`BUID-1001` and `EMP-0001` restart in each workspace; invoice codes may repeat across workspaces; `invoice_counters` is keyed by `(workspace_id, …)`.

### 6.7 Storage
```
w<workspace_id>/client/<client_id>/<file>
w<workspace_id>/client/<client_id>/p<project_id>/<file>
w<workspace_id>/expense/<expense_id>/<file>
w<workspace_id>/bill/<bill_id>/<file>
w<workspace_id>/rent/<payment_id>/<file>
```
Bucket policies check the first segment against `current_workspace()`.

---

## 7. Server API (`server.js`)

Every route except `/api/config` and the public ones verifies the caller's JWT with the secret key and loads their profile.

| Method | Route | Guard | Purpose |
|---|---|---|---|
| GET | `/api/config` | none | Supabase URL + publishable key |
| POST | `/api/public/workspace-brand` | IP rate limit | Name and logo for a known email, `{}` otherwise |
| GET | `/api/public/form` | none | Company name, agents and currency for the public lead form, by workspace token |
| POST | `/api/public/lead` | honeypot + IP rate limit | Insert a lead into that workspace |
| POST | `/api/members` | admin or manager of the caller's workspace | Create auth user + profile + roles, return invite link |
| PATCH | `/api/members/:id` | same, member must be in the caller's workspace | Edit a member |
| POST | `/api/members/:id/status` | same | Activate, deactivate, cancel invite |
| POST | `/api/members/:id/access-link` | same | New invite or reset link, carrying `?w=<slug>` |
| GET | `/api/master/workspaces` | `is_master` | List with counts and billing state |
| POST | `/api/master/workspaces` | `is_master` | Create a workspace, its Admin and Manager, return both invite links |
| PATCH | `/api/master/workspaces/:id` | `is_master` | Details, roles, plan, status |
| POST | `/api/master/workspaces/:id/access` | `is_master` | Full access on or off; logs and notifies |
| POST | `/api/master/workspaces/:id/notify` | `is_master` | Message the Admin, or Admin + Managers |
| POST | `/api/master/payments` | `is_master` | Record a rent payment |

Rules: every `/api/members*` route refuses an id outside the caller's workspace with 403 before touching the database; every `/api/master/*` route refuses a non-master with 403 and the same body as any other 403; writes go through security-definer RPCs and are logged; tokens, passwords and the secret key are never logged; workspace creation is one transaction.

---

## 8. Client architecture

### 8.1 Boot order
1. `GET /api/config`, create the client.
2. Session? No → the right login page.
3. Load the profile; inactive or suspended → sign out with the message from §5.5.
4. Branch into the Master or business world (§4).
5. Render the shell, then start presence, the timer pill and the bell.
6. **After the shell paints**, run the sweeps: `finance_sweep()` in a workspace, `master_sweep()` for the Master. Never block first paint.

### 8.2 Router
`#/route`, `#/role/<key>`, `#/project/<id>`, and for the Master `#/master/...` and `#/w/<workspace_id>/<tab>`. Unknown or forbidden route → the user's home with a toast, never a blank page.

### 8.3 `state.js`
`user`, `profile`, `workspace`, `settings`, `roles`, `perms`, `pmPerms`, `billing`, and the flags `isMaster`, `isOwner` (the workspace admin), `isAdmin` (admin or manager). `money()` formats in the active workspace's currency, or PKR for the Master.

### 8.4 Rendering rules
Escape all user content with `esc()`. Every list has an empty state; every action gives a toast or an inline error. The sidebar is built from the roles the workspace actually has — an inactive role never renders.

---

## 9. Billing engine

`subscriptions` holds one row per rented workspace: plan, amount, currency, cycle, next cycle, trial end, next due, grace days, status, member limit.

**`master_sweep()`** mirrors `finance_sweep()`, runs on the Master's app load and on each Admin's app load, and is **idempotent** through a `billing_log` keyed by `(workspace_id, kind, for_date)`. For each rented workspace it: rolls a finished trial into its paid cycle, computes the status from `next_due`, today and `grace_days`, sends the right notice to the Master and the Admin, and suspends once grace is over. Workspaces of type `master_project` are skipped entirely.

**`record_rent_payment(...)`** stores the payment, advances `next_due` by exactly one cycle with `advance_due()`, returns the status to Active, un-suspends if needed, notifies both sides and writes an activity line.

Money: currency first, then amount; a live rate, editable; stored as `currency`, `amount_original`, `fx_rate`, `amount`; converted in a database trigger, never in the browser.

---

## 10. Security requirements (non-negotiable)

1. RLS on for every table. Writes go through security-definer RPCs using `auth.uid()` and `now()`, narrow column grants with RLS, or `server.js` with the secret key.
2. **Never trust the client** for timestamps, durations, totals, invoice numbers, workspace ids or permissions.
3. **Never hard-delete history.** Deactivate, archive or mark a status.
4. `activity_logs` is append-only, written with `log_event()`. Never log tokens or passwords.
5. Revoke `execute` on internal functions from `public` and `anon`, and from `authenticated` for trigger and helper functions.
6. The public lead form writes into exactly one workspace, by a per-workspace token, rate-limited, with a honeypot.
7. `POST /api/public/workspace-brand` returns branding only, is rate-limited, and never reveals the Master.
8. Master access to business data is opt-in per workspace, logged twice, notified to the Admin, and never covers salaries.
9. Suspension blocks sign-in. It never deletes, hides or rewrites a row.
10. `/master-login` is unlinked, `noindex`, and disallowed in `robots.txt`. No error message anywhere hints at its existence.

---

## 11. Responsiveness and performance

- Breakpoints: **390 (phone), 768 (tablet), 1024 (small laptop), 1440 (desktop)**. Every page is opened headless at all four before a phase is handed over.
- No horizontal page scroll at any width. Tables scroll inside `.table-wrap`.
- The login animation is hidden below 900px and replaced by a compact brand header.
- All animation is CSS or inline SVG, GPU-friendly (transform and opacity only), and wrapped in `@media (prefers-reduced-motion: reduce)` so it stops for anyone who asks.
- Images are sized and lazy where off-screen. No page loads a font or script it does not use — `master.css` and `auth-art.js` are loaded only where they belong.

---

## 12. Testing

`npm test` must pass before every handover. The suite runs the whole schema in PGlite twice, proving idempotency.

**Test 0 — isolation, written before any feature test.** Seed two full workspaces. As a user of A, assert zero rows from every scoped table of B, across reads, writes, RPCs and storage paths. Assert the Master reads counts but not client rows. Assert the counters never collide.

Then: RLS per role · timers and auto-pause · stale sessions · report splitting at the workspace midnight · lead routing and convert · the project approval matrix · the actor is never notified · finance with salaries hidden, currencies, one-time bills and idempotent reminders · invoices with BUID, collisions, numbering, locking and totals · attachment validation.

New for Webnox OS:
- workspace creation seeds everything in one transaction
- role activation hides a role everywhere
- trial rolls into the paid cycle on the right day
- reminders fire on day 3, 2, 1, due, and daily while overdue, and never twice
- suspension blocks members and allows the Admin into Billing only
- a payment advances the due date by exactly one cycle
- a `master_project` workspace never receives a billing notice
- the full-access toggle writes both logs and the notification
- `workspace-brand` returns `{}` for an unknown email, a suspended workspace and the Master
- the Master is refused at the business login and a member is refused at `/master-login`

**Every phase from the team phase onward adds one isolation test to its own feature.**

---

## 13. Deployment and handover

Vercel deploys on push to `main`. If no deployment appears, push an empty commit. Never "Redeploy" an old one.

The schema is one idempotent file pasted into the Supabase SQL Editor, safe to re-run. New features go in a **new numbered part at the bottom**: `create table if not exists`, `alter table … add column if not exists`, `create or replace function`, `drop policy if exists` + `create policy`.

After every phase: `npm test`, `node --check` on changed JS, headless pages at 390/768/1024/1440, update `AGENTS.md`, give the owner the three git steps in Hinglish, and **stop for review**.
