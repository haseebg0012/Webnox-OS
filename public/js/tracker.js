import { rpc } from "./data.js";
import { state } from "./state.js";
import { refreshContext } from "./app.js";
import { getSupabase } from "./supabase.js";

// Only the timestamp of activity is kept. No keys, text, pointer paths or images.
let lastActivity = Date.now(),
  sessionId,
  interval,
  stopped = false,
  inFlight = false;
const channel =
  typeof BroadcastChannel === "function"
    ? new BroadcastChannel("webnox-presence")
    : null;
channel?.addEventListener("message", ({ data }) => {
  if (data?.user === state.user?.id && data?.type === "activity")
    lastActivity = Math.max(
      lastActivity,
      Math.min(Date.now(), Number(data.at) || 0),
    );
});
function activity() {
  const now = Date.now();
  if (now - lastActivity < 1000) return;
  lastActivity = now;
  channel?.postMessage({ type: "activity", user: state.user?.id, at: now });
}
async function heartbeat() {
  if (stopped || inFlight) return;
  inFlight = true;
  try {
    await refreshContext();
    if (
      state.profile.status !== "active" ||
      !["active", "trial"].includes(state.workspace?.status)
    ) {
      await stopTracking();
      if (state.isAdmin && state.workspace?.status === "suspended") {
        location.hash = "#/billing";
        return;
      }
      sessionStorage.setItem(
        "webnox-signout-reason",
        state.workspace?.status === "suspended"
          ? "This workspace is suspended. Please ask your admin."
          : "Your account or workspace is unavailable. Please contact your admin.",
      );
      const sb = await getSupabase();
      await sb.auth.signOut();
      location.replace("/login.html");
      return;
    }
    if (!sessionId) sessionId = await rpc("session_start");
    const result = await rpc("session_heartbeat", {
      target: sessionId,
      active:
        Date.now() - lastActivity < (state.settings?.idle_minutes || 5) * 60000,
    });
    if (result?.expired) {
      sessionId = await rpc("session_start");
      await rpc("session_heartbeat", {
        target: sessionId,
        active:
          Date.now() - lastActivity <
          (state.settings?.idle_minutes || 5) * 60000,
      });
    }
    document.documentElement.dataset.connection = "online";
    window.dispatchEvent(new CustomEvent("tracking-heartbeat"));
  } catch {
    document.documentElement.dataset.connection = "offline";
  } finally {
    inFlight = false;
  }
}
export async function startTracking() {
  if (state.isMaster || state.workspace?.status === "suspended") return;
  ["pointerdown", "pointermove", "keydown", "scroll", "touchstart"].forEach(
    (name) => addEventListener(name, activity, { passive: true }),
  );
  addEventListener("online", heartbeat);
  const lead = async () => {
    if (stopped) return;
    await heartbeat();
    interval = setInterval(heartbeat, 60000);
    await new Promise((resolve) => {
      addEventListener("pagehide", resolve, { once: true });
      addEventListener("tracking-stop", resolve, { once: true });
    });
    clearInterval(interval);
  };
  // A single tab owns heartbeats; activity from all tabs feeds the same session.
  if (navigator.locks)
    navigator.locks
      .request(`webnox-presence-${state.user.id}`, lead)
      .catch(() => {});
  else lead();
}
export async function stopTracking() {
  stopped = true;
  clearInterval(interval);
  dispatchEvent(new Event("tracking-stop"));
  try {
    await rpc("session_end");
  } catch {
    /* Expired sessions close at their last heartbeat on the next sweep. */
  }
}
