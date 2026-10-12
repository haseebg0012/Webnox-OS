// Development-only end-to-end harness: real application pages, HTTP and PGlite
// RPC/RLS execution. Auth identities are synthetic; no live users or data touched.
import express from "express";
import { once } from "node:events";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const db = new PGlite();
const A = "10000000-0000-0000-0000-000000000001",
  admin = "20000000-0000-0000-0000-000000000001",
  manager = "20000000-0000-0000-0000-000000000002";
await db.exec(
  `create schema auth;create role anon;create role authenticated;create role service_role bypassrls;create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb default '{}',raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon;grant select,insert,update,delete on storage.objects to authenticated,anon;`,
);
await db.exec(
  await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8"),
);
await db.exec(
  `begin;insert into auth.users(id,email) values('${admin}','admin@fixture.invalid'),('${manager}','manager@fixture.invalid');insert into workspaces(id,name,slug,short_code,type) values('${A}','Browser Fixture','browser-fixture','BF','master_project');insert into profiles(id,workspace_id,name,email,account_type,job_title) values('${admin}','${A}','Fixture Admin','admin@fixture.invalid','admin','Business owner'),('${manager}','${A}','Fixture Manager','manager@fixture.invalid','member','Manager');insert into member_roles(workspace_id,user_id,role_key) values('${A}','${manager}','manager');update workspaces set status='active';commit;`,
);
let queue = Promise.resolve();
function run(sql, params = []) {
  const job = queue.then(async () => {
    await db.exec(
      `select set_config('request.jwt.claim.sub','${admin}',false);set role authenticated;`,
    );
    try {
      return (await db.query(sql, params)).rows;
    } finally {
      await db.exec("reset role");
    }
  });
  queue = job.catch(() => {});
  return job;
}
const ident = (s) => {
  if (!/^[a-z_]+$/.test(s)) throw new Error("Invalid identifier");
  return '"' + s + '"';
};
const app = express();
app.use(express.json());
app.post("/fixture/rpc", async (req, res) => {
  try {
    const { name, args = {} } = req.body,
      entries = Object.entries(args),
      sql = `select ${ident(name)}(${entries.map(([k], i) => `${ident(k)} => $${i + 1}`).join(",")}) result`;
    res.json({
      data: (
        await run(
          sql,
          entries.map(([, v]) => v),
        )
      )[0].result,
    });
  } catch (error) {
    res.json({ error: { message: error.message } });
  }
});
app.post("/fixture/query", async (req, res) => {
  try {
    const { name, filters = [], order, ascending, limit = 500 } = req.body;
    const args = [];
    let sql = "select * from " + ident(name);
    if (filters.length)
      sql +=
        " where " +
        filters
          .map(([k, v, op]) => {
            if (v === null) return ident(k) + " is null";
            args.push(v);
            return (
              ident(k) +
              (op === "in" ? ` = any($${args.length})` : ` = $${args.length}`)
            );
          })
          .join(" and ");
    if (order)
      sql += " order by " + ident(order) + (ascending ? " asc" : " desc");
    sql += " limit " + Math.min(500, Math.max(1, Number(limit) || 500));
    res.json({ data: await run(sql, args) });
  } catch (error) {
    res.json({ error: { message: error.message } });
  }
});
app.get("/js/supabase.js", (_req, res) =>
  res
    .type("text/javascript")
    .send(
      `const send=(path,body)=>fetch('/fixture/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());const sb={auth:{getUser:async()=>({data:{user:{id:'${admin}',email:'admin@fixture.invalid',email_confirmed_at:'2026-10-12T00:00:00Z'}}}),getSession:async()=>({data:{session:{user:{id:'${admin}'},access_token:'fixture-only'}}}),onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}}},rpc:(name,args)=>send('rpc',{name,args}),from(name){const query={name,filters:[]};const chain={select(){return chain},eq(k,v){query.filters.push([k,v,'eq']);return chain},is(k,v){query.filters.push([k,v,'is']);return chain},in(k,v){query.filters.push([k,v,'in']);return chain},order(k,{ascending}){query.order=k;query.ascending=ascending;return chain},limit(limit){query.limit=limit;return send('query',query)}};return chain}};export async function getSupabase(){return sb}`,
    ),
);
app.use(express.static(fileURLToPath(new URL("../public", import.meta.url))));
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const base = `http://127.0.0.1:${server.address().port}`;
const go = async (route) => {
  await page.goto(base + "/#/" + route);
  await page.locator("#page h1").first().waitFor();
  assert.equal(
    await page.getByText("Unable to load this page", { exact: true }).count(),
    0,
  );
};
const fill = (label, value) =>
  page.getByLabel(label, { exact: true }).fill(value);
