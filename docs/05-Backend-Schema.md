# Webnox OS — Backend Schema

**Product:** Webnox OS · **Owner and Master:** Haseeb Gul (haseebg0012@gmail.com)
**Version:** 2.0 · **Date:** 11 October 2026

The database contract. This file wins over every other document on database questions.

---

## 1. Conventions

`supabase/schema.sql` is **one idempotent file** the owner pastes into the Supabase SQL Editor and runs. It is safe to re-run. Build it in numbered **PARTS**; each new feature is a new part at the bottom.

- New tables: `create table if not exists`
- New columns: `alter table … add column if not exists`
- Functions: `create or replace`
- Policies: `drop policy if exists` then `create policy`
- Enums: `do $$ begin … exception when duplicate_object then null; end $$;`
- One-time data moves are guarded and run with notify triggers disabled
- The file ends with: `-- Done. Next: create your Master user (see README, step 2).`

**Part map**

| Part | Contents |
|---|---|
| 1 | Tenancy core: `workspaces`, `workspace_roles`, profile columns, helpers, the RLS pattern |
| 2 | Accounts: `profiles`, `member_roles`, `team_roles`, `app_settings`, `activity_logs` |
| 3 | Tasks, comments, time entries |
| 4 | Sessions, activity intervals, reports |
| 5 | Permissions |
| 6 | Leads |
| 7 | Clients, client files, BUID and invoice codes |
| 8 | Projects, project members, requirements |
| 9 | Notifications |
| 10 | Workspace finance: expenses, recurring, investments, currencies |
| 11 | Invoices and counters, invoice template fields |
| 12 | Finance attachments |
| 13 | **Master billing: `subscriptions`, `subscription_payments`, `master_access_log`, `billing_log`, `master_sweep()`** |

---

## 2. Enums

```sql
create type workspace_type   as enum ('master_project', 'rented');
create type workspace_status as enum ('setup', 'trial', 'active', 'suspended', 'archived');
create type billing_cycle    as enum ('trial_7', 'trial_14', 'monthly', 'quarterly', 'yearly');
create type billing_status   as enum ('trial', 'active', 'due_soon', 'due_today', 'overdue', 'suspended', 'cancelled');
create type payment_method   as enum ('bank_transfer', 'other');
```

Enums carried over from the prototype are unchanged: task status and priority, lead stage, client status, project status, project member status, expense category, recurrence frequency, investment kind, invoice kind and status, session end reason.

---

## 3. New tables

### 3.1 `workspaces`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `name` | text not null | Business name, shown on its login page |
| `slug` | text not null unique | lowercase, hyphenated — this is what `?w=` carries |
| `short_code` | text not null unique | 2–4 letters, uppercase, used in IDs |
| `type` | workspace_type not null | default `'rented'` |
| `status` | workspace_status not null | default `'setup'` |
| `logo_url` | text | shown on its login page and in its sidebar |
| `country` | text | |
| `created_by` | uuid | the Master |
| `created_at` | timestamptz not null | `now()` |
| `archived_at` | timestamptz | set on archive, never deleted |
| `full_access` | boolean not null | default false — the Master's data access |
| `full_access_at` | timestamptz | |
| `public_form_token` | text unique | used by `/lead-form.html?w=…` |

`slug` and `short_code` are separate on purpose: the slug is public and readable, the short code is for IDs.

### 3.2 `workspace_roles`

| Column | Type | Notes |
|---|---|---|
| `workspace_id` | uuid not null | fk `workspaces` |
| `role_key` | text not null | `sales_rep`, `lead_gen`, `cold_caller`, `finance`, `project_manager` |
| `active` | boolean not null | default true |
| pk | `(workspace_id, role_key)` | |

`admin` and `manager` are **not** rows here. They always exist.

### 3.3 `subscriptions` — one row per rented workspace

| Column | Type | Notes |
|---|---|---|
| `workspace_id` | uuid pk | fk `workspaces` |
| `plan_name` | text | free text |
| `cycle` | billing_cycle not null | chosen at creation |
| `next_cycle` | billing_cycle | the paid cycle a trial rolls into |
| `amount_original` | numeric(14,2) not null | rent as entered |
| `currency` | text not null | |
| `fx_rate` | numeric(14,6) not null | to PKR |
| `amount` | numeric(14,2) not null | converted, set by trigger |
| `start_date` | date not null | |
| `trial_ends_on` | date | only for a trial |
| `next_due` | date | null during a trial |
| `grace_days` | int not null | default 7 |
| `member_limit` | int | null = no limit, never blocks |
| `status` | billing_status not null | computed by the sweep |
| `suspended_at` · `cancelled_at` | timestamptz | |
| `notes` | text | |
| `created_at` · `updated_at` | timestamptz | |

