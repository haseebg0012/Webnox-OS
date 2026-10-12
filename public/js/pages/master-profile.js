import { registerRoute, refreshContext } from "../app.js";
import { state } from "../state.js";
import { rpc } from "../data.js";
import { getSupabase } from "../supabase.js";
import {
  avatar,
  esc,
  field,
  formValues,
  dialog,
  busy,
  toast,
  icon,
} from "../ui.js";
import { datetime, today } from "../time.js";

export async function refreshMasterIdentity() {
  if (!state.isMaster) return;
  const sb = await getSupabase();
  let image = "";
  if (state.profile.avatar_path) {
    const result = await sb.storage
      .from("avatars")
      .createSignedUrl(state.profile.avatar_path, 3600);
    if (!result.error) image = result.data.signedUrl;
  }
  document.querySelectorAll("[data-master-avatar]").forEach((el) => {
    el.innerHTML = image
      ? `<img src="${esc(image)}" alt="Profile picture">`
      : avatar(state.profile.name);
  });
  document
    .querySelectorAll("[data-master-name]")
    .forEach((el) => (el.textContent = state.profile.name));
  return image;
}

async function cropPicture(file, save) {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 5 * 1024 * 1024
  )
    throw new Error("Choose a JPG, PNG or WebP image smaller than 5 MB.");
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("This image could not be opened.");
  }
  const d = dialog(
    "Crop & adjust profile picture",
    `<p class="muted small">Drag the image to reposition, or use the sliders. The saved picture uses this crop.</p><canvas class="avatar-crop" width="512" height="512" tabindex="0" aria-label="Profile crop preview. Use arrow keys to pan."></canvas><div class="stack crop-controls">${field("zoom", "Zoom", 1, { type: "range", min: 1, max: 4, step: 0.01 })}<div class="form-grid">${field("pan_x", "Horizontal position", 0, { type: "range", min: -100, max: 100, step: 1 })}${field("pan_y", "Vertical position", 0, { type: "range", min: -100, max: 100, step: 1 })}</div></div><p class="form-error" role="alert"></p><div class="form-actions"><button class="btn" data-reset>Reset</button><button class="btn" data-cancel>Cancel</button><button class="btn primary" data-save>Save cropped picture</button></div>`,
  );
  const canvas = d.querySelector("canvas"),
    ctx = canvas.getContext("2d");
  const zoom = d.querySelector("[name=zoom]"),
    x = d.querySelector("[name=pan_x]"),
    y = d.querySelector("[name=pan_y]");
  const base = Math.max(512 / image.width, 512 / image.height);
  const draw = () => {
    const scale = base * Number(zoom.value),
      w = image.width * scale,
      h = image.height * scale;
    ctx.clearRect(0, 0, 512, 512);
    ctx.drawImage(
      image,
      (512 - w) / 2 + ((Number(x.value) / 100) * (w - 512)) / 2,
      (512 - h) / 2 + ((Number(y.value) / 100) * (h - 512)) / 2,
      w,
      h,
    );
  };
  [zoom, x, y].forEach((input) => (input.oninput = draw));
  let drag;
  canvas.onpointerdown = (e) => {
    drag = {
      x: e.clientX,
      y: e.clientY,
      px: Number(x.value),
      py: Number(y.value),
    };
    canvas.setPointerCapture(e.pointerId);
  };
  canvas.onpointermove = (e) => {
    if (!drag) return;
    const scale = base * Number(zoom.value),
      ratio = 512 / canvas.getBoundingClientRect().width;
    x.value = Math.max(
      -100,
      Math.min(
        100,
        drag.px +
          ((e.clientX - drag.x) * ratio * 200) /
            Math.max(1, image.width * scale - 512),
      ),
    );
    y.value = Math.max(
      -100,
      Math.min(
        100,
        drag.py +
          ((e.clientY - drag.y) * ratio * 200) /
            Math.max(1, image.height * scale - 512),
      ),
    );
    draw();
  };
  canvas.onpointerup = canvas.onpointercancel = () => (drag = null);
  canvas.onkeydown = (e) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key))
      return;
    e.preventDefault();
    const input = e.key.includes("Left") || e.key.includes("Right") ? x : y;
    input.value =
      Number(input.value) + (["ArrowLeft", "ArrowUp"].includes(e.key) ? -5 : 5);
    draw();
  };
  d.querySelector("[data-reset]").onclick = () => {
    zoom.value = 1;
    x.value = y.value = 0;
    draw();
  };
  d.querySelector("[data-cancel]").onclick = () => d.close();
  d.querySelector("[data-save]").onclick = (e) =>
    busy(e.currentTarget, async () => {
      try {
        const blob = await new Promise((resolve) =>
          canvas.toBlob(resolve, "image/webp", 0.88),
        );
        if (!blob)
          throw new Error("Unable to prepare the image. Try another picture.");
        await save(blob);
        d.close();
        toast("Profile picture saved");
      } catch (error) {
        d.querySelector(".form-error").textContent = error.message;
      }
    });
  d.addEventListener("close", () => URL.revokeObjectURL(url), { once: true });
  draw();
}

