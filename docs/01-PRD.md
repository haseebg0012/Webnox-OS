# Webnox OS — Product Requirements Document (PRD)

**Product:** Webnox OS · **Owner and Master:** Haseeb Gul (haseebg0012@gmail.com)
**Version:** 2.0 · **Date:** 11 October 2026 · **Status:** approved, build from this

---

## 1. What we are building

**Webnox OS is a complete multi-tenant SaaS business operating system**, rented to small agencies and businesses.

For each business it covers: the team and their roles, tasks with timers and work tracking, leads and the sales pipeline, clients and projects, business finance (expenses, bills, salaries, investments, invoices, reports) and in-app notifications.

Above all of them sits a **Master** — the platform owner, Haseeb Gul — who creates a workspace per business, rents it to them, watches the platform and collects the rent.

**EcomHub OS was a prototype.** It was built for one business, with no tenancy and no billing, and it proved the modules work. Webnox OS is the real product and is built fresh, in a new repo, with multi-tenancy from the first line of SQL. Webnoxos becomes one tenant inside Webnox OS, created through the normal flow, with no special case in the code.

| | EcomHub OS (prototype) | Webnox OS (product) |
|---|---|---|
| Businesses | One | Many, one workspace each |
| Top of the tree | Admin | Master, the platform owner |
| Data model | One shared set of tables | Same tables, every row owned by a `workspace_id` |
| Money | The business tracks its own | Same, **plus** the Master collects rent |
| Login | One generic page | Hidden Master login, plus a per-business login that carries the business's own brand |
| Theme | One white theme | White for a business, blue and gradient for the Master |
| Sign-up | None | None. Only the Master creates workspaces |

**Product promise:** a business gets a link, sets a password, and has a working company system the same day — their team, their clients, their money, their brand — without ever seeing another business's data, and without ever knowing the Master's login exists.

---

## 2. Users

### 2.1 Master — Haseeb Gul
One account for the whole platform. Lives outside every workspace. Never appears in a workspace's Team page, is never assigned a task, lead or project. **Signs in only at `/master-login`**, a page nobody else is ever shown.

**Jobs to be done**
- Create a workspace for a new business in under five minutes.
- Decide which roles that business gets.
- Hand its Admin and Manager their invite links.
- See at a glance who is live, who is due, and how many days are left.
- Record a bank-transfer payment and have the next due date move by itself.
- Suspend a workspace that has not paid, and bring it back the day it does.
- See how many people work in a workspace and what is happening there.
- Send its Admin a message.
- Keep project spaces of his own, free, that never expire.

### 2.2 Workspace Admin
Exactly one per workspace, mandatory, created by the Master. Owner of that business inside the app.

Adds the rest of the team, sets designations and roles, opens the Permissions page, fills Settings and Invoice details, sees everything in their own workspace including salaries. Can only hand out roles the Master switched on. Owns the Billing page.

### 2.3 Workspace Manager
At least one per workspace, mandatory. The Master creates the first; the Admin can add more. Admin-level access except **Settings**, **Permissions** and **Billing**.

### 2.4 Team roles (switched on per workspace by the Master)

| Role key | Name | What they do |
|---|---|---|
| `sales_rep` | Sales Representative | Works leads, changes stage, assigns leads, converts won leads |
| `lead_gen` | Lead Generation | Adds leads by form, CSV or public link. **Cannot assign** |
| `cold_caller` | Cold Caller | Calls leads, updates stage and notes |
| `finance` | Finance | Expenses, bills, invoices. Sees salary **totals only**, never names |
| `project_manager` | Project Manager | Runs **only** the projects assigned to them |

A member can hold several roles; each adds a tab under "My roles". Role names stay plain — no clever naming.

---

## 3. Workspace types

| Type | Rent | Expiry | Suspension | Who |
|---|---|---|---|---|
| **Master project** | None | Never | Never | Haseeb's own spaces — his own business, or testing |
| **Rented business** | Yes | By plan | Yes, after grace | Every paying customer |

