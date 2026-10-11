import { q, rpc } from "./data.js";
import { esc, icon, dialog, empty, busy, toast } from "./ui.js";
import { datetime } from "./time.js";
let rows = [];
async function load() {
  rows = await q("notifications", { limit: 100 });
  const bell = document.querySelector("#notifications"),
    count = rows.filter((n) => !n.read_at).length;
  if (bell) {
    bell.innerHTML =
      icon("bell") +
      (count
        ? `<span class="notification-dot">${count > 99 ? "99+" : count}</span>`
        : "");
    bell.setAttribute(
      "aria-label",
      `Notifications${count ? ", " + count + " unread" : ""}`,
    );
  }
}
export function startNotifications() {
  load().catch(() => {});
  setInterval(() => {
    if (!document.hidden) load().catch(() => {});
  }, 30000);
  const bell = document.querySelector("#notifications");
  bell.onclick = async () => {
    try {
      await load();
      const d = dialog(
        "Notifications",
        `<div class="row between" style="margin-bottom:20px"><span class="small muted">Your latest 100 updates</span><button class="btn small" data-read-all>Mark all as read</button></div>${rows.length ? `<div class="stack">${rows.map((n) => `<article class="card ${n.read_at ? "" : "unread"}"><div class="row between"><strong>${esc(n.title)}</strong>${n.read_at ? "" : '<span class="chip">New</span>'}</div><p style="margin:8px 0;white-space:pre-wrap">${esc(n.body)}</p><div class="small muted">${n.source === "master" ? "From Webnox OS · " : ""}${datetime(n.created_at)}</div>${n.link?.startsWith("#/") ? `<a class="text-button" href="${esc(n.link)}" data-open="${n.id}">View update</a>` : ""}</article>`).join("")}</div>` : empty("All caught up", "Your workspace updates will appear here.")}`,
        { drawer: true },
      );
      d.querySelector("[data-read-all]").onclick = (e) =>
        busy(e.currentTarget, async () => {
          try {
            await rpc("notifications_read");
            await load();
            d.close();
            toast("All notifications marked as read");
          } catch (e) {
            toast(e.message, "error");
          }
        });
      d.querySelectorAll("[data-open]").forEach(
        (a) =>
          (a.onclick = () => {
            rpc("notifications_read", { target: a.dataset.open })
              .then(load)
              .catch(() => {});
            d.close();
          }),
      );
    } catch (error) {
      toast(error.message, "error");
    }
  };
}
