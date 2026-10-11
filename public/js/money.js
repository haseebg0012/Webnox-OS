import { state, money } from "./state.js";
import { api } from "./data.js";
import { field, esc } from "./ui.js";
import { CURRENCIES } from "./lead-options.js";
export function moneyFields(record = {}) {
  return `${field("currency", "Currency", record.currency || state.settings.app_currency, { options: CURRENCIES, required: true })}${field("amount_original", "Amount", record.amount_original ?? 0, { type: "number", min: 0, step: ".01", required: true })}${field("fx_rate", `Rate to ${state.settings.app_currency}`, record.fx_rate ?? 1, { type: "number", min: ".000001", step: ".000001", required: true })}<div class="field"><span>Reporting amount</span><strong data-money-total></strong><small data-rate-status></small><small><a href="https://www.exchangerate-api.com" target="_blank" rel="noopener noreferrer">Rates by ExchangeRate-API</a> · daily reference rates</small></div>`;
}
export function bindMoney(form) {
  const currency = form.elements.currency,
    rate = form.elements.fx_rate,
    amount = form.elements.amount_original;
  let request = 0;
  const draw = () => {
    const el = form.querySelector("[data-money-total]");
    if (el)
      el.textContent = money(
        Number(amount?.value || 0) * Number(rate.value || 0),
        state.settings.app_currency,
      );
  };
  const load = async () => {
    const version = ++request;
    const status = form.querySelector("[data-rate-status]");
    if (currency.value === state.settings.app_currency) {
      rate.value = 1;
      status.textContent = "Same currency";
      draw();
      return;
    }
    status.textContent = "Fetching reference rate…";
    try {
      const result = await api(
        `/api/fx?from=${encodeURIComponent(currency.value)}&to=${encodeURIComponent(state.settings.app_currency)}`,
      );
      if (version !== request) return;
      rate.value = Number(result.rate).toFixed(6);
      status.textContent = `Updated ${new Date(result.updated_at).toLocaleDateString()}. You can edit this rate.`;
      draw();
    } catch (e) {
      if (version === request) {
        rate.value = "";
        status.textContent = e.message;
        draw();
      }
    }
  };
  currency.addEventListener("change", load);
  rate.addEventListener("input", () => {
    request++;
    draw();
  });
  amount?.addEventListener("input", draw);
  draw();
  return load;
}
