import { registerRoute } from "../app.js";
import { state } from "../state.js";
import { empty, esc } from "../ui.js";
registerRoute("home", "Overview", async (el) => {
  el.innerHTML = `<div class="page-heading"><div><h1>Welcome, ${esc(state.profile.name.split(" ")[0])}</h1><p>A clear view of the work ahead.</p></div></div>${empty("Your workspace is ready", "Your team’s work and updates will appear here.", "", "home")}`;
});
await import("./workspaces.js");
await import("./team.js");
