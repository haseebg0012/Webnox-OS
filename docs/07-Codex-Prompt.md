# The prompt for Codex

Paste everything below the line into Codex, with the `docs/` folder attached or present in the repo.

---

You are building **Webnox OS** from scratch, in a fresh repo called `Webnox-OS`.

Read the whole `docs/` folder first — `00-README.md`, `01-PRD.md`, `02-TRD.md`, `03-AppFlow.md`, `04-UIUX-Design-Brief.md`, `05-Backend-Schema.md`, `06-Implementation-Plan.md` — before writing a line of code. Then build phase by phase from `06-Implementation-Plan.md`. **After every phase, run the checks, give me the git steps, and stop for my review.** Do not run ahead.

## What the product is

Webnox OS is a complete multi-tenant SaaS business operating system. One Master — the platform owner — creates a workspace for each business, rents it to them, and watches the platform. Each business gets its own sealed system: team and roles, tasks with timers and work tracking, leads and the sales pipeline, clients and projects, business finance with invoices, and in-app notifications.

An earlier app called **EcomHub OS was only a prototype**: one business, no tenancy, no billing. It proved the modules work. Do not build on it, do not copy its repo, and do not treat it as the architecture. Where the docs describe how a module behaves, that behaviour came from the prototype and is correct; the architecture is in these documents.

**Owner and Master:** Haseeb Gul, haseebg0012@gmail.com.

## The rules that cannot be broken

1. **Isolation.** Every business row carries a `workspace_id`. No user, query, RPC or storage path may ever reach another workspace's rows. Enforced in Postgres RLS, never in the browser. The isolation test is written in phase M2, before any feature, and never deleted.
2. **Stack.** Plain HTML + CSS + vanilla JavaScript ES modules in `public/`. One Express 5 file, `server.js`. Supabase for Postgres, Auth, RLS and Storage. Vercel. PGlite for tests. **No React, no Vue, no bundler, no build step, no CSS framework, no animation library.**
3. **Fully responsive.** Every page is designed and tested at **390, 768, 1024 and 1440**. No page scrolls sideways at any width.
4. **No sign-up anywhere.** Only the Master creates workspaces. Only the Master and a workspace Admin create accounts. No "create your workspace" button on any login page.
5. **No hard deletes.** Members, sessions, time entries, logs, project requests and workspaces are deactivated or archived, never removed.
6. **The server is the source of truth.** Timestamps, durations, totals, invoice numbers, workspace ids and permissions come from the database, never from the browser. The Supabase secret key is server-only and never appears in `public/`.

## The three things that define the look

**1. The Master login is hidden.** It lives at `/master-login` only, rewritten in `vercel.json` to `master-login.html`. No link to it exists anywhere in the product — not in a footer, a menu, a sitemap or an error message — and the page carries `noindex, nofollow`. A business member who signs in there, and the Master who signs in at the business login, both get the same neutral sentence: **"These details don't work here."** Nothing ever hints that a Master account exists.

**2. Two themes.** The Master world is **blue**: a deep blue-to-cyan gradient login with a slow animated background and a glass card, and a dashboard with gradient hero stat cards. A business workspace stays **white**, quiet and neutral, with its own brand. `master.css` is loaded only in the Master world. There are no gradients inside a business workspace.

**3. The business login carries the business.** White page, split layout. On the **left**, an animated panel built from inline SVG and CSS that shows why Webnox OS exists — four looping scenes: a team coming together, a task moving through its timer, a lead becoming a client, money becoming clear. On the **right**, the sign-in form. When the workspace is known — from the `?w=<slug>` in the invite link, from the last sign-in remembered on that device, or from the email the person types — **that business's own name and logo** appear above the form: *"Sign in to Webnoxos"*. With no workspace known, the page shows the Webnox OS brand and the same layout. The animation is CSS and SVG only, under 25 KB, pauses on a hidden tab, collapses to a compact header below 900px, and freezes under `prefers-reduced-motion`.

## How the money works

Each workspace is rented. At creation the Master picks one plan from a single dropdown: **Trial 7 days · Trial 14 days · Monthly · Quarterly · Yearly**, plus the rent amount and currency, the start date, 7 grace days and an optional member limit. A trial also carries the cycle and amount that begin the day it ends.

Reminders go to **both the Master and that workspace's Admin**: every day during a trial with the days left, and on each of the **last three days** of a paid cycle, then on the due date, then every day while overdue. After the grace period the workspace is **suspended**: members cannot sign in, the Admin can sign in but sees only a Billing page, and nothing is deleted. The Master records the bank transfer by hand — there is no payment gateway — and the due date advances by exactly one cycle, the status returns to Active and both sides are notified.

The Master also keeps **project spaces of his own** that pay nothing, never expire and are skipped by the billing engine entirely.

Reminders are idempotent: however many times the app is opened, the same notice is never sent twice for the same day.

## What the Master can and cannot see

The Master can create workspaces, switch each one's roles on or off, open a workspace read-only, see member counts and presence, see its activity log, message its Admin, charge rent, suspend, resume and archive.

By default he **cannot** see clients, leads, invoices, expenses, salaries or task contents. A per-workspace **Full access** switch exists for support; turning it on writes a line in that workspace's activity log, notifies its Admin and is recorded in the Master's access log. **Salaries stay invisible to the Master even with full access on.**

## Roles

Exactly one **Admin** and at least one **Manager** per workspace, both created by the Master. The other roles — Sales Representative, Lead Generation, Cold Caller, Finance, Project Manager — exist in a workspace only if the Master switched them on; an unticked role has no sidebar tab, no permissions row and no dropdown entry anywhere. Role names stay plain.

## After every phase

```
npm test
node --check <changed js files>
# open every page headless at 390, 768, 1024 and 1440
```

Update `AGENTS.md`. Then give me, in Hinglish:

- "Supabase → SQL Editor mein poora `supabase/schema.sql` paste karke Run karo" — only if the schema changed.
- `git add .` → `git commit -m "…"` → `git push`.

Then **stop and wait for my review.** Vercel deploys on its own.

## Before you start

Reply with one short message: which phase you are starting, and anything in the documents that contradicts itself, one line each. Nothing else — no restated plan, no summary. Then begin.
