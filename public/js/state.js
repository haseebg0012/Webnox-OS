export const state = {
  user: null,
  profile: null,
  workspace: null,
  settings: null,
  roles: [],
  perms: [],
  billing: null,
  isMaster: false,
  isOwner: false,
  isAdmin: false,
};
export function can(module, action = "view") {
  if (state.isMaster) return false;
  if (state.isAdmin) return true;
  if (
    state.roles.includes("manager") &&
    !["settings", "permissions", "billing"].includes(module)
  )
    return true;
  return state.perms.some(
    (p) =>
      state.roles.includes(p.role_key) &&
      p.module === module &&
      p[action] === true,
  );
}
export const money = (value, currency) =>
  new Intl.NumberFormat("en", {
    style: "currency",
    currency: currency || state.settings?.app_currency || "PKR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
