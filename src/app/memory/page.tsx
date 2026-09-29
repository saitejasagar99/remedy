"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { api } from "@/app/lib/api";
import { countLabel, formatDateTime, truncate } from "@/app/lib/format";
import { MEMORY_STAGES, MEMORY_STAGE_LABEL, outcomeLabel, outcomeTone } from "@/app/lib/labels";
import type { FindingsListDto, Finding } from "@/app/types";
import type { RelevanceResult, StoredMemory } from "@/lib/memory/inspect";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  PageHeader,
  RelativeMatchBar,
} from "@/app/components/ui";

interface MemoriesPayload {
  memory: {
    available: boolean;
    reason?: string;
    items: StoredMemory[];
    total: number;
    stageCounts: Record<string, number>;
  };
  relevance: RelevanceResult | null;
  page: { limit: number; offset: number; total: number };
}

const PAGE_SIZE = 20;
const TABS = [{ key: "all", label: "All memory" }, ...MEMORY_STAGES.map((s) => ({ key: s, label: MEMORY_STAGE_LABEL[s] }))];

/** Headline of a retained memory: the self-contained sentence it leads with. */
function headline(text: string): string {
  const index = text.indexOf(" | ");
  return index > 0 ? text.slice(0, index) : text;
}

function body(text: string): string {
  const index = text.indexOf(" | ");
  return index > 0 ? text.slice(index + 3) : "";
}

export default function MemoryPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-500">
          Loading the memory inspector…
        </div>
      }
    >
      <MemoryInspector />
    </Suspense>
  );
}

