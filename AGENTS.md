# Webnox OS — working instructions

## Owner decisions

- Product: **Webnox OS**. Owner and platform Master: Haseeb Gul.
- Repository: https://github.com/haseebg0012/Webnox-OS.git (branch `main`).
- First business: **Webnoxos**, an ecommerce, business growth and web development agency. Create it through the normal workspace flow; never hard-code tenant privileges.
- The original EcomHub OS is a prototype reference only. Build this repository fresh.
- User instructions override the docs. For domain details, `docs/01-PRD.md` governs product, `docs/05-Backend-Schema.md` governs database and `docs/04-UIUX-Design-Brief.md` governs visual design. See `docs/08-Owner-Decisions.md` for changes and open questions.

## Build scope

- Follow `docs/06-Implementation-Plan.md`, M0 through M21, with checks at each milestone. **Latest owner instruction overrides the per-phase pause:** continue autonomously toward a complete operational system; do not stop for routine phase review. Pause only for essential account actions or decisions that cannot be safely inferred.
- Plain HTML/CSS/JavaScript ES modules, Express 5 in `server.js`, Supabase, Vercel and PGlite. No React, bundler, CSS framework or animation library.
- M0–M20 modules are implemented. M21 hardening includes database-backed browser workflows and responsive tests; production verification and the external items below still gate a complete handover.
- Node 24 is the selected supported runtime. Dependencies are pinned in `package.json` and `package-lock.json`; use `npm ci` for repeatable installs.

## Security and data

- `public/` is the only static directory. Never expose `.env`, `Files/`, docs, tests or server source.
- Ignore `.env` and `.env.*` except `.env.example`. Never print credentials, include them in a commit, or upload them in a deployment source bundle.
- `/api/config` returns exactly `supabaseUrl` and `supabasePublishableKey`; the server key must never reach a browser.
- Build database isolation first in M2. Every domain feature from M6 adds a cross-workspace isolation check. No live seed/demo users.
- No public registration. No user-facing links to the platform login route. Its deliberate server rewrite, robots rules and tests may refer to the path; these are not navigation links.
- Master access is read-only, logged and limited by default. Full access never includes salaries. Finance sees salary totals only.
- Backend authorization, timestamps, identifiers and totals are authoritative. Archiving/deactivation preserves history.

## Verification and handover

- Run `npm test` and `npm run check`.
- Open every current page at 390, 768, 1024 and 1440; check errors and horizontal page overflow.
- `tests/db.test.mjs` includes HTTP boundaries plus `tests/database.mjs`: PGlite runs the schema twice, then Test 0 cross-workspace isolation, role restrictions, account invariants, suspension and atomic workspace provisioning.
- Use the Vercel plugin for deployment checks when the correct project scope is authorized. Never change to an unrelated team to bypass a 403.
- Give concise Hinglish handover, test results, pending external settings, and git commands. Only ask the owner to run `supabase/schema.sql` when that file actually changed.

## Current phase status

The business-module release a7733bc is live on webnoxos.vercel.app (Vercel Ready). Live source/config/branding/private-path checks and 20 production public-page checks passed. The owner completed password setup and the real Master dashboard/finance loaded successfully. The complete schema through platform billing was installed successfully on 11 October 2026, with RLS. Vercel plugin returns 403 for the correct team; authorized dashboard access and GitHub deployment work. SITE_URL is configured for Production and Preview. Supabase public signup is disabled; production Site URL and set-password redirect are configured. Email OTP expiry is verified at 86400 seconds after explicit owner approval.

Current checks: 30 database/API checks, 20 public route checks, 220 authenticated responsive page/tab checks at 390/768/1024/1440. `tests/integration-browser.mjs` runs real UI → local HTTP → PGlite RPC/RLS → UI flows for lead conversion, projects, task timers/review, invoices, expenses and bills. Browser fixtures exist only in tests, never in production. Temporary reports/screenshots/print PDFs are ignored in tmp/.

Outstanding external details: recipients choose their own passwords; the original invoice A4 reference and actual bank/address/logo details were not supplied. The implemented printable A4 follows the written specification, with no claim of exact visual parity. Never invent bank details or enter a user's password. FX uses daily reference rates with manual override and visible attribution. Client/finance uploads track incomplete/failed uploads; only completed uploads show download links.

Owner Master email: haseebg0012@gmail.com. First workspace Admin: Webnox Hub, webnoxhub@gmail.com. Manager: Haseeb, itshaseebgul@gmail.com. Provision these real accounts only; no production demo accounts. Passwords are chosen by recipients via private local setup links; do not expose tokens in logs.

## Master control center release

The 12 October Master redesign and operational profile/catalog/platform-team forms are implemented and tested. Additive migration: `supabase/migrations/20261012_master_control.sql` (also included in full schema). Standalone migration tested twice against be8f4f1 schema with existing owner preserved. Owner applied the migration successfully on 12 October; live columns, 8 catalog roles and the private avatar bucket are independently verified. Release checks: 30 database/API checks and local database-backed Master/business workflows passed. Never implement the reference's plaintext password localStorage fallback. Platform delegation is owner-only; scoped platform staff never inherit `is_master()` owner permissions.
