import { getSupabase } from "./supabase.js";
export async function q(
  table,
  {
    select = "*",
    filters = {},
    order = "created_at",
    ascending = false,
    limit = 500,
  } = {},
) {
  const db = await getSupabase();
  let query = db.from(table).select(select);
  for (const [k, v] of Object.entries(filters)) {
    query = Array.isArray(v)
      ? query.in(k, v)
      : v === null
        ? query.is(k, null)
        : query.eq(k, v);
  }
  if (order) query = query.order(order, { ascending });
  const { data, error } = await query.limit(limit);
  if (error) throw new Error(error.message);
  return data;
}
export async function rpc(name, args = {}) {
  const db = await getSupabase();
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
export async function api(
  path,
  { method = "GET", body, publicRequest = false } = {},
) {
  const headers = { "Content-Type": "application/json" };
  if (!publicRequest) {
    const db = await getSupabase();
    const { data } = await db.auth.getSession();
    if (!data.session) throw new Error("Please sign in again.");
    headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  const response = await fetch(path, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response
    .json()
    .catch(() => ({ error: "Unable to complete the request." }));
  if (!response.ok)
    throw new Error(result.error || "Unable to complete the request.");
  return result;
}
export const loadMembers = () => rpc("team_directory");
