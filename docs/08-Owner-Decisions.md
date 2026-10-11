# Owner decisions and implementation notes

Updated 11 October 2026 from the owner's instructions in this chat.

## Confirmed overrides

- Platform name: **Webnox OS**, replacing Webnex OS / Webnex Hub OS in the source briefs.
- Actual repository: **haseebg0012/Webnox-OS** on GitHub. This overrides proposed repo names in earlier specs.
- Owner and Master: **Haseeb Gul**, unchanged.
- Confirmed first-business Admin: **Webnox Hub — webnoxhub@gmail.com**.
- Confirmed first-business Manager: **Haseeb — itshaseebgul@gmail.com**.
- First business workspace: **Webnoxos**, an agency for ecommerce, business growth and web development. It replaces Ecometrix Hub as the first tenant and uses ordinary workspace creation.
- Whether the first workspace is an internal Master project or a rented workspace will be selected at creation; ownership of the agency does not silently change tenant privileges.
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
- M0 has only holding pages. The detailed themes and auth forms belong to later phases; do not imply those features are operational.
