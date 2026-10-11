import { getSupabase } from "./supabase.js";
import { state, can } from "./state.js";
import { icon, avatar, esc, loading, errorView, empty, dialog } from "./ui.js";
const app = document.querySelector("#app");
const routes = new Map();
export function registerRoute(name, title, render) {
  routes.set(name, { title, render });
}
export async function refreshContext() {
  const sb = await getSupabase();
  const { data, error } = await sb.rpc("boot_context");
  if (error) throw error;
  if (!data?.profile)
    throw new Error(
      "Your account has not been activated. Please contact your admin.",
    );
  Object.assign(state, data, {
    isMaster: data.profile.is_master,
    isAdmin: data.profile.account_type === "admin",
    isOwner: data.profile.account_type === "admin",
    roles: data.roles || [],
    perms: data.permissions || [],
  });
  const navElement = document.querySelector(".sidebar nav");
  if (navElement) {
    const nav =
      state.workspace?.status === "suspended"
        ? [["billing", "Billing", "money"]]
        : navigation();
    navElement.innerHTML = nav
      .map(
        ([r, t, i]) =>
          `<a class="nav-item ${location.hash === `#/${r}` ? "active" : ""}" title="${t}" href="#/${r}">${icon(i)}<span class="nav-text">${t}</span></a>`,
      )
      .join("");
  }
  return data;
}
function navigation() {
  return state.isMaster
    ? [
        ["master-home", "Home", "home"],
        ["master-workspaces", "Workspaces", "grid"],
        ["master-finance", "Finance", "money"],
        ["master-settings", "Settings", "settings"],
      ]
    : [
        ["home", "Overview", "home"],
        ["tasks", "Tasks", "tasks"],
        ...(can("leads") ? [["leads", "Leads", "target"]] : []),
        ...(can("clients") ? [["clients", "Clients", "briefcase"]] : []),
        ...(can("projects") ? [["projects", "Projects", "folder"]] : []),
        ...(can("finance") ? [["finance", "Finance", "money"]] : []),
        ["activity", "My activity", "activity"],
        ...(state.isAdmin || state.roles.includes("manager")
          ? [["reports", "Work tracking", "clock"]]
          : []),
        ["team", "Team", "users"],
        ...(state.isAdmin
          ? [
              ["permissions", "Permissions", "shield"],
              ["settings", "Settings", "settings"],
              ["billing", "Billing", "money"],
            ]
          : []),
      ];
}
function shell() {
  const nav =
    state.workspace?.status === "suspended"
      ? [["billing", "Billing", "money"]]
      : navigation();
  const name = state.isMaster ? "Webnox OS" : state.workspace.name;
  document.title = name;
  document.body.dataset.world = state.isMaster ? "master" : "business";
  if (state.isMaster && !document.querySelector("#master-theme")) {
    const style = document.createElement("link");
    style.id = "master-theme";
    style.rel = "stylesheet";
    style.href = "/css/master.css";
    document.head.append(style);
  }
  app.innerHTML = `<aside class="sidebar"><div class="sidebar-brand">${avatar(name)}<span class="brand-text"><strong>${esc(name)}</strong>${state.isMaster ? '<br><span class="master-badge">Master</span>' : ""}</span></div><nav>${nav.map(([r, t, i]) => `<a class="nav-item" title="${t}" href="#/${r}">${icon(i)}<span class="nav-text">${t}</span></a>`).join("")}</nav><div class="sidebar-foot row">${avatar(state.profile.name)}<div class="person-info grow"><strong class="small">${esc(state.profile.name)}</strong><div class="small muted">${esc(state.isMaster ? "Master" : state.profile.job_title || state.profile.account_type)}</div></div></div></aside><div class="sidebar-shade"></div><div class="app-main"><header class="topbar"><div class="row"><button class="icon-btn" id="toggle-nav" aria-label="Toggle navigation">${icon("menu")}</button><h1 id="page-title"></h1></div><div class="row"><span id="timer-slot"></span><button class="icon-btn" id="notifications" aria-label="Notifications">${icon("bell")}</button><button class="profile-button" id="profile-menu" aria-label="Account menu">${avatar(state.profile.name)}${icon("down", 14)}</button></div></header><main class="page" id="page"></main></div>`;
  document.querySelector("#toggle-nav").onclick = () =>
    document.body.classList.toggle(innerWidth < 768 ? "nav-open" : "collapsed");
  document.querySelector(".sidebar-shade").onclick = () =>
    document.body.classList.remove("nav-open");
  document.querySelector("#profile-menu").onclick = () => {
    const modal = dialog(
      "Your account",
      `<p><strong>${esc(state.profile.name)}</strong><br><span class="muted">${esc(state.profile.email)}</span></p><button class="btn" id="sign-out">${icon("logout")}Sign out</button>`,
    );
    modal.querySelector("#sign-out").onclick = async () => {
      const sb = await getSupabase();
      if (!state.isMaster) await (await import("./tracker.js")).stopTracking();
      await sb.auth.signOut();
      location.replace("/login.html");
    };
  };
  document.querySelector("#notifications").onclick = () =>
    dialog(
      "Notifications",
      empty("All caught up", "Your workspace updates will appear here."),
    );
}
async function route() {
  document.body.classList.toggle(
    "billing-only",
    state.workspace?.status === "suspended",
  );
  document.body.classList.remove("nav-open");
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  const key =
    state.workspace?.status === "suspended" && parts[0] !== "invoice"
      ? "billing"
      : parts[0] || (state.isMaster ? "master-home" : "home");
  const entry = routes.get(key);
  const page = document.querySelector("#page");
  document.querySelector("#page-title").textContent =
    entry?.title || "Page not found";
  document
    .querySelectorAll(".nav-item")
    .forEach((a) => a.classList.toggle("active", a.hash === `#/${key}`));
  page.innerHTML = loading();
  try {
    if (entry) await entry.render(page, parts.slice(1));
    else
      page.innerHTML = empty(
        "Page not found",
        "Choose a page from your navigation.",
      );
  } catch (error) {
    errorView(page, error, route);
  }
}
async function boot() {
  try {
    const sb = await getSupabase();
    const {
      data: { session },
    } = await sb.auth.getSession();
    if (!session) {
      location.replace("/login.html");
      return;
    }
    state.user = session.user;
    await refreshContext();
    if (
      state.profile.status !== "active" ||
      (!state.isMaster &&
        (!state.workspace ||
          ["setup", "archived"].includes(state.workspace.status) ||
          (state.workspace.status === "suspended" && !state.isAdmin)))
    ) {
      await sb.auth.signOut();
      location.replace("/login.html");
      return;
    }
    await import("./pages/core.js");
    shell();
    window.addEventListener("hashchange", route);
    await route();
    (await import("./notifications.js")).startNotifications();
    if (state.isMaster || state.isAdmin)
      setTimeout(
        () =>
          getSupabase()
            .then((sb) => sb.rpc("master_sweep"))
            .then(async () => {
              await refreshContext();
              if (state.workspace?.status === "suspended")
                location.hash = "#/billing";
            })
            .catch(() => {}),
        0,
      );
    if (!state.isMaster) {
      (await import("./tracker.js")).startTracking();
      (await import("./timer.js")).startTimerUI();
    }
    sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") location.replace("/login.html");
    });
  } catch (error) {
    errorView(app, error, boot);
  }
}
boot();
