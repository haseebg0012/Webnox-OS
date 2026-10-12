import { registerRoute } from "../app.js";
import { state } from "../state.js";
import { q, rpc, api } from "../data.js";
import {
  esc,
  field,
  formValues,
  dialog,
  busy,
  toast,
  table,
  chip,
  empty,
  icon,
  label,
} from "../ui.js";
import { date, datetime } from "../time.js";
import { showInvites } from "./workspaces.js";
import { INDUSTRIES, existingOptions } from "../lead-options.js";
import { DEPARTMENTS } from "../team-config.js";
export const PLATFORM_PERMISSIONS = {
  view_workspaces: "View workspaces",
  create_workspaces: "Create workspaces",
  edit_workspaces: "Edit workspaces",
  suspend_workspaces: "Suspend / archive workspaces",
  view_team: "View Master team",
  view_audit: "View platform activity",
  edit_settings: "Edit platform settings",
  manage_catalog: "Manage business roles & task templates",
};
export const platformCan = (permission) =>
  state.isMaster &&
  ((state.profile.platform_role || "owner") === "owner" ||
    state.profile.platform_permissions?.includes(permission));
const refresh = () => dispatchEvent(new HashChangeEvent("hashchange"));
function guard(permission) {
  if (!platformCan(permission)) throw new Error("Access is not permitted.");
}
export function businessFields(w = {}) {
  const d = w.business_details || w;
  return `${field("owner_name", "Owner name", d.owner_name || "", { required: true })}${field("legal_name", "Registered / legal name", d.legal_name || "")}${field("industry", "Business category", d.industry || "", { required: true, options: [["", "Choose a category"], ...existingOptions(INDUSTRIES, d.industry)] })}${field("website", "Website", d.website || "", { type: "url", placeholder: "https://" })}${field("business_email", "Business email", d.business_email || "", { type: "email", required: true })}${field("business_phone", "Business phone", d.business_phone || "", { type: "tel", required: true, placeholder: "+923001234567" })}${field("tax_id", "Tax / registration number", d.tax_id || "")}${field("address", "Street address", d.address || "", { type: "textarea", full: true })}${field("city", "City", d.city || "")}${field("region", "State / province", d.region || "")}${field("postal_code", "Postal code", d.postal_code || "")}${field("description", "About the business", d.description || "", { type: "textarea", full: true })}`;
}

export function validateBusinessForm(form) {
 const phone=form.elements.business_phone;
 if(phone){phone.pattern="[+][1-9][0-9]{7,14}";phone.title="Include + and the country code, followed by digits only.";}
}

