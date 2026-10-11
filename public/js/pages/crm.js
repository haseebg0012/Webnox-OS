import { registerRoute } from "../app.js";
import { state, can, money } from "../state.js";
import { q, rpc, loadMembers } from "../data.js";
import {
  esc,
  icon,
  field,
  formValues,
  dialog,
  busy,
  toast,
  empty,
  table,
  chip,
  confirmDialog,
  copyText,
  downloadCSV,
} from "../ui.js";
import { date, today } from "../time.js";
import { STAGES, CURRENCIES, SERVICES, SOURCES } from "../lead-options.js";
const refresh = () => dispatchEvent(new HashChangeEvent("hashchange"));
const manager = () => state.isAdmin || state.roles.includes("manager");
export async function clientForm(client) {
  crmForm("clients", client);
}
async function crmForm(kind, record) {
  const lead = kind === "leads",
    r = record || {},
    members = lead ? await loadMembers() : [];
  const sales = members.filter(
    (m) => m.status === "active" && m.roles?.includes("sales_rep"),
  );
  const d = dialog(
    `${record ? "Edit" : "New"} ${lead ? "lead" : "client"}`,
    `<form class="stack"><div class="form-grid">${field("name", "Name", r.name || "", { required: !lead })}${field("company", "Company", r.company || "", { required: true })}${field("email", "Email", r.email || "", { type: "email" })}${field("phone", "Phone", r.phone || "")}${field("website", "Website", r.website || "")}${field("country", "Country", r.country || "")}${lead ? `${field("niche", "Industry / niche", r.niche || "")}${field("service", "Service", r.service || "", { options: [["", "Choose a service"], ...SERVICES] })}` : `${field("address", "Address", r.address || "", { type: "textarea", full: true })}${field("services", "Services", r.services || "")}${field("onboarding_date", "Onboarding date", r.onboarding_date || today(), { type: "date" })}`}${field("currency", "Currency", r.currency || state.settings.app_currency, { options: CURRENCIES })}${field(lead ? "budget" : "monthly_retainer", lead ? "Budget" : "Monthly retainer", lead ? r.budget || 0 : r.monthly_retainer || 0, { type: "number", min: 0, step: ".01" })}${lead ? `${field("source", "Source", r.source || "Other", { options: SOURCES })}${field("stage", "Stage", r.stage || "new", { options: STAGES })}${field("priority", "Priority", r.priority || "medium", { options: ["low", "medium", "high", "urgent"] })}${field("follow_up_date", "Follow-up date", r.follow_up_date || "", { type: "date" })}${manager() || state.roles.includes("sales_rep") ? field("agent_id", "Sales Representative", r.agent_id || "", { options: [["", "Not assigned yet"], ...sales.map((m) => [m.id, m.name])] }) : ""}` : field("status", "Status", r.status || "active", { options: ["active", "paused", "archived"] })}${field("notes", "Notes", r.notes || "", { type: "textarea", full: true })}</div><p class="form-error" role="alert"></p><div class="form-actions"><button class="btn primary" type="submit">${record ? "Save changes" : lead ? "Add lead" : "Add client"}</button></div></form>`,
    { wide: true },
  );
  const form = d.querySelector("form");
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form.querySelector("[type=submit]"), async () => {
      try {
        const payload = formValues(form);
        if (record) payload.id = record.id;
        await rpc(lead ? "lead_save" : "client_save", { payload });
        d.close();
        toast("Saved");
        refresh();
      } catch (error) {
        form.querySelector(".form-error").textContent = error.message;
      }
    });
  };
}
async function openLead(id) {
  try {
    const [rows, members] = await Promise.all([
      q("leads", { filters: { id }, limit: 1 }),
      loadMembers(),
    ]);
    const l = rows[0];
    if (!l) throw new Error("Lead not found.");
    const d = dialog(
      l.company,
      `<div class="row wrap">${chip(l.stage)}${chip(l.priority)}${l.client_id ? chip("converted") : ""}</div><dl class="kv" style="margin-top:20px">${[
        ["Name", l.name],
        ["Email", l.email],
        ["Phone", l.phone],
        ["Country", l.country],
        ["Website", l.website],
        ["Service", l.service],
        ["Budget", money(l.budget, l.currency)],
        ["Source", l.source],
        [
          "Agent",
          members.find((m) => m.id === l.agent_id)?.name || "Not assigned yet",
        ],
        ["Follow-up", date(l.follow_up_date)],
      ]
        .map(([k, v]) => `<dt>${k}</dt><dd>${esc(v || "—")}</dd>`)
        .join(
          "",
        )}</dl><p style="white-space:pre-wrap">${esc(l.notes || "")}</p><div class="row wrap">${can("leads", "edit") && !l.client_id ? '<button class="btn" data-edit>Edit lead</button>' : ""}${can("leads", "edit") && !l.agent_id && state.roles.includes("sales_rep") ? '<button class="btn" data-take>Take this lead</button>' : ""}${l.stage === "won" && !l.client_id && manager() ? '<button class="btn primary" data-convert>Convert to client</button>' : ""}${l.client_id ? `<a class="btn primary" href="#/client/${l.client_id}" data-client>Open client</a>` : ""}${can("leads", "delete") ? '<button class="btn" data-archive>Archive</button>' : ""}</div>`,
      { drawer: true },
    );
    d.querySelector("[data-edit]")?.addEventListener("click", () => {
      d.close();
      crmForm("leads", l);
    });
    d.querySelector("[data-client]")?.addEventListener("click", () =>
      d.close(),
    );
    d.querySelector("[data-take]")?.addEventListener("click", (e) =>
      busy(e.currentTarget, async () => {
        try {
          await rpc("lead_save", {
            payload: { id: l.id, agent_id: state.user.id },
          });
          d.close();
          refresh();
          toast("Lead assigned to you");
        } catch (e) {
          toast(e.message, "error");
        }
      }),
    );
    d.querySelector("[data-convert]")?.addEventListener("click", (e) =>
      busy(e.currentTarget, async () => {
        if (
          !(await confirmDialog(
            "Convert to client?",
            `Create a client record for ${l.company}?`,
            "Convert",
          ))
        )
          return;
        try {
          const client = await rpc("lead_convert", { target: l.id });
          d.close();
          location.hash = `#/client/${client.id}`;
          const next = dialog(
            "Client created",
            `<p>${esc(client.company)} is now ${esc(client.buid)}.</p><a class="btn primary" href="#/new-project/${client.id}">Create a project now</a>`,
          );
          next.querySelector("a").onclick = () => next.close();
        } catch (err) {
          toast(err.message, "error");
        }
      }),
    );
    d.querySelector("[data-archive]")?.addEventListener("click", (e) =>
      busy(e.currentTarget, async () => {
        if (
          !(await confirmDialog(
            "Archive this lead?",
            "The record will remain in your history.",
            "Archive",
          ))
        )
          return;
        try {
          await rpc("lead_archive", { target: l.id });
          d.close();
          refresh();
        } catch (err) {
          toast(err.message, "error");
        }
      }),
    );
  } catch (error) {
    toast(error.message, "error");
  }
}
export function parseCSV(text) {
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("A quoted cell is not closed.");
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
function importLeads() {
  const d = dialog(
    "Import leads",
    `<p>CSV headings: company (required), name, email, phone, website, country, niche, service, currency, budget, source, stage, priority, notes. Up to 500 rows, 1 MB. Imported leads start unassigned.</p><label class="field"><span>CSV file</span><input type="file" accept=".csv,text/csv"></label><div data-summary></div><p class="form-error" role="alert"></p><button class="btn primary" data-import disabled>Import leads</button>`,
  );
  let records = [];
  d.querySelector("input").onchange = async (e) => {
    try {
      const file = e.target.files[0];
      if (!file || file.size > 1048576)
        throw new Error("Choose a CSV up to 1 MB.");
      const [headers, ...rows] = parseCSV(
        (await file.text()).replace(/^\uFEFF/, ""),
      );
      if (!headers?.includes("company") || rows.length > 500)
        throw new Error("Include a company heading and no more than 500 rows.");
      records = rows.map((row, i) => {
        const r = Object.fromEntries(
          headers.map((key, j) => [
            key.trim().toLowerCase(),
            row[j]?.trim() || "",
          ]),
        );
        if (!r.company) throw new Error(`Row ${i + 2}: company is required.`);
        const allowed = [
          "company",
          "name",
          "email",
          "phone",
          "website",
          "country",
          "niche",
          "service",
          "currency",
          "budget",
          "source",
          "stage",
          "priority",
          "notes",
        ];
        return Object.fromEntries(
          Object.entries(r).filter(([k, v]) => allowed.includes(k) && v !== ""),
        );
      });
      d.querySelector("[data-summary]").textContent =
        `${records.length} leads ready to import.`;
      d.querySelector("[data-import]").disabled = !records.length;
      d.querySelector(".form-error").textContent = "";
    } catch (error) {
      records = [];
      d.querySelector("[data-import]").disabled = true;
      d.querySelector(".form-error").textContent = error.message;
    }
  };
  d.querySelector("[data-import]").onclick = (e) =>
    busy(e.currentTarget, async () => {
      let saved = 0;
      try {
        while (records.length) {
          await rpc("lead_save", { payload: records[0] });
          records.shift();
          saved++;
          d.querySelector("[data-summary]").textContent =
            `${saved} imported; ${records.length} remaining.`;
        }
        d.close();
        toast(`${saved} leads imported`);
        refresh();
      } catch (error) {
        d.querySelector(".form-error").textContent =
          `${saved} saved. ${records.length} not imported: ${error.message}`;
        refresh();
      }
    });
}
registerRoute("leads", "Leads", async (el) => {
  if (!can("leads")) throw new Error("Access is not permitted.");
  const rows = await q("leads", { filters: { archived_at: null } });
  let stage = "all";
  el.innerHTML = `<div class="page-heading"><div><h1>Leads</h1><p>From first conversation to your next client.</p></div><div class="row wrap">${state.isAdmin ? '<button class="btn" id="public-form">Public form link</button>' : ""}${can("leads", "edit") ? '<button class="btn" id="import-leads">Import CSV</button><button class="btn primary" id="add-lead">Add lead</button>' : ""}</div></div><div class="toolbar"><label class="search">${icon("search")}<input class="input" aria-label="Search leads" placeholder="Company, name or email"></label></div><div class="filters" style="margin-bottom:20px">${["all", ...STAGES, "converted"].map((s) => `<button data-stage="${s}" class="${s === "all" ? "active" : ""}">${s === "all" ? "All leads" : s === "converted" ? "Converted to client" : s[0].toUpperCase() + s.slice(1)}</button>`).join("")}</div><div id="lead-list"></div>`;
  const draw = () => {
    const term = el.querySelector("input").value.toLowerCase(),
      filtered = rows.filter(
        (r) =>
          (stage === "all" ||
            (stage === "converted" ? r.client_id : r.stage === stage)) &&
          [r.company, r.name, r.email].some((x) =>
            x?.toLowerCase().includes(term),
          ),
      );
    el.querySelector("#lead-list").innerHTML = filtered.length
      ? table(
          ["Company", "Contact", "Stage", "Budget", "Follow-up"],
          filtered.map((r) => [
            `<button class="text-button strong" data-open="${r.id}">${esc(r.company)}</button>`,
            esc(r.name || r.email),
            chip(r.stage),
            money(r.budget, r.currency),
            date(r.follow_up_date),
          ]),
        )
      : empty(
          "No leads here yet",
          "Add a lead, import your list or share your public form.",
        );
    el.querySelectorAll("[data-open]").forEach(
      (b) => (b.onclick = () => openLead(b.dataset.open)),
    );
  };
  el.querySelector("input").oninput = draw;
  el.querySelectorAll("[data-stage]").forEach(
    (b) =>
      (b.onclick = () => {
        stage = b.dataset.stage;
        el.querySelectorAll("[data-stage]").forEach((x) =>
          x.classList.toggle("active", x === b),
        );
        draw();
      }),
  );
  el.querySelector("#add-lead")?.addEventListener("click", () =>
    crmForm("leads"),
  );
  el.querySelector("#import-leads")?.addEventListener("click", importLeads);
  el.querySelector("#public-form")?.addEventListener("click", () =>
    copyText(
      `${location.origin}/lead.html?token=${state.workspace.public_form_token}`,
    ),
  );
  draw();
});
registerRoute("clients", "Clients", async (el) => {
  if (!can("clients")) throw new Error("Access is not permitted.");
  const rows = await q("clients");
  el.innerHTML = `<div class="page-heading"><div><h1>Clients</h1><p>Keep relationships and delivery in one place.</p></div>${can("clients", "edit") ? '<button class="btn primary" id="add-client">Add client</button>' : ""}</div><div class="toolbar"><label class="search">${icon("search")}<input class="input" aria-label="Search clients" placeholder="Name, company or BUID"></label></div><div id="client-list"></div>`;
  const draw = () => {
    const term = el.querySelector("input").value.toLowerCase(),
      filtered = rows.filter((r) =>
        [r.name, r.company, r.buid].some((x) => x.toLowerCase().includes(term)),
      );
    el.querySelector("#client-list").innerHTML = filtered.length
      ? table(
          ["Client", "Business ID", "Status", "Monthly retainer"],
          filtered.map((c) => [
            `<a class="strong" href="#/client/${c.id}">${esc(c.company)}</a><div class="small muted">${esc(c.name)}</div>`,
            esc(c.buid),
            chip(c.status),
            money(c.monthly_retainer, c.currency),
          ]),
        )
      : empty(
          "Your client list starts here",
          "Add a client or convert a Won lead.",
        );
  };
  el.querySelector("input").oninput = draw;
  el.querySelector("#add-client")?.addEventListener("click", () =>
    crmForm("clients"),
  );
  draw();
});
registerRoute("client", "Client", async (el, [id]) => {
  if (!can("clients")) throw new Error("Access is not permitted.");
  const [c] = await q("clients", { filters: { id }, limit: 1 });
  if (!c) throw new Error("Client not found.");
  el.innerHTML = `<div class="page-heading"><div><p class="eyebrow">${esc(c.buid)} · ${esc(c.invoice_code)}</p><h1>${esc(c.company)}</h1><p>${esc(c.name)}</p></div><div class="row wrap">${can("projects", "edit") ? `<a class="btn" href="#/new-project/${c.id}">New project</a>` : ""}${can("clients", "edit") ? '<button class="btn" id="edit-client">Edit client</button>' : ""}</div></div><div class="tabs">${["overview", "projects", "tasks", "invoices", "files"].map((t) => `<button data-tab="${t}" class="${t === "overview" ? "active" : ""}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div><div id="client-content"></div>`;
  const content = el.querySelector("#client-content");
  const draw = async (tab) => {
    if (tab === "overview") {
      content.innerHTML = `<section class="card"><dl class="kv">${[
        ["Status", c.status],
        ["Email", c.email],
        ["Phone", c.phone],
        ["Website", c.website],
        ["Country", c.country],
        ["Address", c.address],
        ["Services", c.services],
        ["Onboarding", date(c.onboarding_date)],
        ["Monthly retainer", money(c.monthly_retainer, c.currency)],
      ]
        .map(([k, v]) => `<dt>${k}</dt><dd>${esc(v || "—")}</dd>`)
        .join("")}</dl><p>${esc(c.notes || "")}</p></section>`;
    } else {
      window.dispatchEvent(
        new CustomEvent("client-tab", {
          detail: { tab, client: c, element: content },
        }),
      );
    }
  };
  el.querySelector("#edit-client")?.addEventListener("click", () =>
    crmForm("clients", c),
  );
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
