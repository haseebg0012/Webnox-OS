import { getSupabase } from "./supabase.js";
import { mountArt } from "./auth-art.js";
import { avatar, esc, dialog } from "./ui.js";
const mode = document.body.dataset.auth;
const signoutReason = sessionStorage.getItem("webnox-signout-reason");
if (signoutReason && mode === "business") {
  const notice = document.createElement("p");
  notice.className = "form-error";
  notice.textContent = signoutReason;
  document.querySelector("#login-form")?.prepend(notice);
  sessionStorage.removeItem("webnox-signout-reason");
}
mountArt(document.querySelector(".auth-art"));
const params = new URLSearchParams(location.search);
let slug = params.get("w") || localStorage.getItem("webnox-workspace") || "";
async function lookup(payload) {
  try {
    const response = await fetch("/api/public/workspace-brand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.ok ? await response.json() : {};
  } catch {
    return {};
  }
}
function paintBrand(value) {
  if (!value?.name) return;
  slug = value.slug;
  localStorage.setItem("webnox-workspace", slug);
  const el = document.querySelector(".auth-brand");
  if (el)
    el.innerHTML = `${value.logo_url && /^https:\/\//.test(value.logo_url) ? `<img src="${esc(value.logo_url)}" alt="${esc(value.name)} logo">` : avatar(value.name, true)}<strong>${esc(value.name)}</strong>`;
  document.querySelector("#auth-title").textContent =
    mode === "password"
      ? `Welcome to ${value.name}`
      : `Sign in to ${value.name}`;
  document.querySelector("#clear-brand")?.removeAttribute("hidden");
}
if (mode !== "master" && slug) lookup({ slug }).then(paintBrand);
document
  .querySelector("#forgot")
  ?.addEventListener("click", () =>
    dialog(
      "Reset your password",
      "<p>Ask your admin for a new password link. They can send it to you on WhatsApp.</p>",
    ),
  );
document.querySelector("#clear-brand")?.addEventListener("click", () => {
  localStorage.removeItem("webnox-workspace");
  location.replace("/login.html");
});
let step = mode === "master" ? 2 : 1;
const login = document.querySelector("#login-form");
document.querySelector("#change-email")?.addEventListener("click", () => {
  step = 1;
  document.querySelector("#email-field").hidden = false;
  document.querySelector(".email-summary").hidden = true;
  document.querySelector("#password-field").hidden = true;
  login.password.required = false;
  login.querySelector("[type=submit]").textContent = "Continue";
  login.email.focus();
});
if (login)
  login.onsubmit = async (e) => {
    e.preventDefault();
    const button = login.querySelector("[type=submit]"),
      error = login.querySelector(".form-error");
    button.disabled = true;
    error.textContent = "";
    try {
      if (step === 1) {
        paintBrand(
          await lookup({ email: login.email.value.trim().toLowerCase() }),
        );
        step = 2;
        document.querySelector("#email-field").hidden = true;
        document.querySelector(".email-summary").hidden = false;
        document.querySelector(".email-summary span").textContent =
          login.email.value;
        document.querySelector("#password-field").hidden = false;
        login.password.required = true;
        button.textContent = "Sign in";
        login.password.focus();
        return;
      }
      button.textContent = "Signing in…";
      const sb = await getSupabase();
      const result = await sb.auth.signInWithPassword({
        email: login.email.value.trim(),
        password: login.password.value,
      });
      if (result.error) throw new Error("These details don't work here.");
      const { data: context, error: profileError } =
        await sb.rpc("boot_context");
      if (
        profileError ||
        !context?.profile ||
        Boolean(context.profile.is_master) !== (mode === "master")
      ) {
        await sb.auth.signOut();
        throw new Error("These details don't work here.");
      }
      if (context.profile.status !== "active") {
        await sb.auth.signOut();
        throw new Error("This account is inactive. Please contact your admin.");
      }
      if (
        !context.profile.is_master &&
        (!context.workspace ||
          ["archived", "setup"].includes(context.workspace.status) ||
          (context.workspace.status === "suspended" &&
            context.profile.account_type !== "admin"))
      ) {
        await sb.auth.signOut();
        throw new Error(
          "Your workspace is unavailable. Please contact your admin.",
        );
      }
      if (context.workspace?.slug)
        localStorage.setItem("webnox-workspace", context.workspace.slug);
      location.replace("/");
    } catch (err) {
      error.textContent = err.message;
      button.textContent = step === 1 ? "Continue" : "Sign in";
    } finally {
      button.disabled = false;
    }
  };
const passwordForm = document.querySelector("#password-form");
let verified = false;
if (passwordForm)
  passwordForm.onsubmit = async (e) => {
    e.preventDefault();
    const button = passwordForm.querySelector("[type=submit]"),
      error = passwordForm.querySelector(".form-error");
    button.disabled = true;
    error.textContent = "";
    try {
      const sb = await getSupabase();
      if (!verified) {
        const token_hash = params.get("token_hash"),
          type = params.get("type");
        if (!token_hash || !["invite", "recovery"].includes(type))
          throw new Error(
            "This link is incomplete. Ask your admin for a new password link.",
          );
        await sb.auth.signOut({ scope: "local" });
        const result = await sb.auth.verifyOtp({ token_hash, type });
        if (result.error)
          throw new Error(
            "This link has expired or was already used. Ask your admin for a new password link.",
          );
        verified = true;
        history.replaceState(
          null,
          "",
          `/set-password.html${slug ? "?w=" + encodeURIComponent(slug) : ""}`,
        );
        document.querySelector("#password-inputs").hidden = false;
        passwordForm.password.required = true;
        passwordForm.confirmation.required = true;
        button.textContent = "Save password";
        document.querySelector(".auth-subtitle").textContent =
          "Choose a password to keep your workspace secure.";
        passwordForm.password.focus();
        return;
      }
      const p = passwordForm.password.value;
      if (p.length < 8) throw new Error("Use at least 8 characters.");
      if (p !== passwordForm.confirmation.value)
        throw new Error("The two passwords do not match.");
      const result = await sb.auth.updateUser({ password: p });
      if (result.error) throw new Error(result.error.message);
      const context = await sb.rpc("boot_context");
      if (context.data?.profile?.is_master) {
        location.replace("/");
        return;
      }
      await sb.auth.signOut({ scope: "local" });
      document.querySelector(".auth-box").innerHTML =
        '<h1>Your password is ready</h1><p class="auth-subtitle">You can now sign in with your email and new password.</p><a class="btn primary" href="/login.html' +
        (slug ? "?w=" + encodeURIComponent(slug) : "") +
        '">Go to sign in</a>';
    } catch (err) {
      error.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  };
