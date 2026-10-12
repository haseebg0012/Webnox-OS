import { api } from "./data.js";
import { dialog, field, busy } from "./ui.js";
export function secureMasterAction(action, target, payload = {}) {
  return new Promise((resolve) => {
    let result = false;
    const d = dialog(
      "Confirm Master action",
      `<form class="stack"><p>Enter your current Master password to authorize this action.</p>${field("master_password", "Master password", "", { type: "password", required: true })}<p class="form-error" role="alert"></p><div class="form-actions"><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn primary">Confirm action</button></div></form>`,
    );
    d.querySelector("input").autocomplete = "current-password";
    d.querySelector("[data-cancel]").onclick = () => d.close();
    d.addEventListener("close", () => resolve(result), { once: true });
    d.querySelector("form").onsubmit = (e) => {
      e.preventDefault();
      busy(d.querySelector("[type=submit]"), async () => {
        const input = d.querySelector("input"),
          password = input.value;
        input.value = "";
        try {
          await api("/api/master/action", {
            method: "POST",
            body: { action, target, payload, password },
          });
          result = true;
          d.close();
        } catch (error) {
          d.querySelector(".form-error").textContent = error.message;
          input.focus();
        }
      });
    };
  });
}
export const pictureField = (title = "Logo / profile picture") =>
  `<label class="field span-all"><span>${title}</span><input type="file" data-upload-picture accept="image/png,image/jpeg,image/webp"><small>PNG, JPG or WebP up to 5 MB. Prepared as a small square image.</small><img data-picture-preview hidden alt="Selected image preview" style="width:80px;height:80px;object-fit:contain;border-radius:12px"></label>`;
export async function readPicture(form) {
  const file = form.querySelector("[data-upload-picture]")?.files[0];
  if (!file) return null;
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 5 * 1024 * 1024
  )
    throw new Error("Choose a PNG, JPG or WebP smaller than 5 MB.");
  const url = URL.createObjectURL(file),
    image = new Image();
  try {
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const c = canvas.getContext("2d"),
      scale = Math.min(256 / image.width, 256 / image.height);
    c.drawImage(
      image,
      (256 - image.width * scale) / 2,
      (256 - image.height * scale) / 2,
      image.width * scale,
      image.height * scale,
    );
    return canvas.toDataURL("image/webp", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function previewPicture(form) {
  const input = form.querySelector("[data-upload-picture]");
  if (!input) return;
  input.onchange = async () => {
    const preview = form.querySelector("[data-picture-preview]");
    try {
      const value = await readPicture(form);
      preview.hidden = !value;
      if (value) preview.src = value;
    } catch (error) {
      input.value = "";
      preview.hidden = true;
      form.querySelector(".form-error").textContent = error.message;
    }
  };
}
