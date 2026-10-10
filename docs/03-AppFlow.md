# Webnox OS — App Flow

**Product:** Webnox OS · **Owner and Master:** Haseeb Gul
**Version:** 2.0 · **Date:** 11 October 2026

Every route, every screen, every end-to-end flow. Read with `04-UIUX-Design-Brief.md` for how each screen looks.

---

## 1. Route map

### 1.1 Public (no login)
| Page | Route | Theme |
|---|---|---|
| Business sign-in | `/login.html` · `/login.html?w=<slug>` | White, split, animated left panel |
| **Master sign-in** | **`/master-login`** (rewritten to `master-login.html`) | Blue gradient, animated, unlinked, `noindex` |
| Set password | `/set-password.html?token_hash=…&type=invite\|recovery&w=<slug>` | White, matches the business login |
| Public lead form | `/lead-form.html?w=<workspace token>` | White |

There is **no sign-up route and no "create your workspace" link** anywhere.

### 1.2 Master world (inside `/app.html`)
| Page | Route |
|---|---|
| Home | `#/master` |
| Workspaces | `#/master/workspaces` |
| One workspace | `#/w/<id>/overview` · `/members` · `/activity` · `/roles` · `/billing` · `/settings` |
| Finance | `#/master/finance` → Dashboard · Subscriptions · Payments · Reports |
| Platform activity | `#/master/activity` |
| Settings | `#/master/settings` |

### 1.3 Business world (inside `/app.html`)
| Page | Route | Who |
|---|---|---|
| Dashboard | `#/` | Everyone, two versions |
| My tasks | `#/my-tasks` | Everyone |
| Tasks | `#/tasks` | Admin, Manager |
| Leads | `#/leads` | By permission |
| Clients | `#/clients` | By permission |
| Projects | `#/projects` | By permission |
| Project workspace | `#/project/<id>` | Members of that project |
| Finance | `#/finance` | By permission |
| Team | `#/team` | Admin, Manager |
| Work tracking | `#/tracking` | Admin, Manager |
| Login history | `#/logins` | Admin, Manager |
| Activity logs | `#/logs` | Admin, Manager |
| Permissions | `#/permissions` | Admin only |
| Settings | `#/settings` | Admin only |
| Billing | `#/billing` | **Admin only** |
| Role tab | `#/role/<key>` | Whoever holds that role |
| My activity | `#/my-activity` | Everyone, own records |
| Profile | `#/profile` | Everyone |

Unknown or forbidden route → the user's home with a toast, never a blank page.

---

## 2. Boot flow

```
/app.html
  └─ GET /api/config  →  create Supabase client
     └─ session?  no  →  the login page they came from (business by default)
        yes
        └─ load profile
           ├─ no profile            →  sign out, "Ask your admin to add you"
           ├─ status inactive       →  sign out, "Your account is not active"
           ├─ is_master = true      →  MASTER WORLD   (master.css, Master sidebar)
           └─ member of a workspace →  load workspace + settings + roles + permissions
                ├─ archived                →  sign out, "This workspace is closed"
                ├─ suspended, not Admin    →  sign out, "This workspace is suspended. Please ask your admin"
                ├─ suspended, is Admin     →  BILLING-ONLY SHELL
                └─ active                  →  BUSINESS WORLD
```

After the shell paints: start presence, the timer pill and the bell, then run the sweep. The sweep never blocks first paint.

---

## 3. Sign-in flows

### 3.1 Business sign-in — how the page learns the business

```
/login.html?w=webnoxos        →  slug in the URL            →  show that business
/login.html  (device signed in before)
                                   →  localStorage last workspace →  show that business
/login.html  (fresh device, no slug)
                                   →  two-step: email → Continue
                                   →  POST /api/public/workspace-brand
                                        found  →  show name + logo above the password field
                                        not    →  stay on the Webnox OS brand, no error
```

The page then shows **"Sign in to Webnoxos"** with that logo, the email and password fields on the right, the animated panel on the left, the **Forgot password?** link, and the tracking notice under the form. No sign-up, no workspace creation, no mention of a Master.

On success the slug is written to `localStorage.webnox_last_workspace` so the next visit is branded straight away. A **Not your business?** link clears it.

### 3.2 Master sign-in
Typing `/master-login` is the only way to reach it. Full-screen blue gradient with the animated background, a single glass card, email and password, no "forgot password" (the Master resets his own password in Supabase), no branding of any business.

### 3.3 Cross-login refusals
A member who signs in at `/master-login`, and the Master who signs in at `/login.html`, both get the same neutral sentence: **"These details don't work here."** Nothing hints that another login page exists.

### 3.4 Set password
Invite or reset link → `set-password.html` → it first signs out any local session → shows **Continue** → on click `verifyOtp({ token_hash, type })` → new password twice (min 8) → `updateUser` → the app.