A `master_project` workspace gets **no** row here.

### 3.4 `subscription_payments`

| Column | Type |
|---|---|
| `id` | uuid pk |
| `workspace_id` | uuid not null |
| `amount_original` | numeric(14,2) not null |
| `currency` | text not null |
| `fx_rate` | numeric(14,6) not null |
| `amount` | numeric(14,2) not null — converted by trigger |
| `paid_on` | date not null |
| `method` | payment_method not null, default `'bank_transfer'` |
| `reference` | text — bank reference |
| `period_from` · `period_to` | date |
| `invoice_number` | text — `INV-WX001`, from the Master counter |
| `attachments` | jsonb — `[{path, name, size, type}]`, validated by trigger |
| `note` | text |
| `recorded_by` | uuid not null — the Master |
| `created_at` | timestamptz |

### 3.5 `master_access_log`

| Column | Type |
|---|---|
| `id` | uuid pk |
| `workspace_id` | uuid not null |
| `action` | text — `opened`, `full_access_on`, `full_access_off`, `suspended`, `resumed`, `archived`, `plan_changed`, `role_changed` |
| `detail` | jsonb |
| `at` | timestamptz not null |

Append-only. Never updated, never deleted.

### 3.6 `billing_log` — the idempotency guard

| Column | Type |
|---|---|
| `workspace_id` | uuid not null |
| `kind` | text — `trial_countdown`, `due_soon`, `due_today`, `overdue`, `suspended`, `payment` |
| `for_date` | date not null |
| `at` | timestamptz not null |
| pk | `(workspace_id, kind, for_date)` |

The sweep inserts here with `on conflict do nothing` and sends a notification **only when the insert actually happened**. This is what makes reminders idempotent however many times the app is opened.

---

## 4. Changed tables

`workspace_id uuid not null references workspaces(id)` is added to each, with an index:

`profiles`, `member_roles`, `role_permissions`, `app_settings`, `tasks`, `task_comments`, `task_time_entries`, `user_sessions`, `activity_intervals`, `activity_logs`, `leads`, `clients`, `projects`, `project_members`, `project_requirements`, `invoices`, `invoice_counters`, `client_files`, `notifications`, `expenses`, `recurring_expenses`, `investments`, `finance_report_log`.

Special cases:

- **`profiles`** gains `workspace_id` (nullable — null only for the Master) and `is_master boolean not null default false`. One admin per workspace is enforced:
  ```sql
  create unique index if not exists one_admin_per_workspace
    on profiles (workspace_id) where account_type = 'admin' and status = 'active';
  ```
  Plus a check so a Master row can never carry a workspace:
  ```sql
  alter table profiles add constraint master_has_no_workspace
    check ( not is_master or workspace_id is null );
  ```
- **`app_settings`** stops being a single row. Primary key becomes `workspace_id`. It keeps company name, timezone, idle minutes, app currency and `invoice_details jsonb`.
- **`role_permissions`** keyed by `(workspace_id, role_key, module)`.
- **`invoice_counters`** keyed by `(workspace_id, kind, client_id)`. A Master-level row with `workspace_id is null` serves rent invoices (`INV-WX…`).
- **`notifications`** allows `workspace_id` null — those are the Master's own notices.

---

## 5. Helper functions

All security definer, stable where possible, with `execute` revoked from `public` and `anon`.

```sql
create or replace function current_workspace() returns uuid
language sql stable security definer as $$
  select workspace_id from public.profiles where id = auth.uid()
$$;

create or replace function is_master() returns boolean
language sql stable security definer as $$
  select coalesce((select is_master from public.profiles where id = auth.uid()), false)
$$;

create or replace function is_admin() returns boolean          -- admin OF THE CURRENT WORKSPACE
create or replace function is_manager() returns boolean        -- admin or manager role, same workspace
create or replace function is_manager_id(uuid) returns boolean
create or replace function workspace_has_role(text) returns boolean
create or replace function master_can_read(uuid) returns boolean   -- is_master() and full_access on
```

Every helper from the prototype is rewritten workspace-scoped: `perm(module, action)`, `pm_perm()`, `can_client()`, `can_invoice()`, `can_project()`, `can_manage_project()`, `client_via_project()`, `can_project_invoice()`, `can_money(category, action)`, `can_storage_file()`, `can_finance_file()`.

`perm()` returns false when the role is not active in this workspace, so switching a role off removes its access immediately without editing `role_permissions`.

---

## 6. RLS

RLS is **on** for every table, with no exception and no "temporarily off" during development.

### 6.1 The pattern

```sql
drop policy if exists tasks_read on tasks;
create policy tasks_read on tasks for select
  using ( workspace_id = current_workspace() and perm('tasks','view') );
```

Every policy on every scoped table carries `workspace_id = current_workspace()` as its **first** condition.

