const paths = {
  home: "M3 10l9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10zm6 11v-8h6v8",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
  tasks: "M9 5h11M9 12h11M9 19h11M2 5l2 2 3-4M2 12l2 2 3-4M2 19l2 2 3-4",
  target:
    "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4",
  briefcase: "M3 7h18v13H3zM8 7V3h8v4M3 12h18M10 12v3h4v-3",
  folder: "M3 5h7l2 3h9v12H3z",
  money: "M12 2v20M17 5H9a4 4 0 0 0 0 8h6a4 4 0 0 1 0 8H6",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 6v6l4 2",
  activity: "M2 12h5l3-9 4 18 3-9h5",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 2h6l1 4 4 1 2 5-3 3-1 5-6 2-4-3-5-1-1-6 3-4 1-5z",
  shield: "M12 2l9 4v6c0 5-9 10-9 10S3 17 3 12V6zM8 12l3 3 5-6",
  file: "M5 2h9l5 5v15H5zM14 2v6h5M8 12h8M8 16h8",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
  menu: "M3 6h18M3 12h18M3 18h18",
  chevron: "m9 5 7 7-7 7",
  down: "m6 9 6 6 6-6",
  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M6 18 18 6",
  search: "M21 21l-6-6M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14",
  logout: "M9 4H3v16h6M9 12h13M17 7l5 5-5 5",
  play: "m7 3 14 9-14 9z",
  pause: "M8 4v16M16 4v16",
  check: "m4 12 5 5L20 6",
  copy: "M9 9h12v12H9zM15 5V2H2v13h3",
  download: "M12 3v12M7 10l5 5 5-5M3 16v5h18v-5",
  edit: "m16 3 5 5-13 13H3v-5zM13 6l5 5",
  mail: "M3 4h18v16H3zM3 5l9 7 9-7",
  globe:
    "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M2 12h20M12 2c-6 5-6 15 0 20 6-5 6-15 0-20",
  link: "M10 13a5 5 0 0 0 7 0l4-4a5 5 0 0 0-7-7l-3 3M14 11a5 5 0 0 0-7 0l-4 4a5 5 0 0 0 7 7l3-3",
  calendar: "M3 5h18v16H3zM7 2v6M17 2v6M3 10h18",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  inbox: "M3 3h18v18H3zM3 14h5l2 3h4l2-3h5",
  lock: "M5 10h14v12H5zM8 10V6a4 4 0 0 1 8 0v4",
};
export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
export function icon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.grid}"/></svg>`;
}
export function initials(name) {
  return String(name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}
export function avatar(name, large = false) {
  return `<span class="avatar${large ? " large" : ""}">${esc(initials(name))}</span>`;
}
export function label(value) {
  return String(value ?? "")
    .replaceAll("_", " ")
    .replace(/^./, (x) => x.toUpperCase());
}
export function chip(value) {
  return `<span class="chip ${esc(value)}">${esc(label(value))}</span>`;
}
export function toast(message, type = "") {
  let stack = document.querySelector(".toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "toast-stack";
    stack.setAttribute("aria-live", "polite");
    document.body.append(stack);
  }
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.textContent = message;
  stack.append(item);
  setTimeout(() => item.remove(), 4000);
}
export function loading(message = "Loading your workspace…") {
  return `<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span>${esc(message)}</div>`;
}
export function empty(title, description, action = "", symbol = "inbox") {
  return `<div class="empty"><div class="empty-icon">${icon(symbol, 26)}</div><h2>${esc(title)}</h2><p>${esc(description)}</p>${action}</div>`;
}
export function errorView(el, error, retry) {
  el.innerHTML = `<div class="banner error-panel"><div><strong>Unable to load this page</strong><div>${esc(error.message || "Please try again.")}</div></div><button class="btn" data-retry>Try again</button></div>`;
  el.querySelector("[data-retry]").onclick = retry;
}
export function dialog(title, body, { drawer = false, wide = false } = {}) {
  const previous = document.activeElement;
  const el = document.createElement("dialog");
  if (drawer) el.className = "drawer";
  if (wide) el.style.width = "min(900px, calc(100vw - 32px))";
  el.innerHTML = `<div class="dialog-head"><h2>${esc(title)}</h2><button class="icon-btn" aria-label="Close">${icon("close")}</button></div><div class="dialog-body">${body}</div>`;
  document.body.append(el);
  el.querySelector(".dialog-head button").onclick = () => el.close();
  el.addEventListener("close", () => {
    el.remove();
    previous?.focus();
  });
  el.addEventListener("click", (event) => {
    if (event.target === el) {
      const r = el.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        el.close();
    }
  });
  el.showModal();
  return el;
}
export function confirmDialog(title, message, action = "Confirm") {
  return new Promise((resolve) => {
    const el = dialog(
      title,
      `<p>${esc(message)}</p><div class="form-actions"><button class="btn" data-cancel>Cancel</button><button class="btn primary" data-confirm>${esc(action)}</button></div>`,
    );
    let result = false;
    el.querySelector("[data-cancel]").onclick = () => el.close();
    el.querySelector("[data-confirm]").onclick = () => {
      result = true;
      el.close();
    };
    el.addEventListener("close", () => resolve(result));
  });
}
export async function busy(button, work) {
  if (button.disabled) return;
  button.disabled = true;
  const text = button.innerHTML;
  button.innerHTML = `${icon("clock")} Working…`;
  try {
    return await work();
  } finally {
    button.disabled = false;
    button.innerHTML = text;
  }
}
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied to clipboard");
  } catch {
    dialog(
      "Copy this text",
      `<textarea class="input" rows="5" readonly>${esc(text)}</textarea>`,
    )
      .querySelector("textarea")
      .select();
  }
}
export function downloadCSV(filename, rows) {
  if (!rows.length) {
    toast("No records to export");
    return;
  }
  const headers = Object.keys(rows[0]);
  const cell = (v) => {
    let s = typeof v === "object" ? JSON.stringify(v) : String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  const csv = [headers, ...rows.map((r) => headers.map((h) => r[h]))]
    .map((r) => r.map(cell).join(","))
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function field(
  name,
  title,
  value = "",
  {
    type = "text",
    required = false,
    options,
    full = false,
    help = "",
    min,
    max,
    step,
    placeholder = "",
  } = {},
) {
  const attr = `name="${esc(name)}" ${required ? "required" : ""} ${min !== undefined ? `min="${esc(min)}"` : ""} ${max !== undefined ? `max="${esc(max)}"` : ""} ${step ? `step="${esc(step)}"` : ""}`;
  let control = options
    ? `<select ${attr}>${options
        .map((o) => {
          const [v, l] = Array.isArray(o) ? o : [o, label(o)];
          return `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${esc(l)}</option>`;
        })
        .join("")}</select>`
    : type === "textarea"
      ? `<textarea ${attr}>${esc(value)}</textarea>`
      : `<input ${attr} type="${esc(type)}" value="${esc(value)}" placeholder="${esc(placeholder)}">`;
  return `<label class="field ${full ? "span-all" : ""}"><span>${esc(title)}${required ? " *" : ""}</span>${control}${help ? `<small>${esc(help)}</small>` : ""}</label>`;
}
export const formValues = (form) => Object.fromEntries(new FormData(form));
export function table(headers, rows) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c ?? ""}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
