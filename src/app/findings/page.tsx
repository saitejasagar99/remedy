"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { api } from "@/app/lib/api";
import { loadSampleFindings, SAMPLE_FINDINGS } from "@/app/lib/samples";
import {
  FINDING_STATUS_TONE,
  categoryLabel,
  findingStatusLabel,
  severityTone,
} from "@/app/lib/labels";
import { countLabel, timeAgo } from "@/app/lib/format";
import type { AnalysisSummary, FindingsListDto, Finding } from "@/app/types";
import { Badge, Button, EmptyState, ErrorNote, PageHeader } from "@/app/components/ui";

const SEVERITIES = ["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

/**
 * Statuses in the order a reviewer meets them: what is untouched, what needs a
 * decision, what is moving, what is closed.
 */
const STATUSES = [
  "ALL",
  "OPEN",
  "AWAITING_APPROVAL",
  "REMEDIATING",
  "VERIFYING",
  "RESOLVED",
  "RECURRED",
] as const;

/** What the Memory column can say, given one stored analysis. */
function MemoryCell({ summary }: { summary?: AnalysisSummary }) {
  if (!summary) {
    return (
      <span className="text-[11px] text-zinc-400" title="Run the pipeline to analyse this finding">
        not analysed
      </span>
    );
  }
  if (summary.memoryStatus === "UNAVAILABLE") {
    return <Badge tone="danger">history unavailable</Badge>;
  }
  if (!summary.memoryInfluenced) {
    return <Badge tone="neutral">no relevant history</Badge>;
  }
  // Two lines rather than one long row: stacking the flags keeps the column
  // narrow enough that the whole table fits without sideways scrolling.
  return (
    <span className="flex flex-col items-start gap-1">
      <Badge tone={summary.changed ? "info" : "neutral"}>
        {countLabel(summary.casesUsed, "historical match")}
      </Badge>
      {(summary.changed || summary.rejected > 0) && (
        <span className="flex flex-wrap items-center gap-1">
          {summary.changed && <Badge tone="warn">answer changed</Badge>}
          {summary.rejected > 0 && (
            <Badge tone="danger">{summary.rejected} fix rejected</Badge>
          )}
        </span>
      )}
    </span>
  );
}

function FindingsView() {
  const router = useRouter();
  // Deep-linked so the dashboard can send a reviewer straight to a queue.
  const params = useSearchParams();
  const statusParam = params.get("status");
  const recurringParam = params.get("recurring");

  const [findings, setFindings] = useState<Finding[]>([]);
  const [summaries, setSummaries] = useState<Record<string, AnalysisSummary>>({});
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  // Distinguishes "still fetching" from "the workspace really is empty" —
  // without it, first paint tells a user with eight findings that there are none.
  const [loaded, setLoaded] = useState(false);

  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>("ALL");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>(
    statusParam && (STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as (typeof STATUSES)[number])
      : "ALL",
  );
  const [recurringOnly, setRecurringOnly] = useState(recurringParam === "1");

  // Not wrapped in `useCallback`: the compiler memoises this itself, and the
  // explicit empty dependency list only ever fought with that inference.
  const load = () => setTick((t) => t + 1);

  useEffect(() => {
    let cancelled = false;
    api
      .get<FindingsListDto>("/api/findings")
      .then((res) => {
        if (cancelled) return;
        setFindings(res.findings);
        setSummaries(res.summaries ?? {});
        setError(null);
        setLoaded(true);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load findings");
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return findings.filter((f) => {
      if (severity !== "ALL" && f.severity !== severity) return false;
      if (status !== "ALL" && f.status !== status) return false;
      if (recurringOnly && !f.recurrenceOf && f.status !== "RECURRED") return false;
      if (!needle) return true;
      return [f.id, f.controlId, f.title, f.affectedSystem, categoryLabel(f.category)]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [findings, query, severity, status, recurringOnly]);

  async function loadSamples() {
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      const result = await loadSampleFindings();
      setNote(
        `Workspace ready: ${result.created} finding(s) created, ${result.alreadyPresent} already present.`,
      );
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create sample findings");
    } finally {
      setBusy(false);
    }
  }

  const input =
    "rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-zinc-500";

  return (
    <div className="remedy-rise">
      <PageHeader
        eyebrow="Findings"
        title="Everything on record"
        description="Open a finding to see its evidence, its root cause, what history says about it, and the recommendation waiting on a decision."
        actions={
          <Link
            href="/investigate"
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700"
          >
            Investigate a finding
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          className={`${input} w-64`}
          placeholder="Search title, control, system…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search findings"
        />
        <select
          className={input}
          value={severity}
          onChange={(e) => setSeverity(e.target.value as (typeof SEVERITIES)[number])}
          aria-label="Filter by severity"
        >
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s === "ALL" ? "All severities" : s.charAt(0) + s.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
        <select
          className={input}
          value={status}
          onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])}
          aria-label="Filter by status"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === "ALL" ? "All statuses" : findingStatusLabel(s)}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-zinc-700">
          <input
            type="checkbox"
            checked={recurringOnly}
            onChange={(e) => setRecurringOnly(e.target.checked)}
          />
          Recurring only
        </label>
        <span className="ml-auto text-xs text-zinc-500">
          {!loaded
            ? "Loading…"
            : `${countLabel(rows.length, "finding")}${
                rows.length !== findings.length ? ` of ${findings.length}` : ""
              }`}
        </span>
      </div>

      <ErrorNote message={error} />
      {note && (
        <div className="mb-3">
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            {note}
          </p>
        </div>
      )}

      {!loaded && !error && (
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-10 text-center text-xs text-zinc-500">
          Loading findings…
        </div>
      )}

      {loaded && findings.length === 0 && !error && (
        <EmptyState
          title="No findings on record yet"
          body={`Load ${SAMPLE_FINDINGS.length} example compliance findings to fill the workspace, or file one yourself from Investigate.`}
          action={
            <Button onClick={loadSamples} busy={busy}>
              Load sample findings
            </Button>
          }
        />
      )}

      {findings.length > 0 && rows.length === 0 && (
        <EmptyState
          title="No finding matches these filters"
          body="Clear the search or widen the severity or status filter. Nothing has been removed — the findings still exist."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setQuery("");
                setSeverity("ALL");
                setStatus("ALL");
                setRecurringOnly(false);
              }}
            >
              Clear filters
            </Button>
          }
        />
      )}

      {rows.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-xs">
              <thead className="bg-zinc-50">
                <tr className="border-b border-zinc-200 text-[10px] uppercase tracking-wide text-zinc-500">
                  <th className="px-4 py-2.5 font-medium">Finding</th>
                  <th className="px-3 py-2.5 font-medium">Control</th>
                  <th className="px-3 py-2.5 font-medium">Severity</th>
                  <th className="px-3 py-2.5 font-medium">System</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Recurrence</th>
                  <th className="px-3 py-2.5 font-medium">Memory</th>
                  <th className="hidden px-3 py-2.5 text-right font-medium xl:table-cell">
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <tr
                    key={f.id}
                    onClick={() => router.push(`/findings/${f.id}`)}
                    className="cursor-pointer border-b border-zinc-100 transition-colors last:border-0 hover:bg-zinc-50"
                  >
                    <td className="max-w-[17rem] px-4 py-3">
                      <span className="block font-medium leading-snug text-zinc-900">{f.title}</span>
                      <span className="mt-0.5 block text-[11px] text-zinc-500">
                        <span className="font-mono">{f.id}</span> · {categoryLabel(f.category)}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono text-[11px]">{f.controlId}</td>
                    <td className="px-2.5 py-3">
                      <Badge tone={severityTone(f.severity)}>{f.severity}</Badge>
                    </td>
                    <td className="max-w-[9rem] px-2.5 py-3 text-zinc-600 [overflow-wrap:anywhere]">
                      {f.affectedSystem}
                    </td>
                    <td className="px-2.5 py-3">
                      <Badge tone={FINDING_STATUS_TONE[f.status] ?? "neutral"}>
                        {findingStatusLabel(f.status)}
                      </Badge>
                    </td>
                    <td className="px-2.5 py-3">
                      {f.recurrenceOf || f.status === "RECURRED" ? (
                        <Badge tone="danger">Recurring</Badge>
                      ) : (
                        <span className="text-[11px] text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="w-[14rem] px-2.5 py-3">
                      <MemoryCell summary={summaries[f.id]} />
                    </td>
                    <td className="hidden px-3 py-3 text-right text-zinc-500 xl:table-cell">
                      {timeAgo(f.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * `useSearchParams` needs a Suspense boundary when the route is statically
 * rendered; the fallback matches the filter bar so nothing jumps on load.
 */
export default function FindingsPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-500">
          Loading findings…
        </div>
      }
    >
      <FindingsView />
    </Suspense>
  );
}
