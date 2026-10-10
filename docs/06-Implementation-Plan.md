# Webnox OS — Implementation Plan

**Product:** Webnox OS · **Owner and Master:** Haseeb Gul · **Repo:** `Webnox-OS`
**Version:** 2.0 · **Date:** 11 October 2026

For Codex. Build in this order. Stop after every phase for the owner's review.

---

## 0. How every phase ends

No phase is finished until all five are done:

1. `npm test` passes, including the isolation test for that phase's feature.
2. `node --check` on every changed JS file.
3. Every page opens headless at **390, 768, 1024 and 1440** with no console error and no horizontal page scroll.
4. `AGENTS.md` updated with what changed.
5. The owner is handed, in Hinglish:
   - "Supabase → SQL Editor mein poora `supabase/schema.sql` paste karke Run karo" — **only if the schema changed**; dobara chalana safe hai.
   - ```
     git add .
     git commit -m "<short message>"
     git push
     ```
   - Vercel khud deploy karega. Naya deployment na aaye to `git commit --allow-empty -m "Trigger deploy"`. Purana deployment kabhi **Redeploy** mat karna.

Then **stop and wait.**

---

## 1. Why tenancy comes first

Retrofitting `workspace_id` onto a finished app means rewriting every policy, every RPC and every test. So M2 is built before any feature, and nothing else starts until the isolation test is green.

---

## 2. Phases

### M0 · Accounts and plumbing
Fresh GitHub repo `Webnox-OS`. New Supabase project. New Vercel project linked to the repo. Env vars `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SITE_URL`. Supabase Auth URLs: Site URL = live URL, Redirect = `<live URL>/set-password.html`, OTP expiry 86400. `package.json`, `.env.example`, and a `vercel.json` that rewrites `/master-login` → `/master-login.html`.
**Done when:** an empty app deploys, `/api/config` answers, and `/master-login` resolves.

### M1 · Foundation, themes and the two login screens ⭐
- The folder structure from the TRD; `server.js` with `/api/config`.
- `css/app.css` with every business token; `css/master.css` with the blue tokens and gradients; `css/auth.css`.
- `ui.js`, `time.js`, `data.js`, `supabase.js`; the app shell with a collapsible sidebar, top bar and hash router; the `data-world` switch that loads `master.css`.
- **`login.html`** — white, split, with the four-scene animated left panel from `auth-art.js`, the two-step email form, the business brand slot, the tracking notice, no sign-up link.
- **`master-login.html`** — blue `--grad-hero`, drifting blurred blobs, the glass card, `noindex`, no outbound links. `robots.txt` disallows it.
- `set-password.html` matching the business login.

**Done when:** both login pages render correctly at 390, 768, 1024 and 1440; the animation runs, pauses on a hidden tab and freezes under `prefers-reduced-motion`; no page in the build links to `/master-login`.

### M2 · Tenancy core ⭐
Schema Part 1 — `workspaces` (with `slug`), `workspace_roles`, `profiles.workspace_id`, `profiles.is_master`, the enums, `current_workspace()`, `is_master()`, `master_can_read()`, the `set_workspace_id` trigger, the `slug_normalise` trigger, the RLS pattern, the one-admin index and the master-has-no-workspace check. Build the PGlite harness that seeds two workspaces with full fake data.
**Done when:** a user of workspace A returns zero rows from every scoped table, RPC and storage path of B. This test is written first and never deleted.

### M3 · Master account and shell
`promote_to_master()`. The Master branch in the boot sequence. The blue Master shell with its sidebar, badge and gradient top line. `master-home` and `master-workspaces` with their empty states. The `/api/master/*` guard. The cross-login refusals in both directions, both using *"These details don't work here."*
**Done when:** the Master signs in at `/master-login` and is refused at `/login.html`; a member is refused at `/master-login`; a non-master gets 403 from every master route.

### M4 · Create a workspace
`master_create_workspace()`, the `workspace_seed_after` trigger, `POST /api/master/workspaces` creating the two auth users and returning both invite links with `?w=<slug>`. The five-step creation page with the live plan preview. The result modal with Copy and Share on WhatsApp. Role activation. Slug and short-code uniqueness with suggestions. The `brand` bucket and logo upload.
**Done when:** a workspace is created from an empty database, both invite links work, and its Admin signs in with no SQL run by hand.

