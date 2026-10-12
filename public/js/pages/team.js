import { registerRoute } from "../app.js";
import { loadMembers, q, rpc, api } from "../data.js";
import { state } from "../state.js";
import {
  esc,
  avatar,
  icon,
  chip,
  table,
  empty,
  field,
  formValues,
  dialog,
  busy,
  toast,
  confirmDialog,
} from "../ui.js";
import { ROLE_KEYS, DEPARTMENTS, DESIGNATIONS } from "../team-config.js";
import { date } from "../time.js";
import { showInvites } from "./workspaces.js";
async function editMember(member, refresh) {
  const available = await q("workspace_roles", {
    filters: { active: true },
    order: "role_key",
  });
  const roles = ["manager", ...available.map((r) => r.role_key)];
  const catalog = await q("business_role_catalog", {
    filters: { active: true },
    order: "name",
    ascending: true,
  });
  const d = dialog(
    member ? "Edit team member" : "Add team member",
    `<form class="stack"><div class="form-grid">${field("name", "Full name", member?.name, { required: true })}${member ? "" : field("email", "Email address", "", { required: true, type: "email" })}${field("job_title", "Designation", member?.job_title || "", { required: true, help: "For example, Developer or Account manager." })}${field("department", "Department", member?.department || "", { options: ["", ...new Set([...DEPARTMENTS, member?.department].filter(Boolean))] })}${field("phone", "Phone", member?.phone || "")}</div><div><h3>Roles</h3><div class="form-grid">${roles.map((r) => `<label class="check"><input type="checkbox" name="role" value="${r}" ${member?.roles?.includes(r) ? "checked" : ""}>${ROLE_KEYS[r]}</label>`).join("")}</div></div><p class="form-error" role="alert"></p><div class="form-actions"><button class="btn primary" type="submit">${member ? "Save changes" : "Create member"}</button></div></form>`,
  );
  const form = d.querySelector("form");
  if (catalog.length) {
    form.insertAdjacentHTML(
      "afterbegin",
      field("work_profile", "Business work profile", "", {
        options: [
          ["", "Custom designation"],
          ...catalog.map((r) => [r.id, `${r.name} · ${r.department}`]),
        ],
      }),
    );
    form.elements.work_profile.onchange = () => {
      const role = catalog.find(
        (r) => r.id === form.elements.work_profile.value,
      );
      if (!role) return;
      form.elements.job_title.value = role.name;
      if (
        ![...form.elements.department.options].some(
          (o) => o.value === role.department,
        )
      )
        form.elements.department.add(
          new Option(role.department, role.department),
        );
      form.elements.department.value = role.department;
    };
  }
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form.querySelector("[type=submit]"), async () => {
      form.querySelector(".form-error").textContent = "";
      try {
        const payload = formValues(form);
        payload.roles = [...form.querySelectorAll("[name=role]:checked")].map(
          (x) => x.value,
        );
        if (!member && payload.roles.length === 0)
          throw new Error("Choose at least one role.");
        if (member)
          await rpc("admin_save_member", { target: member.id, payload });
        else {
          const result = await api("/api/members", {
            method: "POST",
            body: payload,
          });
          showInvites([{ ...payload, role: "Team member", url: result.url }]);
        }
        d.close();
        toast(member ? "Member updated" : "Team member created");
        await refresh();
      } catch (error) {
        form.querySelector(".form-error").textContent = error.message;
      }
    });
  };
}
registerRoute("team", "Team", async (el) => {
  if (state.isMaster) throw new Error("Access is not permitted.");
  const rows = await loadMembers();
  el.innerHTML = `<div class="page-heading"><div><h1>Your team</h1><p>${rows.filter((m) => m.status === "active").length} active members · Working together.</p></div>${state.isAdmin ? `<button class="btn primary" id="add-member">${icon("plus")}Add team member</button>` : ""}</div><div class="toolbar"><label class="search">${icon("search")}<input class="input" aria-label="Search team" placeholder="Search by name, role or designation"></label></div><div id="team-list"></div>`;
  const refresh = () => window.dispatchEvent(new HashChangeEvent("hashchange"));
  el.querySelector("#add-member")?.addEventListener("click", () =>
    editMember(null, refresh),
  );
  const draw = () => {
    const term = el.querySelector("input").value.toLowerCase(),
      filtered = rows.filter((m) =>
        (m.name + " " + m.job_title + " " + m.roles.join(" "))
          .toLowerCase()
          .includes(term),
      );
    el.querySelector("#team-list").innerHTML = filtered.length
      ? table(
          [
            "Team member",
            "Roles",
            "Designation",
            "Employee ID",
            "Status",
            "Joined",
            "",
          ],
          filtered.map((m) => [
            `<button class="profile-button" data-member="${m.id}">${avatar(m.name)}<span style="text-align:left"><strong>${esc(m.name)}</strong><br><span class="muted small">${esc(m.email)}</span></span></button>`,
            [
              m.account_type === "admin" ? "Admin" : "",
              ...m.roles.map((r) => ROLE_KEYS[r]),
            ]
              .filter(Boolean)
              .map((r) => `<span class="chip">${esc(r)}</span>`)
              .join(" "),
            esc(m.job_title || "—"),
            esc(m.employee_id),
            chip(m.status),
            m.joined_at
              ? date(m.joined_at)
              : '<span class="muted">Not joined yet</span>',
            state.isAdmin
              ? `<button class="icon-btn" data-edit="${m.id}" aria-label="Edit ${esc(m.name)}">${icon("edit")}</button>`
              : "",
          ]),
        )
      : empty(
          "No team members found",
          "Try another name or designation.",
          "",
          "users",
        );
    el.querySelectorAll("[data-edit]").forEach(
      (b) =>
        (b.onclick = () =>
          editMember(
            rows.find((m) => m.id === b.dataset.edit),
            refresh,
          )),
    );
    el.querySelectorAll("[data-member]").forEach(
      (b) =>
        (b.onclick = () => {
          const m = rows.find((m) => m.id === b.dataset.member);
          const d = dialog(
            m.name,
            `<div class="row" style="margin-bottom:24px">${avatar(m.name, true)}<div><h2 style="margin-bottom:4px">${esc(m.name)}</h2><span class="muted">${esc(m.job_title || m.account_type)}</span></div></div><dl class="kv"><dt>Email</dt><dd>${esc(m.email)}</dd><dt>Phone</dt><dd>${esc(m.phone || "—")}</dd><dt>Department</dt><dd>${esc(m.department || "—")}</dd><dt>Employee ID</dt><dd>${esc(m.employee_id)}</dd><dt>Status</dt><dd>${chip(m.status)}</dd><dt>Joined</dt><dd>${m.joined_at ? date(m.joined_at) : "Not joined yet"}</dd></dl>${state.isAdmin ? `<div class="divider"></div><div class="stack">${m.status === "active" ? '<button class="btn" data-link>Regenerate password link</button>' : ""}${m.account_type !== "admin" ? `<button class="btn ${m.status === "active" ? "danger" : ""}" data-status>${m.status === "active" ? "Deactivate" : "Activate"} member</button>` : ""}</div>` : ""}`,
            { drawer: true },
          );
          d.querySelector("[data-link]")?.addEventListener("click", (e) =>
            busy(e.currentTarget, async () => {
              try {
                const result = await api(`/api/members/${m.id}/link`, {
                  method: "POST",
                });
                showInvites([{ ...m, url: result.url }]);
              } catch (error) {
                toast(error.message, "error");
              }
            }),
          );
          d.querySelector("[data-status]")?.addEventListener("click", (e) =>
            busy(e.currentTarget, async () => {
              try {
                const inactive = m.status === "active";
                if (
                  !(await confirmDialog(
                    `${inactive ? "Deactivate" : "Activate"} ${m.name}?`,
                    inactive
                      ? "This member will lose access. Their work and history will be kept."
                      : "This member will regain access to the workspace.",
                    inactive ? "Deactivate" : "Activate",
                  ))
                )
                  return;
                await rpc("admin_set_member_status", {
                  target: m.id,
                  new_status: inactive ? "inactive" : "active",
                });
                d.close();
                toast("Member status updated");
                refresh();
              } catch (error) {
                toast(error.message, "error");
              }
            }),
          );
        }),
    );
  };
  el.querySelector("input").oninput = draw;
  draw();
});
