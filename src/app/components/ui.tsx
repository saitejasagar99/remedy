/** Small presentational primitives shared across panels. */
import { useState, type ReactNode } from "react";

export function Card({
  title,
  subtitle,
  actions,
  children,
  tone = "default",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  tone?: "default" | "warn" | "danger" | "ok";
}) {
  const border =
    tone === "danger"
      ? "border-red-300 dark:border-red-900"
      : tone === "warn"
        ? "border-amber-300 dark:border-amber-800"
        : tone === "ok"
          ? "border-emerald-300 dark:border-emerald-900"
          : "border-zinc-200 dark:border-zinc-800";

  return (
    <section
      className={`rounded-lg border ${border} bg-white shadow-sm dark:bg-zinc-950`}
    >
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-zinc-100 px-4 py-3 dark:border-zinc-900">
          <div>
            {title && (
              <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
            )}
            {subtitle && (
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</p>
            )}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </header>
      )}
      <div className="px-4 py-3 text-sm">{children}</div>
    </section>
  );
}

const TONES = {
  neutral: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  danger: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  info: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
} as const;

/**
 * Status chip.
 *
 * Defaults to the interface typeface: most badges are words ("Awaiting
 * approval", "answer changed"), and setting every one of them in a fixed-width
 * face is what makes a product read like a terminal. Pass `mono` for values
 * that genuinely are identifiers — control ids, case numbers, versions.
 */
export function Badge({
  children,
  tone = "neutral",
  mono = false,
}: {
  children: ReactNode;
  tone?: keyof typeof TONES;
  mono?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${
        mono ? "font-mono" : ""
      } ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** Label/value line used inside detail lists. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2 py-1">
      <dt className="w-36 shrink-0 text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="min-w-0 flex-1 text-xs">{children}</dd>
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  busy,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  busy?: boolean;
  type?: "button" | "submit";
}) {
  const styles = {
    primary:
      "bg-zinc-900 text-white hover:bg-zinc-700 disabled:bg-zinc-400 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white",
    secondary:
      "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800",
    danger:
      "border border-red-300 bg-white text-red-700 hover:bg-red-50 dark:border-red-900 dark:bg-zinc-950 dark:text-red-400 dark:hover:bg-red-950/40",
    ghost: "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900",
  }[variant];

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${styles}`}
    >
      {busy ? "Working…" : children}
    </button>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      {message}
    </p>
  );
}

/* ------------------------------------------------------------------ page -- */

/** Page masthead: what this screen is for, in one line. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 border-b border-zinc-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            {eyebrow}
          </p>
        )}
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">{title}</h1>
        {description && (
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-zinc-600">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Metric tile. `value` is always real data — see the dashboard route. */
export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "neutral" | "ok" | "warn" | "danger" | "info";
}) {
  const accent = {
    neutral: "border-zinc-200 border-t-zinc-300",
    ok: "border-zinc-200 border-t-emerald-500",
    warn: "border-zinc-200 border-t-amber-500",
    danger: "border-zinc-200 border-t-red-500",
    info: "border-zinc-200 border-t-sky-500",
  }[tone];

  const valueTone = {
    neutral: "text-zinc-900",
    ok: "text-emerald-700",
    warn: "text-amber-700",
    danger: "text-red-700",
    info: "text-sky-700",
  }[tone];

  return (
    <div className={`rounded-lg border border-t-2 bg-white px-4 py-3 shadow-sm ${accent}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`tabular mt-1 text-2xl font-semibold tracking-tight ${valueTone}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">{hint}</p>}
    </div>
  );
}

/** Nothing to show — and, crucially, *why* there is nothing to show. */
export function EmptyState({
  title,
  body,
  action,
  tone = "neutral",
}: {
  title: string;
  body: string;
  action?: ReactNode;
  tone?: "neutral" | "warn" | "danger";
}) {
  const border =
    tone === "danger"
      ? "border-red-200 bg-red-50/50"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50/50"
        : "border-dashed border-zinc-300 bg-white";

  return (
    <div className={`rounded-lg border px-5 py-7 text-center ${border}`}>
      <p className="text-sm font-semibold text-zinc-800">{title}</p>
      <p className="mx-auto mt-1 max-w-xl text-xs leading-relaxed text-zinc-600">{body}</p>
      {action && <div className="mt-3 flex justify-center gap-2">{action}</div>}
    </div>
  );
}

/** Inline banner with a title — used for conflicts, degradations and gates. */
export function Callout({
  tone = "neutral",
  title,
  children,
  actions,
}: {
  tone?: "neutral" | "ok" | "warn" | "danger" | "info";
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const styles = {
    neutral: "border-zinc-200 bg-zinc-50 text-zinc-700",
    ok: "border-emerald-200 bg-emerald-50 text-emerald-900",
    warn: "border-amber-300 bg-amber-50 text-amber-900",
    danger: "border-red-300 bg-red-50 text-red-900",
    info: "border-sky-200 bg-sky-50 text-sky-900",
  }[tone];

  return (
    <div className={`rounded-lg border px-4 py-3 ${styles}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide">{title}</p>
        {actions}
      </div>
      {children && <div className="mt-1.5 text-xs leading-relaxed">{children}</div>}
    </div>
  );
}

