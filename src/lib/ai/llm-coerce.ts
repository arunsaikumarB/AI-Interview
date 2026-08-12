/**
 * Normalize messy local-LLM JSON into shapes Zod can accept.
 * Models often return string blobs, objects, or short arrays instead of
 * clean string[].
 */

export function coerceScore(value: unknown, fallback = 50): number {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string") {
    n = Number(value.replace(/%/g, "").trim());
  } else {
    n = fallback;
  }
  if (!Number.isFinite(n)) n = fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function coerceDifficulty(value: unknown, fallback = 3): number {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string") {
    n = Number(value.trim());
  } else {
    n = fallback;
  }
  if (!Number.isFinite(n)) n = fallback;
  return Math.max(1, Math.min(5, Math.round(n)));
}

function stringFromUnknown(item: unknown): string {
  if (typeof item === "string") return item.trim();
  if (typeof item === "number" || typeof item === "boolean") {
    return String(item);
  }
  if (item && typeof item === "object") {
    const o = item as Record<string, unknown>;
    for (const key of [
      "text",
      "point",
      "reason",
      "description",
      "item",
      "value",
      "match",
      "summary",
      "name",
      "why",
      "question",
      "claim",
      "evidence",
    ]) {
      if (typeof o[key] === "string" && (o[key] as string).trim()) {
        return (o[key] as string).trim();
      }
    }
    const first = Object.values(o).find(
      (v) => typeof v === "string" && v.trim(),
    );
    if (typeof first === "string") return first.trim();
  }
  return "";
}

export function coerceStringArray(
  value: unknown,
  opts?: { min?: number; max?: number; padWith?: string },
): string[] {
  const min = opts?.min ?? 0;
  const max = opts?.max ?? 50;
  const padWith = opts?.padWith;

  let items: string[] = [];

  if (value == null) {
    items = [];
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      items = [];
    } else if (trimmed.startsWith("[")) {
      try {
        return coerceStringArray(JSON.parse(trimmed), opts);
      } catch {
        /* split below */
      }
    }
    items = trimmed
      .split(/\n+|;\s+|•\s*|(?:^|\n)\s*[-*]\s+/m)
      .map((s) => s.replace(/^\d+[.)]\s*/, "").trim())
      .filter(Boolean);
    if (items.length <= 1) items = [trimmed];
  } else if (Array.isArray(value)) {
    items = value.map(stringFromUnknown).filter(Boolean);
  } else if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    for (const key of [
      "items",
      "points",
      "reasons",
      "matches",
      "whyMatch",
      "values",
      "list",
    ]) {
      if (key in o) return coerceStringArray(o[key], opts);
    }
    items = Object.values(o).map(stringFromUnknown).filter(Boolean);
  }

  items = items.map((s) => s.trim()).filter((s) => s.length > 0);
  if (max > 0) items = items.slice(0, max);
  while (padWith && items.length < min) {
    items.push(padWith);
  }
  return items;
}

export function coerceEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  if (typeof value !== "string") return fallback;
  const raw = value.trim();
  const normalized = raw.toUpperCase().replace(/[\s-]+/g, "_");
  const hit = allowed.find((a) => a === normalized || a === raw);
  return hit ?? fallback;
}

export function ensureMinText(
  value: unknown,
  minChars: number,
  fallback: string,
): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length >= minChars) return text;
  if (!text) return fallback;
  const pad = ` ${fallback}`;
  return (text + pad).slice(0, Math.max(minChars, text.length + pad.length));
}
