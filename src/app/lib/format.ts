/** Date and count formatting shared by every panel. */

const DATE_FMT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "2-digit",
  year: "numeric",
};

const SHORT_FMT: Intl.DateTimeFormatOptions = { month: "short", day: "2-digit" };

function parse(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `Mar 02, 2026` — or an em dash when there is no date to show. */
export function formatDate(value?: string | null): string {
  const date = parse(value);
  return date ? date.toLocaleDateString("en-US", DATE_FMT) : "—";
}

/** `Mar 02` — for dense recurrence timelines. */
export function formatShortDate(value?: string | null): string {
  const date = parse(value);
  return date ? date.toLocaleDateString("en-US", SHORT_FMT) : "—";
}

/** `Mar 02, 2026 · 14:08` */
export function formatDateTime(value?: string | null): string {
  const date = parse(value);
  if (!date) return "—";
  return `${date.toLocaleDateString("en-US", DATE_FMT)} · ${date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

/** Coarse age of a timestamp: "just now", "3h ago", "12d ago". */
export function timeAgo(value?: string | null): string {
  const date = parse(value);
  if (!date) return "—";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

/** Whole days between two instants; `null` when either is unparseable. */
export function daysBetween(from?: string | null, to?: string | null): number | null {
  const a = parse(from);
  const b = parse(to);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * `1 finding` / `3 findings` / `334 memories`.
 *
 * The plural is derived rather than passed at every call site, because a
 * forgotten `plural` argument is exactly how a dashboard ends up reading
 * "334 memorys".
 */
function defaultPlural(singular: string): string {
  if (/[^aeiou]y$/i.test(singular)) return `${singular.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(singular)) return `${singular}es`;
  return `${singular}s`;
}

export function countLabel(
  n: number,
  singular: string,
  plural: string = defaultPlural(singular),
): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** Truncate for a card body without cutting mid-word. */
export function truncate(text: string, max = 180): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
