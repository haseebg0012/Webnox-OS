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
            /current_workspace|is_master|master_can_read|own_profile|billing_workspace/.test(
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
  } finally {
    await db.close();
  }
});
