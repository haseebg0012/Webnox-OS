import { rpc } from "./data.js";
import { state } from "./state.js";
import { icon, esc, toast, busy, dialog } from "./ui.js";
import { duration } from "./time.js";
let running = null,
  offset = 0;
async function sync() {
  try {
    running = await rpc("my_timer");
    offset = running?.server_time
      ? new Date(running.server_time).getTime() - Date.now()
      : 0;
    draw();
  } catch {
    /* Keep the last known timer until connectivity returns. */
  }
}
function seconds() {
  return running
    ? Number(running.prior_seconds || 0) +
        (Date.now() + offset - new Date(running.started_at).getTime()) / 1000
    : 0;
}
function draw() {
  const slot = document.querySelector("#timer-slot");
  if (!slot) return;
  slot.innerHTML = running
    ? `<button class="timer-pill" aria-label="Running timer: ${esc(running.title)}">${icon("clock")}<span>${duration(seconds())}</span></button>`
    : "";
  slot.querySelector("button")?.addEventListener("click", () => {
    const d = dialog(
      "Running timer",
      `<p><strong>${esc(running.title)}</strong></p><p class="timer-total">${duration(seconds())}</p><div class="row wrap"><button class="btn" data-pause>${icon("pause")}Pause</button><button class="btn primary" data-stop>Stop timer</button></div>`,
    );
    for (const [selector, name] of [
      ["[data-pause]", "timer_pause"],
      ["[data-stop]", "timer_stop"],
    ])
      d.querySelector(selector).onclick = (e) =>
        busy(e.currentTarget, async () => {
          try {
            await rpc(name);
            d.close();
            await sync();
            toast("Timer saved");
          } catch (err) {
            toast(err.message, "error");
          }
        });
  });
}
export function startTimerUI() {
  if (state.isMaster || state.workspace?.status === "suspended") return;
  sync();
  addEventListener("tracking-heartbeat", sync);
  addEventListener("task-updated", sync);
  setInterval(() => {
    const text = document.querySelector(".timer-pill span");
    if (text && running) text.textContent = duration(seconds());
  }, 1000);
  setInterval(sync, 30000);
  addEventListener("task-drawer-open", ({ detail: { task, element } }) => {
    if (
      task.assignee_id !== state.user.id ||
      !["todo", "in_progress"].includes(task.status)
    )
      return;
    element.innerHTML = `<button class="btn" data-timer>${icon("play")}Start timer</button>`;
    element.querySelector("button").onclick = (e) =>
      busy(e.currentTarget, async () => {
        try {
          await rpc("timer_start", { target: task.id });
          await sync();
          toast("Timer started");
          element.closest("dialog").close();
          dispatchEvent(new HashChangeEvent("hashchange"));
        } catch (err) {
          toast(err.message, "error");
        }
      });
  });
}
