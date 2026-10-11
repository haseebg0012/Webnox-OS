import { state } from "./state.js";
export const timezone = () => state.settings?.timezone || "Asia/Karachi";
export function date(value, options = {}) {
  if (!value) return "—";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(value + "T12:00:00Z")
    : new Date(value);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: timezone(),
    ...options,
  }).format(d);
}
export function datetime(value) {
  return value ? date(value, { hour: "2-digit", minute: "2-digit" }) : "—";
}
export function duration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(s / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((s % 3600) / 60)
    .toString()
    .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
