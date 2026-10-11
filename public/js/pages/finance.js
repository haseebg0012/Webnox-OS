import { registerRoute } from "../app.js";
import { state, can, money } from "../state.js";
import { q, rpc, loadMembers } from "../data.js";
import {
  esc,
  field,
  formValues,
  dialog,
  busy,
  toast,
  table,
  empty,
  chip,
  confirmDialog,
  downloadCSV,
} from "../ui.js";
import { date, today } from "../time.js";
import { moneyFields, bindMoney } from "../money.js";
const manager = () => state.isAdmin || state.roles.includes("manager");
const refresh = () => dispatchEvent(new HashChangeEvent("hashchange"));
const categories = [
  "software",
  "marketing",
  "office",
  "travel",
  "contractor",
  "other",
];
export async function financeForm(kind, record) {
  const r = record || {},
    members = manager() ? await loadMembers() : [];
  const d = dialog(
    `${record ? "Edit" : "New"} ${kind}`,
    `<form class="stack"><div class="form-grid">${field("title", "Title", r.title || "", { required: true, full: true })}${kind === "investment" ? field("kind", "Type", r.kind || "capital_in", { options: ["capital_in", "capital_out", "loan_in", "loan_repayment"] }) : field("category", "Category", r.category || "other", { options: [...categories, ...(manager() ? ["salary"] : [])] })}${kind !== "investment" && manager() ? field("employee_id", "Employee (salary only)", r.employee_id || "", { options: [["", "Not applicable"], ...members.map((m) => [m.id, m.name])] }) : ""}${moneyFields(r)}${kind === "bill" ? `${field("frequency", "Frequency", r.frequency || "monthly", { options: ["one_time", "weekly", "monthly", "quarterly", "yearly"] })}${field("next_due", "Renews on", r.next_due || today(), { type: "date", required: true })}<label class="check span-all"><input name="automatic" type="checkbox" ${r.automatic ? "checked" : ""}>Charged automatically</label>` : field(kind === "expense" ? "paid_on" : "occurred_on", "Date", r.paid_on || r.occurred_on || today(), { type: "date", required: true })}${field("notes", "Notes", r.notes || "", { type: "textarea", full: true })}</div><p class="form-error" role="alert"></p><button class="btn primary" type="submit">Save ${kind}</button></form>`,
    { wide: true },
  );
  const form = d.querySelector("form");
  bindMoney(form);
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form.querySelector("[type=submit]"), async () => {
      try {
        const payload = formValues(form);
        if (record) payload.id = record.id;
        if (kind === "bill") payload.automatic = form.automatic.checked;
        const saved = await rpc("finance_save", { kind, payload });
        d.close();
        toast("Saved");
        refresh();
        if (kind !== "investment")
          dispatchEvent(
            new CustomEvent("finance-attachments", {
              detail: { kind, record: saved },
            }),
          );
      } catch (error) {
        form.querySelector(".form-error").textContent = error.message;
      }
    });
  };
}
function settleBill(b, skip) {
  const d = dialog(
    skip ? "Skip this occurrence" : "Mark bill paid",
    `<form class="stack"><p>${esc(b.title)} · ${money(b.amount_original, b.currency)}</p><p>Occurrence due ${date(b.next_due)}. ${b.frequency === "one_time" ? "This one-time bill will close." : "The next due date advances by one cycle."}</p>${skip ? "" : field("paid_on", "Paid on", today(), { type: "date", required: true })}<p class="form-error" role="alert"></p><button class="btn primary">${skip ? "Skip occurrence" : "Record payment"}</button></form>`,
  );
  const form = d.querySelector("form");
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form.querySelector(".btn"), async () => {
      try {
        const id = await rpc("bill_settle", {
          target: b.id,
          expected_due: b.next_due,
          skip,
          paid_on: skip ? today() : form.paid_on.value,
        });
        d.close();
        refresh();
        toast(skip ? "Occurrence skipped" : "Payment recorded");
        if (id)
          dispatchEvent(
            new CustomEvent("finance-attachments", {
              detail: { kind: "expense", record: { id, title: b.title } },
            }),
          );
      } catch (error) {
        form.querySelector(".form-error").textContent = error.message;
      }
    });
  };
}
export async function renderFinanceSummary(el, from, to) {
  const s = await rpc("finance_summary", { from_day: from, to_day: to });
  const revenue = Number(s.revenue || 0);
  el.innerHTML = `<div class="grid four">${[
    ["Revenue received", revenue],
    ["Expenses", s.expense_total],
    ["Salary total", s.salary_total],
    ["Net operating", revenue - Number(s.expense_total)],
  ]
    .map(
      ([name, n]) =>
        `<section class="card"><div class="stat-label">${name}</div><div class="stat-value">${money(n)}</div></section>`,
    )
    .join(
      "",
    )}</div><section class="card" style="margin-top:24px"><h2>Capital and funding</h2><p>${money(s.investment_net)} net movement during this period.</p><p class="muted small">Capital is shown separately from operating revenue and expenses. Salary total is included in expenses.</p></section>`;
  return { ...s, revenue, net_operating: revenue - Number(s.expense_total) };
}
registerRoute("finance", "Finance", async (el, [tab = "dashboard"]) => {
  if (!can("finance")) throw new Error("Access is not permitted.");
  const tabs = [
    ["dashboard", "Dashboard"],
    ["expenses", "Expenses"],
    ["bills", manager() ? "Bills & salaries" : "Bills"],
    ["investments", "Investments"],
    ["client-invoices", "Client invoices"],
    ["business-invoices", "Business invoices"],
    ["report", "Monthly report"],
  ];
  el.innerHTML = `<div class="page-heading"><div><h1>Finance</h1><p>Clear records for your business.</p></div></div><div class="tabs">${tabs.map(([key, name]) => `<a href="#/finance/${key}" class="${tab === key ? "active" : ""}">${name}</a>`).join("")}</div><div id="finance-content"></div>`;
  const content = el.querySelector("#finance-content");
  if (tab === "dashboard")
    await renderFinanceSummary(content, today().slice(0, 7) + "-01", today());
  else if (tab === "report") {
    content.innerHTML = `<form class="toolbar">${field("month", "Month", today().slice(0, 7), { type: "month", required: true })}<button class="btn primary">Load report</button><button class="btn" type="button" data-export>Export CSV</button></form><div data-report></div>`;
    const form = content.querySelector("form");
    let report;
    const draw = async () => {
      try {
        const month = form.month.value,
          from = month + "-01",
          to = new Date(
            Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0),
          )
            .toISOString()
            .slice(0, 10);
        report = {
          month,
          ...(await renderFinanceSummary(
            content.querySelector("[data-report]"),
            from,
            to,
          )),
        };
      } catch (e) {
        toast(e.message, "error");
      }
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      draw();
    };
    form.querySelector("[data-export]").onclick = () => {
      if (report) downloadCSV("finance-report.csv", [report]);
    };
    await draw();
  } else if (tab.endsWith("invoices")) {
    dispatchEvent(
      new CustomEvent("invoice-list", {
        detail: {
          kind: tab === "client-invoices" ? "client" : "business",
          element: content,
        },
      }),
    );
  } else if (["expenses", "bills", "investments"].includes(tab)) {
    const kind = {
        expenses: "expense",
        bills: "bill",
        investments: "investment",
      }[tab],
      rows = await q(tab === "bills" ? "recurring_expenses" : tab, {
        filters: tab === "bills" ? {} : { archived_at: null },
      });
    content.innerHTML = `<div class="section-heading"><h2>${tabs.find((t) => t[0] === tab)[1]}</h2>${can("finance", "edit") ? `<button class="btn primary" data-add>New ${kind}</button>` : ""}</div>${
      rows.length
        ? table(
            [
              "Description",
              "Category / type",
              "Original",
              "Reporting amount",
              tab === "bills" ? "Renews on" : "Date",
              "",
            ],
            rows.map((r, i) => [
              `${esc(r.title)}${r.automatic ? '<div class="small muted">Charged automatically</div>' : ""}`,
              chip(r.category || r.kind),
              money(r.amount_original, r.currency),
              money(r.amount),
              tab === "bills"
                ? `${date(r.next_due)}<div class="small muted">${r.active ? "Active · " + r.frequency.replace("_", " ") : "Closed"}</div>`
                : date(r.paid_on || r.occurred_on),
              `<div class="row wrap">${can("finance", "edit") ? `${tab === "bills" && r.active ? `<button class="btn small" data-paid="${i}">Mark paid</button><button class="btn small" data-skip="${i}">Skip</button>` : ""}${!r.bill_id ? `<button class="btn small" data-edit="${i}">Edit</button>` : ""}` : ""}${kind !== "investment" ? `<button class="btn small" data-files="${i}">Attachments</button>` : ""}${can("finance", "delete") ? `<button class="btn small" data-archive="${i}">Archive</button>` : ""}</div>`,
            ]),
          )
        : empty(
            `No ${tab} recorded`,
            "Add a record to start tracking business finances.",
          )
    }`;
    content
      .querySelector("[data-add]")
      ?.addEventListener("click", () => financeForm(kind));
    content
      .querySelectorAll("[data-edit]")
      .forEach(
        (b) =>
          (b.onclick = () => financeForm(kind, rows[Number(b.dataset.edit)])),
      );
    content
      .querySelectorAll("[data-paid]")
      .forEach(
        (b) =>
          (b.onclick = () => settleBill(rows[Number(b.dataset.paid)], false)),
      );
    content
      .querySelectorAll("[data-skip]")
      .forEach(
        (b) =>
          (b.onclick = () => settleBill(rows[Number(b.dataset.skip)], true)),
      );
    content
      .querySelectorAll("[data-files]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            dispatchEvent(
              new CustomEvent("finance-attachments", {
                detail: { kind, record: rows[Number(b.dataset.files)] },
              }),
            )),
      );
    content.querySelectorAll("[data-archive]").forEach(
      (b) =>
        (b.onclick = async () => {
          if (
            !(await confirmDialog(
              "Archive this record?",
              "It remains in your audit history.",
              "Archive",
            ))
          )
            return;
          try {
            await rpc("finance_archive", {
              kind,
              target: rows[Number(b.dataset.archive)].id,
            });
            refresh();
          } catch (e) {
            toast(e.message, "error");
          }
        }),
    );
  } else content.innerHTML = empty("Page not found", "Choose a Finance tab.");
  // Work does not block the initial page render.
  setTimeout(() => rpc("finance_sweep").catch(() => {}), 0);
});
addEventListener(
  "project-finances",
  async ({ detail: { project, element } }) => {
    try {
      const invoices = await q("invoices", {
          filters: { project_id: project.id },
        }),
        expenses = can("finance")
          ? await q("expenses", {
              filters: { project_id: project.id, archived_at: null },
            })
          : [];
      element.innerHTML = `<section class="card"><h2>Project finances</h2><dl class="kv"><dt>Budget</dt><dd>${money(project.budget, project.currency)}</dd><dt>Invoiced</dt><dd>${money(invoices.filter((i) => i.status !== "void").reduce((n, i) => n + Number(i.amount), 0))}</dd>${can("finance") ? `<dt>Expenses</dt><dd>${money(expenses.reduce((n, e) => n + Number(e.amount), 0))}</dd>` : ""}</dl></section>`;
    } catch (e) {
      element.innerHTML = `<p class="form-error">${esc(e.message)}</p>`;
    }
  },
);