async function catalogForm(kind, item = {}) {
  const roles =
    kind === "template"
      ? await q("business_role_catalog", {
          filters: { active: true },
          order: "name",
          ascending: true,
        })
      : [];
  if (kind === "template" && !roles.length) {
    toast("Create an active business role first.");
    return;
  }
  const d = dialog(
    item.id
      ? "Edit " + (kind === "role" ? "business role" : "task template")
      : "Create " + (kind === "role" ? "business role" : "task template"),
    `<form class="stack"><div class="form-grid">${field("name", kind === "role" ? "Role name" : "Task name", item.name || "", { required: true, full: true })}${field("department", "Department", item.department || roles[0]?.department || "Operations", { options: [...new Set([...DEPARTMENTS, ...roles.map((r) => r.department), item.department].filter(Boolean))] })}${kind === "template" ? field("role_id", "Business role", item.role_id || roles[0]?.id, { options: roles.map((r) => [r.id, r.name]), required: true }) : ""}${field("description", "Description / summary", item.description || "", { type: "textarea", full: true })}${field(kind === "role" ? "responsibilities" : "instructions", kind === "role" ? "Responsibilities (one per line)" : "Step-by-step instructions", item.responsibilities || item.instructions || "", { type: "textarea", full: true })}${kind === "template" ? field("required_module", "Required module", item.required_module || "tasks", { options: ["tasks", "leads", "clients", "projects", "finance"] }) : ""}${field(
      "active",
      "Status",
      item.active === false ? "false" : "true",
      {
        options: [
          ["true", "Active"],
          ["false", "Archived"],
        ],
      },
    )}</div><p class="form-error" role="alert"></p><div class="form-actions"><button class="btn" type="button" data-cancel>Cancel</button><button class="btn primary" type="submit">Save ${kind === "role" ? "business role" : "task template"}</button></div></form>`,
  );
  const form = d.querySelector("form");
  if (kind === "template") {
    const sync = () => {
      const matches = roles.filter(
        (r) => r.department === form.department.value,
      );
      form.role_id.innerHTML = matches
        .map(
          (r) =>
            `<option value="${r.id}" ${r.id === item.role_id ? "selected" : ""}>${esc(r.name)}</option>`,
        )
        .join("");
    };
    form.department.onchange = sync;
    sync();
  }
  d.querySelector("[data-cancel]").onclick = () => d.close();
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form.querySelector("[type=submit]"), async () => {
      try {
        await rpc("master_catalog_save", {
          kind,
          payload: { ...formValues(form), ...(item.id ? { id: item.id } : {}) },
        });
        d.close();
        toast("Saved");
        refresh();
      } catch (error) {
        form.querySelector(".form-error").textContent = error.message;
      }
    });
  };
}
for (const [route, kind, title, subtitle] of [
  [
    "master-roles",
    "role",
    "Standardized Work Profiles & Responsibilities",
    "Define job profiles and responsibilities for your business teams. These profiles do not grant account permissions.",
  ],
  [
    "master-templates",
    "template",
    "Standardized Reusable Task Templates",
    "Create operational task templates linked to departments and business roles.",
  ],
]) {
  registerRoute(
    route,
    kind === "role" ? "Business Roles" : "Task Builder",
    async (el) => {
      guard("manage_catalog");
      const rows = await q(
        kind === "role" ? "business_role_catalog" : "task_templates",
        { order: "name", ascending: true },
      );
      el.innerHTML = `<div class="hero"><span class="eyebrow">${icon(kind === "role" ? "briefcase" : "tasks")} Master ${kind === "role" ? "business role catalog" : "task builder & library"}</span><div class="row between wrap"><div><h1>${title}</h1><p>${subtitle}</p></div><button class="btn primary" data-create>${icon("plus")} Create ${kind === "role" ? "business role" : "task template"}</button></div></div><div class="toolbar card"><label class="search">${icon("search")}<input class="input" aria-label="Search catalog" placeholder="Search ${kind === "role" ? "roles" : "templates"}"></label><div class="row wrap">${field("department", "Department", "", { options: [["", "All"], ...new Set(rows.map((r) => r.department))] })}${field("status", "Status", "active", { options: ["active", "archived", "all"] })}</div></div><div class="grid three" data-catalog></div>`;
      el.querySelector("[data-create]").onclick = () => catalogForm(kind);
      const draw = () => {
        const term = el.querySelector("input").value.toLowerCase(),
          department = el.querySelector("[name=department]").value,
          status = el.querySelector("[name=status]").value;
        const filtered = rows.filter(
          (r) =>
            (!department || r.department === department) &&
            (status === "all" || r.active === (status === "active")) &&
            (r.name + " " + r.description).toLowerCase().includes(term),
        );
        el.querySelector("[data-catalog]").innerHTML = filtered.length
          ? filtered
              .map(
                (r) =>
                  `<section class="card catalog-card"><div class="row between"><span class="chip">${esc(r.department)}</span>${chip(r.active ? "active" : "archived")}</div><h2>${esc(r.name)}</h2><p class="small muted">${esc(r.description || "No description added.")}</p><div class="divider"></div><div class="row between wrap"><span class="small muted">${kind === "role" ? `${r.responsibilities.split("\n").filter((x) => x.trim()).length} responsibilities` : esc(label(r.required_module))}</span><button class="btn small" data-edit="${r.id}">View details / edit</button></div></section>`,
              )
              .join("")
          : empty(
              "No " +
                (kind === "role" ? "business roles" : "task templates") +
                " found",
              "Create your first entry or change the filters.",
            );
        el.querySelectorAll("[data-edit]").forEach(
          (b) =>
            (b.onclick = () =>
              catalogForm(
                kind,
                rows.find((r) => r.id === b.dataset.edit),
              )),
        );
      };
      el.querySelector("input").oninput = draw;
      el.querySelectorAll("select").forEach((s) => (s.onchange = draw));
      draw();
    },
  );
}

