# Owner decisions and implementation notes

Updated 11 October 2026 from the owner's instructions in this chat.

## Confirmed overrides

- Platform name: **Webnox OS**, replacing Webnex OS / Webnex Hub OS in the source briefs.
- Actual repository: **haseebg0012/Webnox-OS** on GitHub. This overrides proposed repo names in earlier specs.
- Owner and Master: **Haseeb Gul**, unchanged.
- Confirmed first-business Admin: **Webnox Hub — webnoxhub@gmail.com**.
- Confirmed first-business Manager: **Haseeb — itshaseebgul@gmail.com**.
- First business workspace: **Webnoxos**, an agency for ecommerce, business growth and web development. It replaces Ecometrix Hub as the first tenant and uses ordinary workspace creation.
- First workspace was created as an internal Master project, without rent, using ordinary business permissions. This implementation choice was disclosed during setup.
- Country: **Pakistan**, explicitly confirmed by the owner. Keep it unchanged.
- The owner approved starting work after providing the GitHub repo. Subsequently he requested the full operational system by morning, without needing to make changes himself. This supersedes per-phase review pauses: continue through phases, retaining the checks, and request input only when essential external access is missing.
- Use the Vercel plugin for deployment testing. The user provided the local `.env` path; never disclose its contents.

The copied documentation has product/business names and repo references normalized. Originals remain unchanged in the ignored `Files/` folder.

## Questions before their dependent phases

1. **First payment after a trial:** PRD / creation preview say due when the trial ends; schema `master_sweep()` advances by one cycle from trial end. Confirm billing intent before implementing the cycle.
2. **Member creation:** PRD says accounts are created by the Master and workspace Admin only; TRD member API guards also allow Managers. PRD is the default product authority; resolve the API contract before M6.
3. **Manual suspension/resume:** flows provide manual controls while billing states are derived by a sweep. Define how manual status persists across the next sweep before M20.
4. **Notifications:** the actor is never notified, but a payment recorded by the Master is also described as notifying both the Master and Admin. Resolve that event before M18.
5. **Atomic workspace creation:** Supabase Auth user creation via its Admin API is not part of a normal application SQL transaction. M4 needs an idempotent provisioning/compensation design so failures never activate a half-created workspace.
6. **References not yet supplied:** exact original A4 invoice template and some prototype enum/module definitions are referenced but absent from the current inputs. Do not claim exact template parity without the source.

Implementation decisions: first payment is due at trial end (PRD); only Admin creates workspace members (PRD); manual suspension is stored separately; notification actor-skip is authoritative. Auth creation uses compensating cleanup only for identities proven unprovisioned, and workspace rows activate in one SQL transaction. Exact invoice-reference parity remains unverifiable until the reference is supplied.

## Practical interpretation

- The ban on links to the platform login means user-facing navigation links. Its required rewrite, robots exclusion, HTTP handler and security tests must reference that path.
- Auth, workspace and M7–M20 business modules are now implemented. Full schema migration succeeded on 11 October 2026; production release a7733bc is Ready and verified. Owner password setup and real Master dashboard/finance are verified. Email OTP expiry is 86400 seconds, explicitly approved by owner. Current local verification: 28 database/API checks, 20 public responsive checks, 200 authenticated responsive page/tab checks and a real database-backed browser workflow.
- Invoice A4 follows written requirements; exact visual reference remains absent. Business bank/address/logo details are left for the real values, never invented.

## Master control center update — 12 October 2026

Owner supplied screenshots and a React reference. The implementation stays plain HTML/CSS/ES modules: indigo Master navigation, profile and private avatar crop upload, complete business details, business-role catalog, reusable task templates, platform team permissions and activity. Existing finance remains available.

Password updates use Supabase Auth with current-password verification. The reference's plaintext localStorage password fallback is intentionally not used; connection failures report an error and allow retry. JWT is described as signed authentication, not encryption. Email status is read from Auth; confirmed accounts do not resend unnecessary verification mail.

Only the Platform Owner can delegate platform access. Staff permissions are checked by the database and API; tenant financial data and full-access controls remain owner-only. Catalog work profiles supply designations, not authorization roles. Records are archived/deactivated rather than deleted.

Deployment prerequisite: apply `supabase/migrations/20261012_master_control.sql` once in the existing Supabase project. The full `supabase/schema.sql` includes this migration for repeatable installs. Owner applied this migration successfully on 12 October after dashboard automation failed to initialize. Live profile/workspace columns, catalog tables and private avatar storage were independently verified.
