import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const A = "10000000-0000-0000-0000-000000000001",
  B = "10000000-0000-0000-0000-000000000002";
const adminA = "20000000-0000-0000-0000-000000000001",
  managerA = "20000000-0000-0000-0000-000000000002",
  memberA = "20000000-0000-0000-0000-000000000003";
const adminB = "20000000-0000-0000-0000-000000000004",
  managerB = "20000000-0000-0000-0000-000000000005",
  master = "20000000-0000-0000-0000-000000000006";
const db = new PGlite();
async function as(id, sql, params = []) {
  await db.exec(
    `reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated;`,
  );
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec("reset role;");
  }
}
async function owner(sql) {
  await db.exec(
    "reset role;select set_config('request.jwt.claim.sub','',false)",
  );
  return db.exec(sql);
}
test("database contract", async (t) => {
  try {
    await db.exec(
      `create schema auth;create role anon;create role authenticated;create role service_role bypassrls;create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb default '{}',raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon;grant select,insert,update,delete on storage.objects to authenticated,anon;`,
    );
    const schema = await readFile(
      new URL("../supabase/schema.sql", import.meta.url),
      "utf8",
    );
    await db.exec(schema);
    await db.exec(schema);
    await owner(
      `begin;insert into auth.users(id,email) values('${adminA}','admin-a@fixture.invalid'),('${managerA}','manager-a@fixture.invalid'),('${memberA}','member-a@fixture.invalid'),('${adminB}','admin-b@fixture.invalid'),('${managerB}','manager-b@fixture.invalid'),('${master}','master@fixture.invalid');insert into workspaces(id,name,slug,short_code,type) values('${A}','Workspace A','WORKSPACE A','WA','master_project'),('${B}','Workspace B','workspace-b','WB','master_project');insert into profiles(id,workspace_id,name,email,account_type,is_master) values('${adminA}','${A}','Admin A','admin-a@fixture.invalid','admin',false),('${managerA}','${A}','Manager A','manager-a@fixture.invalid','member',false),('${memberA}','${A}','Member A','member-a@fixture.invalid','member',false),('${adminB}','${B}','Admin B','admin-b@fixture.invalid','admin',false),('${managerB}','${B}','Manager B','manager-b@fixture.invalid','member',false),('${master}',null,'Master','master@fixture.invalid','master',true);insert into member_roles(workspace_id,user_id,role_key) values('${A}','${managerA}','manager'),('${B}','${managerB}','manager'),('${A}','${memberA}','sales_rep');update workspaces set status='active';insert into activity_logs(workspace_id,actor_id,action) values('${A}','${adminA}','fixture'),('${B}','${adminB}','fixture');insert into storage.objects(bucket_id,name) values('brand','w${A}/logo.png'),('brand','w${B}/logo.png');commit;`,
    );
    await t.test(
      "Test 0: A cannot read, mutate or call RPCs for B",
      async () => {
        for (const table of [
          "workspaces",
          "workspace_roles",
          "profiles",
          "member_roles",
          "app_settings",
          "role_permissions",
          "activity_logs",
        ]) {
          const key = table === "workspaces" ? "id" : "workspace_id";
          assert.equal(
            (await as(adminA, `select * from ${table} where ${key}=$1`, [B]))
              .length,
            0,
            table,
          );
        }
        const directory = (
          await as(adminA, "select team_directory() as result")
        )[0].result;
        assert.ok(
          directory.length === 3 &&
            directory.every((x) => x.workspace_id === A),
        );
        await assert.rejects(
          as(adminA, "select admin_set_member_status($1,$2)", [
            managerB,
            "inactive",
          ]),
          /not found|permitted/i,
        );
        await assert.rejects(
          as(adminA, "select admin_save_member($1,$2)", [
            managerB,
            { name: "Stolen" },
          ]),
          /not found|permitted/i,
        );
        assert.equal(
          (
            await as(adminA, "select can_brand_file($1) as allowed", [
              `w${B}/logo.png`,
            ])
          )[0].allowed,
          false,
        );
        await assert.rejects(
          as(
            adminA,
            "insert into storage.objects(bucket_id,name) values($1,$2)",
            ["brand", `w${B}/logo.webp`],
          ),
          /row-level security/,
        );
        assert.equal(
          (await as(adminA, "select current_workspace() as id"))[0].id,
          A,
        );
      },
    );
    await t.test(
      "workspace identity cannot be forged and every scoped table has RLS",
      async () => {
        await owner("grant insert on member_roles to authenticated");
        await assert.rejects(
          as(
            adminA,
            "insert into member_roles(workspace_id,user_id,role_key) values($1,$2,$3)",
            [B, adminB, "finance"],
          ),
          /workspace/i,
        );
        await owner("revoke insert on member_roles from authenticated");
        const tables = (
          await db.query(
            "select relname,relrowsecurity from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='public' and relkind='r'",
          )
        ).rows;
        assert.ok(tables.length >= 7);
        assert.ok(tables.every((t) => t.relrowsecurity));
        const policies = (
          await db.query(
            "select tablename,qual,with_check from pg_policies where schemaname='public'",
          )
        ).rows;
        assert.ok(
          policies.every((p) =>
            /current_workspace|is_master|master_can_read|own_profile|billing_workspace|platform_can/.test(
              `${p.qual} ${p.with_check}`,
            ),
          ),
        );
      },
    );
    await t.test(
      "master never becomes a member; admin and manager safeguards are enforced",
      async () => {
        await assert.rejects(
          owner(`update profiles set workspace_id='${A}' where id='${master}'`),
          /constraint|immutable/,
        );
        await assert.rejects(
          owner(
            `update profiles set account_type='admin' where id='${memberA}'`,
          ),
          /unique/,
        );
        await assert.rejects(
          as(adminA, "select admin_set_member_status($1,$2)", [
            adminA,
            "inactive",
          ]),
          /admin/i,
        );
        await assert.rejects(
          as(adminA, "select admin_set_member_status($1,$2)", [
            managerA,
            "inactive",
          ]),
          /manager/i,
        );
        assert.equal((await as(master, "select * from profiles")).length, 1);
        const safe = await as(master, "select * from master_member_list");
        assert.equal(safe.length, 5);
        assert.ok(safe.every((x) => !("email" in x) && !("phone" in x)));
      },
    );
    await t.test(
      "inactive roles remove permission immediately; employee IDs restart per business",
      async () => {
        assert.equal(
          (await as(memberA, "select perm('leads','edit') as yes"))[0].yes,
          true,
        );
        await owner(
          `update workspace_roles set active=false where workspace_id='${A}' and role_key='sales_rep'`,
        );
        assert.equal(
          (await as(memberA, "select perm('leads','edit') as yes"))[0].yes,
          false,
        );
        await owner(
          `update workspace_roles set active=true where workspace_id='${A}' and role_key='sales_rep'`,
        );
        const p = (
          await db.query(
            "select employee_id from profiles where id=any($1::uuid[]) order by id",
            [[adminA, adminB]],
          )
        ).rows;
        assert.equal(p[0].employee_id, "EMP-0001");
        assert.equal(p[1].employee_id, "EMP-0001");
      },
    );
    await t.test(
      "suspension and deactivation invalidate existing sessions at the database boundary",
      async () => {
        await owner(`update workspaces set status='suspended' where id='${A}'`);
        assert.equal(
          (await as(adminA, "select current_workspace() as id"))[0].id,
          null,
        );
        assert.equal(
          (await as(adminA, "select * from app_settings")).length,
          0,
        );
        assert.equal((await as(managerA, "select * from profiles")).length, 1);
        await assert.rejects(
          as(adminA, "select admin_save_member($1,$2)", [
            memberA,
            { name: "Denied" },
          ]),
          /permitted/,
        );
        await owner(`update workspaces set status='active' where id='${A}'`);
        await as(adminA, "select admin_set_member_status($1,$2)", [
          memberA,
          "inactive",
        ]);
        assert.equal(
          (await as(memberA, "select current_workspace() as id"))[0].id,
          null,
        );
        assert.equal(
          (await as(memberA, "select team_directory() as result"))[0].result
            .length,
          0,
        );
      },
    );
    await t.test(
      "workspace creation is atomic, complete and restricted to Master",
      async () => {
        const a = "30000000-0000-0000-0000-000000000001",
          m = "30000000-0000-0000-0000-000000000002";
        await owner(
          `insert into auth.users(id,email) values('${a}','new-admin@fixture.invalid'),('${m}','new-manager@fixture.invalid')`,
        );
        const payload = {
          name: "New business",
          slug: "NEW Business",
          short_code: "NB",
          type: "rented",
          roles: ["finance"],
          admin_id: a,
          manager_id: m,
          admin_name: "New Admin",
          manager_name: "New Manager",
          cycle: "trial_7",
          next_cycle: "monthly",
          amount: 1000,
          currency: "PKR",
          fx_rate: 1,
          start_date: "2026-01-31",
          timezone: "Asia/Karachi",
        };
        await assert.rejects(
          as(adminA, "select master_create_workspace($1)", [payload]),
          /Not permitted/,
        );
        await assert.rejects(
          as(master, "select master_create_workspace($1)", [
            { ...payload, manager_name: null },
          ]),
          /null/,
        );
        assert.equal(
          (
            await db.query(
              "select count(*)::int n from workspaces where short_code='NB'",
            )
          ).rows[0].n,
          0,
        );
        const w = (
          await as(master, "select master_create_workspace($1) result", [
            payload,
          ])
        )[0].result;
        assert.equal(w.slug, "new-business");
        assert.equal(w.status, "trial");
        const boot = (await as(a, "select boot_context() result"))[0].result;
        assert.equal(boot.profile.account_type, "admin");
        assert.equal(boot.settings.timezone, "Asia/Karachi");
        assert.equal(
          (await as(m, "select is_manager() result"))[0].result,
          true,
        );
        const roles = (await as(a, "select * from workspace_roles")).filter(
          (r) => r.active,
        );
        assert.deepEqual(
          roles.map((r) => r.role_key),
          ["finance"],
        );
        assert.equal((await as(a, "select * from subscriptions")).length, 1);
        assert.equal(
          (
            await as(
              adminA,
              "select * from subscriptions where workspace_id=$1",
              [w.id],
            )
          ).length,
          0,
        );
        assert.equal((await as(m, "select * from subscriptions")).length, 0);
        assert.equal(
          (
            await as(
              master,
              "select advance_due('2026-01-31','monthly')::text as result",
            )
          )[0].result,
          "2026-02-28",
        );
        await assert.rejects(
          as(adminA, "select promote_to_master($1)", [
            "admin-a@fixture.invalid",
          ]),
          /permission denied/,
        );
      },
    );
    await t.test(
      "tasks: cross-workspace IDs are rejected and review is enforced",
      async () => {
        await owner(
          `update profiles set status='active' where id='${memberA}'`,
        );
        const a = (
          await as(adminA, "select task_save($1) result", [
            { title: "Fixture task A", assignee_id: memberA, priority: "high" },
          ])
        )[0].result;
        const b = (
          await as(adminB, "select task_save($1) result", [
            { title: "Fixture task B", assignee_id: managerB },
          ])
        )[0].result;
        assert.equal(
          (await as(adminA, "select * from tasks where id=$1", [b.id])).length,
          0,
        );
        await assert.rejects(
          as(adminA, "select task_save($1)", [
            { title: "Forged assignee", assignee_id: managerB },
          ]),
          /same workspace|assignee/i,
        );
        await assert.rejects(
          as(adminA, "select task_set_status($1,$2)", [b.id, "in_progress"]),
          /not found|permitted/i,
        );
        await assert.rejects(
          as(memberA, "select task_set_status($1,$2)", [a.id, "completed"]),
          /review/i,
        );
        await as(memberA, "select task_set_status($1,$2)", [
          a.id,
          "in_progress",
        ]);
        await as(memberA, "select task_set_status($1,$2)", [a.id, "in_review"]);
        await assert.rejects(
          as(memberA, "select task_review($1,$2,$3)", [a.id, true, ""]),
          /permitted/i,
        );
        await as(managerA, "select task_review($1,$2,$3)", [a.id, true, ""]);
        assert.equal(
          (await as(memberA, "select status from tasks where id=$1", [a.id]))[0]
            .status,
          "completed",
        );
        await assert.rejects(
          as(memberA, "select task_comment($1,$2)", [
            b.id,
            "Cross-tenant comment",
          ]),
          /permitted/,
        );
        assert.equal((await as(master, "select * from tasks")).length, 0);
        await owner(`update workspaces set full_access=true where id='${A}'`);
        assert.equal(
          (await as(master, "select * from tasks where id=$1", [a.id])).length,
          1,
        );
        await assert.rejects(
          as(master, "select task_set_status($1,$2)", [a.id, "todo"]),
          /permitted|not found/,
        );
      },
    );

    await t.test(
      "tracking: server timestamps, one timer, stale boundaries and isolation",
      async () => {
        const t = (
          await as(memberA, "select task_save($1) result", [
            { title: "Timing task" },
          ])
        )[0].result;
        const other = (
          await as(memberA, "select task_save($1) result", [
            { title: "Other timing task" },
          ])
        )[0].result;
        const session = (await as(memberA, "select session_start() id"))[0].id;
        assert.equal(
          (await as(memberA, "select session_start() id"))[0].id,
          session,
          "multiple tabs reuse session",
        );
        assert.equal(
          (
            await as(adminB, "select session_heartbeat($1,true) result", [
              session,
            ])
          )[0].result.expired,
          true,
        );
        const timer = (
          await as(memberA, "select timer_start($1) result", [t.id])
        )[0].result;
        assert.equal(
          (await as(memberA, "select timer_start($1) result", [t.id]))[0].result
            .id,
          timer.id,
        );
        await as(memberA, "select timer_start($1)", [other.id]);
        assert.equal(
          (
            await as(
              memberA,
              "select * from task_time_entries where ended_at is null",
            )
          ).length,
          1,
        );
        assert.equal(
          (
            await as(
              memberA,
              "select end_reason from task_time_entries where id=$1",
              [timer.id],
            )
          )[0].end_reason,
          "paused",
        );
        await as(memberA, "select timer_pause()");
        const restarted = (
          await as(memberA, "select timer_start($1) result", [t.id])
        )[0].result;
        timer.id = restarted.id;
        await assert.rejects(
          as(adminB, "select timer_start($1)", [t.id]),
          /assigned/,
        );
        for (const table of [
          "user_sessions",
          "activity_intervals",
          "task_time_entries",
        ])
          assert.equal(
            (
              await as(
                adminB,
                "select * from " + table + " where workspace_id=$1",
                [A],
              )
            ).length,
            0,
          );
        await as(memberA, "select session_heartbeat($1,false)", [session]);
        assert.equal(
          (
            await as(
              memberA,
              "select presence from user_sessions where id=$1",
              [session],
            )
          )[0].presence,
          "idle",
        );
        await db.query(
          "update task_time_entries set started_at=now()-interval '40 minutes',last_heartbeat_at=now()-interval '21 minutes' where id=$1",
          [timer.id],
        );
        await as(memberA, "select sweep_stale_sessions()");
        const stopped = (
          await as(memberA, "select * from task_time_entries where id=$1", [
            timer.id,
          ])
        )[0];
        assert.equal(stopped.end_reason, "auto_paused");
        assert.equal(
          String(stopped.ended_at),
          String(stopped.last_heartbeat_at),
        );
        await db.query(
          "update user_sessions set started_at=now()-interval '10 minutes',last_heartbeat_at=now()-interval '4 minutes' where id=$1",
          [session],
        );
        await as(memberA, "select sweep_stale_sessions()");
        const stale = (
          await as(memberA, "select * from user_sessions where id=$1", [
            session,
          ])
        )[0];
        assert.equal(stale.end_reason, "stale");
        assert.equal(String(stale.ended_at), String(stale.last_heartbeat_at));
        await as(memberA, "select timer_start($1)", [t.id]);
        await as(memberA, "select task_set_status($1,$2)", [t.id, "in_review"]);
        assert.equal(
          (await as(memberA, "select my_timer() result"))[0].result,
          null,
        );
        await as(memberA, "select session_start()");
        await as(memberA, "select session_end()");
        assert.equal(
          (
            await as(
              memberA,
              "select * from user_sessions where ended_at is null",
            )
          ).length,
          0,
        );
        await assert.rejects(
          as(
            memberA,
            "update task_time_entries set started_at=now()-interval '1 day'",
          ),
          /permission denied/,
        );
      },
    );
    await t.test(
      "reports: exact timezone midnight splits and member privacy",
      async () => {
        const t = (
          await as(memberA, "select task_save($1) result", [
            { title: "Midnight task" },
          ])
        )[0].result;
        const session = (
          await db.query(
            "insert into user_sessions(workspace_id,user_id,started_at,last_heartbeat_at,ended_at,end_reason) values($1,$2,'2026-01-01 18:30Z','2026-01-01 19:30Z','2026-01-01 19:30Z','sign_out') returning id",
            [A, memberA],
          )
        ).rows[0].id;
        await db.query(
          "insert into activity_intervals(workspace_id,user_id,session_id,state,started_at,ended_at) values($1,$2,$3,'active','2026-01-01 18:30Z','2026-01-01 19:10Z'),($1,$2,$3,'idle','2026-01-01 19:10Z','2026-01-01 19:30Z')",
          [A, memberA, session],
        );
        await db.query(
          "insert into task_time_entries(workspace_id,user_id,task_id,started_at,last_heartbeat_at,ended_at,end_reason) values($1,$2,$3,'2026-01-01 18:45Z','2026-01-01 19:15Z','2026-01-01 19:15Z','stopped')",
          [A, memberA, t.id],
        );
        const rows = (
          await as(memberA, "select report_daily($1,$2,$3) result", [
            "2026-01-01",
            "2026-01-02",
            memberA,
          ])
        )[0].result;
        const jan1 = rows.find((r) => r.day === "2026-01-01"),
          jan2 = rows.find((r) => r.day === "2026-01-02");
        assert.deepEqual(
          [
            jan1.signed_in_seconds,
            jan1.active_seconds,
            jan1.idle_seconds,
            jan1.task_seconds,
          ],
          [1800, 1800, 0, 900],
        );
        assert.deepEqual(
          [
            jan2.signed_in_seconds,
            jan2.active_seconds,
            jan2.idle_seconds,
            jan2.task_seconds,
          ],
          [1800, 600, 1200, 900],
        );
        await assert.rejects(
          as(memberA, "select report_daily($1,$2,$3)", [
            "2026-01-01",
            "2026-01-02",
            adminA,
          ]),
          /permitted/,
        );
        await assert.rejects(
          as(adminA, "select report_daily($1,$2,$3)", [
            "2026-01-01",
            "2026-01-02",
            adminB,
          ]),
          /not found/,
        );
        await assert.rejects(
          as(master, "select report_daily($1,$2,$3)", [
            "2026-01-01",
            "2026-01-02",
            memberA,
          ]),
          /permitted/,
        );
        const tasks = (
          await as(memberA, "select report_tasks($1,$2,$3) result", [
            "2026-01-01",
            "2026-01-02",
            memberA,
          ])
        )[0].result;
        assert.equal(tasks[0].seconds, 1800);
        const timeline = (
          await as(memberA, "select day_timeline($1,$2) result", [
            "2026-01-02",
            memberA,
          ])
        )[0].result;
        assert.equal(timeline.length, 3);
      },
    );

    await t.test(
      "permissions and brand: only Admin can change own workspace",
      async () => {
        await as(master, "select master_set_roles($1,$2)", [
          A,
          ["sales_rep", "finance"],
        ]);
        const entries = [
          {
            role_key: "sales_rep",
            module: "leads",
            view: true,
            edit: false,
            delete: false,
          },
        ];
        await assert.rejects(
          as(managerA, "select save_permissions($1)", [entries]),
          /permitted/,
        );
        await assert.rejects(
          as(adminA, "select save_permissions($1)", [
            [{ role_key: "project_manager", module: "projects", view: true }],
          ]),
          /available/,
        );
        await as(adminA, "select save_permissions($1)", [entries]);
        assert.equal(
          (await as(memberA, "select perm('leads','edit') result"))[0].result,
          false,
        );
        entries[0].edit = true;
        await as(adminA, "select save_permissions($1)", [entries]);
        assert.equal(
          (await as(memberA, "select perm('leads','edit') result"))[0].result,
          true,
        );
        await assert.rejects(
          as(adminA, "select save_permissions($1)", [
            [{ role_key: "sales_rep", module: "settings", view: true }],
          ]),
          /configurable/,
        );
        await as(adminA, "select save_brand($1)", ["w" + A + "/logo.png"]);
        await assert.rejects(
          as(adminA, "select save_brand($1)", ["w" + B + "/logo.png"]),
          /workspace/,
        );
        await assert.rejects(
          as(memberA, "select save_brand($1)", ["w" + A + "/logo.png"]),
          /permitted/,
        );
        await assert.rejects(
          as(adminA, "select save_settings($1)", [
            { timezone: "made-up-zone" },
          ]),
          /timezone/,
        );
      },
    );

    await t.test(
      "leads and clients: assignment, conversion, codes and tenant isolation",
      async () => {
        const a = (
          await as(adminA, "select lead_save($1) result", [
            {
              company: "Acme",
              name: "Harry Ford",
              agent_id: memberA,
              currency: "USD",
              budget: 500,
            },
          ])
        )[0].result;
        const b = (
          await as(adminB, "select lead_save($1) result", [
            { company: "Beta", name: "Harry Ford", stage: "won" },
          ])
        )[0].result;
        assert.equal(
          (await as(adminA, "select * from leads where id=$1", [b.id])).length,
          0,
        );
        await assert.rejects(
          as(adminA, "select lead_save($1)", [
            { id: a.id, agent_id: managerB },
          ]),
          /Sales Representative/,
        );
        await assert.rejects(
          as(adminA, "select lead_save($1)", [
            { workspace_id: B, company: "Forged" },
          ]),
          /Workspace/,
        );
        await assert.rejects(
          as(adminA, "select lead_convert($1)", [a.id]),
          /Won/,
        );
        await as(adminA, "select lead_mark_won($1)", [a.id]);
        const ca = (
          await as(adminA, "select lead_convert($1) result", [a.id])
        )[0].result;
        const again = (
          await as(adminA, "select lead_convert($1) result", [a.id])
        )[0].result;
        const cb = (
          await as(adminB, "select lead_convert($1) result", [b.id])
        )[0].result;
        assert.equal(ca.id, again.id);
        assert.equal(ca.buid, "BUID-1001");
        assert.equal(cb.buid, "BUID-1001");
        assert.equal(ca.invoice_code, "HF");
        assert.equal(cb.invoice_code, "HF");
        const collision = (
          await as(adminA, "select client_save($1) result", [
            { name: "Harry Ford", company: "Second client" },
          ])
        )[0].result;
        assert.notEqual(collision.invoice_code, "HF");
        assert.equal(collision.buid, "BUID-1002");
        await assert.rejects(
          as(adminA, "select client_save($1)", [{ id: cb.id, name: "Forged" }]),
          /not found/,
        );
        assert.equal(
          (await as(adminA, "select * from clients where id=$1", [cb.id]))
            .length,
          0,
        );
        await as(master, "select master_set_roles($1,$2)", [
          A,
          ["sales_rep", "lead_gen", "finance"],
        ]);
        await owner(
          "update member_roles set role_key='lead_gen' where user_id='" +
            memberA +
            "'",
        );
        await assert.rejects(
          as(memberA, "select lead_save($1)", [
            { company: "No assignment", agent_id: managerA },
          ]),
          /Only Sales/,
        );
        const unassigned = (
          await as(memberA, "select lead_save($1) result", [
            { company: "Unassigned" },
          ])
        )[0].result;
        assert.equal(unassigned.agent_id, null);
        await assert.rejects(
          as(memberA, "select public_lead_submit($1,$2)", ["bad", {}]),
          /permission denied/,
        );
        await owner(
          "update member_roles set role_key='sales_rep' where user_id='" +
            memberA +
            "'",
        );
      },
    );

    await t.test(
      "projects: approval directions, ownership, linkage and private files",
      async () => {
        await as(master, "select master_set_roles($1,$2)", [
          A,
          ["sales_rep", "project_manager", "finance"],
        ]);
        await owner(
          "insert into member_roles(workspace_id,user_id,role_key) values('" +
            A +
            "','" +
            memberA +
            "','project_manager');update profiles set job_title='Developer' where id='" +
            managerA +
            "'",
        );
        const ca = (await as(adminA, "select * from clients order by buid"))[0],
          cb = (await as(adminB, "select * from clients"))[0];
        const p = (
          await as(adminA, "select project_save($1) result", [
            { name: "Fixture project", client_id: ca.id, pm_id: memberA },
          ])
        )[0].result;
        const pb = (
          await as(adminB, "select project_save($1) result", [
            { name: "Other project", client_id: cb.id },
          ])
        )[0].result;
        assert.equal(
          (await as(memberA, "select * from projects where id=$1", [pb.id]))
            .length,
          0,
        );
        await assert.rejects(
          as(memberA, "select project_save($1)", [
            { id: p.id, pm_id: managerA },
          ]),
          /Only a Manager/,
        );
        const requested = (
          await as(adminA, "select project_add_member($1,$2,$3) result", [
            p.id,
            managerA,
            "Developer",
          ])
        )[0].result;
        assert.equal(requested.status, "pending");
        assert.equal(requested.approval_side, "pm");
        await assert.rejects(
          as(managerA, "select project_review_member($1,true)", [requested.id]),
          /permitted/,
        );
        await as(memberA, "select project_review_member($1,true)", [
          requested.id,
        ]);
        await assert.rejects(
          as(memberA, "select project_review_member($1,true)", [requested.id]),
          /already/,
        );
        await as(memberA, "select project_remove_member($1,$2)", [
          requested.id,
          "New scope",
        ]);
        const reverse = (
          await as(memberA, "select project_add_member($1,$2,$3) result", [
            p.id,
            managerA,
            "Developer",
          ])
        )[0].result;
        assert.equal(reverse.approval_side, "manager");
        await as(adminA, "select project_review_member($1,false,$2)", [
          reverse.id,
          "Not needed",
        ]);
        const directProject = (
          await as(adminA, "select project_save($1) result", [
            { name: "No PM project", client_id: ca.id },
          ])
        )[0].result;
        const direct = (
          await as(adminA, "select project_add_member($1,$2,$3) result", [
            directProject.id,
            managerA,
            "Developer",
          ])
        )[0].result;
        assert.equal(direct.status, "approved");
        await assert.rejects(
          as(adminA, "select project_add_member($1,$2,$3)", [
            p.id,
            managerB,
            "Developer",
          ]),
          /designation/,
        );
        const task = (
          await as(memberA, "select task_save($1) result", [
            { title: "Linked task", project_id: p.id },
          ])
        )[0].result;
        assert.equal(task.client_id, ca.id);
        await assert.rejects(
          as(memberA, "select task_save($1)", [
            { title: "Cross project", project_id: pb.id },
          ]),
          /permitted/,
        );
        const path =
          "w" + A + "/" + ca.id + "/30000000-0000-0000-0000-000000000001.pdf";
        await as(memberA, "select file_register($1)", [
          {
            client_id: ca.id,
            project_id: p.id,
            name: "brief.pdf",
            path,
            mime_type: "application/pdf",
            size_bytes: 100,
          },
        ]);
        assert.equal(
          (
            await as(memberA, "select can_client_file($1,true) result", [path])
          )[0].result,
          true,
        );
        assert.equal(
          (await as(adminB, "select can_client_file($1) result", [path]))[0]
            .result,
          false,
        );
        await assert.rejects(
          as(
            adminB,
            "insert into storage.objects(bucket_id,name) values('client-files',$1)",
            [path],
          ),
          /row-level security/,
        );
        assert.equal(
          (
            await as(
              adminB,
              "select * from project_members where project_id=$1",
              [p.id],
            )
          ).length,
          0,
        );
        assert.equal(
          (await as(adminB, "select * from client_files where path=$1", [path]))
            .length,
          0,
        );
        const file = (
          await as(memberA, "select * from client_files where path=$1", [path])
        )[0];
        await assert.rejects(
          as(memberA, "select file_finish($1,true)", [file.id]),
          /not complete/,
        );
        await assert.rejects(
          as(adminB, "select file_finish($1,true)", [file.id]),
          /permitted/,
        );
        await as(
          memberA,
          "insert into storage.objects(bucket_id,name) values('client-files',$1)",
          [path],
        );
        await as(memberA, "select file_finish($1,true)", [file.id]);
        assert.equal(
          (
            await as(
              memberA,
              "select upload_status from client_files where id=$1",
              [file.id],
            )
          )[0].upload_status,
          "ready",
        );
        await assert.rejects(
          as(memberA, "delete from project_members"),
          /permission denied/,
        );
      },
    );

    await t.test(
      "notifications: actor skip, inactive skip, scope and read ownership",
      async () => {
        const before = (await as(adminA, "select * from notifications")).length;
        await as(adminA, "select task_save($1)", [
          { title: "Notify fixture", assignee_id: memberA },
        ]);
        assert.equal(
          (await as(adminA, "select * from notifications")).length,
          before,
        );
        const notices = await as(memberA, "select * from notifications");
        assert.ok(notices.some((n) => n.body === "Notify fixture"));
        assert.equal(
          (
            await as(
              adminB,
              "select * from notifications where workspace_id=$1",
              [A],
            )
          ).length,
          0,
        );
        const notice = notices.find((n) => n.body === "Notify fixture");
        await as(adminB, "select notifications_read($1)", [notice.id]);
        assert.equal(
          (
            await as(memberA, "select * from notifications where id=$1", [
              notice.id,
            ])
          )[0].read_at,
          null,
        );
        await as(memberA, "select notifications_read($1)", [notice.id]);
        assert.ok(
          (
            await as(memberA, "select * from notifications where id=$1", [
              notice.id,
            ])
          )[0].read_at,
        );
        await assert.rejects(
          as(memberA, "select notify($1,$2,$3)", [adminB, B, "forged"]),
          /permission denied/,
        );
        await owner(
          "update profiles set status='inactive' where id='" +
            memberA +
            "';select notify('" +
            memberA +
            "','" +
            A +
            "','inactive-test')",
        );
        assert.equal(
          (
            await db.query(
              "select * from notifications where title='inactive-test'",
            )
          ).rows.length,
          0,
        );
        await owner(
          "update profiles set status='active' where id='" + memberA + "'",
        );
      },
    );

    await t.test(
      "finance: salary isolation, authoritative FX, recurrence and idempotent sweeps",
      async () => {
        await owner(
          "insert into member_roles(workspace_id,user_id,role_key) values('" +
            A +
            "','" +
            memberA +
            "','finance')",
        );
        const salary = (
          await as(adminA, "select finance_save($1,$2) result", [
            "expense",
            {
              title: "Private salary",
              category: "salary",
              employee_id: memberA,
              paid_on: "2026-01-05",
              currency: "PKR",
              amount_original: 1000,
              fx_rate: 99,
              amount: 1,
            },
          ])
        )[0].result;
        assert.equal(salary.amount, 1000);
        assert.equal(salary.fx_rate, 1);
        assert.equal(
          (await as(memberA, "select * from expenses where id=$1", [salary.id]))
            .length,
          0,
        );
        assert.equal(
          (await as(master, "select * from expenses where id=$1", [salary.id]))
            .length,
          0,
        );
        assert.equal(
          (await as(adminB, "select * from expenses where id=$1", [salary.id]))
            .length,
          0,
        );
        await assert.rejects(
          as(memberA, "select finance_save($1,$2)", [
            "expense",
            {
              id: salary.id,
              title: "Leak",
              category: "other",
              currency: "PKR",
              amount_original: 1,
              fx_rate: 1,
            },
          ]),
          /not found/,
        );
        const summary = (
          await as(memberA, "select finance_summary($1,$2) result", [
            "2026-01-01",
            "2026-01-31",
          ])
        )[0].result;
        assert.equal(summary.salary_total, 1000);
        assert.equal(JSON.stringify(summary).includes("Private"), false);
        const fx = (
          await as(memberA, "select finance_save($1,$2) result", [
            "expense",
            {
              title: "Hosting",
              category: "software",
              paid_on: "2026-01-05",
              currency: "USD",
              amount_original: 10,
              fx_rate: 280,
              amount: 1,
            },
          ])
        )[0].result;
        assert.equal(fx.amount, 2800);
        const bill = (
          await as(adminA, "select finance_save($1,$2) result", [
            "bill",
            {
              title: "Monthly tool",
              category: "software",
              frequency: "monthly",
              next_due: "2026-01-31",
              currency: "PKR",
              amount_original: 50,
              fx_rate: 1,
            },
          ])
        )[0].result;
        const expense = (
          await as(adminA, "select bill_settle($1,$2,false,$3) result", [
            bill.id,
            "2026-01-31",
            "2026-01-31",
          ])
        )[0].result;
        assert.equal(
          (
            await as(adminA, "select bill_settle($1,$2,false,$3) result", [
              bill.id,
              "2026-01-31",
              "2026-01-31",
            ])
          )[0].result,
          expense,
        );
        assert.equal(
          (
            await as(
              adminA,
              "select next_due::text due from recurring_expenses where id=$1",
              [bill.id],
            )
          )[0].due,
          "2026-02-28",
        );
        await as(adminA, "select bill_settle($1,$2,true,$3)", [
          bill.id,
          "2026-02-28",
          "2026-02-28",
        ]);
        assert.equal(
          (
            await as(adminA, "select * from expenses where bill_id=$1", [
              bill.id,
            ])
          ).length,
          1,
        );
        const once = (
          await as(adminA, "select finance_save($1,$2) result", [
            "bill",
            {
              title: "One-off",
              category: "other",
              frequency: "one_time",
              next_due: "2026-01-01",
              automatic: true,
              currency: "PKR",
              amount_original: 20,
              fx_rate: 1,
            },
          ])
        )[0].result;
        for (let i = 0; i < 10; i++) await as(adminA, "select finance_sweep()");
        assert.equal(
          (
            await as(adminA, "select * from expenses where bill_id=$1", [
              once.id,
            ])
          ).length,
          1,
        );
        assert.equal(
          (
            await as(
              adminA,
              "select active from recurring_expenses where id=$1",
              [once.id],
            )
          )[0].active,
          false,
        );
        const duplicates = await db.query(
          "select workspace_id,kind,for_date,entity_id,count(*) from finance_report_log group by 1,2,3,4 having count(*)>1",
        );
        assert.equal(duplicates.rows.length, 0);
        await assert.rejects(
          as(adminB, "select bill_settle($1,$2)", [bill.id, "2026-03-28"]),
          /permitted/,
        );
        await assert.rejects(
          as(memberA, "select bill_settle_internal($1,$2,false,$3)", [
            bill.id,
            "2026-03-28",
            "2026-03-28",
          ]),
          /permission denied/,
        );
        await assert.rejects(
          as(adminA, "select save_settings($1)", [{ app_currency: "USD" }]),
          /fixed/,
        );
      },
    );

    await t.test(
      "invoices: immutable identity, database totals, numbering and salary file denial",
      async () => {
        const client = (
          await as(adminA, "select * from clients order by buid")
        )[0];
        const payload = {
          kind: "client",
          client_id: client.id,
          due_date: "2026-02-01",
          currency: "USD",
          fx_rate: 280,
          line_items: [
            { description: "Website", quantity: 2, unit_price: 100 },
          ],
          discount_percent: 10,
          tax_percent: 5,
          amount: 1,
          number: "FAKE",
          issued_by: { name: "Fake" },
        };
        const i = (
          await as(adminA, "select invoice_save($1) result", [payload])
        )[0].result;
        assert.equal(i.amount_original, 189);
        assert.equal(i.amount, 52920);
        assert.equal(i.number, "INV-BUID-1001-HF001");
        assert.equal(i.issued_by.name, "Admin A");
        const j = (
          await as(adminA, "select invoice_save($1) result", [payload])
        )[0].result;
        assert.equal(j.number, "INV-BUID-1001-HF002");
        await as(adminA, "select invoice_save($1)", [
          {
            id: i.id,
            number: "FORGED",
            line_items: [
              { description: "Website revised", quantity: 1, unit_price: 100 },
            ],
          },
        ]);
        const updated = (
          await as(adminA, "select * from invoices where id=$1", [i.id])
        )[0];
        assert.equal(updated.number, i.number);
        assert.equal(Number(updated.amount_original), 94.5);
        await as(adminA, "select invoice_set_status($1,$2,$3)", [
          i.id,
          "paid",
          "2026-01-20",
        ]);
        await assert.rejects(
          as(adminA, "select invoice_save($1)", [{ id: i.id, line_items: [] }]),
          /Only unpaid/,
        );
        await assert.rejects(
          as(adminB, "select invoice_set_status($1,$2)", [i.id, "void"]),
          /not found/,
        );
        assert.equal(
          (await as(adminB, "select * from invoices where id=$1", [i.id]))
            .length,
          0,
        );
        await assert.rejects(
          as(memberA, "select invoice_next_number($1,$2,$3)", [
            A,
            "client",
            client.id,
          ]),
          /permission denied/,
        );
        const salary = (
          await as(adminA, "select * from expenses where category='salary'")
        )[0];
        const path =
          "w" +
          A +
          "/expense/" +
          salary.id +
          "/40000000-0000-0000-0000-000000000001.pdf";
        assert.equal(
          (await as(memberA, "select can_finance_file($1) result", [path]))[0]
            .result,
          false,
        );
        assert.equal(
          (await as(master, "select can_finance_file($1) result", [path]))[0]
            .result,
          false,
        );
        assert.equal(
          (
            await as(adminA, "select can_finance_file($1,true) result", [path])
          )[0].result,
          true,
        );
        await assert.rejects(
          as(memberA, "select finance_file_register($1)", [
            {
              kind: "expense",
              record_id: salary.id,
              name: "salary.pdf",
              path,
              mime_type: "application/pdf",
              size_bytes: 100,
            },
          ]),
          /permitted/,
        );
        const f = (
          await as(adminA, "select finance_file_register($1) result", [
            {
              kind: "expense",
              record_id: salary.id,
              name: "salary.pdf",
              path,
              mime_type: "application/pdf",
              size_bytes: 100,
            },
          ])
        )[0].result;
        await assert.rejects(
          as(adminA, "select finance_file_finish($1,true)", [f]),
          /not completed/,
        );
        await as(
          adminA,
          "insert into storage.objects(bucket_id,name) values('finance-files',$1)",
          [path],
        );
        await as(adminA, "select finance_file_finish($1,true)", [f]);
        assert.equal(
          (await as(memberA, "select * from finance_files")).length,
          0,
        );
        assert.equal(
          (await as(master, "select * from finance_files")).length,
          0,
        );
      },
    );

    await t.test(
      "Master billing: date-based rollover, one notice per day, internal skip and payment resume",
      async () => {
        const w = (
          await db.query("select * from workspaces where type='rented' limit 1")
        ).rows[0];
        const admin = (
          await db.query(
            "select id from profiles where workspace_id=$1 and account_type='admin'",
            [w.id],
          )
        ).rows[0].id;
        const manager = (
          await db.query(
            "select id from profiles where workspace_id=$1 and account_type='member'",
            [w.id],
          )
        ).rows[0].id;
        await db.query(
          "update subscriptions set cycle='trial_7',next_cycle='monthly',trial_ends_on=current_date-8,next_due=null,grace_days=7 where workspace_id=$1",
          [w.id],
        );
        await as(master, "select master_sweep()");
        let sub = (
          await as(
            master,
            "select * from subscriptions where workspace_id=$1",
            [w.id],
          )
        )[0];
        assert.equal(sub.cycle, "monthly");
        assert.equal(String(sub.next_due), String(sub.trial_ends_on));
        assert.equal(sub.status, "suspended");
        assert.equal(
          (await as(manager, "select current_workspace() id"))[0].id,
          null,
        );
        assert.equal(
          (await as(admin, "select billing_workspace() id"))[0].id,
          w.id,
        );
        await as(admin, "select billing_details()");
        for (let i = 0; i < 10; i++) await as(master, "select master_sweep()");
        assert.equal(
          (
            await db.query(
              "select * from billing_log where workspace_id=$1 and kind='suspended'",
              [w.id],
            )
          ).rows.length,
          1,
        );
        assert.equal(
          (
            await db.query("select * from billing_log where workspace_id=$1", [
              A,
            ])
          ).rows.length,
          0,
        );
        assert.equal(
          (
            await as(master, "select status from workspaces where id=$1", [A])
          )[0].status,
          "active",
        );
        const payload = {
          request_id: "50000000-0000-0000-0000-000000000001",
          currency: "PKR",
          amount_original: 1000,
          fx_rate: 1,
          paid_on: new Date().toISOString().slice(0, 10),
          reference: "Fixture bank transfer",
        };
        const payment = (
          await as(master, "select record_rent_payment($1,$2) result", [
            w.id,
            payload,
          ])
        )[0].result;
        const duplicate = (
          await as(master, "select record_rent_payment($1,$2) result", [
            w.id,
            payload,
          ])
        )[0].result;
        assert.equal(payment.id, duplicate.id);
        sub = (
          await as(
            master,
            "select * from subscriptions where workspace_id=$1",
            [w.id],
          )
        )[0];
        assert.equal(sub.status, "active");
        const inv = (
          await as(master, "select * from invoices where id=$1", [
            payment.invoice_id,
          ])
        )[0];
        assert.equal(inv.number, "INV-WX001");
        const receiptPath = `w${w.id}/rent/${payment.id}/60000000-0000-0000-0000-000000000001.pdf`;
        const receipt = (
          await as(master, "select finance_file_register($1) id", [
            {
              kind: "rent",
              record_id: payment.id,
              path: receiptPath,
              name: "receipt.pdf",
              mime_type: "application/pdf",
              size_bytes: 100,
            },
          ])
        )[0].id;
        await as(
          master,
          "insert into storage.objects(bucket_id,name) values('finance-files',$1)",
          [receiptPath],
        );
        await as(master, "select finance_file_finish($1,true)", [receipt]);
        assert.equal(
          (
            await as(admin, "select * from finance_files where id=$1", [
              receipt,
            ])
          ).length,
          1,
        );
        assert.equal(
          (
            await as(adminA, "select * from finance_files where id=$1", [
              receipt,
            ])
          ).length,
          0,
        );
        assert.equal(
          (
            await as(manager, "select can_finance_file($1) allowed", [
              receiptPath,
            ])
          )[0].allowed,
          false,
        );
        assert.equal(
          (
            await as(admin, "select can_finance_file($1,true) allowed", [
              receiptPath,
            ])
          )[0].allowed,
          false,
        );
        assert.equal(
          (await as(admin, "select * from invoices where id=$1", [inv.id]))
            .length,
          1,
        );
        assert.equal(
          (await as(manager, "select * from invoices where id=$1", [inv.id]))
            .length,
          0,
        );
        await assert.rejects(
          as(adminA, "select record_rent_payment($1,$2)", [w.id, payload]),
          /permitted/,
        );
        await assert.rejects(
          as(master, "select record_rent_payment($1,$2)", [
            A,
            { ...payload, request_id: "50000000-0000-0000-0000-000000000002" },
          ]),
          /cannot/,
        );
        await as(master, "select master_set_status($1,$2,$3)", [
          w.id,
          "suspended",
          "Fixture suspension",
        ]);
        await as(master, "select master_sweep()");
        assert.equal(
          (
            await as(master, "select status from workspaces where id=$1", [
              w.id,
            ])
          )[0].status,
          "suspended",
        );
        await as(master, "select master_set_status($1,$2,$3)", [
          w.id,
          "archived",
          "Fixture archive",
        ]);
        await as(master, "select master_sweep()");
        assert.equal(
          (
            await as(master, "select status from workspaces where id=$1", [
              w.id,
            ])
          )[0].status,
          "archived",
        );
        assert.equal(
          (await as(admin, "select billing_workspace() id"))[0].id,
          null,
        );
        await as(master, "select master_set_status($1,$2,$3)", [
          w.id,
          "active",
          "Fixture restore",
        ]);
      },
    );
    await t.test(
      "public forms force their token's workspace and reject suspended businesses",
      async () => {
        await owner("select 1");
        const token = (
          await db.query(
            "select public_form_token from workspaces where id=$1",
            [A],
          )
        ).rows[0].public_form_token;
        await db.exec("set role service_role");
        try {
          await db.query("select public_lead_submit($1,$2)", [
            token,
            {
              name: "Form fixture",
              company: "Token scope check",
              currency: "PKR",
              workspace_id: B,
              stage: "won",
              agent_id: managerB,
            },
          ]);
        } finally {
          await db.exec("reset role");
        }
        const row = (
          await db.query(
            "select * from leads where company='Token scope check'",
          )
        ).rows[0];
        assert.equal(row.workspace_id, A);
        assert.equal(row.stage, "new");
        assert.equal(row.agent_id, null);
        assert.equal(
          (await as(adminB, "select * from leads where id=$1", [row.id]))
            .length,
          0,
        );
        await owner(`update workspaces set status='suspended' where id='${A}'`);
        await db.exec("set role service_role");
        try {
          await assert.rejects(
            db.query("select public_lead_submit($1,$2)", [
              token,
              { company: "Blocked" },
            ]),
            /unavailable/,
          );
        } finally {
          await db.exec("reset role");
        }
        await owner(`update workspaces set status='active' where id='${A}'`);
      },
    );
    await t.test(
      "Master access is audited twice and never opens salaries",
      async () => {
        const before = (
          await db.query(
            "select count(*)::int n from master_access_log where workspace_id=$1",
            [A],
          )
        ).rows[0].n;
        await as(master, "select master_open_workspace($1)", [A]);
        assert.equal(
          (
            await db.query(
              "select count(*)::int n from master_access_log where workspace_id=$1",
              [A],
            )
          ).rows[0].n,
          before + 1,
        );
        assert.ok(
          (
            await as(
              adminA,
              "select * from activity_logs where action='master_opened'",
            )
          ).length > 0,
        );
        await as(master, "select master_set_full_access($1,false)", [A]);
        assert.equal(
          (await as(master, "select * from tasks where workspace_id=$1", [A]))
            .length,
          0,
        );
        await as(master, "select master_set_full_access($1,true)", [A]);
        assert.ok(
          (await as(master, "select * from tasks where workspace_id=$1", [A]))
            .length > 0,
        );
        assert.equal(
          (await as(master, "select * from expenses where category='salary'"))
            .length,
          0,
        );
        assert.ok(
          (
            await as(
              adminA,
              "select * from notifications where title='Full access enabled'",
            )
          ).length > 0,
        );
        await assert.rejects(
          as(adminA, "select master_set_full_access($1,true)", [B]),
          /permitted/,
        );
        await assert.rejects(
          as(master, "select finance_save($1,$2)", ["expense", {}]),
          /permitted/,
        );
        await as(master, "select master_set_full_access($1,false)", [A]);
      },
    );
    await t.test(
      "Master control: profile, avatar, catalogs and delegated access stay isolated",
      async () => {
        await as(master, "select master_profile_save($1)", [
          {
            name: "Master Updated",
            first_name: "Master",
            last_name: "Updated",
            phone: "+123",
            date_of_birth: "1990-01-01",
            email: "forged@fixture.invalid",
            is_master: false,
          },
        ]);
        const profile = (await as(master, "select boot_context() data"))[0].data
          .profile;
        assert.equal(profile.name, "Master Updated");
        assert.equal(profile.email, "master@fixture.invalid");
        assert.equal(profile.is_master, true);
        await assert.rejects(
          as(adminA, "select master_profile_save($1)", [{ name: "Wrong" }]),
          /permitted/,
        );
        await assert.rejects(
          as(master, "select master_profile_save($1)", [
            { name: "Master", date_of_birth: "2999-01-01" },
          ]),
          /birth/,
        );
        await assert.rejects(
          as(master, "select master_profile_save($1)", [
            { name: "Master", avatar_path: adminA + "/photo.webp" },
          ]),
          /Upload/,
        );
        const path = master + "/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp";
        await as(
          master,
          "insert into storage.objects(bucket_id,name) values('avatars',$1)",
          [path],
        );
        await as(master, "select master_profile_save($1)", [
          { name: "Master Updated", avatar_path: path },
        ]);
        assert.equal(
          (
            await as(
              adminA,
              "select * from storage.objects where bucket_id='avatars'",
            )
          ).length,
          0,
        );
        const role = (
          await as(master, "select master_catalog_save($1,$2) id", [
            "role",
            {
              name: "Developer",
              department: "Development",
              responsibilities: "Build\nReview",
            },
          ])
        )[0].id;
        const template = (
          await as(master, "select master_catalog_save($1,$2) id", [
            "template",
            {
              name: "Build page",
              role_id: role,
              department: "Wrong",
              required_module: "projects",
              instructions: "Implement and review",
            },
          ])
        )[0].id;
        assert.equal(
          (
            await as(adminA, "select * from task_templates where id=$1", [
              template,
            ])
          )[0].department,
          "Development",
        );
        await assert.rejects(
          as(adminA, "select master_catalog_save($1,$2)", [
            "role",
            { name: "Forged" },
          ]),
          /permitted/,
        );
        const staff = "20000000-0000-0000-0000-000000000090";
        await owner(
          `insert into auth.users(id,email) values('${staff}','support@fixture.invalid')`,
        );
        await as(master, "select master_team_save($1,$2)", [
          staff,
          {
            name: "Support Fixture",
            platform_role: "support",
            permissions: ["view_workspaces", "view_team"],
          },
        ]);
        assert.equal(
          (await as(staff, "select is_master() value"))[0].value,
          false,
        );
        assert.equal(
          (await as(staff, "select master_workspace_list() data"))[0].data
            .length > 0,
          true,
        );
        await as(staff, "select master_open_workspace($1)", [A]);
        await assert.rejects(
          as(staff, "select master_set_full_access($1,true)", [A]),
          /permitted/,
        );
        await assert.rejects(
          as(staff, "select master_team_save($1,$2)", [
            staff,
            { name: "Escalate", platform_role: "admin", permissions: [] },
          ]),
          /owner/,
        );
        await assert.rejects(
          as(staff, "select master_save_workspace($1,$2)", [
            A,
            { name: "Forged" },
          ]),
          /permitted/,
        );
        assert.equal((await as(staff, "select * from expenses")).length, 0);
        await as(master, "select master_team_save($1,$2)", [
          staff,
          {
            name: "Support Fixture",
            platform_role: "support",
            permissions: ["view_workspaces", "edit_workspaces"],
          },
        ]);
        await as(staff, "select master_save_workspace($1,$2)", [
          A,
          {
            name: "Workspace A",
            legal_name: "Fixture Ltd",
            business_email: "contact@fixture.invalid",
            website: "https://fixture.invalid",
            city: "Test city",
          },
        ]);
        assert.equal(
          (await as(staff, "select master_workspace_list() data"))[0].data.find(
            (w) => w.id === A,
          ).business_details.city,
          "Test city",
        );
        await as(master, "select master_team_save($1,$2)", [
          staff,
          {
            name: "Support Fixture",
            platform_role: "support",
            status: "inactive",
            permissions: ["view_workspaces"],
          },
        ]);
        await assert.rejects(
          as(staff, "select master_workspace_list()"),
          /permitted/,
        );
        await db.exec(schema);
        await assert.rejects(
          as(staff, "select master_workspace_list()"),
          /permitted/,
        );
      },
    );

    await t.test(
      "Universal profiles preserve authority and private avatar ownership",
      async () => {
        await as(memberA, "select save_profile($1)", [
          {
            name: "Updated Member",
            first_name: "Updated",
            last_name: "Member",
            phone: "+923001234567",
            date_of_birth: "1995-01-01",
            id: adminB,
            is_master: true,
            account_type: "admin",
            email: "forged@example.com",
          },
        ]);
        const p = (await as(memberA, "select boot_context() data"))[0].data
          .profile;
        assert.equal(p.first_name, "Updated");
        assert.equal(p.is_master, false);
        assert.equal(p.account_type, "member");
        assert.equal(p.email, "member-a@fixture.invalid");
        assert.equal(
          (await as(adminB, "select boot_context() data"))[0].data.profile.name,
          "Admin B",
        );
        const path = `${memberA}/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp`;
        await as(
          memberA,
          "insert into storage.objects(bucket_id,name) values('avatars',$1)",
          [path],
        );
        await as(memberA, "select save_profile($1)", [
          { name: "Updated Member", avatar_path: path },
        ]);
        await assert.rejects(
          as(adminB, "select save_profile($1)", [
            { name: "Admin B", avatar_path: path },
          ]),
          /image/,
        );
        await assert.rejects(
          as(
            adminB,
            "insert into storage.objects(bucket_id,name) values('avatars',$1)",
            [`${memberA}/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp`],
          ),
          /row-level/,
        );
        assert.equal(
          (
            await as(
              adminB,
              "select * from storage.objects where bucket_id='avatars' and name=$1",
              [path],
            )
          ).length,
          0,
        );
        await assert.rejects(
          as(memberA, "select save_profile($1)", [
            { name: "Member", date_of_birth: "2200-01-01" },
          ]),
          /date of birth/,
        );
      },
    );
    await t.test(
      "Permission matrix scopes and separate archive authorization",
      async () => {
        await as(master, "select master_set_roles($1,$2)", [
          A,
          ["sales_rep", "finance"],
        ]);
        await as(managerA, "select permission_matrix($1)", [A]);
        await as(master, "select permission_matrix($1)", [B]);
        await assert.rejects(
          as(managerA, "select permission_matrix($1)", [B]),
          /permitted/,
        );
        await assert.rejects(
          as(memberA, "select permission_matrix($1)", [A]),
          /permitted/,
        );
        await as(adminA, "select save_permissions($1)", [
          [
            {
              role_key: "sales_rep",
              module: "leads",
              view: true,
              edit: true,
              delete: false,
              archive: true,
            },
          ],
        ]);
        assert.equal(
          (await as(memberA, "select perm('leads','archive') yes"))[0].yes,
          true,
        );
        assert.equal(
          (await as(memberA, "select perm('leads','delete') yes"))[0].yes,
          false,
        );
        const lead = (
          await as(memberA, "select lead_save($1) data", [
            { company: "Archive fixture" },
          ])
        )[0].data;
        await as(memberA, "select lead_archive($1)", [lead.id]);
        await as(adminA, "select save_permissions($1)", [
          [
            {
              role_key: "sales_rep",
              module: "leads",
              view: true,
              edit: true,
              delete: true,
              archive: false,
            },
          ],
        ]);
        await assert.rejects(
          as(memberA, "select lead_archive($1)", [lead.id]),
          /permitted/,
        );
        await assert.rejects(
          as(adminA, "select save_permissions($1)", [
            [
              {
                role_key: "sales_rep",
                module: "leads",
                view: false,
                archive: true,
              },
            ],
          ]),
          /View permission/,
        );
      },
    );
    await t.test(
      "Lead contact validation covers RPC and public submissions without breaking historical updates",
      async () => {
        for (const email of [
          "no-email",
          "wrong@host.x",
          "a@-host.com",
          "a b@example.com",
        ])
          await assert.rejects(
            as(adminA, "select lead_save($1)", [{ company: "Invalid", email }]),
            /valid email/,
          );
        for (const phone of [
          "122131",
          "923001234567",
          "+92 abc",
          "+00123456789",
        ])
          await assert.rejects(
            as(adminA, "select lead_save($1)", [{ company: "Invalid", phone }]),
            /country code/,
          );
        const lead = (
          await as(adminA, "select lead_save($1) data", [
            {
              company: "Valid contact",
              email: "person+sales@example.com",
              phone: "+923001234567",
            },
          ])
        )[0].data;
        assert.equal(lead.country, "Pakistan");
        const token = (
          await as(
            adminA,
            "select public_form_token from workspaces where id=$1",
            [A],
          )
        )[0].public_form_token;
        await owner("set role service_role");
        await assert.rejects(
          db.query("select public_lead_submit($1,$2)", [
            token,
            { company: "Public invalid", email: "no-email" },
          ]),
          /valid email/,
        );
        await db.exec("reset role");
        await owner(
          `alter table leads disable trigger validate_contact;update leads set email='legacy-invalid' where id='${lead.id}';alter table leads enable trigger validate_contact;`,
        );
        await as(adminA, "select lead_save($1)", [
          { id: lead.id, notes: "Unrelated edit" },
        ]);
        const migration = await readFile(
          new URL(
            "../supabase/migrations/20261012_profiles_permissions.sql",
            import.meta.url,
          ),
          "utf8",
        );
        await owner(migration);
        await owner(migration);
        assert.equal(
          (await as(memberA, "select perm('leads','archive') yes"))[0].yes,
          false,
        );
      },
    );
  } finally {
    await db.close();
  }
});
