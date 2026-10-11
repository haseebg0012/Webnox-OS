import { registerRoute } from "../app.js";
import { state, can, money } from "../state.js";
import { q, rpc, loadMembers } from "../data.js";
import { getSupabase } from "../supabase.js";
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
  icon,
  confirmDialog,
} from "../ui.js";
import { date, datetime, today } from "../time.js";
import { CURRENCIES } from "../lead-options.js";
import { openTask, taskForm } from "./tasks.js";
const manager = () => state.isAdmin || state.roles.includes("manager");
const refresh = () => dispatchEvent(new HashChangeEvent("hashchange"));
const editable = (p) =>
  manager() || (p.pm_id === state.user.id && can("projects", "edit"));
async function projectForm(el, project, clientId) {
  if (!manager() && !project)
    throw new Error("Only Admin or Manager can create projects.");
  const [clients, members] = await Promise.all([q("clients"), loadMembers()]),
    p = project || {};
  const pms = members.filter(
    (m) =>
      m.status === "active" &&
      (m.account_type === "admin" ||
        m.roles?.some((r) => ["manager", "project_manager"].includes(r))),
  );
  el.innerHTML = `<div class="page-heading"><div><h1>${project ? "Project settings" : "New project"}</h1><p>Define the work, ownership and timeline.</p></div></div><form class="card stack"><div class="form-grid">${field("name", "Project name", p.name || "", { required: true })}${!project ? field("client_id", "Client", clientId || "", { required: true, options: [["", "Choose a client"], ...clients.map((c) => [c.id, `${c.company} · ${c.buid}`])] }) : ""}${manager() ? field("pm_id", "Project Manager", p.pm_id || "", { options: [["", "Not assigned"], ...pms.map((m) => [m.id, m.name])] }) : ""}${field("status", "Status", p.status || "planning", { options: ["planning", "active", "on_hold", "completed", "archived"] })}${field("start_date", "Start date", p.start_date || today(), { type: "date" })}${field("due_date", "Due date", p.due_date || "", { type: "date" })}${field("currency", "Currency", p.currency || state.settings.app_currency, { options: CURRENCIES })}${field("budget", "Project budget", p.budget || 0, { type: "number", min: 0, step: ".01" })}${field("live_url", "Live website URL", p.live_url || "", { type: "url", full: true })}${field("description", "Description", p.description || "", { type: "textarea", full: true })}</div><p class="form-error" role="alert"></p><div class="form-actions"><button class="btn primary" type="submit">${project ? "Save project" : "Create project"}</button></div></form>`;
  const form = el.querySelector("form");
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form.querySelector("[type=submit]"), async () => {
      try {
        const payload = formValues(form);
        if (project) payload.id = p.id;
        const result = await rpc("project_save", { payload });
        toast("Project saved");
        location.hash = `#/project/${result.id}`;
        refresh();
      } catch (error) {
        form.querySelector(".form-error").textContent = error.message;
      }
    });
  };
}
registerRoute("new-project", "New project", (el, [clientId]) =>
  projectForm(el, null, clientId),
);
function projectTable(rows) {
  return rows.length
    ? table(
        ["Project", "Status", "Due", "Budget"],
        rows.map((p) => [
          `<a class="strong" href="#/project/${p.id}">${esc(p.name)}</a>`,
          chip(p.status),
          date(p.due_date),
          money(p.budget, p.currency),
        ]),
      )
    : empty(
        "No projects yet",
        "Create a project for a client to organise delivery.",
      );
}
registerRoute("projects", "Projects", async (el) => {
  if (!can("projects")) throw new Error("Access is not permitted.");
  const rows = await q("projects");
  el.innerHTML = `<div class="page-heading"><div><h1>Projects</h1><p>Plan, approve and deliver together.</p></div>${manager() ? '<a class="btn primary" href="#/new-project">New project</a>' : ""}</div>${projectTable(rows)}`;
});
async function requestMember(p, members) {
  const people = members.filter((m) => m.status === "active" && m.job_title),
    designations = [...new Set(people.map((m) => m.job_title))];
  const d = dialog(
    "Add a project member",
    `<form class="stack">${field("designation", "Designation", "", { options: [["", "Choose a designation"], ...designations], required: true })}${field("member", "Person", "", { options: [["", "Choose a designation first"]], required: true })}<p class="small muted">The appropriate Project Manager or Manager will review the request. Existing history is retained.</p><p class="form-error" role="alert"></p><button class="btn primary" type="submit">Request membership</button></form>`,
  );
  const form = d.querySelector("form");
  form.designation.onchange = () => {
    form.member.innerHTML =
      '<option value="">Choose a person</option>' +
      people
        .filter((m) => m.job_title === form.designation.value)
        .map((m) => `<option value="${m.id}">${esc(m.name)}</option>`)
        .join("");
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form.querySelector("[type=submit]"), async () => {
      try {
        await rpc("project_add_member", {
          target: p.id,
          member: form.member.value,
          designation: form.designation.value,
        });
        d.close();
        toast("Member request saved");
        refresh();
      } catch (err) {
        form.querySelector(".form-error").textContent = err.message;
      }
    });
  };
}
async function memberAction(row, approve) {
  const title =
    approve === null
      ? "Remove membership"
      : approve
        ? "Approve membership"
        : "Reject membership";
  const d = dialog(
    title,
    `<form class="stack">${field("reason", "Note", "", { type: "textarea", required: approve !== true })}<p class="form-error" role="alert"></p><button class="btn primary">${title}</button></form>`,
  );
  d.querySelector("form").onsubmit = (e) => {
    e.preventDefault();
    busy(d.querySelector(".btn"), async () => {
      try {
        await rpc(
          approve === null ? "project_remove_member" : "project_review_member",
          {
            target: row.id,
            ...(approve === null ? {} : { approve }),
            reason: d.querySelector("textarea").value,
          },
        );
        d.close();
        refresh();
        toast("Membership updated");
      } catch (err) {
        d.querySelector(".form-error").textContent = err.message;
      }
    });
  };
}
function requirementForm(p, r) {
  const d = dialog(
    r ? "Edit requirement" : "Add requirement",
    `<form class="stack">${field("title", "Title", r?.title || "", { required: true })}${field("description", "Details", r?.description || "", { type: "textarea" })}${r ? field("status", "Status", r.status, { options: ["open", "in_progress", "done"] }) : ""}<p class="form-error" role="alert"></p><button class="btn primary">Save requirement</button></form>`,
  );
  const form = d.querySelector("form");
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form.querySelector(".btn"), async () => {
      try {
        await rpc("requirement_save", {
          payload: {
            ...formValues(form),
            project_id: p.id,
            ...(r ? { id: r.id } : {}),
          },
        });
        d.close();
        refresh();
      } catch (e) {
        form.querySelector(".form-error").textContent = e.message;
      }
    });
  };
}
export async function renderFiles(
  el,
  clientId,
  projectId = null,
  write = can("clients", "edit"),
) {
  const rows = await q("client_files", {
    filters: {
      client_id: clientId,
      ...(projectId ? { project_id: projectId } : {}),
      archived_at: null,
    },
  });
  el.innerHTML = `<div class="section-heading"><div><h2>Files</h2><p class="muted small">PDF, PNG, JPEG or WebP. Up to 10 files per upload, 10 MB each.</p></div>${write ? '<label class="btn">Upload files<input type="file" class="sr-only" multiple accept="application/pdf,image/png,image/jpeg,image/webp" aria-label="Upload files"></label>' : ""}</div><p role="status" data-upload-status></p>${
    rows.length
      ? table(
          ["File", "Size", "Uploaded", ""],
          rows.map((f) => [
            esc(f.name),
            `${(f.size_bytes / 1024).toFixed(1)} KB`,
            datetime(f.created_at),
            f.upload_status === "ready"
              ? `<button class="btn small" data-download="${f.id}">Open file</button>`
              : `<span class="muted small">${f.upload_status === "failed" ? "Upload failed — upload the file again" : "Upload incomplete"}</span>`,
          ]),
        )
      : empty(
          "No files yet",
          "Keep the client’s documents and assets together.",
        )
  }`;
  el.querySelectorAll("[data-download]").forEach(
    (b) =>
      (b.onclick = () =>
        busy(b, async () => {
          try {
            const f = rows.find((x) => x.id === b.dataset.download),
              sb = await getSupabase();
            const { data, error } = await sb.storage
              .from("client-files")
              .createSignedUrl(f.path, 60);
            if (error) throw error;
            const d = dialog(
              "Open file",
              `<p>${esc(f.name)}</p><a class="btn primary" href="${esc(data.signedUrl)}" target="_blank" rel="noopener noreferrer">Open securely</a><p class="small muted">This link expires in one minute.</p>`,
            );
          } catch (e) {
            toast(e.message, "error");
          }
        })),
  );
  el.querySelector("input")?.addEventListener("change", async (e) => {
    const files = [...e.target.files],
      status = el.querySelector("[data-upload-status]");
    e.target.disabled = true;
    try {
      if (files.length > 10) throw new Error("Choose no more than 10 files.");
      const types = {
        "application/pdf": "pdf",
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
      };
      if (files.some((f) => !types[f.type] || !f.size || f.size > 10485760))
        throw new Error(
          "Each file must be a PDF, PNG, JPEG or WebP up to 10 MB.",
        );
      const sb = await getSupabase();
      for (const [i, file] of files.entries()) {
        status.textContent = `Uploading ${i + 1} of ${files.length}…`;
        const path = `w${state.workspace.id}/${clientId}/${crypto.randomUUID()}.${types[file.type]}`;
        const registered = await rpc("file_register", {
          payload: {
            client_id: clientId,
            project_id: projectId,
            name: file.name,
            path,
            mime_type: file.type,
            size_bytes: file.size,
          },
        });
        const { error } = await sb.storage
          .from("client-files")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (error) {
          await rpc("file_finish", { target: registered.id, succeeded: false });
          throw error;
        }
        await rpc("file_finish", { target: registered.id, succeeded: true });
      }
      await renderFiles(el, clientId, projectId, write);
      toast("Files uploaded");
    } catch (err) {
      status.textContent = err.message;
      e.target.disabled = false;
    }
  });
}
registerRoute("project", "Project", async (el, [id]) => {
  const [[p], projects, members] = await Promise.all([
    q("projects", { filters: { id }, limit: 1 }),
    q("projects"),
    loadMembers(),
  ]);
  if (!p) throw new Error("Project not found or access is not permitted.");
  el.innerHTML = `<div class="page-heading"><div>${field("project-switch", "Project", p.id, { options: projects.map((x) => [x.id, x.name]) })}<h1>${esc(p.name)}</h1><p>${chip(p.status)} · Due ${date(p.due_date)}</p></div></div><div class="tabs">${["overview", "live_view", "requirements", "tasks", "files", "finances", ...(editable(p) ? ["settings"] : [])].map((t) => `<button data-tab="${t}" class="${t === "overview" ? "active" : ""}">${t.replace("_", " ").replace(/^./, (c) => c.toUpperCase())}</button>`).join("")}</div><div id="project-content"></div>`;
  el.querySelector("select").onchange = (e) =>
    (location.hash = `#/project/${e.target.value}`);
  const content = el.querySelector("#project-content");
  const draw = async (tab) => {
    try {
      if (tab === "overview") {
        const team = await q("project_members", {
          filters: { project_id: p.id },
          order: "requested_at",
        });
        content.innerHTML = `<div class="card" style="margin-bottom:24px"><p style="white-space:pre-wrap">${esc(p.description || "No description added.")}</p><dl class="kv"><dt>Project Manager</dt><dd>${esc(members.find((m) => m.id === p.pm_id)?.name || "Not assigned")}</dd><dt>Budget</dt><dd>${money(p.budget, p.currency)}</dd></dl></div><div class="section-heading"><h2>Project team & history</h2>${editable(p) ? '<button class="btn" data-add-member>Add member</button>' : ""}</div>${
          team.length
            ? table(
                ["Person", "Designation", "Status", "Requested", "Review", ""],
                team.map((m, i) => [
                  esc(
                    members.find((x) => x.id === m.user_id)?.name ||
                      "Team member",
                  ),
                  esc(m.designation),
                  chip(m.status),
                  datetime(m.requested_at),
                  `${datetime(m.reviewed_at)}<div class="small muted">${esc(m.note || "")}</div>`,
                  `<div class="row wrap">${m.status === "pending" && m.requested_by !== state.user.id && ((m.approval_side === "manager" && manager()) || (m.approval_side === "pm" && p.pm_id === state.user.id)) ? `<button class="btn small" data-approve="${i}">Approve</button><button class="btn small" data-reject="${i}">Reject</button>` : ""}${editable(p) && ["pending", "approved"].includes(m.status) ? `<button class="btn small" data-remove="${i}">${m.status === "pending" ? "Cancel" : "Remove"}</button>` : ""}</div>`,
                ]),
              )
            : empty(
                "No team requests yet",
                "Choose a designation, then a person to join the project.",
              )
        }`;
        content
          .querySelector("[data-add-member]")
          ?.addEventListener("click", () => requestMember(p, members));
        for (const [action, value] of [
          ["approve", true],
          ["reject", false],
          ["remove", null],
        ])
          content
            .querySelectorAll(`[data-${action}]`)
            .forEach(
              (b) =>
                (b.onclick = () =>
                  memberAction(team[Number(b.dataset[action])], value)),
            );
      } else if (tab === "settings") await projectForm(content, p);
      else if (tab === "requirements") {
        const rows = await q("project_requirements", {
          filters: { project_id: p.id },
        });
        content.innerHTML = `<div class="section-heading"><h2>Requirements</h2>${editable(p) ? '<button class="btn" data-add>Add requirement</button>' : ""}</div>${
          rows.length
            ? table(
                ["Requirement", "Details", "Status", ""],
                rows.map((r, i) => [
                  esc(r.title),
                  esc(r.description),
                  chip(r.status),
                  editable(p)
                    ? `<button class="btn small" data-edit="${i}">Edit</button>`
                    : "",
                ]),
              )
            : empty(
                "No requirements yet",
                "Turn the brief into clear deliverables.",
              )
        }`;
        content
          .querySelector("[data-add]")
          ?.addEventListener("click", () => requirementForm(p));
        content
          .querySelectorAll("[data-edit]")
          .forEach(
            (b) =>
              (b.onclick = () =>
                requirementForm(p, rows[Number(b.dataset.edit)])),
          );
      } else if (tab === "tasks") {
        const rows = await q("tasks", { filters: { project_id: p.id } });
        content.innerHTML = `<div class="section-heading"><h2>Tasks</h2>${editable(p) ? '<button class="btn" data-add>Create task</button>' : ""}</div>${
          rows.length
            ? table(
                ["Task", "Status", "Due"],
                rows.map((t) => [
                  `<button class="text-button" data-task="${t.id}">${esc(t.title)}</button>`,
                  chip(t.status),
                  date(t.due_date),
                ]),
              )
            : empty("No project tasks", "Break the work into manageable steps.")
        }`;
        content
          .querySelectorAll("[data-task]")
          .forEach((b) => (b.onclick = () => openTask(b.dataset.task)));
        content
          .querySelector("[data-add]")
          ?.addEventListener("click", () => taskForm(null, members, p.id));
      } else if (tab === "files")
        await renderFiles(content, p.client_id, p.id, editable(p));
      else if (tab === "live_view") {
        const tasks = await q("tasks", { filters: { project_id: p.id } });
        content.innerHTML = `<section class="card"><h2>Delivery snapshot</h2><p>${tasks.filter((t) => t.status === "completed").length} of ${tasks.length} tasks completed.</p><progress max="${Math.max(1, tasks.length)}" value="${tasks.filter((t) => t.status === "completed").length}" aria-label="Project completion"></progress>${p.live_url && /^https:\/\//.test(p.live_url) ? `<p style="margin-top:20px"><a class="btn" href="${esc(p.live_url)}" target="_blank" rel="noopener noreferrer">Open live website ${icon("link")}</a></p>` : '<p class="muted" style="margin-top:20px">Add a live website URL in project settings.</p>'}</section>`;
      } else if (tab === "finances")
        dispatchEvent(
          new CustomEvent("project-finances", {
            detail: { project: p, element: content },
          }),
        );
    } catch (error) {
      content.innerHTML = `<div class="banner error-panel">${esc(error.message)}</div>`;
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
  await draw("overview");
});
addEventListener("client-tab", async ({ detail: { tab, client, element } }) => {
  try {
    if (tab === "projects")
      element.innerHTML = projectTable(
        await q("projects", { filters: { client_id: client.id } }),
      );
    else if (tab === "files") await renderFiles(element, client.id);
    else if (tab === "tasks") {
      const rows = await q("tasks", { filters: { client_id: client.id } });
      element.innerHTML = rows.length
        ? table(
            ["Task", "Status", "Due"],
            rows.map((t) => [
              `<button class="text-button" data-task="${t.id}">${esc(t.title)}</button>`,
              chip(t.status),
              date(t.due_date),
            ]),
          )
        : empty(
            "No client tasks yet",
            "Tasks linked to this client’s projects will appear here.",
          );
      element
        .querySelectorAll("[data-task]")
        .forEach((b) => (b.onclick = () => openTask(b.dataset.task)));
    }
  } catch (error) {
    element.innerHTML = `<div class="banner error-panel">${esc(error.message)}</div>`;
  }
});