A Master project space behaves identically inside — same roles, same modules — but the billing engine skips it entirely. It shows in the Master's list marked **Internal — no rent**, with no due date, no days-left counter and no reminders. The Master may have more than one.

---

## 4. Login, identity and branding

This section is a product requirement, not a design preference.

### 4.1 The Master login is hidden
- It lives at **`/master-login`** and nowhere else.
- No link to it exists on the business login page, in a footer, in a menu or in a sitemap. The page carries `noindex, nofollow`.
- A business member who reaches it and signs in is signed out with a neutral message. The Master signing in at the business login is refused the same neutral way. Neither message ever hints that a Master account exists.
- The page is blue, gradient and animated — see `04-UIUX-Design-Brief.md`.

### 4.2 The business login carries the business
- White theme, split layout: an **animated panel on the left** showing what Webnox OS does, and the **sign-in form on the right**.
- When the workspace is known, **that business's name and logo** appear above the form, with a line such as *"Sign in to Webnoxos"*.
- The workspace is known in three ways, in this order: the link the member was invited with carries the workspace slug; the device remembers the last workspace signed in on it; or the member types their email and the page looks the workspace up.
- With no workspace known, the page shows the Webnox OS brand and the same layout. It never looks broken.

### 4.3 No sign-up, anywhere
There is **no "create your workspace" button, no sign-up link and no self-service registration** on any login page or anywhere in the public app. Only the Master creates workspaces. Only the Master and a workspace Admin create accounts. **Forgot password?** tells the member to ask their Admin; no reset email is sent.

### 4.4 Two themes, one codebase
- **Master world:** blue. Deep blue-to-cyan gradients, an animated background on the login, gradient stat cards on the dashboard.
- **Business workspace:** white, quiet, numbers first. The tenant's own name and logo in the sidebar and on their invoices. "Webnox OS" appears only on the login page, the set-password page and the Billing page — a tenant's staff should feel they are using their company's system.

### 4.5 Fully responsive
Every page is designed and tested at **390, 768, 1024 and 1440**. No page scrolls sideways at any width. The login animation collapses into a compact header below 900px. Tables scroll inside their own wrapper, never the page. Tap targets are at least 44px.

---

## 5. Plans and billing

### 5.1 The plan dropdown (chosen at workspace creation)

One dropdown, five options:

1. **Trial — 7 days**
2. **Trial — 14 days**
3. **Monthly**
4. **Quarterly**
5. **Yearly**

A trial also carries the **cycle and amount that begin the day the trial ends**, so the workspace rolls into paid billing without a second setup. A paid option starts billing from the start date.

Alongside: rent amount and currency, start date, grace days (default 7) and an optional member limit.

### 5.2 Rent rules
- Rent is set **per workspace**, not from a fixed plan catalogue. Named plans come later, past ten tenants.
- Payment is by **bank transfer only**, recorded by hand by the Master. No payment gateway in v2.
- Every payment is stored in the currency it was received in, with a live exchange rate, and totalled in the Master's currency (**PKR**).
- Recording a payment advances the next due date by exactly one cycle and returns the status to Active.
- Changing a plan mid-cycle never rewrites past payments; it applies from the next due date.
- The **member limit** is recorded but blocks nothing. Crossing it warns the Master only.

### 5.3 Billing statuses

| Status | Meaning | Who can sign in |
|---|---|---|
| Trial | Free days running | Everyone |
| Active | Rent paid, due date in the future | Everyone |
| Due soon | Three days or fewer to the due date | Everyone |
| Due today | The due date is today | Everyone |
| Overdue | Due date passed, grace running | Everyone, with a banner |
| Suspended | Grace over, rent unpaid | **Admin only**, and only the Billing page |
| Cancelled / Archived | Master ended it | Nobody |

Status is computed by the billing sweep from the due date and grace days. It is never typed in by hand.

### 5.4 Reminders

