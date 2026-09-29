"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/app/lib/api";
import { loadSampleFindings } from "@/app/lib/samples";
import {
  FINDING_STATUS_TONE,
  MEMORY_STATUS_COPY,
  findingStatusLabel,
  severityTone,
} from "@/app/lib/labels";
import { countLabel, timeAgo } from "@/app/lib/format";
import type { DashboardStats } from "@/lib/dashboard";
import type { Finding } from "@/app/types";
import { Badge, Button, EmptyState, ErrorNote, PageHeader, Stat } from "@/app/components/ui";

interface DashboardPayload {
  stats: DashboardStats;
}

/** The headline card: what memory actually did, counted from stored analyses. */
function MemoryImpact({ stats }: { stats: DashboardStats }) {
  const headline = [
    {
      label: "Findings analysed",
      value: stats.memory.analyzed,
      hint: "Pipeline completed and the answer was stored",
      tone: "neutral" as const,
    },
    {
      label: "Influenced by historical memory",
      value: stats.memory.influenced,
      hint: "Recommendation drew on recalled prior cases",
      tone: "info" as const,
    },
    {
      label: "Recurring findings detected",
      value: stats.totals.recurring,
      hint: "Same control failing again after a fix",
      tone: "warn" as const,
    },
    {
      label: "Previous failed fixes avoided",
      value: stats.memory.avoidedFailedFix,
      hint: "History vetoed at least one prior remediation",
      tone: "danger" as const,
    },
  ];

  return (
    <section className="rounded-lg border border-zinc-300 bg-white shadow-sm ring-1 ring-zinc-200">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3.5">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-zinc-900">Memory Impact</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Counted from stored analyses — no estimated or synthetic figures.
          </p>
        </div>
        <Badge tone={stats.memory.influenced > 0 ? "info" : "neutral"}>
          {stats.memory.changedAnswer} answer{stats.memory.changedAnswer === 1 ? "" : "s"} changed
        </Badge>
      </header>

      <div className="grid gap-px bg-zinc-100 sm:grid-cols-2 lg:grid-cols-4">
        {headline.map((item) => (
          <div key={item.label} className="bg-white px-5 py-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              {item.label}
            </p>
            <p className="tabular mt-1 text-3xl font-semibold tracking-tight text-zinc-900">
              {item.value}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-zinc-500">{item.hint}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-zinc-100 px-5 py-3 text-xs text-zinc-600">
        <span>
          <strong className="font-semibold text-zinc-900">{stats.memory.casesRecalled}</strong>{" "}
          historical cases recalled across all runs
        </span>
        <span>
          <strong className="font-semibold text-zinc-900">{stats.memory.analysesWithConflict}</strong>{" "}
          run{stats.memory.analysesWithConflict === 1 ? "" : "s"} opened a memory/evidence conflict
        </span>
      </div>
    </section>
  );
}

/**
 * The three things that can actually need a human right now.
 *
 * These are the same counters shown below — not a separate queue — so the
 * numbers and the destinations can never disagree. When nothing is waiting,
 * the strip says so instead of disappearing and leaving a blank.
 */
function AttentionStrip({ stats, findings }: { stats: DashboardStats; findings: Finding[] }) {
  const awaiting = stats.totals.awaitingApproval;
  const recurring = findings.filter((f) => f.recurrenceOf || f.status === "RECURRED").length;
  const failed = stats.remediation.failed;

  const tiles = [
    awaiting > 0 && {
      key: "approval",
      value: awaiting,
      label: "waiting for your approval",
      hint: "Open a finding to approve, reject or ask for more evidence",
      href: "/findings?status=AWAITING_APPROVAL",
      tone: "text-amber-700" as const,
      rule: "border-t-amber-500" as const,
    },
    recurring > 0 && {
      key: "recurring",
      value: recurring,
      label: recurring === 1 ? "recurring finding" : "recurring findings",
      hint: "The same control failed again after a fix",
      href: "/findings?recurring=1",
      tone: "text-red-700" as const,
      rule: "border-t-red-500" as const,
    },
    failed > 0 && {
      key: "failed",
      value: failed,
      label: failed === 1 ? "failed remediation" : "failed remediations",
      hint: "History now vetoes that fix for the next occurrence",
      href: "/remediations",
      tone: "text-zinc-900" as const,
      rule: "border-t-zinc-400" as const,
    },
  ].filter((t): t is Exclude<typeof t, false> => Boolean(t));

  if (tiles.length === 0) {
    return (
      <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-xs text-emerald-900">
        <strong className="font-semibold">Nothing is waiting on you.</strong> No finding needs an
        approval and no previous fix has failed.
      </div>
    );
  }

  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tiles.map((tile) => (
        <Link
          key={tile.key}
          href={tile.href}
          className={`group flex items-start justify-between gap-3 rounded-lg border border-zinc-200 border-t-2 bg-white px-4 py-3 shadow-sm transition-colors hover:bg-zinc-50 ${tile.rule}`}
        >
          <span className="min-w-0">
            <span className={`tabular block text-2xl font-semibold ${tile.tone}`}>
              {tile.value}
            </span>
            <span className="mt-0.5 block text-xs font-medium text-zinc-900">{tile.label}</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">{tile.hint}</span>
          </span>
          <span className="shrink-0 text-xs text-zinc-400 transition-colors group-hover:text-zinc-700">
            →
          </span>
        </Link>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<DashboardPayload>("/api/dashboard"),
      api.get<{ findings: Finding[] }>("/api/findings"),
    ])
      .then(([dashboard, list]) => {
        if (cancelled) return;
        setStats(dashboard.stats);
        setFindings(list.findings);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load dashboard");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  async function seedMemory() {
    setBusy("seed");
    setNote(null);
    setError(null);
    try {
      const res = await api.post<{
        seeded: { seeded: number; alreadyPresent: number; failed: number; memoriesWritten: number };
      }>("/api/seed");
      const s = res.seeded;
      setNote(
        `Historical memory: ${s.seeded} case(s) ensured, ${s.memoriesWritten} stage(s) written, ${s.failed} incomplete.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Seeding failed");
    } finally {
      setBusy(null);
    }
  }

  async function loadSamples() {
    setBusy("samples");
    setNote(null);
    setError(null);
    try {
      const result = await loadSampleFindings();
      setNote(
        `Workspace ready: ${result.created} finding(s) created, ${result.alreadyPresent} already present.`,
      );
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create sample findings");
    } finally {
      setBusy(null);
    }
  }

  const recent = findings.slice(0, 6);
  const empty = stats !== null && stats.totals.findings === 0;

  return (
    <div className="remedy-rise">
      <PageHeader
        eyebrow="Dashboard"
        title="Compliance remediation memory"
        description="What is waiting on you, what historical memory changed, and what happened after the last fix."
        actions={
          <>
            <Link
              href="/investigate"
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 transition-colors hover:bg-zinc-50"
            >
              Investigate a finding
            </Link>
            <Link
              href="/demo"
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700"
            >
              Run REMEDY demo
            </Link>
          </>
        }
      />

      <div className="mb-4">
        <ErrorNote message={error} />
        {note && (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            {note}
          </p>
        )}
      </div>

      {stats && !empty && <AttentionStrip stats={stats} findings={findings} />}

      {!stats && !error && (
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-500">
          Loading application state…
        </div>
      )}

      {empty && (
        <EmptyState
          title="No findings on record yet"
          body="REMEDY works from real application state. Load the sample compliance findings to populate the workspace, or file one yourself from the Investigate screen."
          action={
            <>
              <Button onClick={loadSamples} busy={busy === "samples"}>
                Load sample findings
              </Button>
              <Link
                href="/investigate"
                className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
              >
                File a finding
              </Link>
            </>
          }
        />
      )}

      {stats && !empty && (
        <div className="flex flex-col gap-4">
          <MemoryImpact stats={stats} />

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Open findings" value={stats.totals.open} hint="Not yet resolved" />
            <Stat
              label="Recurring findings"
              value={stats.totals.recurring}
              hint="Failing again after a prior fix"
              tone={stats.totals.recurring > 0 ? "warn" : "neutral"}
            />
            <Stat
              label="Failed remediations"
              value={stats.remediation.failed}
              tone={stats.remediation.failed > 0 ? "danger" : "neutral"}
              hint="Recorded outcome: FAILURE"
            />
            <Stat
              label="Successful remediations"
              value={stats.remediation.successful}
              tone={stats.remediation.successful > 0 ? "ok" : "neutral"}
              hint="Recorded outcome: SUCCESS"
            />
            <Stat
              label="Partial remediations"
              value={stats.remediation.partial}
              tone={stats.remediation.partial > 0 ? "warn" : "neutral"}
              hint="Recorded outcome: PARTIAL"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {/* ---------------------------------------------- recent findings */}
            <section className="rounded-lg border border-zinc-200 bg-white shadow-sm lg:col-span-2">
              <header className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
                <h2 className="text-sm font-semibold tracking-tight">Recent findings</h2>
                <Link href="/findings" className="text-xs font-medium text-sky-700 hover:underline">
                  View all {stats.totals.findings}
                </Link>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-zinc-100 text-[10px] uppercase tracking-wide text-zinc-500">
                      <th className="px-4 py-2 font-medium">Finding</th>
                      <th className="px-3 py-2 font-medium">Control</th>
                      <th className="px-3 py-2 font-medium">Severity</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 text-right font-medium">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((f) => (
                      <tr key={f.id} className="border-b border-zinc-50 last:border-0 hover:bg-zinc-50">
                        <td className="max-w-[22rem] px-4 py-2.5">
                          <Link
                            href={`/findings/${f.id}`}
                            className="block font-medium text-zinc-900 hover:text-sky-700"
                          >
                            {f.title}
                          </Link>
                          <span className="mt-0.5 block text-[11px] text-zinc-500">
                            <span className="font-mono">{f.id}</span> · {f.affectedSystem}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11px]">{f.controlId}</td>
                        <td className="px-3 py-2.5">
                          <Badge tone={severityTone(f.severity)}>{f.severity}</Badge>
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge tone={FINDING_STATUS_TONE[f.status] ?? "neutral"}>
                            {findingStatusLabel(f.status)}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-right text-zinc-500">
                          {timeAgo(f.updatedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* ---------------------------------------------- systemic issues */}
            <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
              <header className="border-b border-zinc-100 px-4 py-3">
                <h2 className="text-sm font-semibold tracking-tight">Systemic issues</h2>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Control families that recur, or have already failed once.
                </p>
              </header>
              {stats.systemic.length === 0 ? (
                <p className="px-4 py-4 text-xs text-zinc-500">
                  No control family has repeated yet.
                </p>
              ) : (
                <ul className="divide-y divide-zinc-50">
                  {stats.systemic.slice(0, 6).map((issue) => (
                    <li key={issue.controlFamily} className="px-4 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-zinc-900">
                          {issue.controlFamily}
                        </span>
                        <span className="text-[11px] text-zinc-500">
                          {countLabel(issue.findings, "finding")}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {issue.recurring > 0 && (
                          <Badge tone="danger">{issue.recurring} recurred</Badge>
                        )}
                        {issue.failed > 0 && <Badge tone="warn">{issue.failed} failed fix</Badge>}
                        <span className="font-mono text-[10px] text-zinc-400">
                          {issue.controls.join(" · ")}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* ------------------------------------------------ memory status */}
          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
              <header className="border-b border-zinc-100 px-4 py-3">
                <h2 className="text-sm font-semibold tracking-tight">Memory status across runs</h2>
              </header>
              <ul className="flex flex-col gap-2 px-4 py-3">
                {Object.keys(MEMORY_STATUS_COPY).map((key) => {
                  const meta = MEMORY_STATUS_COPY[key];
                  const n = stats.memory.byStatus[key] ?? 0;
                  const total = Math.max(1, stats.memory.analyzed);
                  return (
                    <li key={key} className="flex items-center gap-3">
                      <span className="w-40 shrink-0 text-xs font-medium text-zinc-800">
                        {meta.label}
                      </span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100">
                        <span
                          className={`block h-full rounded-full ${
                            meta.tone === "ok"
                              ? "bg-emerald-500"
                              : meta.tone === "warn"
                                ? "bg-amber-500"
                                : meta.tone === "danger"
                                  ? "bg-red-500"
                                  : "bg-zinc-400"
                          }`}
                          style={{ width: `${Math.round((n / total) * 100)}%` }}
                        />
                      </span>
                      <span className="tabular w-8 text-right text-xs text-zinc-600">{n}</span>
                    </li>
                  );
                })}
                {stats.memory.analyzed === 0 && (
                  <li className="text-xs text-zinc-500">
                    No analysis has been stored yet — run one from Investigate.
                  </li>
                )}
              </ul>
            </section>

            <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
              <header className="border-b border-zinc-100 px-4 py-3">
                <h2 className="text-sm font-semibold tracking-tight">Severity mix</h2>
              </header>
              <div className="grid grid-cols-2 gap-3 px-4 py-3">
                {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((severity) => (
                  <div key={severity} className="rounded-md border border-zinc-200 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <Badge tone={severityTone(severity)}>{severity}</Badge>
                      <span className="tabular text-lg font-semibold text-zinc-900">
                        {stats.severity[severity] ?? 0}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* ----------------------------------------------------- setup */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-zinc-200 pt-3 text-[11px] text-zinc-500">
            <span className="uppercase tracking-wide">Workspace setup</span>
            <Button variant="ghost" onClick={seedMemory} busy={busy === "seed"}>
              Re-seed historical memory
            </Button>
            <Button variant="ghost" onClick={loadSamples} busy={busy === "samples"}>
              Load sample findings
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