### M5 · Branded business login and the brand lookup ⭐
`POST /api/public/workspace-brand` with its rate limit and its `{}` response for every negative case. The `?w=<slug>` path, the `localStorage` remembered workspace, the **Not your business?** link, and the logo and name slot on the login and set-password pages.
**Done when:** opening an invite link shows *"Sign in to <business>"* with that logo; an unknown email returns `{}` with no visible difference; a suspended workspace and the Master both return `{}`.

### M6 · Auth, profiles and Team inside a workspace
`handle_new_user`, sign in and out, status checks, the set-password Continue flow with `verifyOtp`, session persistence. Team page, Add team member, Edit, Activate/Deactivate, Regenerate link (carrying the slug), `team_directory()`, employee IDs, the member profile drawer. Only activated roles appear in the role picker.
**Done when:** invite → set password → member signs in; the admin of A cannot read, edit or deactivate a member of B through the UI or the API.

### M7 · Tasks
Tasks, comments, the status flow, review with Approve and Request changes, "Assigned by Name, Designation", the task drawer, `task_set_status`, `task_review`.
**Done when:** the full lifecycle works, logs are written, and a task of B is invisible to A.

### M8 · Tracking and timers
`user_sessions`, `activity_intervals`, the 60-second heartbeat, idle after N minutes, `sweep_stale_sessions` at 3 minutes, the timer RPCs, one running timer per member, the 20-minute auto-pause, the top-bar pill.
**Done when:** every timer and session test passes and nothing records keystrokes or screenshots.

### M9 · Reports
`report_daily`, `report_tasks`, `day_timeline`, splitting at the workspace timezone's midnight, Work tracking, Login history, Activity logs, CSV export, My activity.
**Done when:** the numbers match the tests and every report is scoped to one workspace.

### M10 · Permissions
`role_permissions` per workspace, the Permissions page, `perm()` and `pm_perm()`, per-role sidebar tabs, immediate effect and logging.
**Done when:** access matches the default matrix, and switching a role off at Master level removes its tab, its permissions row and its dropdown entries everywhere.

### M11 · Leads
The pipeline, the lead form and shared options, the public form with its per-workspace token, honeypot and IP rate limit, `GET /api/public/form`, `POST /api/public/lead`, CSV import, assignment rules, notifications, Won and `lead_convert`.
**Done when:** Lead Generation cannot assign, the public form writes only into its own workspace, and a suspended workspace's form refuses politely.

### M12 · Clients and files
Clients with address, `clients_codes_before` with per-workspace BUID and invoice codes including collisions, the client drawer tabs, the `client-files` bucket with workspace-first paths and policies.
**Done when:** codes restart per workspace, may repeat across workspaces, and a file path of B cannot be signed by a user of A.

### M13 · Projects
Projects, `#/project/<id>` with all seven tabs, the project switcher, requirements, the live view snapshot, the approval RPCs and the full history, `project_link_before`.
**Done when:** the approval matrix is tested in all three directions and no row is ever deleted.

### M14 · Notifications
The triggers, `notify()`, `notify_managers()`, `notify_role()`, `notify_finance_people()`, the bell polling every 30 seconds, Mark all as read.
**Done when:** the actor is never notified, inactive users are skipped, and no notice crosses a workspace.

### M15 · Finance inside a workspace
Expenses, bills and salaries with all five frequencies, "Renews on" with days left, Mark paid and Skip, Charged automatically, investments, currency-first money with live rates, `finance_sweep()`, the dashboard, the monthly report, attachments.
**Done when:** salaries are hidden from the Finance role, reminders are idempotent, and one-time bills close on payment.

### M16 · Invoices
Client and business invoices, `invoice_counters` per workspace, `invoices_details_before`, locking, `invoice_next_number`, the editor, the viewer, the owner's A4 print template, Settings → Invoice details with the logo upload.
**Done when:** the print preview matches the template exactly, numbers are per client per workspace, and business invoices are invisible to non-finance roles.