registerRoute("master-profile", "Master Profile", async (el) => {
  if (!state.isMaster) throw new Error("Access is not permitted.");
  const sb = await getSupabase();
  const auth = await sb.auth.getUser();
  if (auth.error) throw auth.error;
  const user = auth.data.user,
    p = state.profile;
  const role = p.platform_role || "owner";
  el.innerHTML = `<div class="master-profile"><section class="card profile-banner row between wrap"><div class="row"><span class="profile-portrait" data-master-avatar>${avatar(p.name, true)}</span><div><div class="row wrap"><h1 data-master-name>${esc(p.name)}</h1><span class="chip">Platform ${esc(role)}</span></div><p class="small muted">${esc(user.email)}</p><div class="small" data-verified-banner></div><div class="small muted">Last sign in: ${datetime(user.last_sign_in_at)}</div></div></div><button class="btn" data-upload>${icon("download")} Upload picture</button><input hidden type="file" accept="image/jpeg,image/png,image/webp" data-picture></section><div class="profile-columns"><div class="stack"><section class="card"><h2>Master Profile Information</h2><p class="muted small">Manage your identity and contact details.</p><form data-profile class="stack"><div class="form-grid">${field("first_name", "First name", p.first_name ?? p.name.split(" ")[0], { required: true })}${field("last_name", "Last name", p.last_name ?? p.name.split(" ").slice(1).join(" "))}${field("name", "Display name", p.name, { required: true })}<label class="field"><span>Master email (immutable)</span><input type="email" readonly disabled value="${esc(user.email)}"></label>${field("phone", "Phone number", p.phone || "", { type: "tel" })}${field("date_of_birth", "Date of birth", p.date_of_birth || "", { type: "date", max: today(), min: "1900-01-01" })}</div><p class="form-error" role="alert"></p><div class="form-actions"><button class="btn primary">Save profile changes</button></div></form></section><section class="card"><h2>${icon("lock")} Master Password & Security</h2><p class="muted small">Confirm your current password to update your Supabase Auth credentials.</p><form data-password class="stack">${field("current_password", "Current password", "", { type: "password", required: true })}${field("password", "New password", "", { type: "password", required: true, help: "Use at least 8 characters." })}${field("confirmation", "Confirm new password", "", { type: "password", required: true })}<p class="form-error" role="alert"></p><p class="success small" role="status"></p><div class="form-actions"><button class="btn primary">Update Master password</button></div></form></section></div><aside class="stack"><section class="card"><h2>Email Verification Status</h2><div data-verification></div><p class="small" role="status" data-verification-notice></p><button class="btn" data-resend>Resend verification email</button><button class="text-button" data-refresh-verification>Refresh status</button></section><section class="card"><h2>Platform Session Info</h2><dl class="kv"><dt>Access level</dt><dd>Platform ${esc(role)}</dd><dt>Authentication</dt><dd>Supabase Auth · signed JWT</dd><dt>Transport</dt><dd>${location.protocol === "https:" ? "HTTPS / TLS" : "Local development HTTP"}</dd><dt>Tenant isolation</dt><dd>Database RLS policies</dd></dl><p class="small muted">Business access remains limited by your platform permissions. Salaries remain private.</p></section></aside></div></div>`;
  await refreshMasterIdentity();
  const profile = el.querySelector("[data-profile]");
  profile.onsubmit = (e) => {
    e.preventDefault();
    busy(profile.querySelector("button"), async () => {
      try {
        await rpc("master_profile_save", { payload: formValues(profile) });
        await refreshContext();
        await refreshMasterIdentity();
        toast("Profile changes saved");
      } catch (error) {
        profile.querySelector(".form-error").textContent = error.message;
      }
    });
  };
  const file = el.querySelector("[data-picture]");
  el.querySelector("[data-upload]").onclick = () => file.click();
  file.onchange = async () => {
    try {
      if (file.files[0])
        await cropPicture(file.files[0], async (blob) => {
          const path = `${p.id}/${crypto.randomUUID()}.webp`;
          const result = await sb.storage
            .from("avatars")
            .upload(path, blob, { contentType: "image/webp", upsert: false });
          if (result.error) throw result.error;
          const old = state.profile.avatar_path;
          try {
            await rpc("master_profile_save", {
              payload: { ...formValues(profile), avatar_path: path },
            });
          } catch (error) {
            await sb.storage.from("avatars").remove([path]);
            throw error;
          }
          await refreshContext();
          await refreshMasterIdentity();
          if (old) await sb.storage.from("avatars").remove([old]);
        });
    } catch (error) {
      toast(error.message, "error");
    } finally {
      file.value = "";
    }
  };
  const password = el.querySelector("[data-password]");
  password.current_password.autocomplete = "current-password";
  password.password.autocomplete = password.confirmation.autocomplete =
    "new-password";
  password.onsubmit = (e) => {
    e.preventDefault();
    busy(password.querySelector("button"), async () => {
      const notice = password.querySelector(".form-error");
      notice.textContent = "";
      password.querySelector(".success").textContent = "";
      try {
        if (password.password.value.length < 8)
          throw new Error("Use at least 8 characters.");
        if (password.password.value !== password.confirmation.value)
          throw new Error("The two passwords do not match.");
        const reauth = await sb.auth.signInWithPassword({
          email: user.email,
          password: password.current_password.value,
        });
        if (reauth.error)
          throw new Error(
            "Current password could not be verified. Check it and retry.",
          );
        const result = await sb.auth.updateUser({
          password: password.password.value,
        });
        if (result.error) throw result.error;
        password.reset();
        password.querySelector(".success").textContent =
          "Password updated successfully.";
      } catch (error) {
        notice.textContent =
          error.message ||
          "Connection unavailable. Your password was not changed; please retry.";
      }
    });
  };
  const drawVerification = (u) => {
    const verified = Boolean(u.email_confirmed_at);
    el.querySelector("[data-verified-banner]").textContent = verified
      ? "✓ Verified platform account"
      : "Email verification pending";
    el.querySelector("[data-verification]").innerHTML =
      `<div class="verification-status ${verified ? "verified" : "pending"}"><strong>${verified ? "Email verified" : "Email not verified"}</strong><p class="small">${verified ? "This email is marked verified by Supabase Auth." : "Check your inbox for a confirmation link."}</p></div>`;
    el.querySelector("[data-resend]").disabled = verified;
  };
  drawVerification(user);
  const update = async () => {
    const r = await sb.auth.getUser();
    if (r.error) throw r.error;
    if (el.isConnected) drawVerification(r.data.user);
  };
  el.querySelector("[data-refresh-verification]").onclick = () =>
    update().catch((e) => toast(e.message, "error"));
  el.querySelector("[data-resend]").onclick = (e) =>
    busy(e.currentTarget, async () => {
      try {
        const r = await sb.auth.resend({
          type: "signup",
          email: user.email,
          options: { emailRedirectTo: location.origin },
        });
        if (r.error) throw r.error;
        el.querySelector("[data-verification-notice]").textContent =
          "Verification email requested. Check your inbox.";
      } catch (error) {
        el.querySelector("[data-verification-notice]").textContent =
          error.message;
      }
    });
  const focus = () => update().catch(() => {});
  window.addEventListener("focus", focus);
  const timer = setInterval(() => {
    if (!el.querySelector("[data-verification]")) {
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    } else if (!document.hidden) focus();
  }, 30000);
  window.addEventListener(
    "hashchange",
    () => {
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    },
    { once: true },
  );
});
