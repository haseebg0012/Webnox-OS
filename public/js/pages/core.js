import { registerRoute } from "../app.js";
import { state } from "../state.js";
import { empty, esc, table, chip } from "../ui.js";
import { rpc } from "../data.js";
import { money } from "../state.js";
import { date, duration } from "../time.js";
import { openTask } from "./tasks.js";
registerRoute("home", "Overview", async (el) => {
  const data = await rpc("dashboard"),
    activity = data.activity?.[0] || {},
    finance = data.finance;
  el.innerHTML = `<div class="page-heading"><div><h1>Welcome, ${esc(state.profile.name.split(" ")[0])}</h1><p>${date(data.today)} · A clear view of the work ahead.</p></div><a class="btn primary" href="#/tasks">Open tasks</a></div>${state.isAdmin && (!state.settings.invoice_details?.address || !state.settings.invoice_details?.bank_details) ? '<section class="card" style="margin-bottom:24px"><h2>Finish your business setup</h2><div class="row wrap"><a class="btn" href="#/settings">Business & invoice details</a><a class="btn" href="#/team">Add your team</a><a class="btn" href="#/permissions">Review permissions</a></div></section>' : ""}<div class="grid four" style="margin-bottom:24px">${[
    ["Open tasks", data.tasks.open],
    ["In review", data.tasks.in_review],
    ["Completed", data.tasks.completed],
    ["Overdue", data.tasks.overdue],
  ]
    .map(
      ([k, v]) =>
        `<section class="card"><div class="stat-label">${k}</div><div class="stat-value">${v}</div></section>`,
    )
    .join(
      "",
    )}</div><section class="card" style="margin-bottom:24px"><div class="section-heading"><h2>My day</h2><a href="#/activity">View activity</a></div><div class="grid four">${[
    ["Signed in", "signed_in_seconds"],
    ["Active", "active_seconds"],
    ["Idle", "idle_seconds"],
    ["Task timers", "task_seconds"],
  ]
    .map(
      ([k, v]) =>
        `<div><div class="stat-label">${k}</div><strong>${duration(activity[v])}</strong></div>`,
    )
    .join("")}</div></section>${
    finance
      ? `<div class="grid three" style="margin-bottom:24px">${[
          ["Revenue this month", finance.revenue],
          ["Expenses this month", finance.expense_total],
          [
            "Operating result",
            Number(finance.revenue) - Number(finance.expense_total),
          ],
        ]
          .map(
            ([k, v]) =>
              `<section class="card"><div class="stat-label">${k}</div><div class="stat-value">${money(v)}</div></section>`,
          )
          .join("")}</div>`
      : ""
  }<div class="grid two"><section><div class="section-heading"><h2>My next tasks</h2></div>${taskRows(data.my_tasks)}</section><section><div class="section-heading"><h2>Ready for your review</h2></div>${taskRows(data.reviews)}</section></div>${
    state.isAdmin || state.roles.includes("manager")
      ? `<section style="margin-top:24px"><div class="section-heading"><h2>Team today</h2><a href="#/reports">Work tracking</a></div>${table(
          ["Member", "Presence"],
          data.presence.map((p) => [esc(p.name), chip(p.presence)]),
        )}</section>`
      : ""
  }`;
  el.querySelectorAll("[data-task]").forEach(
    (b) => (b.onclick = () => openTask(b.dataset.task)),
  );
});
function taskRows(rows) {
  return rows.length
    ? table(
        ["Task", "Status", "Due"],
        rows.map((t) => [
          `<button class="text-button" data-task="${t.id}">${esc(t.title)}</button>`,
          chip(t.status),
          date(t.due_date),
        ]),
      )
    : empty(
        "Nothing waiting here",
        "New tasks and reviews will appear as your team works.",
      );
}
await import("./workspaces.js");
await import("./team.js");
await import("./tasks.js");
await import("./reports.js");
await import("./settings.js");
await import("./crm.js");
await import("./projects.js");
await import("./finance.js");
await import("./invoices.js");
await import("../finance-files.js");
await import("./billing.js");

await import("./master-profile.js");
await import("./master-control.js");