### M17 · Dashboards
The admin/manager dashboard with the revenue block, team today and review queue; the member dashboard with the running timer and the day ribbon.
**Done when:** every number is real and an empty workspace looks calm and correct.

### M18 · Master finance ⭐
Schema Part 13 — `subscriptions`, `subscription_payments`, `billing_log`, `advance_due()` for the billing cycles, `record_rent_payment()`, `master_overview()`. The Master Finance page with its four tabs and the gradient hero cards. Rent invoices on the `INV-WX…` counter reusing the invoice template. The workspace **Billing** page for the Admin.
**Done when:** a full rent cycle runs end to end on test dates and a payment advances the due date by exactly one cycle.

### M19 · Master visibility ⭐
`master_workspace_stats()`, the read-only workspace view with its banner, Members (no emails or phones), Activity, Roles, Settings. `master_access_log`. The full-access switch with its confirm, both log lines and the Admin notification. `master_notify_admin()` with Copy for WhatsApp.
**Done when:** every Master entry is logged in two places and the Admin is notified, and salaries stay invisible with full access on.

### M20 · Billing lifecycle ⭐
`master_sweep()` in full — trial rollover, status computation, the daily trial notice, the last-three-days notices, due today, daily overdue, auto-suspension after grace. The suspended experience: members signed out with the message, the Admin landing on Billing only. Resume on payment. Archive and un-archive. `master_project` spaces skipped entirely.
**Done when:** suspension blocks sign-in and loses no data, ten sweeps in a day send one notice per kind, and a Master project space never receives a billing notice.

### M21 · Hardening and handover
A full isolation review table by table and policy by policy. A responsive pass at all four widths over every page. A search of the whole build proving no link to `/master-login` exists. Hinglish `README.md` with the owner's setup steps. `AGENTS.md` complete. The documentation set checked against what was actually built.
**Done when:** Haseeb can create a workspace, run the schema and deploy on his own, and every success criterion in the PRD is true.

---

## 3. Dependencies

```
M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8 → M9 → M10
                                                   └→ M11 → M12 → M13
                                                                  └→ M14 → M15 → M16 → M17
M4 ──────────────────────────────────────────────────────────────→ M18 → M19 → M20 → M21
```

M18 to M20 may start as soon as M4 and M14 are done. M21 is always last.

---

## 4. Isolation testing rule

**Every phase from M6 onward adds one isolation test to its own feature.** A user of workspace A attempts the new feature's reads, writes and RPCs against workspace B's rows and gets nothing — not an empty list by accident, but a policy refusal or zero rows by design.

Never disable RLS to make a test pass. Never add a `using (true)` policy, not even temporarily.

---

## 5. Risks and how they are handled

| Risk | Handling |
|---|---|
| A policy is written without the workspace condition | A test lists every table and asserts each policy mentions `current_workspace()` or `is_master()` |
| A counter leaks across workspaces | Counters keyed by `workspace_id`; tested with the same-named client in two workspaces |
| The browser forges a `workspace_id` | The insert trigger raises; tested directly |
| A reminder fires twice | `billing_log` primary key; tested by running the sweep ten times |
| A missed sweep skips a billing step | The sweep computes from dates, never from "what happened last time" |
| The Master accidentally sees client data | Business tables have no Master policy without full access; salaries have none at all |
| `/master-login` leaks into the product | A build-time grep in the test suite fails if the string appears in any page or menu outside `master-login.html` and `vercel.json` |
| The brand lookup leaks accounts | Same status, same shape, same timing for every negative case; rate-limited |
| A tenant is confused about whose software this is | Workspace branding is the tenant's; Webnox OS appears only on login, set-password and Billing |
| The login animation hurts load time or battery | Inline SVG and CSS only, under 25 KB, transform and opacity only, paused on a hidden tab, off under reduced motion |
| Scope creep | The PRD's out-of-scope list is binding. Ask the owner in one line before building anything not in these documents |

---

## 6. First message Codex should send back

After reading the documentation set and before writing code, Codex confirms in one short message:

1. Which phase it is starting.
2. Anything in the documents that contradicts itself, in one line each.
3. Nothing else — no restated plan, no summary.
