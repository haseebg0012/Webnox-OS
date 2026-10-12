import { businessFields, platformCan } from "./master-control.js";
import { registerRoute } from "../app.js";
import { api, rpc, q } from "../data.js";
import { state, money } from "../state.js";
import {
  esc,
  icon,
  empty,
  table,
  chip,
  field,
  formValues,
  busy,
  toast,
  dialog,
  copyText,
  avatar,
  label,
} from "../ui.js";
import { date, today } from "../time.js";
import { ROLE_KEYS } from "../team-config.js";
const optionalRoles = Object.entries(ROLE_KEYS).filter(
  ([k]) => k !== "manager",
);
export function showInvites(invites) {
  const modal = dialog(
    "Your workspace is ready",
    `<p class="muted">Share each private link with the right person. They will choose their own password.</p><div class="stack">${invites.map((i, n) => `<section class="card"><div class="row">${avatar(i.name)}<div><strong>${esc(i.name)}</strong><div class="small muted">${esc(i.role || "Team member")} · ${esc(i.email || "")}</div></div></div><div class="code-box" style="margin-top:14px">${esc(i.url)}</div><div class="row wrap" style="margin-top:12px"><button class="btn" data-copy="${n}">${icon("copy")}Copy link</button><a class="btn" href="https://wa.me/?text=${encodeURIComponent(`Your workspace is ready. Set your password: ${i.url}`)}" target="_blank" rel="noopener noreferrer">Share on WhatsApp</a></div></section>`).join("")}</div>`,
    { wide: true },
  );
  modal
    .querySelectorAll("[data-copy]")
    .forEach(
      (b) => (b.onclick = () => copyText(invites[Number(b.dataset.copy)].url)),
    );
}
registerRoute("master-home", "Dashboard", async (el) => {
  if (!state.isMaster) throw new Error("Access is not permitted.");
  if (!platformCan("view_workspaces")) {
    el.innerHTML =
      '<div class="hero"><h1>Webnox OS Control Center</h1><p>Your platform permissions determine which tools are available.</p></div><a class="btn primary" href="#/master-profile">Open my profile</a>';
    return;
  }
  const rows = await api("/api/master/workspaces");
  const live = rows.filter((w) => ["active", "trial"].includes(w.status));
  el.innerHTML = `<div class="hero"><span class="eyebrow">Platform Master Control Panel</span><div class="row between wrap"><div><h1>Webnox OS Architecture & Governance</h1><p>Manage your businesses, platform team and operational templates.</p></div><a class="btn" href="#/create-workspace">${icon("plus")}Create workspace</a></div></div><div class="grid four" style="margin-bottom:24px">${[
    ["Workspaces live", live.length],
    ["Team members", rows.reduce((n, w) => n + w.member_count, 0)],
    ["On trial", rows.filter((w) => w.status === "trial").length],
    ["Internal spaces", rows.filter((w) => w.type === "master_project").length],
  ]
    .map(
      ([k, v]) =>
        `<div class="card hero-stat"><div class="stat-label">${k}</div><div class="stat-value">${v}</div></div>`,
    )
    .join(
      "",
    )}</div><div class="section-heading"><h2>Your workspaces</h2><a href="#/master-workspaces">View all</a></div>${workspaceTable(rows.slice(0, 6))}`;
  if (!platformCan("create_workspaces"))
    el.querySelector('a[href="#/create-workspace"]')?.remove();
});
function workspaceTable(rows) {
  return rows.length
    ? table(
        ["Workspace", "Type", "Members", "Plan", "Next due", "Status", ""],
        rows.map((w) => [
          `<div class="row">${avatar(w.name)}<div><strong>${esc(w.name)}</strong><div class="small muted">${esc(w.slug)}</div></div></div>`,
          w.type === "master_project" ? "Internal" : "Rented",
          w.member_count,
          w.subscription
            ? `${esc(w.subscription.plan_name || label(w.subscription.cycle))}<br><span class="muted small">${money(w.subscription.amount_original, w.subscription.currency)}</span>`
            : "No rent",
          date(w.subscription?.next_due || w.subscription?.trial_ends_on),
          chip(w.status),
          `<a class="btn small" href="#/workspace/${w.id}">Open ${icon("chevron", 14)}</a>`,
        ]),
      )
    : empty(
        "Your first workspace starts here",
        "Set up the business, choose roles and invite its Admin and Manager.",
        '<a class="btn primary" href="#/create-workspace">Create workspace</a>',
        "grid",
      );
}
registerRoute("master-workspaces", "Workspaces", async (el) => {
  if (!state.isMaster) throw new Error("Access is not permitted.");
  const rows = await api("/api/master/workspaces");
  el.innerHTML = `<div class="page-heading"><div><h1>Workspaces</h1><p>Every business has its own space.</p></div><a class="btn primary" href="#/create-workspace">${icon("plus")}Create workspace</a></div><div class="toolbar"><label class="search">${icon("search")}<input class="input" id="workspace-search" aria-label="Search workspaces" placeholder="Search workspaces"></label><div class="filters">${["all", "active", "trial", "suspended", "archived"].map((s, n) => `<button data-status="${s}" class="${n ? "" : "active"}">${label(s)} ${s === "all" ? rows.length : rows.filter((w) => w.status === s).length}</button>`).join("")}</div></div><div id="workspace-list"></div>`;
  if (!platformCan("create_workspaces"))
    el.querySelector('a[href="#/create-workspace"]')?.remove();
  let status = "all";
  const draw = () => {
    const term = el.querySelector("input").value.toLowerCase();
    el.querySelector("#workspace-list").innerHTML = workspaceTable(
      rows.filter(
        (w) =>
          (status === "all" || w.status === status) &&
          (w.name + " " + w.slug).toLowerCase().includes(term),
      ),
    );
  };
  el.querySelector("input").oninput = draw;
  el.querySelectorAll("[data-status]").forEach(
    (b) =>
      (b.onclick = () => {
        status = b.dataset.status;
        el.querySelectorAll("[data-status]").forEach((x) =>
          x.classList.toggle("active", x === b),
        );
        draw();
      }),
  );
  draw();
});
registerRoute("create-workspace", "Create workspace", async (el) => {
  if (!platformCan("create_workspaces"))
    throw new Error("Access is not permitted.");
  el.innerHTML = `<div class="page-heading"><div><h1>Create workspace</h1><p>A separate, secure home for a business and its team.</p></div><a class="btn" href="#/master-workspaces">Cancel</a></div><form id="workspace-form" class="workspace-create"><div class="card"><section class="form-section"><h2>1. Business details</h2><div class="form-grid">${field("name", "Business name", "", { required: true })}${field("slug", "Workspace slug", "", { required: true, help: "Used on branded sign-in links. Example: webnoxos" })}${field("short_code", "Short code", "", { required: true, help: "2–4 letters for business invoice numbers." })}${field("country", "Country")}${businessFields()}${field("timezone", "Timezone", "Asia/Karachi", { required: true })}${field("app_currency", "Workspace currency", "PKR", { options: ["PKR", "USD", "GBP", "EUR", "AED", "SAR", "CAD", "AUD", "INR"] })}</div></section><section class="form-section"><h2>2. Space and rent</h2><div class="form-grid">${field(
    "type",
    "Space type",
    "rented",
    {
      options: [
        ["rented", "Rented business"],
        ["master_project", "Internal — no rent"],
      ],
    },
  )}</div><div class="form-grid" id="rent-fields" style="margin-top:16px">${field("plan_name", "Plan name", "Business")}${field(
    "cycle",
    "Billing cycle",
    "trial_7",
    {
      options: [
        ["trial_7", "Trial — 7 days"],
        ["trial_14", "Trial — 14 days"],
        ["monthly", "Monthly"],
        ["quarterly", "Quarterly"],
        ["yearly", "Yearly"],
      ],
    },
  )}${field("next_cycle", "After trial", "monthly", { options: ["monthly", "quarterly", "yearly"] })}${field("start_date", "Start date", today(), { type: "date" })}${field("currency", "Rent currency", "PKR", { options: ["PKR", "USD", "GBP", "EUR", "AED", "SAR", "CAD", "AUD", "INR"] })}${field("amount", "Rent amount", "0", { type: "number", min: 0, step: ".01" })}${field("fx_rate", "Exchange rate to PKR", "1", { type: "number", min: ".000001", step: ".000001" })}${field("grace_days", "Grace period (days)", "7", { type: "number", min: 0, max: 90 })}${field("member_limit", "Member limit", "", { type: "number", min: 1, help: "Optional. A warning only; members are never blocked." })}</div><p class="help" id="plan-preview" style="margin-top:16px"></p></section><section class="form-section"><h2>3. Available roles</h2><p class="muted small">Admin and Manager are always included.</p><div class="form-grid">${optionalRoles.map(([k, v]) => `<label class="check"><input type="checkbox" name="role" value="${k}" checked>${v}</label>`).join("")}</div></section><section class="form-section"><h2>4. Admin and Manager</h2><p class="muted small">Use two separate email addresses. Private setup links are generated after creation.</p><div class="form-grid">${field("admin_name", "Admin name", "", { required: true })}${field("admin_email", "Admin email", "", { type: "email", required: true })}${field("admin_title", "Admin designation", "Business owner")}${field("manager_title", "Manager designation", "Manager")}${field("manager_name", "Manager name", "", { required: true })}${field("manager_email", "Manager email", "", { type: "email", required: true })}${field("admin_phone", "Admin phone", "", { type: "tel" })}${field("manager_phone", "Manager phone", "", { type: "tel" })}</div></section><section class="form-section"><h2>5. Review and create</h2><p class="muted">The business gets its own data, permissions and branding. Its Admin and Manager receive separate password links for you to share.</p><p class="form-error" role="alert"></p><div class="form-actions"><button class="btn primary" type="submit">${icon("plus")}Create workspace</button></div></section></div><aside class="card create-summary"><h2>Your workspace</h2><div id="live-summary"></div></aside></form>`;
  const form = el.querySelector("form");
  let slugTouched = false,
    codeTouched = false;
  form.slug.oninput = () => (slugTouched = true);
  form.short_code.oninput = () => (codeTouched = true);
  form.name.oninput = () => {
    if (!slugTouched)
      form.slug.value = form.name.value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    if (!codeTouched)
      form.short_code.value = form.name.value
        .replace(/[^a-zA-Z]/g, "")
        .slice(0, 3)
        .toUpperCase();
  };
  const preview = () => {
    const p = formValues(form),
      internal = p.type === "master_project",
      trial = p.cycle.startsWith("trial");
    el.querySelector("#rent-fields").hidden = internal;
    let text = internal
      ? "Internal space. No rent, expiry or billing reminders."
      : `${p.plan_name || "Business"} · ${label(p.cycle)} · ${money(p.amount, p.currency)}`;
    if (trial && !internal && p.start_date) {
      const end = new Date(p.start_date + "T12:00:00Z");
      end.setUTCDate(end.getUTCDate() + (p.cycle === "trial_7" ? 7 : 14));
      text += ` · First payment due ${date(end.toISOString().slice(0, 10))}, then ${label(p.next_cycle).toLowerCase()}.`;
    }
    el.querySelector("#plan-preview").textContent = text;
    el.querySelector("#live-summary").innerHTML =
      `<h3>${esc(p.name || "Business name")}</h3><p class="muted small">${esc(p.slug || "workspace-slug")}</p><p>${esc(text)}</p><div class="divider"></div><p class="small">Admin + Manager<br>${form.querySelectorAll("[name=role]:checked").length} optional roles</p>`;
  };
  form.addEventListener("input", preview);
  preview();
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form.querySelector("[type=submit]"), async () => {
      form.querySelector(".form-error").textContent = "";
      try {
        const p = formValues(form);
        p.roles = [...form.querySelectorAll("[name=role]:checked")].map(
          (i) => i.value,
        );
        const result = await api("/api/master/workspaces", {
          method: "POST",
          body: p,
        });
        location.hash = "#/master-workspaces";
        showInvites(result.invites);
        toast("Workspace created");
      } catch (err) {
        form.querySelector(".form-error").textContent = err.message;
      }
    });
  };
});
registerRoute("workspace", "Workspace", async (el, [id]) => {
  if (!state.isMaster) throw new Error("Access is not permitted.");
  const all = await api("/api/master/workspaces"),
    w = all.find((x) => x.id === id);
  if (!w) throw new Error("Workspace not found.");
  const members = await q("master_member_list", {
    filters: { workspace_id: id },
    order: "name",
    ascending: true,
  });
  el.innerHTML = `<div class="page-heading"><div><h1>${esc(w.name)}</h1><p>${esc(w.slug)} · ${w.type === "master_project" ? "Internal — no rent" : "Rented business"}</p></div><a class="btn" href="#/master-workspaces">Back to workspaces</a></div><div class="banner">Workspace overview · Read only ${chip(w.status)}</div><div class="grid two"><section class="card"><h2>Business details</h2><dl class="kv"><dt>Short code</dt><dd>${esc(w.short_code)}</dd><dt>Country</dt><dd>${esc(w.country || "—")}</dd><dt>Created</dt><dd>${date(w.created_at)}</dd><dt>Members</dt><dd>${members.length}</dd></dl></section><section class="card"><h2>Plan</h2>${w.subscription ? `<p>${esc(w.subscription.plan_name || label(w.subscription.cycle))}</p><div class="stat-value">${money(w.subscription.amount_original, w.subscription.currency)}</div><p class="muted">${label(w.subscription.cycle)} · Next due ${date(w.subscription.next_due || w.subscription.trial_ends_on)}</p>` : '<p class="muted">Internal space. No subscription or rent.</p>'}</section></div><div class="section-heading" style="margin-top:28px"><h2>Members</h2><span class="small muted">Contact information stays private</span></div>${table(
    ["Member", "Designation", "Department", "Status"],
    members.map((m) => [
      esc(m.name),
      esc(m.job_title || "—"),
      esc(m.department || "—"),
      chip(m.status),
    ]),
  )}`;
});