### 6.2 Master policies — separate and read-only

```sql
create policy workspaces_master on workspaces for select using ( is_master() );
create policy subs_master on subscriptions for all using ( is_master() ) with check ( is_master() );
create policy logs_master_read on activity_logs for select using ( is_master() );
create policy sessions_master_read on user_sessions for select using ( is_master() );
```

Business tables get a Master policy **only** gated on full access:

```sql
create policy clients_master_read on clients for select using ( master_can_read(workspace_id) );
```

The Master never has an insert, update or delete policy on a business table. Salary rows (`expenses.category = 'salary'`, `recurring_expenses.category = 'salary'`) get **no** Master policy at all, with or without full access.

### 6.3 Safe member view for the Master

```sql
create or replace view master_member_list as
  select workspace_id, id, name, job_title, department, status, last_seen_at
  from profiles where is_master = false;
```

No emails, no phone numbers, and the Master's own row is excluded.

### 6.4 Login brand lookup

`POST /api/public/workspace-brand` runs on the **server** with the secret key — it is not a browser query and has no RLS path. It returns `{name, logo_url, slug}` only when: the email has a profile, that profile is active and not the Master, and its workspace status is `trial` or `active`. Everything else returns `{}` with the same status code and comparable timing.

---

## 7. Triggers

| Trigger | Table(s) | Does |
|---|---|---|
| `set_workspace_id` | every scoped table, `before insert` | Sets `workspace_id` from `current_workspace()`; raises on a mismatch |
| `handle_new_user` | `auth.users`, `after insert` | Creates the `profiles` row |
| `money_before_write` | expenses, recurring, investments, invoices, subscriptions, subscription_payments | Converts with `fx_rate`, fills `amount` |
| `clients_codes_before` | clients | BUID and the 2-letter invoice code, **per workspace**, never changed |
| `invoices_details_before` | invoices | Number, reference, issued-by snapshot, totals; locks number, reference, issuer and kind |
| `project_link_before` | tasks, invoices, client_files | A row with a `project_id` always carries that project's `client_id` |
| `attachments_validate` | expenses, recurring_expenses, subscription_payments | Type, size and count |
| `*_notify` | tasks, leads, clients, projects, files, finance | Notifications. The actor is never notified; inactive users skipped |
| `workspace_seed_after` | workspaces, `after insert` | Creates `app_settings`, default `role_permissions`, counters, the public form token |
| `subscription_billing_notify` | subscriptions | Notifies on a status change made outside the sweep |
| `one_admin_guard` | profiles | Refuses to deactivate or demote the last active admin of a workspace |
| `slug_normalise` | workspaces | Lowercases and hyphenates the slug, strips anything but `a-z0-9-` |

---

## 8. RPCs

### 8.1 Carried over, now workspace-scoped
`promote_to_admin`, `admin_save_member`, `admin_set_member_status`, `team_directory`, `member_label`,
`session_start`, `session_heartbeat`, `session_end`, `sweep_stale_sessions`,
`timer_start`, `timer_pause`, `timer_stop`, `my_timer`,
`task_set_status`, `task_review`,
`team_presence`, `list_sessions`, `report_daily`, `report_tasks`, `day_timeline`,
`lead_mark_won`, `lead_convert`,
`project_member_request`, `project_member_decide`, `project_member_cancel`, `project_member_remove`,
`business_summary`, `finance_overview`, `finance_report`, `finance_sweep`, `recurring_mark_paid`, `recurring_skip`,
`invoice_next_number`.

### 8.2 New, Master only

```sql
promote_to_master(email text)
  -- run once by hand: select public.promote_to_master('haseebg0012@gmail.com');

master_create_workspace(payload jsonb) returns jsonb
  -- one transaction: workspace, settings, role activations, permissions,
  -- counters, subscription, admin profile, manager profile
  -- server.js creates the auth users and returns both invite links with ?w=<slug>

master_set_roles(workspace uuid, roles text[])
master_set_plan(workspace uuid, cycle billing_cycle, amount numeric, currency text,
                fx_rate numeric, next_cycle billing_cycle, start_date date, grace_days int)
master_set_status(workspace uuid, status workspace_status, reason text)
master_set_full_access(workspace uuid, on_off boolean)
   -- writes master_access_log, writes the workspace's activity_logs, notifies its Admin
master_notify_admin(workspace uuid, title text, body text, include_managers boolean)
record_rent_payment(workspace uuid, amount numeric, currency text, fx_rate numeric,
                    paid_on date, reference text, period_from date, period_to date,
                    note text, attachments jsonb) returns jsonb
master_overview() returns jsonb
master_workspace_stats(workspace uuid) returns jsonb
master_sweep()
```

### 8.3 `master_sweep()` — the billing engine

