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
    settings: {
      timezone: "Asia/Karachi",
      app_currency: "PKR",
      company_name: "Fixture business",
      idle_minutes: 5,
      due_days: 7,
      pause_days: 14,
      invoice_details: {},
    },
    roles: [],
    permissions: [],
  };

  const client = {
    id: "30000000-0000-0000-0000-000000000001",
    workspace_id: workspace.id,
    name: "Fixture Contact",
    company: "Fixture Client",
    buid: "BUID-1001",
    invoice_code: "FC",
    status: "active",
    currency: "PKR",
    monthly_retainer: 1000,
  };
  const project = {
    id: "40000000-0000-0000-0000-000000000001",
    workspace_id: workspace.id,
    client_id: client.id,
    name: "Fixture project",
    status: "active",
    currency: "PKR",
    budget: 5000,
    description: "Build an online store",
    pm_id: members[1].id,
  };
  const invoice = {
    id: "50000000-0000-0000-0000-000000000001",
    workspace_id: workspace.id,
    client_id: client.id,
    kind: "client",
    number: "INV-BUID-1001-FC001",
    reference: "FIXTURE-REFERENCE",
    status: "unpaid",
    issued_by: { name: "Fixture Admin", designation: "Business owner" },
    issuer_details: {
      company_name: "Fixture business",
      address: "Fixture address",
      bank_details: "Fixture bank details",
      due_days: 7,
      pause_days: 14,
    },
    billed_to: {
      company: client.company,
      name: client.name,
      buid: client.buid,
      address: "Fixture client address",
    },
    issue_date: "2026-10-11",
    due_date: "2026-10-18",
    currency: "PKR",
    fx_rate: 1,
    line_items: [
      {
        description: "Website design and development",
        quantity: 1,
        unit_price: 5000,
      },
    ],
    subtotal: 5000,
    discount_percent: 0,
    discount_amount: 0,
    tax_percent: 0,
    tax_amount: 0,
    amount_original: 5000,
    amount: 5000,
  };
  const tables = {
    master_member_list: members,
    workspace_roles: ["sales_rep", "finance", "project_manager"].map(
      (role_key) => ({ role_key, active: true }),
    ),
    clients: [client],
    projects: [project],
    invoices: [invoice],
    platform_settings: [
      { company_name: "Webnox OS", bank_details: {}, invoice_details: {} },
    ],
  };
  const responses = {
    boot_context: context,
    master_team_list: [
      {
        ...profile,
        platform_role: "owner",
        platform_permissions: [],
        created_at: "2026-10-12T00:00:00Z",
      },
    ],
    team_directory: members,
    dashboard: {
      today: "2026-10-11",
      tasks: { open: 0, in_review: 0, completed: 0, overdue: 0 },
      my_tasks: [],
      reviews: [],
      presence: [],
      activity: [],
      finance: null,
    },
    finance_summary: {
      revenue: 0,
      expense_total: 0,
      salary_total: 0,
      investment_net: 0,
    },
    master_overview: {
      workspaces: 1,
      active: 1,
      trials: 0,
      overdue: 0,
      receipts: [],
      due: [],
    },
    master_open_workspace: { members: 2, active: 0, idle: 0, never_joined: 2 },
    billing_details: {
      subscription: null,
      payments: [],
      bank_details: {},
      company_name: "Webnox OS",
    },
    session_start: "fixture-session",
    session_heartbeat: { expired: false },
  };
  return (
    "const context=" +
    JSON.stringify(context) +
    ",tables=" +
    JSON.stringify(tables) +
    ",responses=" +
    JSON.stringify(responses) +
    ";" +
    "const sb={auth:{async getUser(){return {data:{user:{...context.profile,email_confirmed_at:'2026-10-12T00:00:00Z',last_sign_in_at:'2026-10-12T00:00:00Z'}}}},async getSession(){return {data:{session:{user:{id:context.profile.id},access_token:'local-test-token'}}}},onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}}},async rpc(name){return {data:responses[name]??null}},from(name){let rows=tables[name]||[];const chain={select(){return chain},eq(k,v){rows=rows.filter(r=>r[k]===v);return chain},in(k,v){rows=rows.filter(r=>v.includes(r[k]));return chain},is(k,v){rows=rows.filter(r=>r[k]==v);return chain},order(){return chain},limit(){return Promise.resolve({data:rows})}};return chain}};export async function getSupabase(){return sb}"
  );
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
                "master-finance",
                "master-finance/plans",
                "master-finance/payments",
                "master-finance/invoices",
                "master-settings",
                "master-profile",
                "master-team",
                "master-roles",
                "master-templates",
                "master-activity",
                "create-workspace",
                "workspace/" + workspace.id,
              ]
            : [
                "home",
                "tasks",
                "activity",
                "reports",
                "permissions",
                "settings",
                "leads",
                "clients",
                "projects",
                "new-project",
                "client/30000000-0000-0000-0000-000000000001",
                "project/40000000-0000-0000-0000-000000000001",
                "finance",
                "finance/expenses",
                "finance/bills",
                "finance/investments",
                "finance/client-invoices",
                "finance/business-invoices",
                "finance/report",
                "billing",
                "new-invoice/client",
                "new-invoice/business",
                "invoice/50000000-0000-0000-0000-000000000001",
                "edit-invoice/50000000-0000-0000-0000-000000000001",
                "team",
              ];
        for (const route of routes) {
          errors.length = 0;
          await page.goto(base + "/#/" + route, { waitUntil: "networkidle" });
          await page
            .locator("#page h1")
            .first()
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
          if (/^(client|project|workspace)\//.test(route)) {
            const tabs = page.locator("#page [data-tab]");
            for (let i = 0; i < (await tabs.count()); i++) {
              const tabName = await tabs.nth(i).textContent();
              await tabs.nth(i).click();
              await page.waitForLoadState("networkidle");
              assert.equal(
                await page
                  .locator("#page")
                  .getByText("Unable to load this page", { exact: true })
                  .count(),
                0,
              );
              assert.equal(
                await page.evaluate(
                  () => document.documentElement.scrollWidth > innerWidth,
                ),
                false,
                `${route} ${tabName} ${width}`,
              );
              assert.deepEqual(errors, [], `${route} ${tabName}`);
              checks++;
            }
          }
          if (route.startsWith("invoice/") && width === 1440) {
            await page.pdf({
              path: "tmp/invoice-print.pdf",
              format: "A4",
              printBackground: true,
              preferCSSPageSize: true,
            });
          }
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
          await page.goto(base + "/#/tasks");
          await page
            .getByRole("button", { name: "Create task", exact: true })
            .click();
          await page.getByRole("dialog").waitFor();
          await page
            .getByLabel("Task title *", { exact: true })
            .fill("Browser fixture task");
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth,
            ),
            false,
          );
          await page.keyboard.press("Escape");
          await page.goto(base + "/#/team");
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
