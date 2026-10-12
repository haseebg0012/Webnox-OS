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
const master = "20000000-0000-0000-0000-000000000099";
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
await db.exec(
  `insert into auth.users(id,email) values('${master}','master@fixture.invalid');insert into profiles(id,name,email,is_master,account_type) values('${master}','Fixture Master','master@fixture.invalid',true,'master')`,
);
let actor = master;
let queue = Promise.resolve();
function run(sql, params = []) {
  const job = queue.then(async () => {
    await db.exec(
      `select set_config('request.jwt.claim.sub','${actor}',false);set role authenticated;`,
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

let uploaded;
app.post(
  "/fixture/upload",
  express.raw({ type: "image/webp", limit: "1mb" }),
  async (req, res) => {
    try {
      uploaded = req.body;
      await run(
        "insert into storage.objects(bucket_id,name) values('avatars',$1)",
        [req.query.path],
      );
      res.json({ data: { path: req.query.path } });
    } catch (error) {
      res.json({ error: { message: error.message } });
    }
  },
);
app.get("/fixture/avatar", (_req, res) =>
  res.type("image/webp").send(uploaded),
);
app.get("/api/master/workspaces", async (_req, res) =>
  res.json((await run("select master_workspace_list() result"))[0].result),
);
app.get("/js/supabase.js", (_req, res) =>
  res.type("text/javascript").send(`
 const send=(path,body)=>fetch('/fixture/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
 const sb={auth:{getUser:async()=>({data:{user:{id:'${master}',email:'master@fixture.invalid',email_confirmed_at:'2026-10-12T00:00:00Z',last_sign_in_at:'2026-10-12T00:00:00Z'}}}),getSession:async()=>({data:{session:{user:{id:'${master}'},access_token:'fixture-only'}}}),signInWithPassword:async p=>p.password==='fixture-current'?{data:{}}:{error:{message:'Invalid'}},updateUser:async p=>{window.__passwordUpdated=true;return {data:{}}},onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}}},rpc:(name,args)=>send('rpc',{name,args}),storage:{from(){return {upload:(path,blob)=>fetch('/fixture/upload?path='+encodeURIComponent(path),{method:'POST',headers:{'Content-Type':'image/webp'},body:blob}).then(r=>r.json()),createSignedUrl:async()=>({data:{signedUrl:'/fixture/avatar'}}),remove:async()=>({data:{}})}}},from(name){const query={name,filters:[]};const chain={select(){return chain},eq(k,v){query.filters.push([k,v,'eq']);return chain},is(k,v){query.filters.push([k,v,'is']);return chain},in(k,v){query.filters.push([k,v,'in']);return chain},order(k,{ascending}){query.order=k;query.ascending=ascending;return chain},limit(limit){query.limit=limit;return send('query',query)}};return chain}};export async function getSupabase(){return sb}
`),
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
  await go("master-profile");
  await fill("First name *", "Updated");
  await fill("Last name", "Owner");
  await fill("Display name *", "Updated Owner");
  await fill("Phone number", "+123456789");
  await fill("Date of birth", "1990-03-15");
  await click("Save profile changes");
  await page.getByText("Profile changes saved", { exact: true }).waitFor();
  await page.reload();
  await page.getByLabel("Display name *", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Display name *", { exact: true }).inputValue(),
    "Updated Owner",
  );
  const source = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 900;
    c.height = 500;
    const x = c.getContext("2d");
    x.fillStyle = "red";
    x.fillRect(0, 0, 450, 500);
    x.fillStyle = "blue";
    x.fillRect(450, 0, 450, 500);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page
    .locator("[data-picture]")
    .setInputFiles({
      name: "fixture.png",
      mimeType: "image/png",
      buffer: Buffer.from(source, "base64"),
    });
  await page.locator("canvas.avatar-crop").waitFor();
  for (const [name, value] of [
    ["Zoom", "2"],
    ["Horizontal position", "-40"],
    ["Vertical position", "20"],
  ])
    await page.getByLabel(name, { exact: true }).fill(value);
  await page.screenshot({ path: "tmp/master-cropper-1440.png" });
  await click("Save cropped picture");
  await closeDialog();
  assert.equal(uploaded.subarray(0, 4).toString(), "RIFF");
  assert.equal(uploaded.subarray(8, 12).toString(), "WEBP");
  await page.reload();
  await page.locator(".profile-portrait img").waitFor();
  const size = await page
    .locator(".profile-portrait img")
    .evaluate((img) => ({
      width: img.naturalWidth,
      height: img.naturalHeight,
    }));
  assert.deepEqual(size, { width: 512, height: 512 });
  await fill("Current password *", "wrong");
  await fill("New password *", "fixture-new-123");
  await fill("Confirm new password *", "fixture-new-123");
  await click("Update Master password");
  await page
    .getByText("Current password could not be verified. Check it and retry.")
    .waitFor();
  assert.equal(await page.evaluate(() => !!window.__passwordUpdated), false);
  await fill("Current password *", "fixture-current");
  await click("Update Master password");
  await page.getByText("Password updated successfully.").waitFor();
  assert.equal(
    await page.evaluate(() =>
      Object.values(localStorage).some((v) => v.includes("fixture-new-123")),
    ),
    false,
  );
  await go("master-roles");
  await click("Create business role");
  await fill("Role name *", "Web Developer");
  await page
    .getByLabel("Department", { exact: true })
    .last()
    .selectOption("Development");
  await fill(
    "Responsibilities (one per line)",
    "Build accessible pages\nReview changes",
  );
  await click("Save business role");
  await closeDialog();
  await go("master-templates");
  await click("Create task template");
  await fill("Task name *", "Build landing page");
  await fill("Step-by-step instructions", "Use semantic HTML. Verify mobile.");
  await click("Save task template");
  await closeDialog();
  await go("workspace/" + A);
  await click("Settings");
  await click("Edit business details");
  await fill("Registered / legal name", "Fixture Legal Ltd");
  await fill("City", "Fixture City");
  await fill("Website", "https://fixture.invalid");
  await click("Save business details");
  await closeDialog();
  const saved = (await run("select master_workspace_list() data"))[0].data.find(
    (w) => w.id === A,
  );
  assert.equal(saved.business_details.city, "Fixture City");
  await go("master-profile");
  await page.screenshot({
    path: "tmp/master-profile-workflow.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Master database-backed workflows passed: profile persistence, 512px crop upload, password guards, catalog save and workspace details. Auth and storage transport use local fixtures; RPC/RLS use PGlite.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await db.close();
}
