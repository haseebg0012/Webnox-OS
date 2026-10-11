import { registerRoute, refreshContext } from "../app.js";
import { state, money } from "../state.js";
import { rpc, q, api } from "../data.js";
import {
  esc,
  field,
  formValues,
  table,
  chip,
  empty,
  dialog,
  busy,
  toast,
  confirmDialog,
  copyText,
  label,
} from "../ui.js";
import { date, datetime, today } from "../time.js";
import { CURRENCIES } from "../lead-options.js";
import { ROLE_KEYS } from "../team-config.js";
const refresh = () => dispatchEvent(new HashChangeEvent("hashchange"));
function paymentTable(rows, workspaces = []) {
  return rows.length
    ? table(
        ["Business", "Payment", "Paid on", "Period", "Reference", "Receipt"],
        rows.map((p) => [
          esc(
            workspaces.find((w) => w.id === p.workspace_id)?.name ||
              state.workspace?.name ||
              "Business",
          ),
          money(p.amount_original, p.currency),
          date(p.paid_on),
          `${date(p.period_from)} – ${date(p.period_to)}`,
          esc(p.reference || "—"),
          `<a href="#/invoice/${p.invoice_id}">View invoice</a><br><button class="text-button" data-rent-files="${p.id}" data-workspace="${p.workspace_id}">Attachments</button>`,
        ]),
      )
    : empty(
        "No payments recorded",
        "Recorded bank transfers will appear here.",
      );
}
function planCard(s) {
  return s
    ? `<section class="card"><div class="row between wrap"><h2>${esc(s.plan_name || label(s.cycle))}</h2>${chip(s.status)}</div><div class="stat-value">${money(s.amount_original, s.currency)}</div><p>${label(s.cycle)} · Next due ${date(s.next_due || s.trial_ends_on)}</p><p class="small muted">${Number(s.grace_days)} grace days</p></section>`
    : empty(
        "Internal — no rent",
        "This workspace has no subscription, expiry or rent reminders.",
      );
}
registerRoute("billing", "Billing", async (el) => {
  if (!state.isAdmin)
    throw new Error("Only the workspace Admin can view Billing.");
  const data = await rpc("billing_details");
  el.innerHTML = `<div class="page-heading"><div><h1>Billing</h1><p>${esc(state.workspace.name)} · Your workspace plan</p></div></div>${state.workspace.status === "suspended" ? '<div class="banner error-panel">Workspace access is suspended. Access returns as soon as your payment is recorded.</div>' : ""}${planCard(data.subscription)}${
    data.subscription
      ? `<section class="card" style="margin-top:24px"><h2>Pay by bank transfer</h2><p>Payment is recorded manually by ${esc(data.company_name)}.</p>${
          Object.entries(data.bank_details || {})
            .filter(([, v]) => v)
            .map(
              ([k, v]) =>
                `<div class="row between wrap" style="margin:12px 0"><div><span class="small muted">${esc(label(k))}</span><br><strong>${esc(v)}</strong></div><button class="btn small" data-copy="${esc(k)}">Copy</button></div>`,
            )
            .join("") ||
          '<p class="muted">Contact Webnox OS for bank-transfer details.</p>'
        }</section>`
      : ""
  }<div class="section-heading" style="margin-top:24px"><h2>Payment history & rent invoices</h2></div>${paymentTable(data.payments)}`;
  el.querySelectorAll("[data-copy]").forEach(
    (b) => (b.onclick = () => copyText(data.bank_details[b.dataset.copy])),
  );
  setTimeout(
    () =>
      rpc("master_sweep")
        .then(refreshContext)
        .catch(() => {}),
    0,
  );
});
async function recordPayment(w) {
  const s = w.subscription,
    request_id = crypto.randomUUID();
  const d = dialog(
    "Record rent payment",
    `<form class="stack"><p><strong>${esc(w.name)}</strong></p><div class="form-grid">${field("currency", "Currency", s.currency, { options: CURRENCIES })}${field("amount_original", "Amount paid", s.amount_original, { type: "number", min: ".01", step: ".01", required: true })}${field("fx_rate", "Conversion rate", s.fx_rate, { type: "number", min: ".000001", step: ".000001", required: true })}${field("paid_on", "Paid on", today(), { type: "date", required: true })}${field("reference", "Bank reference", "", { required: true, full: true })}${field("notes", "Notes", "", { type: "textarea", full: true })}</div><p class="small muted">Covers one billing cycle from ${date(s.next_due || s.trial_ends_on || s.start_date)}. A rent invoice is created with this payment.</p><p class="form-error"></p><button class="btn primary">Record payment</button></form>`,
    { wide: true },
  );
  const form = d.querySelector("form");
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form.querySelector(".btn"), async () => {
      try {
        const p = await rpc("record_rent_payment", {
          workspace: w.id,
          payload: { ...formValues(form), request_id },
        });
        d.close();
        toast("Payment recorded");
        location.hash = `#/invoice/${p.invoice_id}`;
      } catch (e) {
        form.querySelector(".form-error").textContent = e.message;
      }
    });
  };
}
async function planForm(w) {
  const s = w.subscription;
  const d = dialog(
    "Edit workspace plan",
    `<form class="stack"><div class="form-grid">${field("plan_name", "Plan name", s.plan_name || "")}${field("cycle", "Cycle", s.cycle, { options: ["trial_7", "trial_14", "monthly", "quarterly", "yearly"] })}${field("next_cycle", "After trial", s.next_cycle || "monthly", { options: ["monthly", "quarterly", "yearly"] })}${field("currency", "Currency", s.currency, { options: CURRENCIES })}${field("amount_original", "Amount", s.amount_original, { type: "number", min: 0, step: ".01", required: true })}${field("fx_rate", "Conversion rate", s.fx_rate, { type: "number", min: ".000001", step: ".000001", required: true })}${field("start_date", "Start date", s.start_date, { type: "date", required: true })}${field("next_due", "Next due", s.next_due || "", { type: "date" })}${field("grace_days", "Grace days", s.grace_days, { type: "number", min: 0, max: 90 })}${field("member_limit", "Member warning limit", s.member_limit || "", { type: "number", min: 1 })}</div><p class="form-error"></p><button class="btn primary">Save plan</button></form>`,
    { wide: true },
  );
  const form = d.querySelector("form");
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form.querySelector(".btn"), async () => {
      try {
        await rpc("master_set_plan", {
          workspace: w.id,
          payload: formValues(form),
        });
        await rpc("master_sweep");
        d.close();
        refresh();
        toast("Plan updated");
      } catch (e) {
        form.querySelector(".form-error").textContent = e.message;
      }
    });
  };
}
registerRoute("master-finance", "Finance", async (el, [tab = "overview"]) => {
  if (!state.isMaster) throw new Error("Access is not permitted.");
  const [overview, workspaces, payments] = await Promise.all([
    rpc("master_overview"),
    api("/api/master/workspaces"),
    q("subscription_payments"),
  ]);
  el.innerHTML = `<div class="hero"><h1>Platform finance</h1><p>Plans, rent and payment history across your businesses.</p></div><div class="tabs">${[
    ["overview", "Overview"],
    ["plans", "Plans"],
    ["payments", "Payments"],
    ["invoices", "Rent invoices"],
  ]
    .map(
      ([key, title]) =>
        `<a href="#/master-finance/${key}" class="${key === tab ? "active" : ""}">${title}</a>`,
    )
    .join("")}</div><div data-content></div>`;
  const content = el.querySelector("[data-content]");
  if (tab === "overview")
    content.innerHTML = `<div class="grid four">${[
      ["Workspaces", overview.workspaces],
      ["Active / trial", overview.active],
      ["On trial", overview.trials],
      ["Overdue / suspended", overview.overdue],
    ]
      .map(
        ([k, v]) =>
          `<section class="card hero-stat"><div class="stat-label">${k}</div><div class="stat-value">${v}</div></section>`,
      )
      .join(
        "",
      )}</div><div class="grid two" style="margin-top:24px"><section class="card"><h2>Rent received</h2>${overview.receipts.map((r) => `<p class="stat-value">${money(r.total, r.currency)}</p>`).join("") || '<p class="muted">No payments yet.</p>'}</section><section class="card"><h2>Current rent due</h2>${overview.due.map((r) => `<p class="stat-value">${money(r.total, r.currency)}</p>`).join("") || '<p class="muted">No rent due.</p>'}</section></div>`;
  else if (tab === "plans") {
    const rented = workspaces.filter((w) => w.subscription);
    content.innerHTML = rented.length
      ? table(
          ["Business", "Plan", "Rent", "Next due", "Status", ""],
          rented.map((w) => [
            esc(w.name),
            esc(w.subscription.plan_name || label(w.subscription.cycle)),
            money(w.subscription.amount_original, w.subscription.currency),
            date(w.subscription.next_due || w.subscription.trial_ends_on),
            chip(w.subscription.status),
            `<button class="btn small" data-pay="${w.id}">Record payment</button>`,
          ]),
        )
      : empty(
          "No rented workspaces",
          "Internal workspaces are excluded from billing.",
        );
    content
      .querySelectorAll("[data-pay]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            recordPayment(workspaces.find((w) => w.id === b.dataset.pay))),
      );
  } else content.innerHTML = paymentTable(payments, workspaces);
  setTimeout(() => rpc("master_sweep").catch(() => {}), 0);
});
registerRoute("master-settings", "Settings", async (el) => {
  if (!state.isMaster) throw new Error("Access is not permitted.");
  const [s] = await q("platform_settings", { order: null });
  const b = s.bank_details || {},
    i = s.invoice_details || {};
  el.innerHTML = `<div class="page-heading"><div><h1>Platform settings</h1><p>Bank details shown to workspace Admins and details printed on rent invoices.</p></div></div><form class="card stack"><div class="form-grid">${field("company_name", "Platform billing name", s.company_name, { required: true })}${field("bank_name", "Bank name", b.bank_name || "")}${field("account_title", "Account title", b.account_title || "")}${field("account_number", "Account number / IBAN", b.account_number || "")}${field("instructions", "Payment instructions", b.instructions || "", { type: "textarea", full: true })}${field("address", "Billing address", i.address || "", { type: "textarea", full: true })}${field("email", "Billing email", i.email || "", { type: "email" })}${field("phone", "Billing phone", i.phone || "")}${field("tax_id", "Tax registration", i.tax_id || "")}</div><p class="form-error"></p><button class="btn primary">Save platform settings</button></form>`;
  const form = el.querySelector("form");
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form.querySelector(".btn"), async () => {
      try {
        const v = formValues(form);
        await rpc("master_save_settings", {
          payload: {
            company_name: v.company_name,
            bank_details: {
              bank_name: v.bank_name,
              account_title: v.account_title,
              account_number: v.account_number,
              instructions: v.instructions,
            },
            invoice_details: {
              address: v.address,
              email: v.email,
              phone: v.phone,
              tax_id: v.tax_id,
            },
          },
        });
        toast("Platform settings saved");
      } catch (e) {
        form.querySelector(".form-error").textContent = e.message;
      }
    });
  };
});
registerRoute("workspace", "Workspace", async (el, [id]) => {
  if (!state.isMaster) throw new Error("Access is not permitted.");
  const [all, stats, members] = await Promise.all([
    api("/api/master/workspaces"),
    rpc("master_open_workspace", { workspace: id }),
    q("master_member_list", { filters: { workspace_id: id }, order: "name" }),
  ]);
  const w = all.find((w) => w.id === id);
  if (!w) throw new Error("Workspace not found.");
  el.innerHTML = `<div class="page-heading"><div><h1>${esc(w.name)}</h1><p>${esc(w.slug)} · ${w.type === "master_project" ? "Internal — no rent" : "Rented business"}</p></div><button class="btn" data-access>${w.full_access ? "Turn full access off" : "Enable full access"}</button></div><div class="banner">${w.full_access ? "Full access on — the Admin has been notified." : "Read-only overview · Business records remain private."} ${chip(w.status)}</div><div class="grid four" style="margin:24px 0">${[
    ["Members", stats.members],
    ["Active now", stats.active],
    ["Idle", stats.idle],
    ["Never joined", stats.never_joined],
  ]
    .map(
      ([k, v]) =>
        `<section class="card"><div class="stat-label">${k}</div><div class="stat-value">${v}</div></section>`,
    )
    .join(
      "",
    )}</div>${w.subscription?.member_limit && stats.members > w.subscription.member_limit ? '<div class="banner">Member count exceeds the plan’s warning limit. Access remains available.</div>' : ""}<div class="tabs">${["members", "activity", "roles", "settings", ...(w.subscription ? ["billing"] : []), ...(w.full_access ? ["records"] : [])].map((t) => `<button data-tab="${t}" class="${t === "members" ? "active" : ""}">${label(t)}</button>`).join("")}</div><div data-content></div>`;
  const content = el.querySelector("[data-content]");
  const draw = async (tab) => {
    try {
      if (tab === "members")
        content.innerHTML = table(
          ["Member", "Designation", "Department", "Status"],
          members.map((m) => [
            esc(m.name),
            esc(m.job_title || "—"),
            esc(m.department || "—"),
            chip(m.status),
          ]),
        );
      else if (tab === "activity") {
        const logs = await q("activity_logs", {
          filters: { workspace_id: id },
          limit: 100,
        });
        content.innerHTML = logs.length
          ? table(
              ["When", "Activity"],
              logs.map((l) => [datetime(l.created_at), esc(label(l.action))]),
            )
          : empty("No activity yet", "Workspace events will appear here.");
      } else if (tab === "roles") {
        const roles = await q("workspace_roles", {
          filters: { workspace_id: id },
          order: null,
        });
        content.innerHTML = `<form class="card stack"><h2>Activated roles</h2><p class="muted">Admin and Manager are always available. Switching off a role immediately removes its database access.</p>${roles.map((r) => `<label class="check"><input type="checkbox" name="role" value="${r.role_key}" ${r.active ? "checked" : ""}>${esc(ROLE_KEYS[r.role_key])}</label>`).join("")}<p class="form-error"></p><button class="btn primary">Save roles</button></form>`;
        content.querySelector("form").onsubmit = (e) => {
          e.preventDefault();
          busy(content.querySelector(".btn"), async () => {
            if (
              !(await confirmDialog(
                "Update active roles?",
                "Existing memberships remain in history; inactive roles lose their access.",
                "Update roles",
              ))
            )
              return;
            try {
              await rpc("master_set_roles", {
                workspace: id,
                roles: [...content.querySelectorAll("input:checked")].map(
                  (x) => x.value,
                ),
              });
              toast("Roles updated");
            } catch (e) {
              content.querySelector(".form-error").textContent = e.message;
            }
          });
        };
      } else if (tab === "billing") {
        const payments = await q("subscription_payments", {
          filters: { workspace_id: id },
        });
        content.innerHTML = `${planCard(w.subscription)}<div class="row wrap" style="margin:20px 0"><button class="btn primary" data-pay>Record rent payment</button><button class="btn" data-plan>Edit plan</button></div>${paymentTable(payments, [w])}`;
        content.querySelector("[data-pay]").onclick = () => recordPayment(w);
        content.querySelector("[data-plan]").onclick = () => planForm(w);
      } else if (tab === "settings") {
        content.innerHTML = `<section class="card"><dl class="kv"><dt>Business</dt><dd>${esc(w.name)}</dd><dt>Country</dt><dd>${esc(w.country || "—")}</dd><dt>Short code</dt><dd>${esc(w.short_code)}</dd><dt>Created</dt><dd>${date(w.created_at)}</dd></dl><div class="row wrap"><button class="btn" data-edit-workspace>Edit business details</button><button class="btn" data-message>Notify Admin</button>${w.status === "active" || w.status === "trial" ? '<button class="btn" data-status="suspended">Suspend</button>' : '<button class="btn" data-status="active">Resume</button>'}${w.status !== "archived" ? '<button class="btn" data-status="archived">Archive</button>' : ""}</div></section>`;
        content.querySelector("[data-edit-workspace]").onclick = () => {
          const d = dialog(
            "Business details",
            `<form class="stack">${field("name", "Business name", w.name, { required: true })}${field("country", "Country", w.country || "")}<p class="form-error" role="alert"></p><button class="btn primary" type="submit">Save business details</button></form>`,
          );
          const form = d.querySelector("form");
          form.onsubmit = (e) => {
            e.preventDefault();
            busy(form.querySelector("[type=submit]"), async () => {
              try {
                await rpc("master_save_workspace", {
                  workspace: id,
                  payload: formValues(form),
                });
                d.close();
                toast("Business details saved");
                refresh();
              } catch (error) {
                form.querySelector(".form-error").textContent = error.message;
              }
            });
          };
        };
        content.querySelectorAll("[data-status]").forEach(
          (b) =>
            (b.onclick = () => {
              const d = dialog(
                label(b.dataset.status) + " workspace",
                `<form class="stack"><p>${b.dataset.status === "archived" ? "Nobody can sign in while archived. Records are preserved and the action is reversible." : "This changes access for the entire business."}</p>${field("reason", "Reason", "", { type: "textarea", required: true })}<p class="form-error"></p><button class="btn primary">Confirm</button></form>`,
              );
              d.querySelector("form").onsubmit = (e) => {
                e.preventDefault();
                busy(d.querySelector(".btn"), async () => {
                  try {
                    await rpc("master_set_status", {
                      workspace: id,
                      status: b.dataset.status,
                      reason: d.querySelector("textarea").value,
                    });
                    d.close();
                    refresh();
                  } catch (e) {
                    d.querySelector(".form-error").textContent = e.message;
                  }
                });
              };
            }),
        );
        content.querySelector("[data-message]").onclick = () => {
          const d = dialog(
            "Notify Admin",
            `<form class="stack">${field("title", "Title", "", { required: true })}${field("body", "Message", "", { type: "textarea", required: true })}<label class="check"><input name="include_managers" type="checkbox">Include Managers</label><p class="form-error"></p><div class="row wrap"><button class="btn primary">Send in-app message</button><button class="btn" type="button" data-copy>Copy for WhatsApp</button></div></form>`,
          );
          const form = d.querySelector("form");
          form.querySelector("[data-copy]").onclick = () =>
            copyText(
              form.elements.title.value + "\n" + form.elements.body.value,
            );
          form.onsubmit = (e) => {
            e.preventDefault();
            busy(form.querySelector(".primary"), async () => {
              try {
                await rpc("master_notify_admin", {
                  workspace: id,
                  title: form.elements.title.value,
                  body: form.elements.body.value,
                  include_managers: form.include_managers.checked,
                });
                d.close();
                toast("In-app message sent");
              } catch (e) {
                form.querySelector(".form-error").textContent = e.message;
              }
            });
          };
        };
      } else if (tab === "records") {
        content.innerHTML = '<div class="stack" data-records></div>';
        for (const domain of [
          "tasks",
          "leads",
          "clients",
          "projects",
          "expenses",
          "invoices",
        ]) {
          const rows = await q(domain, {
            filters: { workspace_id: id },
            limit: 100,
          });
          content.querySelector("[data-records]").insertAdjacentHTML(
            "beforeend",
            `<section class="card"><h2>${label(domain)}</h2>${
              rows.length
                ? table(
                    ["Record", "Status / category"],
                    rows.map((r) => [
                      esc(r.title || r.company || r.name || r.number),
                      esc(label(r.status || r.stage || r.category || "")),
                    ]),
                  )
                : '<p class="muted">No records visible.</p>'
            }</section>`,
          );
        }
      }
    } catch (error) {
      content.innerHTML = `<p class="form-error">${esc(error.message)}</p>`;
    }
  };
  el.querySelectorAll("[data-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        el.querySelectorAll("[data-tab]").forEach((x) =>
          x.classList.toggle("active", x === b),
        );
        draw(b.dataset.tab);
      }),
  );
  el.querySelector("[data-access]").onclick = async () => {
    if (
      !(await confirmDialog(
        w.full_access ? "Disable full access?" : "Enable full access?",
        "The Admin of this workspace will be notified and this will appear in their activity log.",
        "Confirm",
      ))
    )
      return;
    try {
      await rpc("master_set_full_access", {
        workspace: id,
        on_off: !w.full_access,
      });
      refresh();
    } catch (e) {
      toast(e.message, "error");
    }
  };
  await draw("members");
});

addEventListener("click", (event) => {
  const button = event.target.closest("[data-rent-files]");
  if (button)
    dispatchEvent(
      new CustomEvent("finance-attachments", {
        detail: {
          kind: "rent",
          record: {
            id: button.dataset.rentFiles,
            workspace_id: button.dataset.workspace,
            title: "Rent payment",
          },
        },
      }),
    );
});
