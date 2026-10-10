# Webnox OS — documentation set

**Product:** Webnox OS · **Owner and Master:** Haseeb Gul (haseebg0012@gmail.com)
**Version:** 2.0 · **Date:** 11 October 2026 · **Repo:** `Webnox-OS`

---

**For Codex:** this folder is the complete brief for building Webnox OS. Read every file before writing code. Build in the phases of `06-Implementation-Plan.md` and stop after each phase for the owner's review. The one-page brief to start from is `07-Codex-Prompt.md`.

**Owner ki baat (Hinglish):** Ye poora folder Codex ko do. Isme product, technical, flow, design, database, build plan aur ek ready prompt — sab alag-alag files mein hai. Codex ko kaho: *"Read all documents first. Build phase by phase from the implementation plan. After every phase run the checks, give me the git steps, and stop."*

---

## 1. What Webnox OS is

**Webnox OS is a complete multi-tenant SaaS.** One Master (the platform owner) creates a workspace for each business, rents it to them, and watches the platform. Each business gets its own sealed system: team, tasks and timers, leads, clients, projects, finance, invoices and notifications.

**EcomHub OS was only a prototype** — one business, no tenancy, no billing. It proved the modules work. Webnox OS is the real product. Where the EcomHub OS Rebuild Spec is referenced in these files, it is referenced **only** as a description of how a module behaves inside a workspace, never as the architecture.

Webnoxos becomes one tenant inside Webnox OS, created through the normal flow, with no special case in the code.

---

## 2. Reading order

| # | File | What it answers |
|---|---|---|
| 0 | `00-README.md` | This file — what the product is and how the set fits together |
| 1 | `01-PRD.md` | Product: who uses it, every feature, every rule |
| 2 | `02-TRD.md` | Technical: stack, architecture, APIs, security, testing, deployment |
| 3 | `03-AppFlow.md` | Every route and every end-to-end flow, screen by screen |
| 4 | `04-UIUX-Design-Brief.md` | Two themes, login screens, animation, components, responsiveness |
| 5 | `05-Backend-Schema.md` | Tables, columns, enums, RLS, triggers, RPCs, storage |
| 6 | `06-Implementation-Plan.md` | Phase-by-phase build order with done-when checks |
| 7 | `07-Codex-Prompt.md` | The prompt to paste into Codex |

**Precedence:** `05-Backend-Schema.md` wins on database questions, `01-PRD.md` wins on product questions, `04-UIUX-Design-Brief.md` wins on anything visual. This set wins over any older document.

---

## 3. The product in eight lines

1. **Webnox OS** is a multi-tenant SaaS. One codebase, one database, many businesses.
2. A **Master** — Haseeb Gul — creates a workspace for each business and rents it to them.
3. Each workspace is sealed: its own team, leads, clients, projects, money and brand.
4. Every workspace has exactly **one Admin** and **at least one Manager**, both created by the Master. Other roles exist only if the Master switches them on.
5. Rent runs on a trial, monthly, quarterly or yearly cycle, paid by bank transfer and recorded by hand. Unpaid rent suspends sign-in; it never deletes data.
6. The Master also keeps **project spaces of his own** that pay nothing and never expire.
7. **The Master login is hidden at `/master-login`.** Nobody else ever sees it.
8. A business member's login page shows **their own business name and logo**, on a white theme, with an animated panel explaining Webnox OS. The Master's login is blue and gradient. There is no sign-up anywhere.

---

## 4. Non-negotiables

- **Isolation:** no user, query, RPC or storage path may ever reach another workspace's rows. Enforced in Postgres RLS, never in the browser.
- **Stack:** plain HTML + CSS + vanilla JS ES modules, one Express file, Supabase, Vercel. No React, no bundler, no build step.
- **Fully responsive:** every page is designed and tested at **390, 768, 1024 and 1440**. No page scrolls sideways at any width.
- **No sign-up:** only the Master creates workspaces, only the Master and the Admin create accounts.
- **No hard deletes:** members, sessions, time entries, logs, project requests and workspaces are deactivated or archived, never removed.
- **Server is the source of truth:** timestamps, durations, totals, invoice numbers, workspace ids and permissions are set by the database, never sent by the browser.
- **Secret key is server-only.** It never appears in `public/`.

---

## 5. Handover routine after every phase

```
npm test
node --check <changed js files>
# open every page headless at 390, 768, 1024 and 1440
```

Then update `AGENTS.md` and give the owner exactly this, in Hinglish:

1. Supabase → SQL Editor → poora `supabase/schema.sql` paste karke **Run** *(sirf tab jab schema badla ho; dobara chalana safe hai)*.
2. Phir terminal mein:

```
git add .
git commit -m "<short message>"
git push
```

Vercel khud deploy karega. Naya deployment na aaye to `git commit --allow-empty -m "Trigger deploy"` push karo. Purana deployment kabhi **Redeploy** mat karna.

Then **stop and wait for review.**

---

*Owner: Haseeb Gul, Pakistan. Talk to him in Hinglish, short sentences, one clear recommendation.*