function teamForm(member) {
  const d = dialog(
    member ? "Edit platform member" : "Invite new platform administrator",
    `<form class="stack"><div class="form-grid">${field("name", "Full name", member?.name || "", { required: true, full: true })}${!member ? field("email", "Email address", "", { type: "email", required: true, full: true }) : `<p class="span-all muted">${esc(member.email)} · Email cannot be changed here.</p>`}${field("phone", "Phone number", member?.phone || "", { type: "tel" })}${field(
      "platform_role",
      "Platform role",
      member?.platform_role || "support",
      {
        options: [
          ["admin", "Platform Admin"],
          ["support", "Platform Support"],
        ],
      },
    )}${member ? field("status", "Account status", member.status, { options: ["active", "inactive"] }) : ""}</div><h3>Granular platform permissions</h3><div class="form-grid">${Object.entries(
      PLATFORM_PERMISSIONS,
    )
      .map(
        ([k, v]) =>
          `<div class="permission-choice row between"><span>${v}</span><button type="button" class="permission-switch" role="switch" aria-label="${v}" aria-checked="${!!member?.platform_permissions?.includes(k)}" data-permission="${k}"><span></span><b>${member?.platform_permissions?.includes(k) ? "On" : "Off"}</b></button></div>`,
      )
      .join(
        "",
      )}</div><p class="small muted">Only the Platform Owner can invite or change platform members. Finance and full tenant access remain owner-only. New members choose their own passwords through a private setup link.</p><p class="form-error" role="alert"></p><div class="form-actions"><button class="btn primary" type="submit">${member ? "Save profile" : "Create secure invitation"}</button></div></form>`,
    { wide: true },
  );
  const form = d.querySelector("form");
  form.querySelectorAll("[data-permission]").forEach(
    (b) =>
      (b.onclick = () => {
        const on = b.getAttribute("aria-checked") !== "true";
        b.setAttribute("aria-checked", String(on));
        b.querySelector("b").textContent = on ? "On" : "Off";
      }),
  );
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form.querySelector("[type=submit]"), async () => {
      try {
        const payload = {
          ...formValues(form),
          permissions: [
            ...form.querySelectorAll('[data-permission][aria-checked="true"]'),
          ].map((i) => i.dataset.permission),
        };
        if (member)
          await rpc("master_team_save", { target: member.id, payload });
        else {
          const result = await api("/api/master/team", {
            method: "POST",
            body: payload,
          });
          showInvites([
            {
              ...payload,
              role: "Platform " + payload.platform_role,
              url: result.url,
            },
          ]);
        }
        d.close();
        toast(member ? "Profile updated" : "Platform invitation ready");
        refresh();
      } catch (error) {
        form.querySelector(".form-error").textContent = error.message;
      }
    });
  };
}
registerRoute("master-team", "Master Team", async (el) => {
  guard("view_team");
  const rows = await rpc("master_team_list"),
    owner = (state.profile.platform_role || "owner") === "owner";
  el.innerHTML = `<div class="page-heading"><div><h1>Master Team & Roles</h1><p>Platform administrators, support personnel and their permissions.</p></div>${owner ? '<button class="btn primary" data-invite>+ Invite platform member</button>' : ""}</div>${table(
    [
      "Member name & email",
      "Platform role",
      "Status",
      "Permissions",
      "Created",
      "Actions",
    ],
    rows.map((m) => [
      `<strong>${esc(m.name)}</strong><div class="small muted">${esc(m.email)}</div>`,
      chip("platform_" + m.platform_role),
      chip(m.status),
      m.platform_role === "owner"
        ? "Owner access"
        : `${m.platform_permissions.length} permissions`,
      date(m.created_at),
      owner && m.platform_role !== "owner"
        ? `<button class="btn small" data-edit="${m.id}">Edit profile</button>`
        : m.id === state.profile.id
          ? '<a href="#/master-profile">My profile</a>'
          : "",
    ]),
  )}`;
  el.querySelector("[data-invite]")?.addEventListener("click", () =>
    teamForm(),
  );
  el.querySelectorAll("[data-edit]").forEach(
    (b) =>
      (b.onclick = () => teamForm(rows.find((m) => m.id === b.dataset.edit))),
  );
});
registerRoute("master-activity", "Platform Activity", async (el) => {
  guard("view_audit");
  const [platform, workspace] = await Promise.all([
    q("platform_activity", { limit: 100 }),
    q("activity_logs", { limit: 100 }),
  ]);
  const rows = [...platform, ...workspace].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
  el.innerHTML = `<div class="page-heading"><div><h1>Platform Activity</h1><p>Recent recorded platform and workspace events. History is retained.</p></div></div><div class="toolbar"><label class="search">${icon("search")}<input class="input" aria-label="Search activity" placeholder="Search action or workspace ID"></label></div><div data-logs></div>`;
  const draw = () => {
    const term = el.querySelector("input").value.toLowerCase(),
      filtered = rows.filter((r) =>
        (r.action + " " + (r.workspace_id || "")).toLowerCase().includes(term),
      );
    el.querySelector("[data-logs]").innerHTML = filtered.length
      ? table(
          ["When", "Action", "Workspace", "Actor"],
          filtered.map((r) => [
            datetime(r.created_at),
            esc(label(r.action)),
            esc(r.workspace_id || "Platform"),
            esc(r.actor_id),
          ]),
        )
      : empty("No matching activity", "Recorded events will appear here.");
  };
  el.querySelector("input").oninput = draw;
  draw();
});