function MemoryInspector() {
  // Read on the client only, so a deep link like /memory?case=102 never causes
  // a server/client markup mismatch.
  const caseParam = useSearchParams().get("case");

  const [tab, setTab] = useState<string>("all");
  const [query, setQuery] = useState(() => (caseParam ? `Case #${caseParam}` : ""));
  const [committed, setCommitted] = useState("");
  const [offset, setOffset] = useState(0);
  const [scoreAgainst, setScoreAgainst] = useState<string>("");
  const [payload, setPayload] = useState<MemoriesPayload | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scoring, setScoring] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [tick, setTick] = useState(0);

  /** The query actually sent: an explicit search wins over the deep link. */
  const effectiveQuery = committed || (caseParam ? `Case #${caseParam}` : "");

  useEffect(() => {
    let cancelled = false;
    api
      .get<FindingsListDto>("/api/findings")
      .then((res) => {
        if (cancelled) return;
        setFindings(res.findings);
        const recurring = res.findings.find((f) => f.recurrenceOf);
        setScoreAgainst((current) => current || (recurring ?? res.findings[0])?.id || "");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (tab !== "all") params.set("stage", tab);
    if (effectiveQuery) params.set("q", effectiveQuery);
    if (scoreAgainst) params.set("scoreAgainst", scoreAgainst);

    api
      .get<MemoriesPayload>(`/api/memories?${params.toString()}`)
      .then((res) => {
        if (!cancelled) {
          setPayload(res);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Memory could not be read");
      })
      .finally(() => {
        if (!cancelled) setScoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, effectiveQuery, offset, scoreAgainst, tick]);

  const memory = payload?.memory ?? null;
  const relevance = payload?.relevance ?? null;
  const relevanceByFact = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of relevance?.matches ?? []) {
      if (m.score !== null) map.set(m.factId, m.score);
    }
    return map;
  }, [relevance]);

  const relevantFinding = findings.find((f) => f.id === relevance?.findingId);

  const stageCounts = memory?.stageCounts ?? {};
  const showCounts = effectiveQuery.length === 0;

  return (
    <div className="remedy-rise">
      <PageHeader
        eyebrow="Memory"
        title="What the organisation remembers"
        description="Every item is a fact Hindsight extracted from a real retained record — findings, root causes, remediations, outcomes, recurrences and lessons. When the server cannot answer, REMEDY says so instead of inventing a memory."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-zinc-500"
              value={scoreAgainst}
              onChange={(e) => {
                setScoring(true);
                setScoreAgainst(e.target.value);
              }}
              aria-label="Score memory against a finding"
            >
              <option value="">No relevance scoring</option>
              {findings.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.controlId} — {f.title}
                </option>
              ))}
            </select>
            <Button variant="secondary" onClick={load}>
              Refresh
            </Button>
          </div>
        }
      />

      <ErrorNote message={error} />

      {/* ------------------------------------------------------ category tabs */}
      <div className="mb-4 flex flex-wrap gap-1.5 border-b border-zinc-200 pb-3">
        {TABS.map((t) => {
          const active = tab === t.key;
          const count = t.key === "all" ? (memory?.total ?? 0) : (stageCounts[t.key] ?? 0);
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setTab(t.key);
                setOffset(0);
              }}
              className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                active
                  ? "border-zinc-900 bg-zinc-900 font-medium text-white"
                  : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              {t.label}
              {showCounts && <span className={active ? "text-zinc-400" : "text-zinc-400"}> · {count}</span>}
            </button>
          );
        })}
      </div>

      {/* ------------------------------------------------------------ search */}
      <form
        className="mb-4 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setOffset(0);
          setCommitted(query.trim());
        }}
      >
        <input
          className="w-72 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-zinc-500"
          placeholder="Search memories — try “Case #102”…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search memories"
        />
        <Button type="submit" variant="secondary">Search</Button>
        {effectiveQuery && (
          <Button variant="ghost" onClick={() => { setQuery(""); setCommitted(""); setOffset(0); }}>
            Clear
          </Button>
        )}
        <span className="ml-auto text-xs text-zinc-500">
          {scoring
            ? "Scoring relevance against the selected finding…"
            : memory?.available
              ? countLabel(memory.total, "memory") + (scoreAgainst ? " · relevance scored" : "")
              : ""}
        </span>
      </form>

      {relevance && !relevance.available && (
        <div className="mb-4">
          <EmptyState
            tone="danger"
            title="Relevance scoring unavailable"
            body={`Historical memory temporarily unavailable: ${relevance.reason ?? "no reason returned"}. Memories are listed, but they could not be ranked against a finding.`}
          />
        </div>
      )}

      {relevance?.available && relevantFinding && (
        <p className="mb-4 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          Bars below show each memory&rsquo;s position against the strongest result of a single
          recall query for <strong>{relevantFinding.controlId} — {relevantFinding.title}</strong>.
          Scores are relative ordering signals, not similarity percentages.
        </p>
      )}

      {/* --------------------------------------------------------- unavailable */}
      {memory && !memory.available && (
        <EmptyState
          tone="danger"
          title="Historical memory temporarily unavailable."
          body={`REMEDY cannot read the memory bank right now: ${memory.reason ?? "no reason returned"}. This is different from having no history — the organisation may well have prior cases; they are simply unreachable at this moment.`}
          action={<Button variant="secondary" onClick={load}>Retry</Button>}
        />
      )}

      {/* ---------------------------------------------------------------- list */}
      {memory?.available && memory.items.length === 0 && (
        <EmptyState
          title={committed ? "No relevant organizational memory found." : "No memories in this category yet"}
          body={
            committed
              ? `Nothing in the bank matches “${committed}”. An empty result means the organisation has not seen this before — not that the memory layer failed.`
              : "Record an outcome on a finding and it will be retained here as organisational memory."
          }
          action={
            committed ? (
              <Button variant="secondary" onClick={() => { setQuery(""); setCommitted(""); }}>
                Clear search
              </Button>
            ) : (
              <Link href="/investigate" className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white">
                Run an investigation
              </Link>
            )
          }
        />
      )}

      {memory?.available && memory.items.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {memory.items.map((item) => {
            const score = relevanceByFact.get(item.factId) ?? null;
            const isOpen = Boolean(expanded[item.factId]);
            return (
              <article
                key={item.factId}
                className={`flex flex-col rounded-lg border bg-white shadow-sm ${
                  item.stage === "lesson"
                    ? "border-amber-300 ring-1 ring-amber-100"
                    : "border-zinc-200"
                }`}
              >
                <header className="flex flex-wrap items-center gap-1.5 border-b border-zinc-100 px-3 py-2">
                  <Badge tone="info">{item.stage ? MEMORY_STAGE_LABEL[item.stage] : "untagged"}</Badge>
                  {item.caseId && <Badge mono>#{item.caseId}</Badge>}
                  {item.outcome && (
                    <Badge tone={outcomeTone(item.outcome)}>{outcomeLabel(item.outcome)}</Badge>
                  )}
                  {item.recurrence && (
                    <Badge tone="danger">
                      recurred{item.daysToRecurrence ? ` · ${item.daysToRecurrence}d` : ""}
                    </Badge>
                  )}
                </header>

                <div className="flex flex-1 flex-col px-3 py-2.5">
                  <h3 className="text-xs font-semibold leading-snug text-zinc-900">
                    {headline(item.text)}
                  </h3>
                  <p className={`mt-1.5 text-xs leading-relaxed text-zinc-600 ${isOpen ? "" : "line-clamp-4"}`}>
                    {body(item.text) || item.text}
                  </p>
                  {item.text.length > 160 && (
                    <button
                      type="button"
                      className="mt-1 self-start text-[11px] font-medium text-sky-700 hover:underline"
                      onClick={() => setExpanded((e) => ({ ...e, [item.factId]: !isOpen }))}
                    >
                      {isOpen ? "Show less" : "Show full memory"}
                    </button>
                  )}

                  <dl className="mt-3 grid gap-y-1 text-[11px] text-zinc-500">
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0">Source</dt>
                      <dd className="text-zinc-700">
                        Hindsight · {item.type} fact
                        {item.controlId ? ` · ${item.controlId}` : ""}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0">Timestamp</dt>
                      <dd className="text-zinc-700">
                        {formatDateTime(item.occurredAt ?? item.mentionedAt)}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0">Finding</dt>
                      <dd className="font-mono text-zinc-700">{item.caseId ?? "—"}</dd>
                    </div>
                  </dl>

                  {score !== null && relevance && (
                    <div className="mt-2 border-t border-zinc-100 pt-2">
                      <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
                        Relevance to selected finding
                      </p>
                      <RelativeMatchBar score={score} topScore={relevance.topScore} />
                    </div>
                  )}
                  {scoreAgainst && score === null && relevance?.available && (
                    <p className="mt-2 border-t border-zinc-100 pt-2 text-[11px] text-zinc-400">
                      not recalled for that finding
                    </p>
                  )}

                  {item.stage === "lesson" && (
                    <p className="mt-2 border-t border-zinc-100 pt-2 text-[10px] uppercase tracking-wide text-amber-700">
                      Retained lesson — used by future recalls on this control
                    </p>
                  )}
                </div>

                <footer className="border-t border-zinc-100 px-3 py-1.5 text-[10px] text-zinc-400">
                  fact id <span className="font-mono">{truncate(item.factId, 18)}</span>
                </footer>
              </article>
            );
          })}
        </div>
      )}

      {/* -------------------------------------------------------- pagination */}
      {memory?.available && memory.total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between gap-3 text-xs">
          <Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            ← Previous
          </Button>
          <span className="tabular text-zinc-500">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, memory.total)} of {memory.total}
          </span>
          <Button
            variant="secondary"
            disabled={offset + PAGE_SIZE >= memory.total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next →
          </Button>
        </div>
      )}

      <p className="mt-6 border-t border-zinc-200 pt-4 text-[11px] leading-relaxed text-zinc-500">
        REMEDY shows memory as facts with case ids, outcomes and timestamps. It does not show a
        model&rsquo;s chain of thought, because none is stored or retrieved — only evidence,
        decisions and results are.
      </p>
    </div>
  );
}
