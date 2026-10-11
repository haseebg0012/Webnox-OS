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
- M0–M2 foundation and isolation are implemented. M3–M6 account/workspace flows are implemented and undergoing live verification. M7–M21 business modules remain in progress; never describe the whole system as complete yet.
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

M0 is live on webnoxos.vercel.app. Vercel plugin still returns 403 for the correct team; authorized dashboard access and GitHub deployment work. SITE_URL was added for Production and Preview. Supabase public signup is disabled, production Site URL and set-password redirect are configured, and the current schema is installed with RLS. OTP expiry remains to be verified.

Current checks: 15 database/API checks, 16 public route checks, 24 authenticated responsive route checks at 390/768/1024/1440. Browser fixtures exist only in tests, never in production. Temporary test reports/screenshots are ignored in tmp/.

Owner Master email: haseebg0012@gmail.com. First workspace Admin: Webnox Hub, webnoxhub@gmail.com. Manager: Haseeb, itshaseebgul@gmail.com. Provision these real accounts only; no production demo accounts. Passwords are chosen by recipients via private local setup links; do not expose tokens in logs.