**Why the Continue button:** WhatsApp and email scanners open links to build previews; the one-time token is only spent when a human clicks. An expired or used link shows *"This link has expired or was already used. Ask your admin for a new link."* with a **Go to sign in** button that carries the workspace slug.

### 3.5 Forgot password
The link shows: *"Ask your admin for a new password link. They can send it to you on WhatsApp."* No email is sent. The Admin uses **Regenerate link** on that member's row.

---

## 4. Master flows

### 4.1 First sign-in
The Master account is created by hand in Supabase Auth and promoted once in the SQL editor. On first sign-in the workspace list is empty, with one button: **Create workspace**. (This button lives inside the Master panel only — never on a login page.)

### 4.2 Create a workspace — five steps, one screen

**Step 1 · Business details**
Name · slug (auto from the name, editable, unique — this is what `?w=` carries) · short code (2–4 letters, used in IDs) · logo upload · country · app currency · timezone · mark idle after (minutes, default 5).

**Step 2 · Space type and plan**
- Space type: **Master project** (no rent, never expires) or **Rented business**.
- If rented, one plan dropdown: Trial 7 days · Trial 14 days · Monthly · Quarterly · Yearly.
- Rent amount + currency.
- If a trial: the cycle and amount that begin the day the trial ends.
- Start date · grace days (default 7) · optional member limit.
- A live preview line: *"Trial ends 25 Oct 2026, then Monthly, first payment due 25 Oct 2026."*

**Step 3 · Roles to activate**
Admin and Manager are ticked and disabled. Tick any of: Sales Representative, Lead Generation, Cold Caller, Finance, Project Manager. Unticked roles will not exist in that workspace at all.

**Step 4 · Admin and Manager**
Admin: first and last name, email, phone, designation, joining date. Manager: the same. Both mandatory. Emails must not exist anywhere on the platform.

**Step 5 · Review and create**
A summary card. **Create workspace** runs one transaction: workspace, settings, role activations, default permissions, counters, subscription, the two auth users, their profiles and roles.

**Result modal:** both invite links — each already carrying `?w=<slug>` — with **Copy** and **Share on WhatsApp**, and a note that only the newest link works.

### 4.3 The workspace list
Each row: name + short code, space type, member count, active now, plan and cycle, next due, **days left** (or "overdue by N days"), status chip, and a menu — Open · Notify admin · Record payment · Suspend / Resume · Archive.

Filters: All · Active · Trial · Due soon · Overdue · Suspended · Internal. Search by name, slug or code.

### 4.4 Opening a workspace (read-only)

`#/w/<id>/overview`, with a persistent bar: **"Viewing Webnoxos as Master — read only"** and an **Exit** button.

| Tab | Shows |
|---|---|
| Overview | Members, active now, plan, next due, days left, created, last activity |
| Members | Name, designation, roles, status, presence, joined. **No emails, no phones, no salaries** |
| Activity | That workspace's activity log and login history, filterable, CSV |
| Roles | The role switches, with a confirm before turning one off |
| Billing | Plan, payments, invoices, Record payment, Change plan |
| Settings | Name, slug, logo, timezone, member limit, space type, **Full access**, Archive |

Turning **Full access** on asks: *"The Admin of this workspace will be notified and this will appear in their activity log."* On confirm it writes `master_access_log`, writes a line in that workspace's `activity_logs`, and notifies the Admin. The banner turns amber and reads **"Full access on — the Admin has been notified."** Salaries stay hidden regardless.

### 4.5 Record a rent payment
Amount · currency with a live rate · paid on · bank reference · period covered (pre-filled) · note · attachment.
On save: stored, `next_due` advances one cycle, status back to Active, a suspended workspace unlocks immediately, both bells ring.

### 4.6 Notify admin
Title · message · recipients (Admin only, or Admin + Managers). Lands marked **From Webnox OS**. A **Copy for WhatsApp** button gives the plain text.

### 4.7 Suspend, resume, archive
- **Suspend** — manual, with a confirm.
- **Resume** — immediate; automatic on a recorded payment.
- **Archive** — a confirm spelling out that nobody can sign in and nothing is deleted. Reversible.

---

## 5. Workspace onboarding

### 5.1 Admin's first run
Invite link → set password → signed in → dashboard with a setup checklist:
1. Fill Settings — company details, currency, timezone, idle minutes
2. Fill Invoice details — logo, address, bank, due days, pause days
3. Add your team
4. Review Permissions

It disappears when done and never blocks anything.

### 5.2 Invite a member
Team → **Add team member** → first and last name, email, phone, joining date, department, designation (dropdown + Other), roles (**only the roles this workspace has**) → Save → modal with the invite link carrying `?w=<slug>`, **Copy** and **Share on WhatsApp**.

### 5.3 Member joins
Link → their own branded login or straight to set-password → Continue → password → dashboard. Presence starts, the bell starts, their role tabs appear.

---

## 6. Daily work flows

### 6.1 Task with a timer
My tasks → open a task → **Start timer** (a `todo` task moves to `in_progress`). The top-bar pill follows them across pages. Starting another task pauses the first. **Stop** → **Submit for review** → the manager or PM is notified → **Approve**, or **Request changes** with a note.

