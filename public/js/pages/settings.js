import { registerRoute, refreshContext } from "../app.js";
import { state } from "../state.js";
import { q, rpc } from "../data.js";
import { getSupabase } from "../supabase.js";
import { esc, field, formValues, busy, toast, table, empty } from "../ui.js";
import { ROLE_KEYS } from "../team-config.js";
registerRoute("permissions", "Permissions", async (el) => {
  if (!state.isAdmin)
    throw new Error("Only the workspace Admin can change permissions.");
  const [roles, permissions] = await Promise.all([
    q("workspace_roles", { order: null, filters: { active: true } }),
    q("role_permissions", { order: null }),
  ]);
  el.innerHTML = `<div class="page-heading"><div><h1>Permissions</h1><p>Choose what each active role can view, edit or archive. Admin and Manager access stays fixed.</p></div></div><form class="stack">${
    roles.length
      ? roles
          .map(
            (role) =>
              `<section class="card"><h2>${esc(ROLE_KEYS[role.role_key])}</h2>${table(
                ["Module", "View", "Edit", "Archive"],
                ["leads", "clients", "projects", "finance"].map((module) => {
                  const p =
                    permissions.find(
                      (p) =>
                        p.role_key === role.role_key && p.module === module,
                    ) || {};
                  return [
                    module[0].toUpperCase() + module.slice(1),
                    ...["view", "edit", "delete"].map(
                      (action) =>
                        `<label class="check"><input type="checkbox" data-role="${role.role_key}" data-module="${module}" data-action="${action}" ${p[action] ? "checked" : ""} aria-label="${esc(ROLE_KEYS[role.role_key])} ${module} ${action}"></label>`,
                    ),
                  ];
                }),
              )}</section>`,
          )
          .join("")
      : empty(
          "No optional roles are active",
          "Contact the platform owner to activate a role.",
        )
  }<p class="small muted">Salary details remain limited to the Admin and Managers. Lead assignment remains limited to Sales Representatives.</p><p class="form-error" role="alert"></p><div class="form-actions"><button class="btn primary" type="submit">Save permissions</button></div></form>`;
  const form = el.querySelector("form");
  form.querySelectorAll("input").forEach(
    (input) =>
      (input.onchange = () => {
        const row = input.closest("tr");
        if (input.dataset.action === "view" && !input.checked)
          row.querySelectorAll("input").forEach((x) => (x.checked = false));
        if (input.dataset.action !== "view" && input.checked)
          row.querySelector("[data-action=view]").checked = true;
      }),
  );
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form.querySelector("[type=submit]"), async () => {
      try {
        const entries = [];
        for (const role of roles)
          for (const module of ["leads", "clients", "projects", "finance"]) {
            const item = { role_key: role.role_key, module };
            for (const action of ["view", "edit", "delete"])
              item[action] = form.querySelector(
                `[data-role=${role.role_key}][data-module=${module}][data-action=${action}]`,
              ).checked;
            entries.push(item);
          }
        await rpc("save_permissions", { entries });
        await refreshContext();
        toast("Permissions saved");
      } catch (err) {
        form.querySelector(".form-error").textContent = err.message;
      }
    });
  };
});
registerRoute("settings", "Settings", async (el) => {
  if (!state.isAdmin)
    throw new Error("Only the workspace Admin can change settings.");
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
