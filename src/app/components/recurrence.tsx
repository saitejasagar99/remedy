"use client";

import Link from "next/link";

import { formatDate, formatShortDate } from "@/app/lib/format";
import { LIFECYCLE_STAGES, outcomeLabel, outcomeTone, REMEDIATION_STATUS_TONE } from "@/app/lib/labels";
import { Badge, Callout } from "./ui";

/** `AC-2(3)` and `AC-2(j)` both belong to `AC-2`. */
function controlRoot(controlId?: string): string | undefined {
  const match = /^([A-Za-z]{2,4}-\d+)/.exec(controlId ?? "");
  return match ? match[1].toUpperCase() : undefined;
}

export interface RecurrenceEntry {
  key: string;
  date?: string;
  fix: string;
  outcome?: string;
  daysToRecurrence?: number;
  caseId?: string;
  source: "memory" | "local";
}

/**
 * "Recurring finding" — the pattern across this control, not just this incident.
 *
 * Every row is a real prior attempt: recalled from Hindsight (with its case id)
 * or recorded locally as an outcome. Nothing is synthesised to fill a timeline;
 * a date the memory does not carry is shown as an em dash.
 */
export function RecurrenceDetection({
  controlId,
  findingTitle,
  isRecurrence,
  cases,
  localEntries,
}: {
  controlId: string;
  findingTitle: string;
  isRecurrence: boolean;
  cases: Array<{
    caseId: string;
    controlId?: string;
    remediationAttempted?: string;
    outcome?: string;
    recurrence: boolean;
    daysToRecurrence?: number;
    mentionedAt?: string;
  }>;
  localEntries: RecurrenceEntry[];
}) {
  const root = controlRoot(controlId);
  const relevant = cases.filter((c) => {
    const family = controlRoot(c.controlId);
    // A case with no recorded control still counts when nothing has one —
    // dropping every row would hide history rather than narrow it.
    return family === undefined ? cases.some((x) => x.controlId === undefined) : family === root;
  });

  const memoryEntries: RecurrenceEntry[] = relevant.map((c) => ({
    key: `mem-${c.caseId}`,
    ...(c.mentionedAt ? { date: c.mentionedAt } : {}),
    fix: c.remediationAttempted || "No remediation recorded",
    ...(c.outcome ? { outcome: c.outcome } : {}),
    ...(c.daysToRecurrence ? { daysToRecurrence: c.daysToRecurrence } : {}),
    caseId: c.caseId,
    source: "memory" as const,
  }));

  const entries = [...localEntries, ...memoryEntries].sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date);
  });

  if (entries.length === 0) return null;

  const priorFailures = entries.filter(
    (e) => e.outcome === "FAILURE" || e.outcome === "PARTIAL" || e.daysToRecurrence,
  );
  const headline = isRecurrence || priorFailures.length > 0;

  return (
    <Callout
      tone={headline ? "warn" : "neutral"}
      title={headline ? "Recurring finding detected" : "Prior attempts on this control"}
      actions={
        <span className="flex items-center gap-2">
          <Badge tone={headline ? "danger" : "neutral"}>
            {entries.length} occurrence{entries.length === 1 ? "" : "s"}
          </Badge>
          <Link href="/memory" className="text-[11px] font-medium underline">
            Open memory
          </Link>
        </span>
      }
    >
      <p className="text-[11px] text-zinc-600">
        {headline
          ? `The same control family has been remediated before. Previous root causes, fixes and outcomes for “${findingTitle}”.`
          : `Remediation history recalled for control family ${root ?? controlId}.`}
      </p>

      <ol className="mt-3 flex flex-col gap-2">
        {entries.map((entry) => (
          <li
            key={entry.key}
            className="rounded-md border border-white/70 bg-white/80 p-2.5 shadow-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="tabular w-16 shrink-0 text-[11px] font-semibold text-zinc-700">
                {entry.date ? formatShortDate(entry.date) : "—"}
              </span>
              <Badge tone={entry.outcome ? outcomeTone(entry.outcome) : "neutral"}>
                {entry.outcome ? outcomeLabel(entry.outcome) : "outcome not recorded"}
              </Badge>
              {entry.daysToRecurrence ? (
                <Badge tone="danger">recurred after {entry.daysToRecurrence} days</Badge>
              ) : null}
              <span className="text-[11px] text-zinc-500">
                {entry.source === "memory" ? (
                  <>
                    from memory · Case #{entry.caseId}
                  </>
                ) : (
                  "recorded on this finding"
                )}
              </span>
            </div>
            <p className="mt-1 text-xs text-zinc-800">
              <span className="text-zinc-500">Fix: </span>
              {entry.fix}
            </p>
            {entry.date && (
              <p className="mt-0.5 text-[11px] text-zinc-500">{formatDate(entry.date)}</p>
            )}
          </li>
        ))}
      </ol>

      {priorFailures.length > 0 && (
        <p className="mt-2 text-[11px] font-medium text-amber-800">
          Time until recurrence was recorded on {priorFailures.length} of these attempts — a fix
          that passed verification is not the same as a fix that held.
        </p>
      )}
    </Callout>
  );
}

const STAGE_INDEX: Record<string, number> = {
  PROPOSED: 0,
  APPROVED: 1,
  IMPLEMENTED: 2,
  VERIFIED: 3,
  SUCCESSFUL: 4,
  PARTIAL: 4,
  FAILED: 4,
  RECURRED: 5,
};

/**
 * PROPOSED → APPROVED → IMPLEMENTED → VERIFIED → outcome → recurrence
 * monitoring. Making the outcome a *stage* rather than a footnote is the point:
 * REMEDY remembers what happened after the fix, so the lifecycle does not end
 * at "implemented".
 */
export function LifecycleTrack({
  status,
  outcome,
  caption,
}: {
  status?: string | null;
  outcome?: string | null;
  /**
   * Overrides the status readout. Used when the track is shown as a legend
   * rather than against one specific remediation — otherwise the explainer
   * reads "No remediation proposed yet" on a page full of them.
   */
  caption?: string;
}) {
  const currentIndex = status ? (STAGE_INDEX[status] ?? 0) : -1;
  const terminalLabel = outcome ? outcomeLabel(outcome) : null;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Remediation lifecycle
        </p>
        <span className="text-[11px] text-zinc-500">
          {caption ? (
            caption
          ) : status ? (
            <>
              Current status: <strong className="text-zinc-800">{status}</strong>
              {terminalLabel && <> · outcome {terminalLabel}</>}
            </>
          ) : (
            "No remediation proposed yet"
          )}
        </span>
      </div>

      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
        {LIFECYCLE_STAGES.map((stage, index) => {
          const isOutcomeStage = stage === "OUTCOME";
          const label = isOutcomeStage && terminalLabel ? terminalLabel : stage;
          const reached = currentIndex >= 0 && index <= currentIndex;
          const current = index === currentIndex;

          return (
            <li key={stage} className="flex items-center gap-1">
              <span
                className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
                  current
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : reached
                      ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                      : "border-zinc-200 bg-zinc-50 text-zinc-400"
                }`}
              >
                {label}
              </span>
              {index < LIFECYCLE_STAGES.length - 1 && (
                <span
                  className={`text-[11px] ${reached ? "text-emerald-500" : "text-zinc-300"}`}
                  aria-hidden
                >
                  →
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {status && REMEDIATION_STATUS_TONE[status] && (
        <p className="mt-2 text-[11px] text-zinc-500">
          Nothing proceeds past PROPOSED without a human approval, and nothing is executed against
          real infrastructure at any stage.
        </p>
      )}
    </div>
  );
}
