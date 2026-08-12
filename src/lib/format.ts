/**
 * Stable date/time formatting for UI — use this everywhere timestamps render
 * to avoid SSR/client hydration mismatches from locale/default formatters.
 */
const dateTime = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
});

const dateOnly = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
});

export function formatDateTime(value: string | Date | number): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return dateTime.format(d);
}

export function formatDate(value: string | Date | number): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return dateOnly.format(d);
}
