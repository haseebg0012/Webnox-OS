import { registerRoute, refreshContext } from "../app.js";
import { state } from "../state.js";
import { q, rpc } from "../data.js";
import { getSupabase } from "../supabase.js";
import { esc, field, formValues, busy, toast, table, empty } from "../ui.js";
import { ROLE_KEYS } from "../team-config.js";
registerRoute("permissions", "Permissions", async (el) => {
  if (!state.isMaster && !state.isAdmin && !state.roles.includes("manager"))
    throw new Error("Only Master, Admin and Manager can view permissions.");
  const workspaces = state.isMaster ? await rpc("master_workspace_list") : [];
  el.innerHTML = `<div class="page-heading"><div><h1>Permissions</h1><p>Review module access by role. Admin and Manager access remains fixed.</p></div></div>${state.isMaster ? `<section class="card">${field("workspace", "Workspace", workspaces[0]?.id || "", { options: workspaces.map((w) => [w.id, w.name]) })}<p class="small muted">Workspace permissions are managed by its Admin. <a href="#/master-team">Manage platform team access</a></p></section>` : ""}<div data-matrix></div>`;
  const draw = async () => {
    const target = state.isMaster
      ? el.querySelector("[name=workspace]").value
      : state.workspace.id;
    const container = el.querySelector("[data-matrix]");
    if (!target) {
      container.innerHTML = empty("No workspaces available");
      return;
    }
    const data = await rpc("permission_matrix", { target });
    const roles = [
      ...data.roles.filter((r) => !["admin", "manager"].includes(r.role_key)),
      { role_key: "admin" },
      { role_key: "manager" },
    ];
    const actions = ["view", "edit", "delete", "archive"],
      modules = ["leads", "clients", "projects", "finance"];
    const roleName = (r) => ROLE_KEYS[r] || (r === "admin" ? "Admin" : r);
    container.innerHTML = `<form class="stack permission-form"><div class="table-wrap permission-matrix" tabindex="0" aria-label="Role permission table. Scroll horizontally for more roles."><table><thead><tr><th rowspan="2" scope="col">Permission / module</th>${roles.map((r) => `<th colspan="4" scope="colgroup">${esc(roleName(r.role_key))}</th>`).join("")}</tr><tr>${roles.map(() => actions.map((a) => `<th scope="col">${a[0].toUpperCase() + a.slice(1)}</th>`).join("")).join("")}</tr></thead><tbody>${modules
      .map(
        (module) =>
          `<tr><th scope="row">${module[0].toUpperCase() + module.slice(1)}</th>${roles
            .map((r) => {
              const fixed = ["admin", "manager"].includes(r.role_key),
                p =
                  data.permissions.find(
                    (p) => p.role_key === r.role_key && p.module === module,
                  ) || {};
              return actions
                .map((action) => {
                  const on = fixed || Boolean(p[action]);
                  return `<td><button type="button" class="permission-switch" role="switch" aria-checked="${on}" aria-label="${esc(roleName(r.role_key))} ${module} ${action}" data-role="${r.role_key}" data-module="${module}" data-action="${action}" ${!state.isAdmin || fixed ? "disabled" : ""}><span></span><b>${on ? "On" : "Off"}</b></button></td>`;
                })
                .join("");
            })
            .join("")}</tr>`,
      )
      .join(
        "",
      )}</tbody></table></div><p class="small muted">Scroll the table to see all roles. View is required for other actions. Delete controls destructive actions such as voiding invoices; records and history are retained. Archive hides or deactivates records. Salary and project-assignment restrictions still apply.</p><p class="form-error" role="alert"></p>${state.isAdmin ? '<div class="form-actions"><button class="btn primary" type="submit">Save permissions</button></div>' : '<p class="muted small">Read-only access. Only the workspace Admin can change these permissions.</p>'}</form>`;
    const form = container.querySelector("form");
    const set = (b, on) => {
      b.setAttribute("aria-checked", String(on));
      b.querySelector("b").textContent = on ? "On" : "Off";
    };
    form.querySelectorAll("[role=switch]").forEach(
      (button) =>
        (button.onclick = () => {
          const on = button.getAttribute("aria-checked") !== "true";
          set(button, on);
          const peers = [...form.querySelectorAll("[role=switch]")].filter(
            (b) =>
              b.dataset.role === button.dataset.role &&
              b.dataset.module === button.dataset.module,
          );
          if (button.dataset.action === "view" && !on)
            peers.forEach((b) => set(b, false));
          if (button.dataset.action !== "view" && on)
            set(
              peers.find((b) => b.dataset.action === "view"),
              true,
            );
        }),
    );
    form.onsubmit = (e) => {
      e.preventDefault();
      if (!state.isAdmin) return;
      busy(form.querySelector("[type=submit]"), async () => {
        try {
          const entries = roles
            .filter((r) => !["admin", "manager"].includes(r.role_key))
            .flatMap((r) =>
              modules.map((module) => ({
                role_key: r.role_key,
                module,
                ...Object.fromEntries(
                  actions.map((action) => [
                    action,
                    form
                      .querySelector(
                        `[data-role="${r.role_key}"][data-module="${module}"][data-action="${action}"]`,
                      )
                      .getAttribute("aria-checked") === "true",
                  ]),
                ),
              })),
            );
          await rpc("save_permissions", { entries });
          await refreshContext();
          toast("Permissions saved");
        } catch (error) {
          form.querySelector(".form-error").textContent = error.message;
        }
      });
    };
  };
  await draw();
  el.querySelector("[name=workspace]")?.addEventListener("change", () =>
    draw().catch((e) => toast(e.message, "error")),
  );
});
registerRoute("settings", "Settings", async (el) => {
  if (!state.isAdmin) {
    el.innerHTML = `<div class="page-heading"><div><h1>Settings</h1><p>Your account and workspace.</p></div></div><section class="card"><h2>${esc(state.workspace?.name || "Account")}</h2><dl class="kv"><dt>Timezone</dt><dd>${esc(state.settings?.timezone || "-")}</dd><dt>Currency</dt><dd>${esc(state.settings?.app_currency || "-")}</dd></dl><p class="muted">Your workspace Admin manages business settings.</p><a class="btn primary" href="#/profile">Edit profile & password</a></section>`;
    return;
  }
  const s = state.settings,
    details = s.invoice_details || {};
  el.innerHTML = `<div class="page-heading"><div><h1>Settings</h1><p>Business details, work tracking and invoice defaults.</p></div></div><form class="stack"><section class="card"><h2>Business</h2><div class="form-grid">${field("company_name", "Company name", s.company_name, { required: true })}${field("timezone", "Timezone", s.timezone, { required: true, help: "Use a timezone such as Asia/Karachi or Europe/London." })}${field("app_currency", "Reporting currency", s.app_currency, { required: true, options: ["PKR", "USD", "GBP", "EUR", "AED", "SAR", "CAD", "AUD", "INR"] })}${field("idle_minutes", "Idle after (minutes)", s.idle_minutes, { type: "number", min: 1, max: 60, required: true })}</div></section><section class="card"><h2>Invoice details</h2><div class="form-grid">${field("legal_name", "Legal business name", details.legal_name || s.company_name)}${field("tax_id", "Tax registration number", details.tax_id || "")}${field("invoice_email", "Billing email", details.email || "", { type: "email" })}${field("invoice_phone", "Billing phone", details.phone || "")}${field("address", "Business address", details.address || "", { type: "textarea", full: true })}${field("bank_details", "Bank / payment details", details.bank_details || "", { type: "textarea", full: true })}${field("due_days", "Payment due after (days)", s.due_days, { type: "number", min: 0 })}${field("pause_days", "Service pause after (days)", s.pause_days, { type: "number", min: 0 })}${field("terms", "Additional terms", details.terms || "", { type: "textarea", full: true })}</div></section><p class="form-error" role="alert"></p><div class="form-actions"><button class="btn primary" type="submit">Save settings</button></div></form><section class="card" style="margin-top:24px"><h2>Business logo</h2><p class="muted small">PNG, JPEG or WebP, up to 300 KB. Used on your sign-in page and invoices.</p><label class="field"><span>Choose a logo</span><input type="file" id="brand-upload" accept="image/png,image/jpeg,image/webp"></label><p class="small" id="brand-status" role="status"></p></section>`;
  const form = el.querySelector("form");
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form.querySelector("[type=submit]"), async () => {
      try {
        const v = formValues(form);
        await rpc("save_settings", {
          payload: {
            company_name: v.company_name,
            timezone: v.timezone,
            app_currency: v.app_currency,
            idle_minutes: Number(v.idle_minutes),
            due_days: Number(v.due_days),
            pause_days: Number(v.pause_days),
            invoice_details: {
              ...details,
              legal_name: v.legal_name,
              tax_id: v.tax_id,
              email: v.invoice_email,
              phone: v.invoice_phone,
              address: v.address,
              bank_details: v.bank_details,
              terms: v.terms,
            },
          },
        });
        await refreshContext();
        toast("Settings saved");
      } catch (err) {
        form.querySelector(".form-error").textContent = err.message;
      }
    });
  };
  el.querySelector("#brand-upload").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const status = el.querySelector("#brand-status");
    try {
      const ext = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
      }[file.type];
      if (!ext || file.size > 307200)
        throw new Error("Choose a PNG, JPEG or WebP up to 300 KB.");
      status.textContent = "Uploading…";
      const sb = await getSupabase(),
        path = `w${state.workspace.id}/${crypto.randomUUID()}.${ext}`;
      const { error } = await sb.storage
        .from("brand")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      await rpc("save_brand", { logo_path: path });
      await refreshContext();
      status.textContent = "Logo updated.";
      toast("Logo updated");
    } catch (error) {
      status.textContent = error.message;
    }
  };
});
