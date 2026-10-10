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
- M0 provides server/deployment plumbing and temporary empty pages only. Authentication, the full UI and database tenancy are not implemented yet.
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
- Tests in `tests/db.test.mjs` currently cover M0 config exposure and HTTP boundaries. The PGlite schema and Test 0 isolation harness start in M2; do not describe M0 tests as database isolation coverage.
- Use the Vercel plugin for deployment checks when the correct project scope is authorized. Never change to an unrelated team to bypass a 403.
- Give concise Hinglish handover, test results, pending external settings, and git commands. Only ask the owner to run `supabase/schema.sql` when that file actually changed.

## Current phase status

M0 is in progress. Local source is prepared. Vercel project `webnoxos` was found, but the plugin returned 403 for team `haseebg0012-gmailcoms-projects`; no Vercel CLI credentials are configured. Live deployment, SITE_URL and Supabase Auth URL settings remain to be verified.