Nobody in the app for 20 minutes → the timer auto-pauses at the last heartbeat. Sign-out or deactivation pauses it immediately.

### 6.2 Lead to client to project
```
Lead Generation adds a lead  (form / CSV / public link)
   → Admin + Managers notified; unassigned leads also notify the Sales team
   → Sales Rep: "Not assigned yet" → Take it   (or a Manager assigns)
   → Contacted → Qualified → Meeting → Proposal → Negotiation
   → Won  → Managers notified
   → Convert to client (confirm) → client created with BUID and invoice code
   → "Create a project now?" → project form with a Project Manager
```

### 6.3 Project team approval
Pick a **designation first**, then a person who holds it.

| Who adds | Who approves |
|---|---|
| Admin or Manager | The project's PM |
| PM | Admin or any Manager, first wins |
| No PM yet, or a Manager is the PM | Added directly |

Rows are never deleted: `pending → approved / rejected / cancelled`, `approved → removed`, with who, when and the note.

### 6.4 Invoice
Finance → Client invoices → **New client invoice** → pick the client by name or BUID → editor (auto number preview, reference on save, issued by) → bill-to with a warning when there is no address → optional project → dates and billing period → currency and rate → line items, discount, tax → **Preview** → **Create invoice** → viewer with **Print / save PDF**, Mark paid, Edit, Delete.

---

## 7. The rent lifecycle, day by day

```
Day 0    Master creates the workspace, chooses Trial 14 days
         → Admin and Manager invited
Day 1-14 Every day: "Trial ends in N days" → Master and Admin
Day 14   Trial ends → the chosen cycle starts → next due set
Cycle-3  "Your month ends in 3 days"  → Master and Admin
Cycle-2  "…in 2 days"
Cycle-1  "…in 1 day"
Due day  "Rent due today" → banner in the workspace for the Admin
+1…+7    "Overdue by N days, suspension in N days" → every day, both bells
+8       Status → Suspended
         Members: cannot sign in
         Admin: signs in, sees the Billing page only
Payment  Master records the bank transfer
         → next due advances one cycle, status → Active, workspace unlocked
         → both notified: "Payment received, next due on <date>"
```

A **Master project** space never enters this loop.

### 7.1 A suspended workspace
- A member signing in is signed out with: *"This workspace is suspended. Please ask your admin."*
- The Admin signs in to one centred page: **Billing** — plan, amount owed, the Master's bank details with copy buttons, rent invoices with Download PDF, payment history, and the line *"Access returns as soon as your payment is recorded."*
- Nothing is deleted, hidden or rewritten. No timer or session is lost.

---

## 8. Notification flows

Created **only by database triggers**. The actor is never notified. Inactive users are never notified. The bell polls every 30 seconds.

| Event | Who hears |
|---|---|
| Task assigned, submitted, approved, changes requested | The other party |
| New lead | Admin + Managers; unassigned also the Sales team |
| Lead won | Managers |
| Project assigned, team request, decision | PM, Admin, Managers, the member |
| File added | Admin + Managers |
| Expense, investment, invoice | Admin + Managers + Finance, salaries excluded |
| Bill coming up, due, overdue, charged | Admin + Managers + Finance; salaries to Admin + Managers only |
| Monthly finance report ready, on the 1st | Admin + Managers |
| **Rent: trial countdown, last 3 days, due, overdue, suspended, payment received** | **Master and the workspace Admin** |
| **Message from the Master** | Admin, or Admin + Managers |
| **Master turned full access on** | Admin |

---

## 9. Edge cases Codex must handle

| Case | Behaviour |
|---|---|
| Email already exists on the platform | Workspace creation fails with a clear message; nothing is half-created |
| Slug or short code taken | Suggest the next free one; the field stays editable |
| A role is switched off while a member holds it | The row stays, the tab and pages disappear; the Master is warned before confirming |
| The Admin is deactivated | Refused. A workspace must always have one active Admin; transfer the role first |
| Member limit crossed | A warning to the Master only; nothing is blocked |
| The app is opened many times in a day | Sweeps are idempotent; no notice is written twice for the same day |
| Due date on the 31st of a short month | `advance_due()` clamps to the last day of the month |
| Trial ends while nobody opens the app | The next sweep works from dates and lands on the correct status |
| Clock or timezone differences | Dates are computed in the workspace timezone from server time; the browser clock is never used |
| Public lead form of a suspended workspace | "This form is not available"; nothing is written |
| The Master opens a workspace read-only | Every write control is absent, not merely disabled |
| `workspace-brand` called with a random email | Returns `{}` with the same timing and status as a real one |
| Someone guesses `/master-login` | They see the page but cannot sign in without the Master's credentials, and no other page links to it |
| A member bookmarks `?w=` of a workspace they left | The brand shows, the sign-in fails with the normal message |