| When | Who | Message |
|---|---|---|
| Every day of a trial | Master **and** Admin | Trial ends in N days |
| Each of the last 3 days of a paid cycle | Master **and** Admin | Your month / quarter / year ends in N days |
| On the due date | Master and Admin | Rent due today |
| Every day while overdue | Master and Admin | Overdue by N days, suspension in N days |
| On suspension | Master and Admin | Workspace suspended |
| On a payment recorded | Master and Admin | Payment received, next due on `<date>` |

All in-app, on the bell. The app sends no email and no WhatsApp itself; every message has a **Copy for WhatsApp** button. Reminders are **idempotent** — the same notice is never sent twice for the same day.

---

## 6. What the Master can do

| Capability | Detail |
|---|---|
| Create a workspace | Name, slug, short code, logo, country, currency, timezone, idle minutes |
| Create its Admin and Manager | Both mandatory; invite links returned with Copy and Share on WhatsApp |
| Switch roles on and off | Only activated roles exist in that workspace — no tab, no permissions row, no dropdown entry |
| Open a workspace | Enter and look around in read-only view mode |
| See the team | Member count, active now, idle, signed in, never joined |
| See activity | That workspace's activity log, login history, task and lead counts |
| Notify the Admin | In-app message to Admin, or Admin + Managers |
| Charge rent | Plan, amount, cycle, due date, payments, overdue |
| Suspend or resume | Block sign-in when rent is unpaid, restore on payment |
| Archive | Hide and block access. **Data is never deleted** |

### 6.1 What the Master does not see

By default the Master does **not** see a workspace's clients, leads, invoices, expenses, salaries or task contents. He sees counts, presence and activity — not business data.

A per-workspace **Full access** switch exists for support. Turning it on writes a line in that workspace's activity log, sends its Admin a notification, and is recorded in the Master's own access log. Access is always visible to the customer, never silent. **Salaries stay invisible to the Master even with full access on.**

---

## 7. Features inside a workspace

These are the modules the prototype proved. They behave the same here, scoped to one workspace.

### 7.1 Accounts and team
- No public sign-up. The Master creates the Admin and the first Manager; the Admin creates everyone else.
- Invite and reset links are our own URL with a hashed token, confirmed behind a **Continue** button so link previews cannot burn the token. The link carries the workspace slug so the member lands on their own branded login.
- Team page: member, roles, status, presence, employee ID (`EMP-0001`), joined date, Regenerate link.
- Deactivating a member signs them out and blocks sign-in. **History is never deleted.**

### 7.2 Tasks and time
- To do → In progress → In review → Completed, with Approve and Request changes.
- The assignee always sees **"Assigned by Name, Designation"**.
- One running timer per person, server timestamps, auto-pause after 20 minutes away.
- Presence heartbeat every 60 seconds; idle after N minutes from Settings.
- **Signed in / Active / Idle / Task timer** are four separate numbers, never added together.
- Nothing records keystrokes, screenshots, camera or other apps. Stated on the login page.

### 7.3 Leads
- New → Contacted → Qualified → Meeting → Proposal → Negotiation → Won / Lost. "Converted to client" is a filter, not a stage.
- Lead form: name, company (required), email, phone, website, country, niche, service, **currency then budget**, source, stage, priority, agent, follow-up date, notes.
- Public lead form with no login, honeypot and rate limit, writing into one workspace only.
- CSV import.
- Lead Generation adds but **cannot assign**. Only Sales Rep, Manager or Admin assign, and only to a Sales Representative.
- Won → notify managers → Convert to client → "Create a project now?"

### 7.4 Clients
- Contact, website, country, **address**, services, status, onboarding date, monthly retainer.
- Automatic **BUID** (`BUID-1001`…) and a unique 2-letter invoice code from the name, set by the database, never changed, **restarting per workspace**.
- Drawer tabs: Overview, Projects, Tasks, Invoices, Files.

