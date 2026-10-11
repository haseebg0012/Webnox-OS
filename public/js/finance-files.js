import { state, can } from "./state.js";
import { q, rpc } from "./data.js";
import { getSupabase } from "./supabase.js";
import { esc, dialog, table, empty, busy, toast } from "./ui.js";
addEventListener(
  "finance-attachments",
  async ({ detail: { kind, record } }) => {
    try {
      const d = dialog(
          "Attachments · " + (record.title || "Rent payment"),
          "<div data-files></div>",
          { wide: true },
        ),
        el = d.querySelector("[data-files]");
      const draw = async () => {
        const rows = await q("finance_files", {
          filters: { kind, record_id: record.id, status: "ready" },
        });
        el.innerHTML = `<p class="small muted">Up to 10 files per record, 10 MB each. PDF, PNG, JPEG or WebP.</p>${(kind === "rent" ? state.isMaster : can("finance", "edit")) ? '<label class="btn">Add attachments<input type="file" class="sr-only" multiple accept="application/pdf,image/png,image/jpeg,image/webp" aria-label="Add attachments"></label>' : ""}<p data-status role="status"></p>${
          rows.length
            ? table(
                ["File", "Size", ""],
                rows.map((f, i) => [
                  esc(f.name),
                  `${Math.round(f.size_bytes / 1024)} KB`,
                  `<button class="btn small" data-open="${i}">Open file</button>`,
                ]),
              )
            : empty(
                "No attachments",
                "Add a receipt, invoice or supporting document.",
              )
        }`;
        el.querySelectorAll("[data-open]").forEach(
          (b) =>
            (b.onclick = () =>
              busy(b, async () => {
                try {
                  const sb = await getSupabase(),
                    f = rows[Number(b.dataset.open)];
                  const { data, error } = await sb.storage
                    .from("finance-files")
                    .createSignedUrl(f.path, 60);
                  if (error) throw error;
                  dialog(
                    "Open attachment",
                    `<p>${esc(f.name)}</p><a class="btn primary" href="${esc(data.signedUrl)}" target="_blank" rel="noopener noreferrer">Open securely</a>`,
                  );
                } catch (e) {
                  toast(e.message, "error");
                }
              })),
        );
        el.querySelector("input")?.addEventListener("change", async (e) => {
          const files = [...e.target.files],
            status = el.querySelector("[data-status]"),
            types = {
              "application/pdf": "pdf",
              "image/png": "png",
              "image/jpeg": "jpg",
              "image/webp": "webp",
            };
          e.target.disabled = true;
          try {
            if (files.length + rows.length > 10)
              throw new Error("A record can have up to 10 attachments.");
            if (
              files.some((f) => !types[f.type] || !f.size || f.size > 10485760)
            )
              throw new Error("Choose supported files up to 10 MB each.");
            const sb = await getSupabase();
            for (const [n, file] of files.entries()) {
              status.textContent = `Uploading ${n + 1} of ${files.length}…`;
              const path = `w${record.workspace_id || state.workspace?.id}/${kind}/${record.id}/${crypto.randomUUID()}.${types[file.type]}`,
                id = await rpc("finance_file_register", {
                  payload: {
                    kind,
                    record_id: record.id,
                    name: file.name,
                    path,
                    mime_type: file.type,
                    size_bytes: file.size,
                  },
                });
              try {
                const { error } = await sb.storage
                  .from("finance-files")
                  .upload(path, file, { contentType: file.type });
                if (error) throw error;
                await rpc("finance_file_finish", { target: id, success: true });
              } catch (err) {
                await rpc("finance_file_finish", {
                  target: id,
                  success: false,
                }).catch(() => {});
                throw err;
              }
            }
            await draw();
            toast("Attachments saved");
          } catch (error) {
            status.textContent = error.message;
            e.target.disabled = false;
          }
        });
      };
      await draw();
    } catch (error) {
      toast(error.message, "error");
    }
  },
);
