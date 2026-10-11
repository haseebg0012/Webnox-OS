let promise;
export function getSupabase() {
  return (promise ??= initialize().catch((error) => {
    promise = null;
    throw error;
  }));
}
async function initialize() {
  const response = await fetch("/api/config", { cache: "no-store" });
  if (!response.ok)
    throw new Error("Service is being configured. Please try again shortly.");
  const config = await response.json();
  const { createClient } = await import(
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm"
  );
  return createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: "webnox-auth",
    },
  });
}