### 7.5 Projects
- A client has many projects. Admin or Manager sets the Project Manager, who is notified.
- `#/project/<id>` with a project switcher as the heading and tabs: Overview, Live view, Requirements, Tasks, Files, Finances, Settings.
- Adding people goes through approval: pick a designation first, then a person who holds it. Admin/Manager adds → PM approves; PM adds → Admin or any Manager approves; no PM yet → added directly. Full history kept, rows never deleted.

### 7.6 Finance
- Tabs: Dashboard, Expenses, Bills & salaries, Investments, Client invoices, Business invoices, Monthly report.
- Any currency: currency first, then amount; a live rate, editable; totals in the workspace's own currency.
- **Salaries visible only to Admin and Managers.** Finance role sees totals, never names.
- Bills support One time / Weekly / Monthly / Quarterly / Yearly, "Renews on" with days left, Mark paid, Skip, Charged automatically.
- Attachments (PDF, PNG, JPG, WEBP — 10 MB each, up to 10) on expenses, bills and Mark paid.

### 7.7 Invoices
- Client invoices `INV-BUID-HF001` per client; business invoices `INV-EH001`. Numbers, reference, issuer and totals made by the database and locked after insert.
- The printed template is the owner's A4 design: logo, TAX INVOICE (INVOICE at 0% tax), details table, Billed to with BUID, line items, payment details, terms with due and pause days from Settings, ad-spend note, Issued by, footer.

### 7.8 Notifications
- One bell, polling every 30 seconds, created only by database triggers.
- **The actor is never notified.** Inactive users are never notified.

### 7.9 Billing page (inside a workspace)
Admin only. Plan and cycle, status, next due with days left, rent amount, the Master's bank details with copy buttons, rent invoices with Download PDF, payment history. It is the only page reachable while suspended.

---

## 8. Non-functional requirements

| Area | Requirement |
|---|---|
| **Isolation** | Zero cross-workspace reads or writes, proven by tests before any feature is built |
| **Security** | RLS on every table; writes through security-definer RPCs; append-only activity logs; secret key server-side only; no hard deletes |
| **Master secrecy** | No route, link, message or error anywhere reveals that a Master login exists |
| **Trust** | Master access to business data is opt-in, logged twice, and the Admin is notified. Salaries never |
| **Responsiveness** | Designed and tested at 390, 768, 1024 and 1440. No horizontal page scroll at any width |
| **Performance** | First paint never waits on a billing or finance sweep |
| **Motion** | Animations are CSS and SVG only, no library, and respect `prefers-reduced-motion` |
| **Language** | UI in English, sentence case. Owner documentation and handover steps in Hinglish |
| **Data honesty** | Real data only. No fake stats, no demo accounts in production |
| **Recovery** | Suspension and archiving are reversible with no data loss |

---

## 9. Out of scope for v2

- Payment gateway, card payments, automatic bank reconciliation
- Email or WhatsApp sending from the app; custom SMTP
- Named plan catalogue with feature gating
- A user in more than one workspace, or a workspace switcher for anyone but the Master
- Self-service sign-up by a business
- Task file attachments and timer corrections
- Public API for tenants, mobile apps, dark mode

---

## 10. Success criteria

1. The Master signs in at `/master-login`; the same account is refused at the business login, and no page anywhere links to `/master-login`.
2. The Master creates a workspace from an empty database and its Admin signs in, with no SQL run by hand.
3. A member of Webnoxos opens their link and sees **"Sign in to Webnoxos"** with that logo, on a white page with the animation on the left.
4. A user of workspace A gets zero rows from every table, RPC and storage path of workspace B.
5. A full rent cycle runs on test dates: trial → reminders → due → overdue → suspended → payment → active, with the right notices on both bells and no data touched.
6. A Master project space never receives a rent notification and never expires.
7. A workspace with the sales roles switched off shows no trace of them anywhere.
8. Salaries are invisible to the Finance role and to the Master, full access on or off.
9. Every page passes at 390, 768, 1024 and 1440.
10. `npm test` passes, including one isolation test per feature.
11. Haseeb can create a workspace, run the schema and deploy on his own, following the Hinglish README.
