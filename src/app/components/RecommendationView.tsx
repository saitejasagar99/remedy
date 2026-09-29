"use client";

import type { HistoricalCaseUsed, MemoryConflict, RejectedPriorAction } from "@/app/types";
import { outcomeLabel, outcomeTone } from "@/app/lib/labels";
import { Badge, Callout, Field, RelativeMatchBar } from "./ui";

/**
 * The three panels that explain a recommendation.
 *
 * They are split rather than rendered as one stack because the finding page
 * presents them at different points in the workflow: conflicts before the
 * answer, the A/B comparison as the answer, and the "why" as an expansion the
 * judge can open when they want the provenance.
 *
 * Scoring note: Hindsight returns a *relative* score for each recalled fact.
 * It is shown as where a case sits against the strongest result of the same
 * query — never as a calibrated similarity percentage.
 */

export function ConflictPanel({ conflicts }: { conflicts: MemoryConflict[] }) {
  if (conflicts.length === 0) return null;
  return (
    <Callout
      tone="danger"
      title="Historical memory conflict"
      actions={<Badge tone="danger">human verification required</Badge>}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide opacity-70">
        Status: human verification required
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {conflicts.map((c) => (
          <li key={c.id} className="rounded-md border border-red-200 bg-white/70 p-2.5">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <Badge tone="danger">{c.severity}</Badge>
              <span className="font-mono text-[11px] text-red-700">{c.kind}</span>
            </div>
            <p>
              <span className="font-semibold">Historical memory:</span> {c.historicalClaim}
            </p>
            <p className="mt-1">
              <span className="font-semibold">Current evidence:</span> {c.currentEvidence}
            </p>
            <p className="mt-1.5 text-[11px] text-zinc-600">
              Recommendation: gather additional evidence before reusing the historical
              remediation. History is never auto-resolved against current evidence.
            </p>
          </li>
        ))}
      </ul>
    </Callout>
  );
}

/**
 * Side-by-side A / B — the required visible memory effect.
 *
 * A is always present: `baselineRecommendation` is computed on every run even
 * when memory is available, so the contrast is real rather than asserted.
 */
