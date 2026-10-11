import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
async function check(directory) {
  for (const file of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${file.name}`;
    if (file.isDirectory()) await check(path);
    else if (/\.(?:js|mjs|cjs)$/.test(file.name)) {
      const result = spawnSync(process.execPath, ["--check", path], {
        encoding: "utf8",
      });
      if (result.status) {
        process.stderr.write(result.stderr);
        process.exitCode = 1;
      }
    }
  }
}
for (const path of ["public/js", "tests", "scripts"]) await check(path);
const server = spawnSync(process.execPath, ["--check", "server.js"], {
  encoding: "utf8",
});
if (server.status) {
  process.stderr.write(server.stderr);
  process.exitCode = 1;
}
if (!process.exitCode) console.log("All JavaScript syntax checks passed.");