Idempotent. Called on the Master's app load and on each workspace Admin's app load. For every workspace where `type = 'rented'` and `status not in ('archived','cancelled')`:

```
1. trial and trial_ends_on <= today
      → cycle := next_cycle, next_due := advance_due(trial_ends_on, next_cycle)
2. status := compute from next_due, today, grace_days:
      trial       if trial_ends_on > today
      due_soon    if next_due - today between 1 and 3
      due_today   if next_due = today
      overdue     if 0 < today - next_due <= grace_days
      suspended   if today - next_due > grace_days
      active      otherwise
3. notify, each guarded by billing_log (workspace, kind, for_date = today):
      trial      → Master + Admin, EVERY day, "Trial ends in N days"
      due_soon   → Master + Admin, "Your <cycle word> ends in N days"
      due_today  → Master + Admin, "Rent due today"
      overdue    → Master + Admin, "Overdue by N days, suspension in N days"
      suspended  → Master + Admin, "Workspace suspended"
4. on reaching suspended, set workspaces.status = 'suspended' and suspended_at
```

`advance_due(from_date, cycle)` mirrors the JS `addFreq()` and clamps to the last day of a short month. A trial cycle never advances; it converts once.

A missed run is never lost: the sweep works from dates, so whenever it next runs it produces the correct status and sends only today's notice.

---

## 9. Storage

Two private buckets, workspace-first paths.

| Bucket | Path | Who can read |
|---|---|---|
| `client-files` | `w<workspace_id>/client/<client_id>/<file>` and `…/p<project_id>/<file>` | `can_storage_file()` within the workspace |
| `finance-files` | `w<workspace_id>/expense/<id>/<file>`, `…/bill/<id>/<file>`, `…/rent/<payment_id>/<file>` | `can_finance_file()`; salary files Admin and Managers only |

Both bucket policies check the first path segment against `current_workspace()`. Limits: client files 25 MB; finance and rent attachments PDF, PNG, JPG, WEBP, 10 MB each, up to 10 per row. Deleting a row deletes its files.

Workspace logos go in a **public** bucket `brand`, path `w<workspace_id>/logo.<ext>`, because the login page must show them before anyone signs in. Nothing but logos goes there, max 300 KB, PNG / JPG / WEBP / SVG.

---

## 10. Seeds and defaults

On `workspaces` insert the seed trigger writes:

- `app_settings` — company name from the workspace name, the chosen timezone and currency, idle minutes 5, empty `invoice_details`, due days 7, pause days 14
- `role_permissions` — the default matrix, for the activated roles only:

| Role | leads | clients | finance | projects |
|---|---|---|---|---|
| lead_gen | view, edit | — | — | — |
| sales_rep | view, edit | view | — | — |
| cold_caller | view, edit | — | — | — |
| finance | — | view | view, edit, delete | — |
| manager | all | all | all | all |
| project_manager | — | — | — | view, edit |

- `invoice_counters` starter rows
- `public_form_token` — a random, unguessable string

Departments and designations ship as the shared defaults from `team-config.js`; a workspace may add its own with "Other".

---

## 11. Test checklist for the schema

1. The whole file runs twice with no error.
2. Two seeded workspaces: a user of A reads zero rows of B from every table, RPC and storage path.
3. A `workspace_id` sent by the client with a wrong value is rejected.
4. A Master row cannot carry a `workspace_id`; a workspace cannot have two active admins.
5. The last active admin cannot be deactivated.
6. BUID, invoice codes and employee IDs restart per workspace and may repeat across workspaces.
7. A role switched off removes its access immediately through `perm()`, without editing `role_permissions`.
8. Salary rows are invisible to the Finance role **and** to the Master, full access on or off.
9. The Master without full access reads counts but no client, lead, invoice or expense row.
10. Turning full access on writes `master_access_log`, writes the workspace's `activity_logs`, and creates the Admin's notification.
11. `master_sweep()` run ten times in one day produces exactly one notification per kind.
12. A trial rolls into its paid cycle on the right day and sets the first `next_due`.
13. Reminders fire on day 3, 2 and 1, then due, then daily while overdue.
14. Beyond grace the status becomes suspended; members are blocked, the Admin reaches Billing only.
15. `record_rent_payment` advances `next_due` by exactly one cycle, un-suspends, and notifies both sides.
16. A `master_project` workspace has no subscription, no billing notice and no status change.
17. `advance_due` clamps 31 January + one month to 28 or 29 February.
18. The public lead form token writes into its own workspace only, and refuses when that workspace is suspended or archived.
19. `workspace-brand` returns `{}` for an unknown email, an inactive member, a suspended workspace and the Master, with the same status code each time.
20. `slug` is unique, lowercase and hyphenated after any insert or update.
