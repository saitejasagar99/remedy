"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { api } from "@/app/lib/api";
import { loadSampleFindings } from "@/app/lib/samples";
import { countLabel, timeAgo } from "@/app/lib/format";
import { FINDING_STATUS_TONE, findingStatusLabel, severityTone } from "@/app/lib/labels";
import type { AnalysisSummary, FindingsListDto, Finding } from "@/app/types";
import { FindingExperience } from "@/app/components/finding-experience";
import { FindingForm } from "@/app/components/WorkflowPanels";
import { Badge, Button, EmptyState, ErrorNote, PageHeader } from "@/app/components/ui";

/**
 * The investigation console.
 *
 * A thin selector over the same experience the Findings detail route renders —
 * the workflow itself is never duplicated, so the two entry points cannot show
 * different answers for the same finding.
 */
export default function InvestigatePage() {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [summaries, setSummaries] = useState<Record<string, AnalysisSummary>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  // First paint is not evidence of an empty workspace, so the picker waits for
  // one response before it claims there is nothing to investigate.
  const [loaded, setLoaded] = useState(false);

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
        setSelected((current) => {
          if (current && res.findings.some((f) => f.id === current)) return current;
          // Prefer a recurring finding when one exists — it is where memory has
          // the most to say — otherwise the newest record.
          const recurring = res.findings.find((f) => f.recurrenceOf);
          return (recurring ?? res.findings[0])?.id ?? null;
        });
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load findings");
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const reload = () => setTick((t) => t + 1);

  const current = useMemo(
    () => findings.find((f) => f.id === selected) ?? null,
    [findings, selected],
  );

  async function ensureSamples() {
    setBusy(true);
    setError(null);
    try {
      const result = await loadSampleFindings();
      setShowForm(false);
      reload();
      if (result.created > 0) {
        setError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create sample findings");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="remedy-rise">
      <PageHeader
        eyebrow="Investigate"
        title="Run the workflow"
        description="Pick a finding, see what happened last time this control was fixed, approve the recommendation, then record the outcome that goes back into memory."
        actions={
          <>
            <Button variant="secondary" onClick={() => setShowForm((v) => !v)}>
              {showForm ? "Close form" : "File a finding"}
            </Button>
            <Link
              href="/findings"
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700"
            >
              Open findings table
            </Link>
          </>
        }
      />

      <ErrorNote message={error} />

      {showForm && (
        <div className="mb-4">
          <FindingForm
            compact
            onCreated={(id) => {
              setShowForm(false);
              setSelected(id);
              reload();
            }}
          />
        </div>
      )}

      {!loaded && !error ? (
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-10 text-center text-xs text-zinc-500">
          Loading findings…
        </div>
      ) : findings.length === 0 && !error ? (
        <EmptyState
          title="No findings to investigate"
          body="Start from a real finding with real evidence. Load the example set, or file one yourself — both go through the normal API."
          action={
            <Button onClick={ensureSamples} busy={busy}>
              Load sample findings
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
          {/* ------------------------------------------------ finding picker */}
          <aside className="h-fit rounded-lg border border-zinc-200 bg-white shadow-sm lg:sticky lg:top-4">
            <header className="border-b border-zinc-100 px-3 py-2.5">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-600">
                Findings
              </h2>
              <p className="mt-0.5 text-[11px] text-zinc-500">{countLabel(findings.length, "record")}</p>
            </header>
            <ul className="max-h-[70vh] divide-y divide-zinc-100 overflow-y-auto">
              {findings.map((f) => {
                const summary = summaries[f.id];
                const active = f.id === selected;
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(f.id)}
                      className={`w-full px-3 py-2.5 text-left transition-colors ${
                        active ? "bg-zinc-900" : "hover:bg-zinc-50"
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        <Badge tone={severityTone(f.severity)}>{f.severity}</Badge>
                        {f.recurrenceOf && <Badge tone="danger">Recurring</Badge>}
                        {summary?.memoryInfluenced && <Badge tone="info">memory</Badge>}
                      </span>
                      <span
                        className={`mt-1 block text-xs font-medium leading-snug ${
                          active ? "text-white" : "text-zinc-900"
                        }`}
                      >
                        {f.title}
                      </span>
                      <span
                        className={`mt-0.5 block font-mono text-[10px] ${
                          active ? "text-zinc-400" : "text-zinc-500"
                        }`}
                      >
                        {f.controlId} · {timeAgo(f.updatedAt)}
                      </span>
                      <span
                        className={`mt-1 block text-[10px] ${
                          active ? "text-zinc-300" : "text-zinc-500"
                        }`}
                      >
                        <Badge tone={FINDING_STATUS_TONE[f.status] ?? "neutral"}>
                          {findingStatusLabel(f.status)}
                        </Badge>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-zinc-100 px-3 py-2.5">
              <Link href="/findings" className="text-[11px] font-medium text-sky-700 hover:underline">
                Open the full findings table →
              </Link>
            </div>
          </aside>

          {/* ------------------------------------------------- experience */}
          <div className="min-w-0">
            {selected ? (
              <FindingExperience key={selected} findingId={selected} onChanged={reload} />
            ) : (
              <EmptyState
                title="Select a finding"
                body="Choose a record from the list to begin an investigation."
              />
            )}
          </div>
        </div>
      )}

      {current && !showForm && (
        <p className="mt-4 text-[11px] text-zinc-500">
          Currently investigating {current.id} — {current.title}
        </p>
      )}
    </div>
  );
}
