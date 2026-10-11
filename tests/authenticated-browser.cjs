const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const workspace = {
  id: "10000000-0000-0000-0000-000000000001",
  name: "Fixture business",
  slug: "fixture-business",
  short_code: "FB",
  type: "master_project",
  status: "active",
  member_count: 2,
  created_at: "2026-10-11T10:00:00Z",
};
const members = [
  {
    id: "20000000-0000-0000-0000-000000000001",
    workspace_id: workspace.id,
    name: "Fixture Admin",
    email: "admin@fixture.invalid",
    account_type: "admin",
    is_master: false,
    status: "active",
    job_title: "Business owner",
    department: "Management",
    employee_id: "EMP-0001",
    roles: [],
    created_at: "2026-10-11T10:00:00Z",
  },
  {
    id: "20000000-0000-0000-0000-000000000002",
    workspace_id: workspace.id,
    name: "Fixture Manager",
    email: "manager@fixture.invalid",
    account_type: "member",
    is_master: false,
    status: "active",
    job_title: "Manager",
    department: "Management",
    employee_id: "EMP-0002",
    roles: ["manager"],
    created_at: "2026-10-11T10:00:00Z",
  },
];
function clientSource(world) {
  const profile =
    world === "master"
      ? {
          id: "20000000-0000-0000-0000-000000000003",
          name: "Fixture Master",
          email: "master@fixture.invalid",
          is_master: true,
          status: "active",
          account_type: "master",
        }
      : members[0];
  const context = {
    profile,
    workspace: world === "master" ? null : workspace,
    settings: { timezone: "Asia/Karachi", app_currency: "PKR" },
    roles: [],
    permissions: [],
  };
  return `const context=${JSON.stringify(context)},members=${JSON.stringify(members)};const sb={auth:{async getSession(){return {data:{session:{user:{id:context.profile.id},access_token:'local-test-token'}}}},onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}}},async rpc(name){return {data:name==='boot_context'?context:name==='team_directory'?members:null}},from(name){const rows=name==='master_member_list'?members:name==='workspace_roles'?['sales_rep','finance','project_manager'].map(role_key=>({role_key,active:true})):[];const chain={select(){return chain},eq(){return chain},in(){return chain},is(){return chain},order(){return chain},limit(){return Promise.resolve({data:rows})}};return chain}};export async function getSupabase(){return sb}`;
}
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const base = process.env.TEST_URL || "http://localhost:3000";
  let checks = 0;
  try {
    for (const world of ["master", "business"])
      for (const width of [390, 768, 1024, 1440]) {
        const page = await browser.newPage({
          viewport: { width, height: 900 },
        });
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
          if (m.type() === "error") errors.push(m.text());
        });
        await page.route("**/js/supabase.js", (route) =>
          route.fulfill({
            contentType: "application/javascript",
            body: clientSource(world),
          }),
        );
        await page.route("**/api/master/workspaces", async (route) => {
          if (route.request().method() === "GET")
            await route.fulfill({ json: [workspace] });
          else
            await route.fulfill({
              status: 201,
              json: { workspace, invites: [] },
            });
        });
        const routes =
          world === "master"
            ? [
                "master-home",
                "master-workspaces",
                "create-workspace",
                "workspace/" + workspace.id,
              ]
            : ["home", "team"];
        for (const route of routes) {
          errors.length = 0;
          await page.goto(base + "/#/" + route, { waitUntil: "networkidle" });
          await page
            .locator("#page h1")
            .waitFor({ timeout: 5000 })
            .catch(async (e) => {
              console.error(
                JSON.stringify({
                  world,
                  route,
                  width,
                  errors,
                  body: await page.locator("body").innerText(),
                }),
              );
              throw e;
            });
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth,
            ),
            false,
            `${world} ${route} ${width}`,
          );
          assert.equal(
            await page
              .getByText("Unable to load this page", { exact: true })
              .count(),
            0,
          );
          assert.deepEqual(errors, [], `${world} ${route}`);
          checks++;
          if (width === 1440 || width === 390)
            await page.screenshot({
              path: `tmp/${route.split("/")[0]}-${width}.png`,
              fullPage: true,
            });
        }
        if (world === "master") {
          await page.goto(base + "/#/create-workspace");
          await page
            .getByLabel("Business name *", { exact: true })
            .fill("New Fixture");
          assert.equal(
            await page.locator("input[name=slug]").inputValue(),
            "new-fixture",
          );
        } else {
          await page
            .getByRole("button", { name: "Add team member", exact: true })
            .click();
          await page.getByRole("dialog").waitFor();
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth,
            ),
            false,
          );
          await page.keyboard.press("Escape");
          await page.locator("dialog").waitFor({ state: "detached" });
        }
        await page.close();
      }
    fs.writeFileSync(
      "tmp/authenticated-browser-results.json",
      JSON.stringify({ checks, errors: 0 }, null, 2),
    );
    console.log(`${checks} authenticated responsive route checks passed.`);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
