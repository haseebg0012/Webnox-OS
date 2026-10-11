import { registerRoute } from "../app.js";
import { state, can, money } from "../state.js";
import { q, rpc, api } from "../data.js";
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
  confirmDialog,
} from "../ui.js";
import { date, today } from "../time.js";
import { CURRENCIES } from "../lead-options.js";
export async function invoiceList(el, kind, clientId = null) {
  const rows = await q("invoices", {
    filters: { kind, ...(clientId ? { client_id: clientId } : {}) },
  });
  el.innerHTML = `<div class="section-heading"><h2>${kind === "client" ? "Client" : "Business"} invoices</h2>${can("finance", "edit") ? `<a class="btn primary" href="#/new-invoice/${kind}${clientId ? "/" + clientId : ""}">New invoice</a>` : ""}</div>${
    rows.length
      ? table(
          ["Invoice", "Billed to", "Due", "Total", "Status"],
          rows.map((i) => [
            `<a class="strong" href="#/invoice/${i.id}">${esc(i.number)}</a>`,
            esc(i.billed_to.company || i.billed_to.name || "—"),
            date(i.due_date),
            money(i.amount_original, i.currency),
            chip(i.status),
          ]),
        )
      : empty(
          "No invoices yet",
          "Create an invoice when you are ready to bill.",
        )
  }`;
}
function lineRow(item = { description: "", quantity: 1, unit_price: 0 }) {
  return `<div class="invoice-item"><label class="field"><span>Description</span><input name="description" value="${esc(item.description)}" required></label><label class="field"><span>Quantity</span><input name="quantity" type="number" min=".001" step=".001" value="${item.quantity}" required></label><label class="field"><span>Unit price</span><input name="unit_price" type="number" min="0" step=".01" value="${item.unit_price}" required></label><button class="icon-btn" type="button" data-remove aria-label="Remove item">×</button></div>`;
}
function totals(items, discount, tax) {
  const subtotal = items.reduce(
      (sum, l) => sum + Math.round(l.quantity * l.unit_price * 100) / 100,
      0,
    ),
    discountAmount = Math.round(subtotal * discount) / 100,
    taxAmount = Math.round((subtotal - discountAmount) * tax) / 100;
  return {
    subtotal,
    discount_amount: discountAmount,
    tax_amount: taxAmount,
    amount_original: subtotal - discountAmount + taxAmount,
  };
}
async function invoiceForm(el, kind, clientId, existing) {
  if (!can("finance", "edit")) throw new Error("Access is not permitted.");
  const [clients, projects] = await Promise.all([q("clients"), q("projects")]);
  const i = existing || {};
  kind = i.kind || kind;
  const due = new Date(today() + "T12:00:00Z");
  due.setUTCDate(due.getUTCDate() + Number(state.settings.due_days));
  el.innerHTML = `<div class="page-heading"><div><h1>${existing ? "Edit " + i.number : "New " + kind + " invoice"}</h1><p>Numbers, references and issuer details are assigned when the invoice is saved.</p></div></div><form class="stack"><section class="card"><div class="form-grid">${!existing && kind === "client" ? field("client_id", "Client", clientId || "", { options: [["", "Choose a client"], ...clients.map((c) => [c.id, `${c.company} · ${c.buid}`])], required: true }) : ""}${!existing && kind === "business" ? `${field("bill_name", "Billed to", "", { required: true })}${field("bill_address", "Address", "", { type: "textarea" })}` : ""}${!existing && kind === "client" ? field("project_id", "Project", "", { options: [["", "No project"]] }) : ""}${field("issue_date", "Issue date", i.issue_date || today(), { type: "date", required: true })}${field("due_date", "Due date", i.due_date || due.toISOString().slice(0, 10), { type: "date", required: true })}${field("period_from", "Period from", i.period_from || "", { type: "date" })}${field("period_to", "Period to", i.period_to || "", { type: "date" })}${field("currency", "Currency", i.currency || state.settings.app_currency, { options: CURRENCIES })}${field("fx_rate", "Conversion rate", i.fx_rate || 1, { type: "number", min: ".000001", step: ".000001", required: true })}</div><p class="small muted" data-client-warning></p><p class="small muted" data-fx-status></p><a class="small" href="https://www.exchangerate-api.com" target="_blank" rel="noopener noreferrer">Rates by ExchangeRate-API · daily reference rates</a></section><section class="card"><h2>Line items</h2><div data-items>${(i.line_items || [{}]).map((item) => lineRow(Object.keys(item).length ? item : undefined)).join("")}</div><button class="btn" type="button" data-add>Add item</button></section><section class="card"><div class="form-grid">${field("discount_percent", "Discount (%)", i.discount_percent || 0, { type: "number", min: 0, max: 100, step: ".001" })}${field("tax_percent", "Tax (%)", i.tax_percent || 0, { type: "number", min: 0, max: 100, step: ".001" })}${field("notes", "Notes / ad-spend note", i.notes || "", { type: "textarea", full: true })}${field("terms", "Terms", i.terms || state.settings.invoice_details?.terms || "", { type: "textarea", full: true })}</div><div data-total class="form-actions"></div></section><p class="form-error" role="alert"></p><div class="form-actions"><button class="btn" type="button" data-preview>Preview</button><button class="btn primary" type="submit">${existing ? "Save changes" : "Create invoice"}</button></div></form>`;
  const form = el.querySelector("form");
  let rateRequest = 0;
  const items = () =>
    [...form.querySelectorAll(".invoice-item")].map((row) => ({
      description: row.querySelector("[name=description]").value,
      quantity: Number(row.querySelector("[name=quantity]").value),
      unit_price: Number(row.querySelector("[name=unit_price]").value),
    }));
  const values = () => ({
    ...formValues(form),
    kind,
    line_items: items(),
    ...(existing ? { id: i.id } : {}),
    ...(kind === "business"
      ? {
          billed_to: {
            name: form.bill_name?.value,
            company: form.bill_name?.value,
            address: form.bill_address?.value,
          },
        }
      : {}),
  });
  const draw = () => {
    const t = totals(
      items(),
      Number(form.discount_percent.value),
      Number(form.tax_percent.value),
    );
    form.querySelector("[data-total]").textContent =
      `Total ${money(t.amount_original, form.currency.value)} · ${money(t.amount_original * Number(form.fx_rate.value))}`;
  };
  form.addEventListener("input", draw);
  form.querySelector("[data-add]").onclick = () => {
    if (form.querySelectorAll(".invoice-item").length >= 100) return;
    form
      .querySelector("[data-items]")
      .insertAdjacentHTML("beforeend", lineRow());
    draw();
  };
  form.querySelector("[data-items]").onclick = (e) => {
    if (
      e.target.closest("[data-remove]") &&
      form.querySelectorAll(".invoice-item").length > 1
    ) {
      e.target.closest(".invoice-item").remove();
      draw();
    }
  };
  const chooseClient = () => {
    if (!form.client_id) return;
    const c = clients.find((c) => c.id === form.client_id.value);
    form.querySelector("[data-client-warning]").textContent =
      c && !c.address
        ? "This client has no billing address. Add it in the client record before issuing."
        : "";
    if (form.project_id)
      form.project_id.innerHTML =
        '<option value="">No project</option>' +
        projects
          .filter((p) => p.client_id === c?.id)
          .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)
          .join("");
  };
  form.client_id?.addEventListener("change", chooseClient);
  chooseClient();
  form.currency.onchange = async () => {
    const n = ++rateRequest,
      status = form.querySelector("[data-fx-status]");
    if (form.currency.value === state.settings.app_currency) {
      form.fx_rate.value = 1;
      status.textContent = "Same currency";
      draw();
      return;
    }
    try {
      status.textContent = "Fetching rate…";
      const rate = await api(
        `/api/fx?from=${form.currency.value}&to=${state.settings.app_currency}`,
      );
      if (n !== rateRequest) return;
      form.fx_rate.value = Number(rate.rate).toFixed(6);
      status.textContent = "Reference rate fetched; you may edit it.";
      draw();
    } catch (e) {
      if (n === rateRequest) {
        form.fx_rate.value = "";
        status.textContent = e.message;
      }
    }
  };
  form.fx_rate.oninput = () => rateRequest++;
  form.querySelector("[data-preview]").onclick = () => {
    if (!form.reportValidity()) return;
    const data = values(),
      t = totals(
        data.line_items,
        Number(data.discount_percent),
        Number(data.tax_percent),
      );
    dialog(
      "Invoice preview",
      `${table(
        ["Description", "Quantity", "Unit price"],
        data.line_items.map((l) => [
          esc(l.description),
          l.quantity,
          money(l.unit_price, data.currency),
        ]),
      )}<p style="margin-top:20px"><strong>Total: ${money(t.amount_original, data.currency)}</strong></p><p class="small muted">The database calculates the final totals when saved.</p>`,
      { wide: true },
    );
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form.querySelector("[type=submit]"), async () => {
      try {
        const saved = await rpc("invoice_save", { payload: values() });
        toast("Invoice saved");
        location.hash = `#/invoice/${saved.id}`;
      } catch (e) {
        form.querySelector(".form-error").textContent = e.message;
      }
    });
  };
  draw();
}
registerRoute(
  "new-invoice",
  "New invoice",
  (el, [kind = "client", clientId]) => {
    if (!["client", "business"].includes(kind))
      throw new Error("Choose a valid invoice type.");
    return invoiceForm(el, kind, clientId);
  },
);
registerRoute("edit-invoice", "Edit invoice", async (el, [id]) => {
  const [i] = await q("invoices", { filters: { id }, limit: 1 });
  if (!i) throw new Error("Invoice not found.");
  return invoiceForm(el, i.kind, i.client_id, i);
});
export async function invoiceSheet(i) {
  let logo = "";
  if (i.issuer_details.logo_path) {
    const config = await fetch("/api/config").then((r) => r.json());
    const path = i.issuer_details.logo_path;
    if (/^w[0-9a-f-]{36}\/[\w.-]+$/.test(path))
      logo = `${config.supabaseUrl}/storage/v1/object/public/brand/${path}`;
    else if (/^https:\/\//.test(path)) logo = path;
  }
  const d = i.issuer_details,
    b = i.billed_to;
  return `<article class="invoice-sheet"><header class="invoice-head"><div>${logo ? `<img class="invoice-logo" src="${esc(logo)}" alt="Business logo">` : ""}<h2>${esc(d.legal_name || d.company_name || "Webnox OS")}</h2><p>${esc(d.address || "")}</p>${d.tax_id ? `<p>Tax ID: ${esc(d.tax_id)}</p>` : ""}</div><div class="invoice-heading"><h1>${Number(i.tax_percent) > 0 ? "TAX INVOICE" : "INVOICE"}</h1><strong>${esc(i.number)}</strong><p>Issued ${date(i.issue_date)}<br>Due ${date(i.due_date)}</p></div></header><section class="invoice-parties"><div><p class="eyebrow">Billed to</p><h2>${esc(b.company || b.name)}</h2>${b.buid ? `<p>${esc(b.buid)}</p>` : ""}<p style="white-space:pre-wrap">${esc(b.address || "Address not provided")}</p><p>${esc(b.email || "")}</p></div><dl class="kv"><dt>Reference</dt><dd class="small">${esc(i.reference)}</dd><dt>Period</dt><dd>${date(i.period_from)} – ${date(i.period_to)}</dd><dt>Currency</dt><dd>${esc(i.currency)}</dd><dt>Status</dt><dd>${esc(i.status.toUpperCase())}</dd></dl></section>${table(
    ["Description", "Qty", "Rate", "Amount"],
    i.line_items.map((l) => [
      esc(l.description),
      l.quantity,
      money(l.unit_price, i.currency),
      money(Number(l.quantity) * Number(l.unit_price), i.currency),
    ]),
  )}<div class="invoice-totals"><dl class="kv"><dt>Subtotal</dt><dd>${money(i.subtotal, i.currency)}</dd><dt>Discount (${Number(i.discount_percent)}%)</dt><dd>−${money(i.discount_amount, i.currency)}</dd><dt>Tax (${Number(i.tax_percent)}%)</dt><dd>${money(i.tax_amount, i.currency)}</dd><dt><strong>Total</strong></dt><dd><strong>${money(i.amount_original, i.currency)}</strong></dd></dl></div><section class="invoice-foot"><h3>Payment details</h3><p style="white-space:pre-wrap">${esc(d.bank_details || "Please contact the issuer for payment instructions.")}</p><h3>Terms</h3><p>Payment is due by ${date(i.due_date)}.${d.pause_days ? ` Services may pause ${Number(d.pause_days)} days after the invoice date if payment is outstanding.` : ""}</p><p style="white-space:pre-wrap">${esc(i.terms || "")}</p>${i.notes ? `<h3>Notes</h3><p style="white-space:pre-wrap">${esc(i.notes)}</p>` : ""}<p>Issued by <strong>${esc(i.issued_by.name)}</strong>${i.issued_by.designation ? ", " + esc(i.issued_by.designation) : ""}</p></section><footer class="small muted">${esc(d.email || "")}${d.phone ? " · " + esc(d.phone) : ""}<span> · Thank you for your business.</span></footer></article>`;
}
registerRoute("invoice", "Invoice", async (el, [id]) => {
  const [i] = await q("invoices", { filters: { id }, limit: 1 });
  if (!i) throw new Error("Invoice not found.");
  el.innerHTML = `<div class="page-heading no-print"><div><h1>${esc(i.number)}</h1><p>${chip(i.status)}</p></div><div class="row wrap"><button class="btn" data-print>Print / save PDF</button>${can("finance", "edit") && i.kind !== "rent" && i.status === "unpaid" ? `<a class="btn" href="#/edit-invoice/${i.id}">Edit</a><button class="btn primary" data-paid>Mark paid</button>` : ""}${can("finance", "delete") && i.kind !== "rent" && i.status === "unpaid" ? '<button class="btn" data-void>Void invoice</button>' : ""}</div></div>${await invoiceSheet(i)}`;
  el.querySelector("[data-print]").onclick = () => window.print();
  el.querySelector("[data-paid]")?.addEventListener("click", () => {
    const d = dialog(
      "Record invoice payment",
      `<form class="stack">${field("paid_on", "Paid on", today(), { type: "date", required: true })}<p class="form-error"></p><button class="btn primary">Mark paid</button></form>`,
    );
    d.querySelector("form").onsubmit = (e) => {
      e.preventDefault();
      busy(d.querySelector(".btn"), async () => {
        try {
          await rpc("invoice_set_status", {
            target: i.id,
            new_status: "paid",
            paid_on: d.querySelector("input").value,
          });
          d.close();
          dispatchEvent(new HashChangeEvent("hashchange"));
        } catch (e) {
          d.querySelector(".form-error").textContent = e.message;
        }
      });
    };
  });
  el.querySelector("[data-void]")?.addEventListener("click", async () => {
    if (
      !(await confirmDialog(
        "Void this invoice?",
        "Its number and history remain on record.",
        "Void invoice",
      ))
    )
      return;
    try {
      await rpc("invoice_set_status", { target: i.id, new_status: "void" });
      dispatchEvent(new HashChangeEvent("hashchange"));
    } catch (e) {
      toast(e.message, "error");
    }
  });
});
addEventListener("invoice-list", ({ detail: { kind, element } }) =>
  invoiceList(element, kind).catch(
    (e) => (element.innerHTML = `<p class="form-error">${esc(e.message)}</p>`),
  ),
);
addEventListener("client-tab", ({ detail: { tab, client, element } }) => {
  if (tab === "invoices")
    invoiceList(element, "client", client.id).catch(
      (e) =>
        (element.innerHTML = `<p class="form-error">${esc(e.message)}</p>`),
    );
});
