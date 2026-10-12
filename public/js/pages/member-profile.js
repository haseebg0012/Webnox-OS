import { registerRoute } from "../app.js";
import { api, q } from "../data.js";
import { state } from "../state.js";
import {
  esc,
  avatar,
  field,
  formValues,
  dialog,
  busy,
  toast,
  chip,
} from "../ui.js";
import { date, datetime } from "../time.js";
import { secureMasterAction, pictureField, readPicture, previewPicture } from "../profile-tools.js";
import { ROLE_KEYS, DEPARTMENTS, DESIGNATIONS } from "../team-config.js";
registerRoute("member-profile", "Member profile", async (el, [id]) => {
  if (!state.isMaster || (state.profile.platform_role || "owner") !== "owner")
    throw new Error("Only the platform owner can view this profile.");
  const p = await api(`/api/master/members/${id}`);
  const details = [
    ["First name", p.first_name],
    ["Last name", p.last_name],
    ["Display name", p.name],
    ["Email", p.email],
    ["Phone", p.phone],
    ["Date of birth", date(p.date_of_birth)],
    ["Joining date", date(p.employment_start)],
    ["First sign in", datetime(p.joined_at)],
    ["Created", datetime(p.created_at)],
    ["Last active", datetime(p.last_seen_at)],
    ["Designation", p.job_title],
    ["Department", p.department],
    ["Employee ID", p.employee_id],
    ["Account type", p.account_type],
  ];
  el.innerHTML = `<div class="page-heading"><div><h1>Member profile</h1><p>Read-only account details and business assignment.</p></div><a class="btn" href="#/workspace/${p.workspace_id}">Back to business</a></div><div class="profile-columns"><section class="card"><h2>Personal details</h2><dl class="kv">${details.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v || "Not supplied")}</dd>`).join("")}</dl></section><aside class="stack"><section class="card"><div class="row"><span class="profile-portrait">${p.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="Profile picture" style="width:100%;height:100%;object-fit:cover">` : avatar(p.name, true)}</span><div><h2>${esc(p.name)}</h2>${chip(p.deleted_at ? "deleted" : p.archived_at ? "archived" : p.status)}</div></div><h3>Assigned business</h3><a href="#/workspace/${p.workspace_id}">${esc(p.workspace.name)}</a><p class="small muted">${esc(p.workspace.business_details?.industry || "Category not supplied")}</p><h3>Roles</h3><div class="row wrap">${[...(p.account_type === "admin" ? ["Admin"] : []), ...p.roles.map((r) => ROLE_KEYS[r] || r)].map((r) => `<span class="chip">${esc(r)}</span>`).join("")}</div></section></aside></div><section class="card" style="margin-top:24px"><h2>Profile actions</h2><p class="muted small">Every change requires your Master password. Delete removes access and moves the profile to deleted records; history is retained. An active business must retain its Admin and at least one Manager.</p><div class="row wrap"><button class="btn" data-edit>Edit</button>${p.status === "active" ? '<button class="btn" data-action="member_inactive">Inactive</button>' : '<button class="btn" data-action="member_restore">Restore active</button>'}<button class="btn" data-action="member_archive">Archive</button><button class="btn danger" data-action="member_delete">Delete</button></div></section>`;
  const refresh = () => dispatchEvent(new HashChangeEvent("hashchange"));
  el.querySelectorAll("[data-action]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (await secureMasterAction(b.dataset.action, p.id)) refresh();
      }),
  );
  el.querySelector("[data-edit]").onclick = async () => {
    const roles = await q("workspace_roles", {
      filters: { workspace_id: p.workspace_id, active: true },
      order: null,
    });
    const d = dialog(
      "Edit member profile",
      `<form class="stack"><div class="form-grid">${field("first_name", "First name", p.first_name || p.name.split(" ")[0], { required: true })}${field("last_name", "Last name", p.last_name || p.name.split(" ").slice(1).join(" "))}${field("name", "Display name", p.name, { required: true })}${field("phone", "Phone", p.phone || "", { type: "tel" })}${field("job_title", "Designation", p.job_title || "", { options: [["", "Choose a designation"], ...new Set([...DESIGNATIONS, p.job_title].filter(Boolean))] })}${field("department", "Department", p.department || "", { options: [["", "Choose a department"], ...new Set([...DEPARTMENTS, p.department].filter(Boolean))] })}${field("employment_start", "Joining date", p.employment_start || "", { type: "date" })}${field("date_of_birth","Date of birth",p.date_of_birth||"",{type:"date"})}${pictureField("Profile picture / logo")}</div><p class="small muted">Email and account type are read-only. Passwords are managed by the account holder.</p><h3>Roles</h3>${["manager", ...roles.map((r) => r.role_key)].map((r) => `<label class="check"><input type="checkbox" name="role" value="${r}" ${p.roles.includes(r) ? "checked" : ""}>${esc(ROLE_KEYS[r] || r)}</label>`).join("")}<p class="form-error" role="alert"></p><button type="submit" class="btn primary">Save changes</button></form>`,
      { wide: true },
    );
    const form = d.querySelector("form");
    previewPicture(form);
    form.onsubmit = (e) => {
      e.preventDefault();
      busy(form.querySelector("button"), async () => {
        const payload = {
          ...formValues(form),
          image: await readPicture(form),
          roles: [...form.querySelectorAll("[name=role]:checked")].map(
            (i) => i.value,
          ),
        };
        if (await secureMasterAction("member_edit", p.id, payload)) {
          d.close();
          toast("Profile updated");
          refresh();
        }
      });
    };
  };
});
