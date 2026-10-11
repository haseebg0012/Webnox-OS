import { registerRoute } from "../app.js";
import { state } from "../state.js";
import { rpc, q, loadMembers } from "../data.js";
import {
  esc,
  icon,
  table,
  empty,
  field,
  chip,
  dialog,
  toast,
  busy,
  label,
  downloadCSV,
} from "../ui.js";
import { today, date, datetime, duration, timezone } from "../time.js";
const manager = () => state.isAdmin || state.roles.includes("manager");
async function timeline(day, member, name) {
  try {
    const rows = await rpc("day_timeline", { on_day: day, member });
    dialog(
      `${name} · ${date(day)}`,
      rows.length
        ? table(
            ["Type", "Activity", "From", "Until", "Time"],
            rows.map((r) => [
              label(r.kind),
              esc(label(r.label)),
              datetime(r.started_at),
              datetime(r.ended_at),
              duration((new Date(r.ended_at) - new Date(r.started_at)) / 1000),
            ]),
          )
        : empty(
            "No activity recorded",
            "Recorded activity will appear after a heartbeat.",
          ),
      { wide: true },
    );
  } catch (e) {
    toast(e.message, "error");
  }
}
async function reports(el, personal) {
  if (state.isMaster || (!personal && !manager()))
    throw new Error("Access is not permitted.");
  const members = personal ? [state.profile] : await loadMembers();
  let tab = "daily",
    exportRows = [];
  el.innerHTML = `<div class="page-heading"><div><h1>${personal ? "My activity" : "Work tracking"}</h1><p>Signed-in, active, idle and task time are separate measures. Times shown in ${esc(timezone())}.</p></div><button class="btn" id="export-report">${icon("download")}Export CSV</button></div><form class="toolbar report-filters">${field("from_day", "From", today(), { type: "date", required: true })}${field("to_day", "Until", today(), { type: "date", required: true })}${personal ? "" : field("member", "Team member", "", { options: [["", "All members"], ...members.map((m) => [m.id, m.name])] })}<button class="btn primary" type="submit">Apply</button></form><div class="filters" style="margin:20px 0">${[
    ["daily", "Daily summary"],
    ["tasks", "Task time"],
    ["sessions", "Login history"],
    ["logs", "Activity log"],
  ]
    .map(
      ([key, name]) =>
        `<button data-tab="${key}" class="${key === "daily" ? "active" : ""}">${name}</button>`,
    )
    .join("")}</div><div id="report-content"></div>`;
  const form = el.querySelector("form"),
    content = el.querySelector("#report-content");
  const draw = async () => {
    const args = {
      from_day: form.elements.from_day.value,
      to_day: form.elements.to_day.value,
      member: personal ? state.user.id : form.elements.member.value || null,
    };
    try {
      if (tab === "daily") {
        const rows = (await rpc("report_daily", args)) || [];
        exportRows = rows;
        const totals = rows.reduce(
          (a, r) => {
            for (const k of Object.keys(a)) a[k] += Number(r[k] || 0);
            return a;
          },
          {
            signed_in_seconds: 0,
            active_seconds: 0,
            idle_seconds: 0,
            task_seconds: 0,
          },
        );
        content.innerHTML = `<div class="grid four" style="margin-bottom:24px">${[
          ["Signed in", "signed_in_seconds"],
          ["Active", "active_seconds"],
          ["Idle", "idle_seconds"],
          ["Task timers", "task_seconds"],
        ]
          .map(
            ([name, key]) =>
              `<div class="card"><div class="stat-label">${name}</div><div class="stat-value">${duration(totals[key])}</div></div>`,
          )
          .join("")}</div>${
          rows.length
            ? table(
                [
                  "Day",
                  "Member",
                  "Signed in",
                  "Active",
                  "Idle",
                  "Task timers",
                  "",
                ],
                rows.map((r, i) => [
                  date(r.day),
                  esc(r.name),
                  duration(r.signed_in_seconds),
                  duration(r.active_seconds),
                  duration(r.idle_seconds),
                  duration(r.task_seconds),
                  `<button class="text-button" data-timeline="${i}">Timeline</button>`,
                ]),
              )
            : empty(
                "Nothing recorded yet",
                "Time appears here after your first heartbeat.",
              )
        }`;
        content.querySelectorAll("[data-timeline]").forEach(
          (b) =>
            (b.onclick = () => {
              const r = rows[Number(b.dataset.timeline)];
              timeline(r.day, r.user_id, r.name);
            }),
        );
      } else if (tab === "tasks") {
        const rows = (await rpc("report_tasks", args)) || [];
        exportRows = rows;
        content.innerHTML = rows.length
          ? table(
              ["Task", "Member", "Tracked time"],
              rows.map((r) => [esc(r.title), esc(r.name), duration(r.seconds)]),
            )
          : empty(
              "No task time in this period",
              "Start a timer from a task assigned to you.",
            );
      } else if (tab === "sessions") {
        const rows = (await rpc("list_sessions", args)) || [];
        exportRows = rows;
        content.innerHTML = rows.length
          ? table(
              ["Member", "Signed in", "Last heartbeat", "Signed out", "Reason"],
              rows.map((r) => [
                esc(r.name),
                datetime(r.started_at),
                datetime(r.last_heartbeat_at),
                datetime(r.ended_at),
                r.ended_at ? esc(label(r.end_reason)) : chip("signed_in"),
              ]),
            )
          : empty(
              "No sessions in this period",
              "Change the date range to see earlier logins.",
            );
      } else {
        const rows = (await rpc("report_activity", args)) || [];
        exportRows = rows.map((r) => ({
          time: r.created_at,
          member: r.name,
          action: r.action,
          entity: r.entity_type || "",
        }));
        content.innerHTML = rows.length
          ? table(
              ["When", "Member", "Action", "Item"],
              rows.map((r) => [
                datetime(r.created_at),
                esc(r.name),
                esc(label(r.action)),
                esc(label(r.entity_type)),
              ]),
            )
          : empty(
              "No activity in this period",
              "Changes to your workspace are recorded here.",
            );
      }
    } catch (error) {
      content.innerHTML = `<div class="banner error-panel">${esc(error.message)}</div>`;
      exportRows = [];
    }
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form.querySelector("button"), draw);
  };
  el.querySelector("#export-report").onclick = () =>
    downloadCSV("work-tracking-" + today() + ".csv", exportRows);
  el.querySelectorAll("[data-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        tab = b.dataset.tab;
        el.querySelectorAll("[data-tab]").forEach((x) =>
          x.classList.toggle("active", x === b),
        );
        draw();
      }),
  );
  await draw();
}
registerRoute("reports", "Work tracking", (el) => reports(el, false));
registerRoute("activity", "My activity", (el) => reports(el, true));
