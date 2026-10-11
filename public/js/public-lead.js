import { field, esc, formValues, busy, empty } from "./ui.js";
import { CURRENCIES, SERVICES } from "./lead-options.js";
const el = document.querySelector("#lead-form-page"),
  token = new URLSearchParams(location.search).get("token") || "";
try {
  const response = await fetch(
    "/api/public/form?token=" + encodeURIComponent(token),
  );
  const brand = await response.json();
  if (!response.ok) throw new Error(brand.error);
  document.title = "Contact " + brand.name;
  el.innerHTML = `<div class="page-heading"><div><p class="eyebrow">${esc(brand.name)}</p><h1>Tell us about your business</h1><p>Share a few details and our team will get in touch.</p></div></div><form class="card stack"><div class="form-grid">${field("name", "Your name", "", { required: true })}${field("company", "Company", "", { required: true })}${field("email", "Email", "", { type: "email", required: true })}${field("phone", "Phone")}${field("website", "Website")}${field("country", "Country")}${field("niche", "Industry / niche")}${field("service", "Interested in", "", { options: [["", "Choose a service"], ...SERVICES] })}${field("currency", "Currency", "PKR", { options: CURRENCIES })}${field("budget", "Estimated budget", "", { type: "number", min: 0, step: ".01" })}${field("notes", "Anything else we should know?", "", { type: "textarea", full: true })}</div><div class="honeypot" aria-hidden="true"><label>Fax<input name="fax" tabindex="-1" autocomplete="off"></label></div><p class="form-error" role="alert"></p><button class="btn primary" type="submit">Send enquiry</button><p class="small muted">Your details will be shared with ${esc(brand.name)} to respond to your enquiry.</p></form>`;
  const form = el.querySelector("form");
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form.querySelector("[type=submit]"), async () => {
      try {
        const response = await fetch("/api/public/lead", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...formValues(form), token }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        el.innerHTML = empty(
          "Thank you for reaching out",
          "Your enquiry has been received by " + brand.name + ".",
          "",
          "check",
        );
      } catch (error) {
        form.querySelector(".form-error").textContent = error.message;
      }
    });
  };
} catch (error) {
  el.innerHTML = empty(
    "This form is unavailable",
    error.message || "Please contact the business directly.",
  );
}
