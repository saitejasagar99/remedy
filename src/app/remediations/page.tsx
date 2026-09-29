"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "@/app/lib/api";
import { countLabel, formatDate, formatDateTime } from "@/app/lib/format";
import { humanize, outcomeLabel, outcomeTone, severityTone } from "@/app/lib/labels";
import type { AnalysisSummary, Finding, FindingsListDto, FindingDetailDto } from "@/app/types";
import { LifecycleTrack } from "@/app/components/recurrence";
import { Badge, EmptyState, ErrorNote, PageHeader, Stat } from "@/app/components/ui";

interface Row {
  finding: Finding;
  detail: FindingDetailDto | null;
  summary?: AnalysisSummary;
}

/** Everything proposed, approved, implemented and outcomeed — one screen. */
export default function RemediationsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await api.get<FindingsListDto>("/api/findings");
        const details = await Promise.all(
          list.findings.map((f) =>
            api
              .get<{ detail: FindingDetailDto | null }>(`/api/findings/${f.id}`)
              .then((r) => r.detail)
              .catch(() => null),
          ),
        );
        if (cancelled) return;
        setRows(
          list.findings.map((finding, index) => ({
            finding,
            detail: details[index],
            summary: list.summaries?.[finding.id],
          })),
        );
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load remediations");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const withRemediation = rows.filter((r) => r.detail?.remediation);

  const counts = withRemediation.reduce(
    (acc, row) => {
      const status = row.detail?.remediation?.status ?? "";
      const outcome = row.detail?.outcomes.at(-1)?.result;
      if (status === "PROPOSED") acc.proposed += 1;
      if (status === "APPROVED") acc.approved += 1;
      if (status === "IMPLEMENTED") acc.implemented += 1;
      if (status === "VERIFIED") acc.verified += 1;
      if (outcome === "SUCCESS") acc.success += 1;
      if (outcome === "PARTIAL") acc.partial += 1;
      if (outcome === "FAILURE") acc.failed += 1;
      return acc;
    },
    { proposed: 0, approved: 0, implemented: 0, verified: 0, success: 0, partial: 0, failed: 0 },
  );

  return (
    <div className="remedy-rise">
      <PageHeader
        eyebrow="Remediations"
        title="Lifecycle & outcomes"
        description="Every proposed change, the human decision behind it, and what happened afterwards. An implemented fix that recurred is recorded as a failure, not a success."
        actions={
          <Link
            href="/investigate"
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700"
          >
            Open the workflow
          </Link>
        }
      />

      <ErrorNote message={error} />

      {/* --------------------------------------------------- stage explainer */}
      <div className="mb-4">
        <LifecycleTrack
          status={null}
          outcome={null}
          caption="Every proposed change moves through these stages"
        />
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Awaiting approval" value={counts.proposed} hint="PROPOSED" tone={counts.proposed ? "warn" : "neutral"} />
        <Stat label="Approved" value={counts.approved} hint="Awaiting implementation" />
        <Stat label="Implemented" value={counts.implemented} hint="Built, not yet verified" />
        <Stat label="Verified" value={counts.verified} hint="Checked, no outcome yet" />
        <Stat label="Succeeded" value={counts.success} hint="Outcome SUCCESS" tone={counts.success ? "ok" : "neutral"} />
        <Stat label="Failed" value={counts.failed + counts.partial} hint="Failure or partial result" tone={counts.failed ? "danger" : counts.partial ? "warn" : "neutral"} />
      </div>

      {loading && (
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-500">
          Loading remediation records…
        </div>
      )}

      {!loading && withRemediation.length === 0 && !error && (
        <EmptyState
          title="No remediation has been proposed yet"
          body="Run the analysis on a finding to put a recommendation on the table. Nothing proceeds past PROPOSED without a human approval."
          action={
            <Link href="/investigate" className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white">
              Open the workflow
            </Link>
          }
        />
      )}

      {withRemediation.length > 0 && (
        <div className="flex flex-col gap-3">
          {withRemediation.map(({ finding, detail, summary }) => {
            const remediation = detail?.remediation;
            if (!remediation) return null;
            const outcome = detail?.outcomes.at(-1) ?? null;
            const approval = detail?.approvals.at(-1) ?? null;

            return (
              <article
                key={finding.id}
                className="rounded-lg border border-zinc-200 bg-white shadow-sm"
              >
                <header className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 px-4 py-3">
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      <Badge tone={severityTone(finding.severity)}>{finding.severity}</Badge>
                      <Badge mono>{finding.controlId}</Badge>
                      {summary?.memoryInfluenced && <Badge tone="info">memory-influenced</Badge>}
                      {summary?.rejected ? <Badge tone="danger">{summary.rejected} fix rejected</Badge> : null}
                    </div>
                    <Link
                      href={`/findings/${finding.id}`}
                      className="text-sm font-semibold text-zinc-900 hover:text-sky-700"
                    >
                      {finding.title}
                    </Link>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[11px] uppercase tracking-wide text-zinc-500">Status</p>
                    <p className="text-sm font-semibold text-zinc-900">
                      {humanize(remediation.status)}
                    </p>
                  </div>
                </header>

                <div className="px-4 py-3 text-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    Proposed action
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-800">
                    {remediation.proposed_action}
                  </p>

                  <div className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
                    <p>
                      <span className="text-zinc-500">Proposed: </span>
                      {formatDateTime(remediation.proposed_at)}
                    </p>
                    <p>
                      <span className="text-zinc-500">Approved: </span>
                      {remediation.approved_at ? formatDateTime(remediation.approved_at) : "—"}
                    </p>
                    <p>
                      <span className="text-zinc-500">Implemented: </span>
                      {remediation.implemented_at ? formatDate(remediation.implemented_at) : "—"}
                    </p>
                    <p>
                      <span className="text-zinc-500">Owner: </span>
                      {remediation.owner || "—"}
                    </p>
                  </div>

                  {approval && (
                    <p className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs">
                      <Badge tone={approval.decision === "APPROVED" ? "ok" : "danger"}>
                        {approval.decision}
                      </Badge>{" "}
                      <span className="text-zinc-700">
                        by {approval.decidedBy} · {formatDateTime(approval.decidedAt)}
                      </span>
                      {approval.reason && <span className="text-zinc-600"> — {approval.reason}</span>}
                    </p>
                  )}

                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <div className="rounded-md border border-zinc-200 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                        Outcome
                      </p>
                      {outcome ? (
                        <>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <Badge tone={outcomeTone(outcome.result)}>{outcomeLabel(outcome.result)}</Badge>
                            {outcome.recurrence && (
                              <Badge tone="danger">recurred after {outcome.daysToRecurrence} days</Badge>
                            )}
                            <span className="text-[11px] text-zinc-500">
                              {formatDateTime(outcome.recordedAt)}
                            </span>
                          </div>
                          <p className="mt-1.5 text-xs leading-relaxed text-zinc-700">
                            {outcome.lessonLearned}
                          </p>
                        </>
                      ) : (
                        <p className="mt-1 text-xs text-zinc-500">
                          Not recorded — this remediation has not yet been closed out.
                        </p>
                      )}
                    </div>

                    <div className="rounded-md border border-zinc-200 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                        Rationale from memory
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-zinc-700">
                        {remediation.rationale ||
                          "No historical case changed this recommendation."}
                      </p>
                    </div>
                  </div>
                </div>

                <footer className="border-t border-zinc-100 px-4 py-2.5">
                  <Link href={`/findings/${finding.id}`} className="text-[11px] font-medium text-sky-700 hover:underline">
                    Open full investigation →
                  </Link>
                </footer>
              </article>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-[11px] text-zinc-500">
        {countLabel(withRemediation.length, "remediation")} on record. Remediation is simulated
        throughout — approval records a human decision and nothing is executed against real
        infrastructure.
      </p>
    </div>
  );
}