export function RecommendationCompare({
  recommendation,
  onReviewNeeded,
}: {
  recommendation: {
    recommendation: string;
    baselineRecommendation: string;
    confidence: number;
    memoryInfluenced: boolean;
    memoryStatus: string;
    memoryReason?: string;
    whyMemoryChangedIt: string;
    risks: string[];
    assumptions: string[];
    rejectedPriorActions: RejectedPriorAction[];
  };
  onReviewNeeded: boolean;
}) {
  const changed = recommendation.recommendation !== recommendation.baselineRecommendation;

  return (
    <div className="flex flex-col gap-4">
      {onReviewNeeded && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
          A conflict between historical memory and current evidence is open on this finding. The
          answer below is shown with that disagreement intact — it has not been silently resolved.
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50/60 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Without memory
            </span>
            <Badge>no memory</Badge>
          </div>
          <p className="text-sm leading-relaxed text-zinc-700">
            {recommendation.baselineRecommendation}
          </p>
          <p className="mt-2 text-[11px] text-zinc-500">
            What any agent says having seen only this finding.
          </p>
        </div>

        <div
          className={`rounded-md border p-3 ${
            changed
              ? "border-amber-400 bg-amber-50"
              : "border-zinc-300 bg-white"
          }`}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-700">
              With hindsight memory
            </span>
            <Badge tone={changed ? "warn" : "neutral"}>
              {changed ? "answer changed" : "same answer"}
            </Badge>
          </div>
          <p className="text-sm font-medium leading-relaxed text-zinc-900">
            {recommendation.recommendation}
          </p>
          <p className="mt-2 text-[11px] text-zinc-600">
            {recommendation.memoryInfluenced
              ? "Re-derived with the organisation's prior remediation outcomes."
              : "No usable history was recalled for this finding."}
          </p>
        </div>
      </div>

      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <Field label="Confidence">
          <span className="tabular font-mono">{recommendation.confidence.toFixed(2)}</span>
          {!recommendation.memoryInfluenced && (
            <span className="ml-2 text-zinc-500">(root-cause hypothesis only)</span>
          )}
        </Field>
        <Field label="Changed by memory?">
          <span className={changed ? "font-semibold text-amber-700" : ""}>
            {changed ? "Yes — answer differs from A" : "No — history corroborates A"}
          </span>
        </Field>
      </div>

      {recommendation.memoryStatus === "UNAVAILABLE" && (
        <Callout tone="danger" title="Historical memory temporarily unavailable">
          {recommendation.memoryReason ??
            "Hindsight could not be reached for this run."}{" "}
          This recommendation is stateless and ignores all organisational experience.
        </Callout>
      )}

      {recommendation.rejectedPriorActions.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
            Rejected prior actions — history vetoed these
          </p>
          <ul className="flex flex-col gap-2">
            {recommendation.rejectedPriorActions.map((r) => (
              <li key={`${r.caseId}-${r.action.slice(0, 24)}`} className="rounded border border-amber-200 bg-white/70 p-2.5">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge tone={outcomeTone(r.outcome)}>{outcomeLabel(r.outcome)}</Badge>
                  <span className="font-mono text-[11px]">Case #{r.caseId}</span>
                </div>
                <p className="text-xs line-through decoration-red-400">{r.action}</p>
                <p className="mt-1 text-xs text-zinc-600">{r.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-md border border-zinc-200 p-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Risks
          </p>
          <ul className="list-disc space-y-1 pl-4 text-xs text-zinc-700">
            {recommendation.risks.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-md border border-zinc-200 p-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Assumptions
          </p>
          <ul className="list-disc space-y-1 pl-4 text-xs text-zinc-700">
            {recommendation.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/**
 * "Why this recommendation?" — provenance only.
 *
 * Cases, outcomes, lessons and the resulting decision. No chain-of-thought,
 * no step-by-step reasoning trace: everything shown here is something the
 * memory layer actually returned and can be traced back to a case id.
 */
export function WhyMemoryContent({
  recommendation,
  casesUsed,
}: {
  recommendation: {
    memoryInfluenced: boolean;
    whyMemoryChangedIt: string;
    historicalCasesUsed: HistoricalCaseUsed[];
    recommendation: string;
    baselineRecommendation: string;
  };
  casesUsed: Array<{
    caseId: string;
    outcome?: string;
    remediationAttempted?: string;
    rootCause?: string;
    lesson?: string;
    recurrence: boolean;
    daysToRecurrence?: number;
    relevance: number | null;
  }>;
}) {
  const count = recommendation.historicalCasesUsed.length;
  const bestRelevance = casesUsed.reduce<number | null>((best, c) => {
    if (c.relevance === null) return best;
    return best === null || c.relevance > best ? c.relevance : best;
  }, null);

  if (count === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-zinc-700">
          {recommendation.memoryInfluenced
            ? "History was recalled but no individual case materially shaped this answer."
            : "No relevant organisational memory was used. The answer derives from the current finding and its root-cause hypothesis only."}
        </p>
        <p className="rounded bg-zinc-50 p-2 text-xs text-zinc-700">
          {recommendation.whyMemoryChangedIt}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium text-zinc-800">
        This recommendation was influenced by {count} historical case{count === 1 ? "" : "s"}.
      </p>

      <ul className="flex flex-col gap-2">
        {recommendation.historicalCasesUsed.map((c) => (
          <li key={c.caseId} className="rounded-md border border-zinc-200 bg-zinc-50/60 p-2.5">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold">Historical Case #{c.caseId}</span>
              <Badge tone={outcomeTone(c.outcome)}>{outcomeLabel(c.outcome)}</Badge>
              {c.recurrenceDays !== null && (
                <Badge tone="danger">recurred after {c.recurrenceDays} days</Badge>
              )}
              <RelativeMatchBar score={c.relevance} topScore={bestRelevance} />
            </div>
            {c.remediationAttempted && (
              <p className="text-xs">
                <span className="text-zinc-500">Fix attempted: </span>
                {c.remediationAttempted}
              </p>
            )}
            {c.lesson && (
              <p className="mt-1 text-xs">
                <span className="text-zinc-500">Lesson: </span>
                {c.lesson}
              </p>
            )}
            {c.whyRelevant && (
              <p className="mt-1 text-[11px] text-zinc-500">Why it matched: {c.whyRelevant}</p>
            )}
          </li>
        ))}
      </ul>

      <div className="rounded-md border border-zinc-300 bg-white p-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Why the decision changed
        </p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-700">
          {recommendation.whyMemoryChangedIt}
        </p>
      </div>

      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
          Current decision
        </p>
        <p className="mt-1 text-xs font-medium leading-relaxed text-emerald-950">
          {recommendation.recommendation}
        </p>
        <p className="mt-1.5 text-[11px] text-emerald-800">
          Without memory this would have been: &ldquo;{recommendation.baselineRecommendation}
          &rdquo;
        </p>
      </div>

      <p className="text-[11px] leading-relaxed text-zinc-500">
        Match strength is shown relative to the strongest result of this recall query. Hindsight
        scores are an ordering signal, not a calibrated similarity percentage. Nothing above is a
        reasoning trace — each item is a stored fact attributable to a case id.
      </p>
    </div>
  );
}

/** Provenance list of recalled cases with their relative scores. */
export function CasesUsedList({
  casesUsed,
}: {
  casesUsed: Array<{
    caseId: string;
    title?: string;
    outcome?: string;
    remediationAttempted?: string;
    rootCause?: string;
    lesson?: string;
    recurrence: boolean;
    daysToRecurrence?: number;
    relevance: number | null;
  }>;
}) {
  if (casesUsed.length === 0) {
    return (
      <p className="text-xs text-zinc-500">
        No relevant historical cases were recalled for this finding.
      </p>
    );
  }

  const best = casesUsed.reduce<number | null>((acc, c) => {
    if (c.relevance === null) return acc;
    return acc === null || c.relevance > acc ? c.relevance : acc;
  }, null);

  return (
    <ul className="flex flex-col gap-3">
      {casesUsed.map((c) => (
        <li key={c.caseId} className="rounded-md border border-zinc-200 p-3">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold">Case #{c.caseId}</span>
            <Badge tone={outcomeTone(c.outcome)}>{outcomeLabel(c.outcome ?? "unknown")}</Badge>
            {c.recurrence && (
              <Badge tone="danger">recurred after {c.daysToRecurrence ?? "?"} days</Badge>
            )}
            <RelativeMatchBar score={c.relevance} topScore={best} />
          </div>
          {c.title && <p className="text-xs font-medium text-zinc-800">{c.title}</p>}
          {c.rootCause && (
            <p className="mt-1 text-xs">
              <span className="text-zinc-500">Root cause: </span>
              {c.rootCause}
            </p>
          )}
          {c.remediationAttempted && (
            <p className="mt-1 text-xs">
              <span className="text-zinc-500">Tried: </span>
              {c.remediationAttempted}
            </p>
          )}
          {c.lesson && (
            <p className="mt-1 text-xs">
              <span className="text-zinc-500">Lesson: </span>
              {c.lesson}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}