/** Expandable panel — the "Why this recommendation?" disclosure. */
export function Disclosure({
  label,
  summary,
  children,
  defaultOpen = false,
  tone = "neutral",
}: {
  label: string;
  summary?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  tone?: "neutral" | "warn";
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className={`rounded-lg border ${
        tone === "warn" ? "border-amber-300 bg-amber-50/40" : "border-zinc-200 bg-white"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-4 px-4 py-3 text-left"
      >
        <span className="min-w-0">
          <span className="block text-xs font-semibold uppercase tracking-wide text-zinc-800">
            {label}
          </span>
          {summary && (
            <span className="mt-0.5 block text-xs leading-relaxed text-zinc-600">{summary}</span>
          )}
        </span>
        <span
          className={`mt-0.5 shrink-0 rounded border border-zinc-300 px-1.5 text-[11px] text-zinc-600 transition-transform ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
        >
          ▾
        </span>
      </button>
      {open && <div className="border-t border-zinc-200 px-4 py-3 text-xs">{children}</div>}
    </div>
  );
}

/**
 * A numbered workflow section: Finding detail walks a judge through ten of
 * these in order, so the numbering is part of the navigation rather than
 * decoration.
 */
export function Section({
  step,
  title,
  description,
  actions,
  children,
  emphasis = false,
  tone = "neutral",
}: {
  step?: number;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  /** Rendered with a heavier border — used for the memory and recommendation sections. */
  emphasis?: boolean;
  /** Amber framing for the sections that gate a decision. */
  tone?: "neutral" | "warn";
}) {
  const border =
    tone === "warn"
      ? "border-amber-300 ring-1 ring-amber-100"
      : emphasis
        ? "border-zinc-300 ring-1 ring-zinc-200"
        : "border-zinc-200";

  return (
    <section
      id={step ? `step-${step}` : undefined}
      className={`rounded-lg border bg-white shadow-sm ${border}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          {step !== undefined && (
            <span
              className={`tabular mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                emphasis ? "bg-zinc-900 text-white" : "bg-zinc-200 text-zinc-700"
              }`}
            >
              {step}
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight text-zinc-900">{title}</h2>
            {description && (
              <p className="mt-0.5 text-xs text-zinc-500">{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className="px-4 py-3 text-sm">{children}</div>
    </section>
  );
}

/** Small status dot with a label — reads instantly at a glance. */
export function StatusDot({
  tone,
  label,
}: {
  tone: "ok" | "warn" | "danger" | "info" | "neutral";
  label: string;
}) {
  const color = {
    ok: "bg-emerald-500",
    warn: "bg-amber-500",
    danger: "bg-red-500",
    info: "bg-sky-500",
    neutral: "bg-zinc-400",
  }[tone];

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-700">
      <span className={`h-2 w-2 rounded-full ${color}`} aria-hidden />
      {label}
    </span>
  );
}

/**
 * Relative match strength against the strongest result of one recall query.
 *
 * Deliberately *not* a similarity percentage: Hindsight scores are an
 * ordering signal within a single query. The bar shows where a fact sits
 * relative to the best result, and the caption says so.
 */
export function RelativeMatchBar({ score, topScore }: { score: number | null; topScore: number | null }) {
  if (score === null || topScore === null || topScore <= 0) {
    return <span className="text-[11px] text-zinc-400">not recalled for this finding</span>;
  }
  const ratio = Math.max(0, Math.min(1, score / topScore));
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-zinc-200">
        <span
          className="block h-full rounded-full bg-sky-500"
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </span>
      <span className="tabular text-[11px] text-zinc-500">
        {Math.round(ratio * 100)}% of top match
      </span>
    </span>
  );
}