const click = async (name) => {
  const dialogs = page.locator("dialog[open]");
  const scope = (await dialogs.count()) ? dialogs.last() : page;
  await scope.getByRole("button", { name, exact: true }).click();
};
const closeDialog = () => page.locator("dialog").waitFor({ state: "detached" });
try {
  await go("profile");
  await fill("First name *", "Updated");
  await fill("Last name", "Admin");
  await fill("Display name *", "Updated Admin");
  await click("Save profile changes");
  await page.getByText("Profile changes saved", { exact: true }).waitFor();
  await page.reload();
  await page.getByLabel("First name *", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("First name *", { exact: true }).inputValue(),
    "Updated",
  );
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  const trigger = await page.locator("#profile-menu").boundingBox(),
    dropdown = await page.locator("#account-dropdown").boundingBox();
  assert.ok(
    dropdown.y >= trigger.y + trigger.height &&
      dropdown.x + dropdown.width <= 1440,
  );
  for (const name of ["Edit profile", "Settings", "Permissions"])
    await page
      .locator("#account-dropdown")
      .getByRole("link", { name, exact: true })
      .waitFor();
  await page
    .locator("#account-dropdown")
    .getByRole("link", { name: "Permissions", exact: true })
    .focus();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#account-dropdown").isVisible(), false);
  await go("permissions");
  const toggle = page.getByRole("switch", {
    name: "Sales Representative leads archive",
    exact: true,
  });
  await toggle.click();
  const checked = await toggle.getAttribute("aria-checked");
  await click("Save permissions");
  await page.getByText("Permissions saved", { exact: true }).waitFor();
  await page.reload();
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute("aria-checked"), checked);
  await page.screenshot({ path: "tmp/permissions-matrix.png", fullPage: true });
  await go("leads");
  await click("Add lead");
  await fill("Name", "Browser Contact");
  await fill("Company *", "Browser Company");
  assert.equal(
    await page.getByLabel("Country", { exact: true }).inputValue(),
    "Pakistan",
  );
  await page
    .getByLabel("Industry / niche", { exact: true })
    .selectOption("Ecommerce");
  await fill("Email", "invalid@host.x");
  await fill("Phone", "122131");
  await click("Add lead");
  assert.equal(await page.locator("dialog[open]").count(), 1);
  assert.equal((await run("select count(*)::int n from leads"))[0].n, 0);
  assert.equal(
    await page
      .getByLabel("Email", { exact: true })
      .evaluate((e) => e.validity.valid),
    false,
  );
  await fill("Email", "contact@example.com");
  assert.equal(
    await page
      .getByLabel("Phone", { exact: true })
      .evaluate((e) => e.validity.valid),
    false,
  );
  await fill("Phone", "+923001234567");
  await page.getByLabel("Stage", { exact: true }).selectOption("won");
  await click("Add lead");
  await closeDialog();
  await click("Browser Company");
  await click("Convert to client");
  await click("Convert");
  await page
    .getByRole("dialog")
    .filter({ hasText: "Client created" })
    .waitFor();
  await page
    .getByRole("link", { name: "Create a project now", exact: true })
    .click();
  await fill("Project name *", "Browser Delivery");
  await click("Create project");
  await page
    .getByRole("heading", { name: "Browser Delivery", exact: true })
    .waitFor();
  await click("Requirements");
  await click("Add requirement");
  await fill("Title *", "Working checkout");
  await click("Save requirement");
  await closeDialog();
  await click("Tasks");
  await click("Create task");
  await fill("Task title *", "Deliver checkout");
  await page.getByLabel("Assign to *", { exact: true }).selectOption(admin);
  await click("Create task");
  await closeDialog();
  await go("tasks");
  await click("Deliver checkout");
  await click("Start timer");
  await closeDialog();
  await click("Deliver checkout");
  await click("Submit for review");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Approve", exact: true })
    .waitFor();
  await click("Approve");
  await page
    .getByRole("dialog")
    .getByText("Completed", { exact: true })
    .first()
    .waitFor();
  await page.keyboard.press("Escape");
  await go("new-invoice/client");
  await page
    .getByLabel("Client *", { exact: true })
    .selectOption({ label: "Browser Company · BUID-1001" });
  await fill("Description", "Website delivery");
  await fill("Unit price", "12500");
  await click("Create invoice");
  await page
    .getByRole("heading", { name: "INV-BUID-1001-BC001", exact: true })
    .waitFor();
  await click("Mark paid");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Mark paid", exact: true })
    .click();
  await closeDialog();
  await page.getByText("Paid", { exact: true }).first().waitFor();
  await go("finance/expenses");
  await click("New expense");
  await fill("Title *", "Test hosting");
  await fill("Amount *", "500");
  await click("Save expense");
  await page.getByRole("dialog").filter({ hasText: "Attachments" }).waitFor();
  await page.keyboard.press("Escape");
  await go("finance/bills");
  await click("New bill");
  await fill("Title *", "Test one-time bill");
  await fill("Amount *", "200");
  await page.getByLabel("Frequency", { exact: true }).selectOption("one_time");
  await click("Save bill");
  await page.getByRole("dialog").filter({ hasText: "Attachments" }).waitFor();
  await page.keyboard.press("Escape");
  await click("Mark paid");
  await click("Record payment");
  await page.getByRole("dialog").filter({ hasText: "Attachments" }).waitFor();
  await page.keyboard.press("Escape");
  await go("home");
  await page.getByText("PKR 12,500", { exact: true }).first().waitFor();
  const task = (
    await run("select * from tasks where title='Deliver checkout'")
  )[0];
  assert.equal(task.status, "completed");
  const timer = await run("select * from task_time_entries where task_id=$1", [
    task.id,
  ]);
  assert.equal(timer.length, 1);
  assert.ok(timer[0].ended_at);
  assert.equal((await run("select * from clients")).length, 1);
  assert.equal((await run("select * from projects")).length, 1);
  assert.equal((await run("select * from project_requirements")).length, 1);
  const summary = (
    await run("select finance_summary(current_date-1,current_date+1) result")
  )[0].result;
  assert.equal(summary.revenue, 12500);
  assert.equal(summary.expense_total, 700);
  await mkdir("tmp", { recursive: true });
  await page.screenshot({
    path: "tmp/integration-dashboard.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await writeFile(
    "tmp/integration-browser-results.json",
    JSON.stringify(
      {
        passed: true,
        flows: [
          "lead conversion",
          "project requirement",
          "task timer and approval",
          "invoice payment",
          "expense",
          "one-time bill",
          "dashboard totals",
        ],
        consoleErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Database-backed browser workflows passed: lead → client → project → task/timer/review; invoice → payment; expenses/bills → dashboard.",
  );
} catch (error) {
  await mkdir("tmp", { recursive: true });
  await page.screenshot({
    path: "tmp/integration-failure.png",
    fullPage: true,
  });
  console.error(errors);
  console.error((await page.locator("body").innerText()).slice(-4500));
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await queue;
  await db.close();
}
