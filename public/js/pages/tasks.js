import { registerRoute } from "../app.js";
import { state } from "../state.js";
import { q, rpc, loadMembers } from "../data.js";
import {
  esc,
  icon,
  avatar,
  chip,
  table,
  empty,
  field,
  formValues,
  dialog,
  busy,
  toast,
  label,
} from "../ui.js";
import { date, datetime } from "../time.js";
const statuses = {
  todo: "To do",
  in_progress: "In progress",
  in_review: "In review",
  completed: "Completed",
};
const manager = () => state.isAdmin || state.roles.includes("manager");
const refresh = () => window.dispatchEvent(new HashChangeEvent("hashchange"));
export async function taskForm(task, members, projectId = null) {
  projectId ||= task?.project_id || null;
  const approved =
    projectId && !manager()
      ? await q("project_members", {
          filters: { project_id: projectId, status: "approved" },
        })
      : [];
  const editable = manager()
    ? members.filter((m) => m.status === "active")
    : members.filter(
        (m) =>
          m.status === "active" &&
          (m.id === state.user.id || approved.some((p) => p.user_id === m.id)),
      );
  const templates = task
    ? []
    : await q("task_templates", {
        filters: { active: true },
        order: "name",
        ascending: true,
      });
  const d = dialog(
    task ? "Edit task" : "Create task",
    `<form class="stack">${field("title", "Task title", task?.title || "", { required: true })}${field("description", "Description", task?.description || "", { type: "textarea" })}<div class="form-grid">${field("assignee_id", "Assign to", task?.assignee_id || state.user.id, { options: editable.map((m) => [m.id, `${m.name}${m.job_title ? " · " + m.job_title : ""}`]), required: true })}${field("priority", "Priority", task?.priority || "medium", { options: ["low", "medium", "high", "urgent"] })}${field("due_date", "Due date", task?.due_date || "", { type: "date" })}</div><p class="form-error" role="alert"></p><div class="form-actions"><button class="btn primary" type="submit">${task ? "Save changes" : "Create task"}</button></div></form>`,
  );
  const form = d.querySelector("form");
  if (templates.length) {
    form.insertAdjacentHTML(
      "afterbegin",
      field("template", "Start from a template", "", {
        options: [
          ["", "Blank task"],
          ...templates.map((t) => [t.id, `${t.name} · ${t.department}`]),
        ],
      }),
    );
    form.elements.template.onchange = () => {
      const selected = templates.find(
        (t) => t.id === form.elements.template.value,
      );
      if (!selected) return;
      form.elements.title.value = selected.name;
      form.elements.description.value = [
        selected.description,
        selected.instructions,
        `Required module: ${selected.required_module}`,
      ]
        .filter(Boolean)
        .join("\n\n");
    };
  }
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form.querySelector("[type=submit]"), async () => {
      try {
        const payload = formValues(form);
        if (task) payload.id = task.id;
        if (projectId) payload.project_id = projectId;
        await rpc("task_save", { payload });
        d.close();
        toast(task ? "Task updated" : "Task created");
        refresh();
      } catch (error) {
        form.querySelector(".form-error").textContent = error.message;
      }
    });
  };
}
export async function openTask(id) {
  try {
    const [rows, members, comments] = await Promise.all([
      q("tasks", { filters: { id }, limit: 1 }),
      loadMembers(),
      q("task_comments", { filters: { task_id: id }, ascending: true }),
    ]);
    const task = rows[0];
    if (!task) throw new Error("Task not found.");
    const assignee = members.find((m) => m.id === task.assignee_id),
      creator = members.find((m) => m.id === task.created_by);
    const canReview =
      manager() ||
      (task.project_id &&
        (await rpc("pm_perm", { target: task.project_id, action: "edit" })));
    const canUpdate = canReview || task.assignee_id === state.user.id;
    const canEdit =
      canReview || (!task.project_id && task.created_by === state.user.id);
    const d = dialog(
      task.title,
      `<div class="row wrap" style="margin-bottom:20px">${chip(task.status)}${chip(task.priority)}</div><p style="white-space:pre-wrap">${esc(task.description || "No description added.")}</p><dl class="kv"><dt>Assigned to</dt><dd>${esc(assignee?.name || "Team member")}</dd><dt>Assigned by</dt><dd>${esc(creator?.name || "Team member")}${creator?.job_title ? ", " + esc(creator.job_title) : ""}</dd><dt>Due date</dt><dd>${date(task.due_date)}</dd><dt>Created</dt><dd>${datetime(task.created_at)}</dd>${task.completed_at ? `<dt>Completed</dt><dd>${datetime(task.completed_at)}</dd>` : ""}</dl><div class="divider"></div><div class="row wrap">${canUpdate && task.status !== "completed" ? `<button class="btn primary" data-status="${task.status === "todo" ? "in_progress" : "in_review"}">${task.status === "todo" ? "Start work" : task.status === "in_review" ? "Awaiting review" : "Submit for review"}</button>` : ""}${task.status === "in_review" && canReview ? '<button class="btn primary" data-approve>Approve</button><button class="btn" data-changes>Request changes</button>' : ""}${task.status === "completed" && canReview ? '<button class="btn" data-status="todo">Reopen task</button>' : ""}${canEdit ? '<button class="btn" data-edit>Edit task</button>' : ""}<span data-timer-action></span></div><div class="divider"></div><h2>Comments</h2><div class="stack">${comments.length ? comments.map((c) => `<div><div class="row">${avatar(members.find((m) => m.id === c.user_id)?.name)}<div class="grow"><strong class="small">${esc(members.find((m) => m.id === c.user_id)?.name || "Team member")}</strong><div class="small muted">${datetime(c.created_at)}</div></div></div><p style="white-space:pre-wrap;margin:10px 0 0 46px">${esc(c.body)}</p></div>`).join("") : '<p class="muted small">No comments yet. Keep the conversation with the work.</p>'}</div><form class="stack" style="margin-top:20px">${field("message", "Add a comment", "", { type: "textarea", required: true })}<p class="form-error" role="alert"></p><button class="btn" type="submit">Post comment</button></form>`,
      { drawer: true },
    );
    const reload = async () => {
      window.dispatchEvent(new Event("task-updated"));
      d.close();
      refresh();
      await openTask(id);
    };
    d.querySelector("[data-edit]")?.addEventListener("click", () => {
      d.close();
      taskForm(task, members);
    });
    const statusButton = d.querySelector("[data-status]");
    if (statusButton && task.status === "in_review")
      statusButton.disabled = true;
    statusButton?.addEventListener("click", () =>
      busy(statusButton, async () => {
        try {
          await rpc("task_set_status", {
            target: id,
            new_status: statusButton.dataset.status,
          });
          toast("Task status updated");
          await reload();
        } catch (e) {
          toast(e.message, "error");
        }
      }),
    );
    d.querySelector("[data-approve]")?.addEventListener("click", (e) =>
      busy(e.currentTarget, async () => {
        try {
          await rpc("task_review", { target: id, approve: true, reason: "" });
          toast("Task approved");
          await reload();
        } catch (err) {
          toast(err.message, "error");
        }
      }),
    );
    d.querySelector("[data-changes]")?.addEventListener("click", () => {
      const review = dialog(
        "Request changes",
        `<form class="stack">${field("reason", "What needs to change?", "", { type: "textarea", required: true })}<p class="form-error"></p><button class="btn primary">Request changes</button></form>`,
      );
      review.querySelector("form").onsubmit = (e) => {
        e.preventDefault();
        busy(review.querySelector("button.btn"), async () => {
          try {
            await rpc("task_review", {
              target: id,
              approve: false,
              reason: review.querySelector("textarea").value,
            });
            review.close();
            toast("Changes requested");
            await reload();
          } catch (err) {
            review.querySelector(".form-error").textContent = err.message;
          }
        });
      };
    });
    d.querySelector("form").onsubmit = (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      busy(form.querySelector("[type=submit]"), async () => {
        try {
          await rpc("task_comment", {
            target: id,
            message: form.message.value,
          });
          await reload();
        } catch (err) {
          form.querySelector(".form-error").textContent = err.message;
        }
      });
    };
    window.dispatchEvent(
      new CustomEvent("task-drawer-open", {
        detail: { task, element: d.querySelector("[data-timer-action]") },
      }),
    );
  } catch (error) {
    toast(error.message, "error");
  }
}
registerRoute("tasks", "Tasks", async (el) => {
  if (state.isMaster) throw new Error("Access is not permitted.");
  const [rows, members] = await Promise.all([
    q("tasks", { filters: { archived_at: null } }),
    loadMembers(),
  ]);
  let status = "all",
    mine = false;
  el.innerHTML = `<div class="page-heading"><div><h1>Tasks</h1><p>A clear next step for every piece of work.</p></div><button class="btn primary" id="add-task">${icon("plus")}Create task</button></div><div class="toolbar"><label class="search">${icon("search")}<input class="input" aria-label="Search tasks" placeholder="Search tasks"></label><label class="check"><input type="checkbox" id="my-tasks">Assigned to me</label></div><div class="filters" style="margin-bottom:20px">${[["all", "All tasks"], ...Object.entries(statuses)].map(([s, l]) => `<button data-filter="${s}" class="${s === "all" ? "active" : ""}">${l} · ${s === "all" ? rows.length : rows.filter((t) => t.status === s).length}</button>`).join("")}</div><div id="task-list"></div>`;
  const draw = () => {
    const term = el.querySelector(".search input").value.toLowerCase();
    const filtered = rows.filter(
      (t) =>
        (status === "all" || t.status === status) &&
        (!mine || t.assignee_id === state.user.id) &&
        t.title.toLowerCase().includes(term),
    );
    el.querySelector("#task-list").innerHTML = filtered.length
      ? table(
          ["Task", "Assigned to", "Status", "Priority", "Due date", ""],
          filtered.map((t) => [
            `<button class="text-button strong" data-task="${t.id}">${esc(t.title)}</button>`,
            esc(
              members.find((m) => m.id === t.assignee_id)?.name ||
                "Team member",
            ),
            chip(t.status),
            chip(t.priority),
            date(t.due_date),
            `<button class="icon-btn" data-task="${t.id}" aria-label="Open ${esc(t.title)}">${icon("chevron")}</button>`,
          ]),
        )
      : empty(
          rows.length ? "No matching tasks" : "Make room for your next step",
          rows.length
            ? "Try another filter or search."
            : "Create a task, choose an assignee and set a due date.",
          "",
          "tasks",
        );
    el.querySelectorAll("[data-task]").forEach(
      (b) => (b.onclick = () => openTask(b.dataset.task)),
    );
  };
  el.querySelector("#add-task").onclick = () => taskForm(null, members);
  el.querySelector(".search input").oninput = draw;
  el.querySelector("#my-tasks").onchange = (e) => {
    mine = e.target.checked;
    draw();
  };
  el.querySelectorAll("[data-filter]").forEach(
    (b) =>
      (b.onclick = () => {
        status = b.dataset.filter;
        el.querySelectorAll("[data-filter]").forEach((x) =>
          x.classList.toggle("active", x === b),
        );
        draw();
      }),
  );
  draw();
});
