"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "@/app/lib/api";
import { friendlyError } from "@/app/lib/errors";
import { countLabel, formatDate, formatDateTime, timeAgo } from "@/app/lib/format";
import {
  FINDING_STATUS_TONE,
  MEMORY_STATUS_COPY,
  STAGE_LABEL,
  categoryLabel,
  findingStatusLabel,
  humanize,
  outcomeLabel,
  outcomeTone,
  severityTone,
} from "@/app/lib/labels";
import type { AnalysisDto, FindingDetailDto } from "@/app/types";

import {
  CasesUsedList,
  ConflictPanel,
  RecommendationCompare,
  WhyMemoryContent,
} from "./RecommendationView";
import { LifecycleTrack, RecurrenceDetection } from "./recurrence";
import { ApprovalPanel, OutcomeWorkflow } from "./WorkflowPanels";
import { Badge, Button, Callout, Disclosure, EmptyState, ErrorNote, Section, StatusDot } from "./ui";

const APPROVABLE = "PROPOSED";
const OUTCOMABLE = ["APPROVED", "IMPLEMENTED", "VERIFIED"];

/** Scroll to a numbered section without losing the page's scroll position. */
function goTo(step: number) {
  document.getElementById(`step-${step}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * The single workflow the product exists to show, as ten numbered sections.
 *
 * One component serves both the Findings detail route and the Investigate
 * console so the two screens cannot drift: a judge who opens the same finding
 * from either entry point sees the identical, evidence-backed story.
 */
export function FindingExperience({
  findingId,
  onChanged,
}: {
  findingId: string;
  onChanged?: () => void;
}) {
  const [detail, setDetail] = useState<FindingDetailDto | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ detail: FindingDetailDto | null }>(`/api/findings/${findingId}`)
      .then((res) => {
        if (cancelled) return;
        setDetail(res.detail);
        setAnalysis(res.detail?.analysis ?? null);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(
          friendlyError(e instanceof Error ? e.message : "Could not load this finding record."),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [findingId, tick]);

  async function runAnalysis() {
    setBusy("analyze");
    setError(null);
    setNote(null);
    try {
      const res = await api.post<{ analysis: AnalysisDto }>(
        `/api/findings/${findingId}/analyze`,
      );
      setAnalysis(res.analysis);
      setNote("Analysis stored. The recommendation below is the one a reviewer would act on.");
      reload();
      onChanged?.();
    } catch (e) {
      setError(
        friendlyError(e instanceof Error ? e.message : "The analysis could not be completed."),
      );
    } finally {
      setBusy(null);
    }
  }

  const finding = detail?.finding ?? null;
  const remediation = detail?.remediation ?? null;
  const status = remediation?.status ?? null;
  const canApprove = Boolean(analysis) && status === APPROVABLE;
  const canRecord = Boolean(status && OUTCOMABLE.includes(status));
  const hasOutcome = Boolean(detail?.outcomes.length);
  const conflicts = analysis?.conflicts ?? [];
  const cases = useMemo(() => analysis?.memory.cases ?? [], [analysis]);

  /** Local outcomes become recurrence rows alongside the recalled ones. */
  const localRecurrence = useMemo(() => {
    if (!detail?.remediation) return [];
    return detail.outcomes.map((o, index) => ({
      key: `local-${o.id}-${index}`,
      ...(o.recordedAt ? { date: o.recordedAt } : {}),
      fix: detail.remediation?.proposed_action ?? "Proposed remediation",
      outcome: o.result,
      ...(o.daysToRecurrence ? { daysToRecurrence: o.daysToRecurrence } : {}),
      source: "local" as const,
    }));
  }, [detail]);

  const heroCase = useMemo(() => {
    if (cases.length === 0) return null;
    const failed = cases.find((c) => c.outcome === "FAILURE" && c.recurrence);
    return failed ?? cases.find((c) => c.outcome === "FAILURE") ?? null;
  }, [cases]);

  if (!detail) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-500">
        {error ? <ErrorNote message={error} /> : "Loading finding record…"}
      </div>
    );
  }

  if (!finding) {
    return (
      <EmptyState
        tone="danger"
        title="This finding could not be loaded"
        body="The record may have been reset. Return to Findings and select it again."
        action={
          <Link
            href="/findings"
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white"
          >
            Back to findings
          </Link>
        }
      />
    );
  }

  const memoryStatus = analysis?.memory.status ?? null;
  const memoryMeta = memoryStatus ? MEMORY_STATUS_COPY[memoryStatus] : null;

  return (
    <div className="flex flex-col gap-4">
      {/* ---------------------------------------------------- action strip */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <Badge tone={severityTone(finding.severity)}>{finding.severity}</Badge>
          <Badge tone={FINDING_STATUS_TONE[finding.status] ?? "neutral"}>
            {findingStatusLabel(finding.status)}
          </Badge>
          {finding.recurrenceOf && <Badge tone="danger">Recurring</Badge>}
          {analysis && memoryMeta && <Badge tone={memoryMeta.tone}>{memoryMeta.label}</Badge>}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={reload} disabled={busy !== null}>
            Refresh record
          </Button>
          <Button onClick={runAnalysis} busy={busy === "analyze"}>
            {analysis ? "Re-run analysis" : "Run analysis"}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <ErrorNote message={error} />
        {note && (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            {note}
          </p>
        )}
      </div>

      <LifecycleTrack status={status} outcome={detail.outcomes.at(-1)?.result ?? null} />

      {/* ---------------------------------------------------------- 1. summary */}
      <Section
        step={1}
        title="Finding summary"
        description="What was detected, where, and when it first entered the record."
        actions={<span className="text-[11px] text-zinc-500">Last updated {timeAgo(finding.updatedAt)}</span>}
      >
        <p className="text-sm font-medium text-zinc-900">{finding.title}</p>
        <p className="mt-1 text-sm leading-relaxed text-zinc-600">{finding.description}</p>

        <dl className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex gap-2 py-1 text-xs">
            <dt className="w-36 shrink-0 text-zinc-500">Finding id</dt>
            <dd className="font-mono">{finding.id}</dd>
          </div>
          <div className="flex gap-2 py-1 text-xs">
            <dt className="w-36 shrink-0 text-zinc-500">Control</dt>
            <dd className="font-mono">{finding.controlId}</dd>
          </div>
          <div className="flex gap-2 py-1 text-xs">
            <dt className="w-36 shrink-0 text-zinc-500">Category</dt>
            <dd>{categoryLabel(finding.category)}</dd>
          </div>
          <div className="flex gap-2 py-1 text-xs">
            <dt className="w-36 shrink-0 text-zinc-500">Affected system</dt>
            <dd>{finding.affectedSystem}</dd>
          </div>
          <div className="flex gap-2 py-1 text-xs">
            <dt className="w-36 shrink-0 text-zinc-500">First detected</dt>
            <dd>{formatDate(finding.firstDetectedAt)}</dd>
          </div>
          <div className="flex gap-2 py-1 text-xs">
            <dt className="w-36 shrink-0 text-zinc-500">Recurrence</dt>
            <dd>
              {finding.recurrenceOf ? (
                <Link className="text-red-700 underline" href={`/findings/${finding.recurrenceOf}`}>
                  Recurrence of {finding.recurrenceOf}
                </Link>
              ) : (
                "First occurrence on record"
              )}
            </dd>
          </div>
        </dl>
      </Section>

      {/* --------------------------------------------------------- 2. evidence */}
      <Section
        step={2}
        title="Evidence"
        description="The observations this analysis is allowed to reason from."
        actions={<Badge>{countLabel(finding.evidence.length, "observation")}</Badge>}
      >
        {finding.evidence.length === 0 ? (
          <EmptyState
            title="No evidence recorded"
            body="REMEDY will not analyse a finding with no observations — an evidence-free recommendation would be a guess. Add an observation, then run the analysis."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {finding.evidence.map((e) => (
              <li key={e.id} className="rounded-md border border-zinc-200 bg-zinc-50/60 p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge tone="info">{e.source}</Badge>
                  <span className="text-[11px] text-zinc-500">{formatDate(e.collectedAt)}</span>
                </div>
                <p className="text-xs leading-relaxed text-zinc-800">{e.observation}</p>
                {e.supportsHypothesis && (
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Supports hypothesis: {e.supportsHypothesis}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ------------------------------------------------------- 3. root cause */}
      <Section
        step={3}
        title="Root-cause analysis"
        description="The hypothesis generated from evidence — not a memory of a past finding."
        actions={
          detail.rootCause && (
            <Badge tone={detail.rootCause.confidence >= 0.7 ? "ok" : "warn"}>
              confidence {detail.rootCause.confidence.toFixed(2)}
            </Badge>
          )
        }
      >
        {!detail.rootCause ? (
          <EmptyState
            title="No root cause identified yet"
            body="Run the analysis to derive a root-cause hypothesis from the evidence above."
            action={<Button onClick={runAnalysis} busy={busy === "analyze"}>Run analysis</Button>}
          />
        ) : (
          <>
            <p className="text-sm leading-relaxed text-zinc-800">{detail.rootCause.rootCause}</p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
              <div
                className="h-full rounded-full bg-zinc-800"
                style={{ width: `${Math.round(detail.rootCause.confidence * 100)}%` }}
              />
            </div>
            {detail.rootCause.contributingFactors.length > 0 && (
              <>
                <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Contributing factors
                </p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-zinc-700">
                  {detail.rootCause.contributingFactors.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </>
            )}
            <p className="mt-3 text-[11px] text-zinc-500">
              Method: {humanize(detail.rootCause.method)} · identified {formatDate(detail.rootCause.identifiedAt)}
            </p>
          </>
        )}
      </Section>

      {/* ----------------------------------------------- 4. historical memory */}
      <Section
        step={4}
        title="Historical memory"
        description="What the organisation already knows about this class of problem — recalled from Hindsight."
        emphasis
        actions={
          analysis && (
            <Link href="/memory" className="text-xs font-medium text-sky-700 hover:underline">
              Open memory inspector →
            </Link>
          )
        }
      >
        {!analysis ? (
          <EmptyState
            title="No analysis yet"
            body="Historical memory is recalled as part of the analysis. Run it to see which prior cases apply — or do not."
            action={<Button onClick={runAnalysis} busy={busy === "analyze"}>Run analysis</Button>}
          />
        ) : memoryStatus === "UNAVAILABLE" ? (
          <EmptyState
            tone="danger"
            title="Historical memory temporarily unavailable"
            body={`Hindsight could not be reached: ${analysis.memory.bundle.reason ?? "no reason returned"}. The recommendation below is stateless — it does not use any organisational experience, and should be treated accordingly.`}
            action={<Button variant="secondary" onClick={reload}>Retry</Button>}
          />
        ) : cases.length === 0 ? (
          <EmptyState
            title="No relevant organizational memory found."
            body="Hindsight answered and returned nothing close enough to this finding to justify using it. REMEDY will not pad an answer with unrelated history."
          />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600">
              <StatusDot tone={memoryMeta?.tone ?? "neutral"} label={memoryMeta?.label ?? memoryStatus ?? "unknown"} />
              <span>{memoryMeta?.explain}</span>
              <span className="font-mono text-[11px] text-zinc-500">
                status: {memoryStatus}
              </span>
            </div>

            <CasesUsedList casesUsed={cases} />

            <RecurrenceDetection
              controlId={finding.controlId}
              findingTitle={finding.title}
              isRecurrence={Boolean(finding.recurrenceOf) || finding.status === "RECURRED"}
              cases={cases}
              localEntries={localRecurrence}
            />
          </div>
        )}
      </Section>

      {/* ---------------------------------------------------- hero: failed fix */}
      {analysis && heroCase && (
        <FailedFixHero
          case={heroCase}
          bestRelevance={Math.max(...cases.map((c) => c.relevance ?? 0))}
          recommendation={analysis.recommendation.recommendation}
          why={analysis.recommendation.whyMemoryChangedIt}
          onViewEvidence={() => goTo(2)}
          onApprove={() => goTo(7)}
        />
      )}

      {/* --------------------------------------------------- 5. recommendation */}
      <Section
        step={5}
        title="Remediation recommendation"
        description="The stateless answer and the memory-influenced answer, side by side."
        emphasis
        actions={
          analysis && (
            <Badge tone={analysis.recommendation.recommendation !== analysis.recommendation.baselineRecommendation ? "warn" : "neutral"}>
              {analysis.recommendation.recommendation !== analysis.recommendation.baselineRecommendation
                ? "changed by memory"
                : "not changed by memory"}
            </Badge>
          )
        }
      >
        {!analysis ? (
          <EmptyState
            title="No recommendation yet"
            body="Run the analysis. REMEDY always computes the stateless answer first, then re-derives it with recalled history, so you can see exactly what memory changed."
            action={<Button onClick={runAnalysis} busy={busy === "analyze"}>Run analysis</Button>}
          />
        ) : (
          <>
            <ConflictPanel conflicts={conflicts} />
            <div className="mt-3">
              <RecommendationCompare
                recommendation={analysis.recommendation}
                onReviewNeeded={conflicts.length > 0}
              />
            </div>
          </>
        )}
      </Section>

      {/* ------------------------------------------------- 6. why this answer */}
      <Section
        step={6}
        title="Why this recommendation?"
        description="Cases used, outcomes, lessons and the resulting decision — provenance, not a reasoning trace."
      >
        {!analysis ? (
          <p className="text-xs text-zinc-500">
            The provenance for this recommendation appears once the analysis has run.
          </p>
        ) : (
          <Disclosure
            label="Why this recommendation?"
            summary={`${analysis.recommendation.historicalCasesUsed.length} historical case(s) cited · current decision: ${analysis.recommendation.recommendation.slice(0, 90)}${analysis.recommendation.recommendation.length > 90 ? "…" : ""}`}
            defaultOpen
          >
            <WhyMemoryContent
              recommendation={analysis.recommendation}
              casesUsed={analysis.memory.cases}
            />
          </Disclosure>
        )}
      </Section>

      {/* --------------------------------------------------------- 7. approval */}
      {canApprove ? (
        <ApprovalPanel
          findingId={findingId}
          disabled={false}
          requiresReview={conflicts.length > 0}
          proposal={analysis?.recommendation.recommendation}
          onDone={() => {
            reload();
            onChanged?.();
          }}
        />
      ) : (
        <Section
          step={7}
          title="Human approval"
          description="The one gate between a recommendation and a change."
          tone="warn"
        >
          {!analysis || !remediation ? (
            <EmptyState
              title="Nothing to approve yet"
              body="A recommendation must exist before a human can approve it. Run the analysis to put one on the table."
              action={<Button onClick={runAnalysis} busy={busy === "analyze"}>Run analysis</Button>}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <Callout tone="warn" title={`Simulated remediation — status ${status}`}>
                REMEDY never modifies real infrastructure. Approval records a human decision; it
                executes nothing.
              </Callout>
              {detail.approvals.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {detail.approvals.map((a) => (
                    <li key={a.id} className="rounded-md border border-zinc-200 p-2.5 text-xs">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Badge tone={a.decision === "APPROVED" ? "ok" : "danger"}>
                          {humanize(a.decision)}
                        </Badge>
                        <span className="text-zinc-600">{a.decidedBy}</span>
                        <span className="text-[11px] text-zinc-500">{formatDateTime(a.decidedAt)}</span>
                      </div>
                      {a.reason && <p className="text-zinc-700">Reason: {a.reason}</p>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-zinc-600">
                  This remediation is <strong>{status}</strong> and is not awaiting a decision.
                </p>
              )}
            </div>
          )}
        </Section>
      )}

      {/* --------------------------------------------- 8 & 9. verify + outcome */}
      {canRecord ? (
        <OutcomeWorkflow
          findingId={findingId}
          onDone={() => {
            reload();
            onChanged?.();
          }}
        />
      ) : (
        <>
          <Section
            step={8}
            title="Verification"
            description="Did the simulated remediation actually close the finding?"
          >
            {status === APPROVABLE ? (
              <EmptyState
                title="A human approval is required first"
                body="Verification cannot be recorded against an unapproved remediation. Approve or reject the recommendation above."
                action={<Button variant="secondary" onClick={() => goTo(7)}>Go to approval</Button>}
              />
            ) : (
              <EmptyState
                title="No remediation to verify yet"
                body="Once a recommendation is approved, verification records whether the fix actually worked — including the cases where it did not."
                action={<Button onClick={runAnalysis} busy={busy === "analyze"}>Run analysis</Button>}
              />
            )}
          </Section>

          <Section
            step={9}
            title="Outcome"
            description="What happened after the fix — the value that goes back into memory."
            emphasis
          >
            {detail.outcomes.length === 0 ? (
              <EmptyState
                title="No outcome recorded yet"
                body="An outcome is what turns a one-off answer into organisational memory. Without it, the next finding on this control starts from zero."
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {detail.outcomes.map((o) => (
                  <li key={o.id} className="rounded-md border border-zinc-200 p-3">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <Badge tone={outcomeTone(o.result)}>{outcomeLabel(o.result)}</Badge>
                      {o.recurrence && (
                        <Badge tone="danger">recurred after {o.daysToRecurrence} days</Badge>
                      )}
                      <span className="text-[11px] text-zinc-500">{formatDateTime(o.recordedAt)}</span>
                    </div>
                    <p className="text-xs leading-relaxed text-zinc-700">{o.lessonLearned}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}

      {/* ------------------------------------------------ 10. memory update */}
      <Section
        step={10}
        title="Memory update"
        description="The retained write-back: why the next finding on this control will read differently."
        emphasis
        actions={
          <Link href="/memory" className="text-xs font-medium text-sky-700 hover:underline">
            Inspect memory →
          </Link>
        }
      >
        {!hasOutcome ? (
          <EmptyState
            title="Nothing retained yet"
            body="Recording an outcome in section 9 writes the result and its lesson back to Hindsight. That write is what changes the recommendation for the next occurrence."
          />
        ) : (
          <div className="flex flex-col gap-3">
            <Callout tone="ok" title="Loop closed: outcome retained">
              The recorded outcome and its lesson are stored in the Hindsight memory bank, where the
              recall step reads them on every future run for this control family.
            </Callout>

            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                Memory write-back audit
              </p>
              <ul className="flex flex-col gap-1.5">
                {detail.runs
                  .filter((r) => r.stage === "hindsight_retain_outcome")
                  .map((r, index) => {
                    const ok = r.ok === 1 || r.ok === true;
                    return (
                      <li
                        key={String(r.id ?? index)}
                        className="flex flex-wrap items-center gap-2 rounded border border-zinc-200 px-2.5 py-1.5 text-xs"
                      >
                        <StatusDot tone={ok ? "ok" : "danger"} label={ok ? "retained" : "failed"} />
                        <span className="text-zinc-600">{STAGE_LABEL[String(r.stage)]}</span>
                        <span className="text-[11px] text-zinc-500">
                          {formatDateTime(String(r.finished_at ?? r.started_at ?? ""))}
                        </span>
                        {!ok && r.error ? (
                          <span className="text-[11px] text-red-700">{friendlyError(String(r.error))}</span>
                        ) : null}
                      </li>
                    );
                  })}
                {detail.runs.filter((r) => r.stage === "hindsight_retain_outcome").length === 0 && (
                  <li className="text-xs text-zinc-500">
                    No write-back audit rows were recorded for this finding.
                  </li>
                )}
              </ul>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

/**
 * The hero: a prior attempt at this exact problem failed, and it changed this
 * answer. Every field is sourced from a recalled case id — nothing here is
 * written by the model at display time.
 */
function FailedFixHero({
  case: failedCase,
  bestRelevance,
  recommendation,
  why,
  onViewEvidence,
  onApprove,
}: {
  case: {
    caseId: string;
    title: string;
    outcome?: string;
    rootCause?: string;
    remediationAttempted?: string;
    lesson?: string;
    recurrence: boolean;
    daysToRecurrence?: number;
    relevance: number | null;
  };
  bestRelevance: number;
  recommendation: string;
  why: string;
  onViewEvidence: () => void;
  onApprove: () => void;
}) {
  const match =
    failedCase.relevance !== null && bestRelevance > 0
      ? Math.round(Math.min(1, failedCase.relevance / bestRelevance) * 100)
      : null;

  return (
    <section className="overflow-hidden rounded-lg border border-red-300 bg-white shadow-sm ring-1 ring-red-100">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-red-200 bg-red-50 px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-[0.14em] text-red-700">
            Don&rsquo;t repeat a failed fix
          </span>
          <Badge tone="danger">
            {failedCase.recurrence ? "RECURRING FINDING DETECTED" : "PRIOR FIX FAILED"}
          </Badge>
        </div>
        <span className="tabular text-[11px] text-red-700">
          Similarity: {match !== null ? `${match}% of top match` : "unranked"} · historical case #{failedCase.caseId}
        </span>
      </header>

      <div className="grid gap-px bg-zinc-100 lg:grid-cols-2">
        <div className="bg-white px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Previous occurrence
          </p>
          <dl className="mt-2 flex flex-col gap-1.5 text-xs">
            <div>
              <dt className="text-zinc-500">Previous finding</dt>
              <dd className="font-medium text-zinc-900">{failedCase.title}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Previous root cause</dt>
              <dd className="text-zinc-800">{failedCase.rootCause || "Not recorded"}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Previous remediation</dt>
              <dd className="text-zinc-800">{failedCase.remediationAttempted || "Not recorded"}</dd>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <dt className="text-zinc-500">Previous outcome</dt>
              <dd>
                <Badge tone={outcomeTone(failedCase.outcome)}>{outcomeLabel(failedCase.outcome)}</Badge>
              </dd>
              {failedCase.daysToRecurrence && (
                <span className="tabular text-zinc-700">
                  · time until recurrence: {failedCase.daysToRecurrence} days
                </span>
              )}
            </div>
            <div>
              <dt className="text-zinc-500">Historical lesson</dt>
              <dd className="border-l-2 border-amber-400 pl-2 text-zinc-800">
                {failedCase.lesson || "No lesson was retained for this case."}
              </dd>
            </div>
          </dl>
        </div>

        <div className="bg-white px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Current recommendation
          </p>
          <p className="mt-2 text-sm font-medium leading-relaxed text-zinc-900">{recommendation}</p>

          <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Why?</p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-700">
            {failedCase.recurrence && failedCase.daysToRecurrence
              ? `The previous remediation addressed the symptom but did not prevent recurrence — the finding returned after ${failedCase.daysToRecurrence} days.`
              : `The previous remediation on this control ended in ${outcomeLabel(failedCase.outcome).toLowerCase()} and history shows repeating it is not safe.`}{" "}
            {why}
          </p>
        </div>
      </div>

      <footer className="flex flex-wrap gap-2 border-t border-zinc-200 bg-zinc-50 px-5 py-3">
        <Link
          href={`/memory?case=${failedCase.caseId}`}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
        >
          View historical case
        </Link>
        <button
          type="button"
          onClick={onViewEvidence}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
        >
          View evidence
        </button>
        <button
          type="button"
          onClick={onApprove}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700"
        >
          Approve recommendation
        </button>
        <span className="ml-auto self-center text-[11px] text-zinc-500">
          Simulated remediation · human approval required
        </span>
      </footer>
    </section>
  );
}
