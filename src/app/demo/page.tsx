"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { api } from "@/app/lib/api";
import { formatDate, formatDateTime } from "@/app/lib/format";
import { categoryLabel, humanize, outcomeLabel, outcomeTone } from "@/app/lib/labels";
import type { StoredMemory } from "@/lib/memory/inspect";
import { LifecycleTrack } from "@/app/components/recurrence";
import { Badge, Button, Callout, EmptyState, ErrorNote, PageHeader } from "@/app/components/ui";

/* ------------------------------------------------------------------ demo data
 *
 * Deterministic on purpose. The walkthrough must tell the same story every
 * time it is run in front of an audience, so the wording of each step is fixed
 * rather than generated. The integration underneath is still real: step 1 reads
 * the seeded case out of Hindsight, step 11 writes a lesson back, and step 12
 * reads it again. No step depends on a model responding.
 * -------------------------------------------------------------------------- */

const HISTORY = {
  caseId: "102",
  controlId: "AC-2(3)",
  category: "PRIVILEGED_ACCESS",
  system: "Okta + SAP SuccessFactors integration",
  title: "12 inactive employees retain privileged access",
  rootCause:
    "HR to IAM synchronization failure: the deprovisioning pipeline processed employee records only, so terminated identities were never revoked.",
  remediation: "Automate HR to IAM deprovisioning on termination event",
  outcome: "FAILURE" as const,
  daysToRecurrence: 43,
  lesson:
    "Contractor identities were excluded from the synchronization pipeline. Event-driven revocation is required for every identity type.",
};

const NEW_FINDING = {
  id: "CF-DEMO-1187",
  controlId: "AC-2(3)",
  category: "PRIVILEGED_ACCESS",
  system: "Okta + SAP SuccessFactors integration",
  severity: "HIGH",
  title: "8 inactive employees again retain privileged access",
  description:
    "The following quarter's review found 8 employees terminated in the last 45 days still holding privileged access, despite the deprovisioning job reporting success on every run.",
  evidence: [
    "IAM entitlement export: 8 accounts of employees terminated within 45 days still hold privileged roles.",
    "Deprovisioning job logs: every scheduled run completed with status SUCCESS and processed 0 contractor identities.",
    "HR roster comparison: 19 contractor identities active in HR are absent from the job's input set.",
  ],
  rootCause:
    "The deprovisioning job reads the employee roster only. Contractor identities are outside its input set, so revocation never fires for them — the same gap that produced the previous incident.",
};

const WITHOUT_MEMORY =
  "Automate HR to IAM deprovisioning so inactive employees lose privileged access.";

const WITH_MEMORY =
  "Do not re-run the automated HR to IAM deprovisioning fix as-is. First verify synchronization coverage for contractor identities, then apply event-driven revocation at the identity provider for every identity type.";

const WHY_CHANGED =
  "History vetoed the obvious fix. Case #102 applied this exact remediation, passed verification, and the finding still returned after 43 days because contractor identities were outside the synchronization scope. The current evidence shows the same gap, so repeating the same fix would reproduce the same failure.";

const FUTURE_FINDING = {
  controlId: "AC-2(3)",
  title: "6 contractor accounts remain active after contract end",
  evidence:
    "Contractor identities are present in the HR roster but absent from the deprovisioning job's input set.",
};

const FUTURE_QUERY =
  "contractor identities synchronization coverage event-driven revocation privileged access AC-2(3)";

const FUTURE_WITHOUT_MEMORY = WITHOUT_MEMORY;
const FUTURE_WITH_MEMORY =
  "Enforce event-driven revocation at the identity provider for every identity type, and add contractor identities to the synchronization scope before relying on scheduled deprovisioning.";

interface Step {
  n: number;
  title: string;
  caption: string;
}

const STEPS: Step[] = [
  { n: 1, title: "Historical case", caption: "Case #102 stored in Hindsight" },
  { n: 2, title: "New finding", caption: "Same control fails again" },
  { n: 3, title: "No memory", caption: "Stateless recommendation A" },
  { n: 4, title: "Recall history", caption: "Hindsight returns prior cases" },
  { n: 5, title: "Changed answer", caption: "Recommendation B" },
  { n: 6, title: "Why it changed", caption: "Cases, outcomes, lessons" },
  { n: 7, title: "Approve", caption: "Human gate" },
  { n: 8, title: "Remediate", caption: "Simulated implementation" },
  { n: 9, title: "Verify", caption: "Did it work?" },
  { n: 10, title: "Outcome", caption: "SUCCESS recorded" },
  { n: 11, title: "Memory update", caption: "Retained to Hindsight" },
  { n: 12, title: "Future finding", caption: "Better next recommendation" },
];

async function getStoredMemories(q: string): Promise<{
  status: "ok" | "down";
  items: StoredMemory[];
  reason?: string;
}> {
  try {
    const res = await api.get<{
      memory: { available: boolean; items: StoredMemory[]; reason?: string };
    }>(`/api/memories?limit=10&q=${encodeURIComponent(q)}`);
    if (!res.memory.available) {
      return { status: "down", items: [], reason: res.memory.reason };
    }
    return { status: "ok", items: res.memory.items };
  } catch (e) {
    return {
      status: "down",
      items: [],
      reason: e instanceof Error ? e.message : "Hindsight unreachable",
    };
  }
}

/* ------------------------------------------------------------------- panels */

function Panel({
  kicker,
  title,
  children,
  tone = "neutral",
}: {
  kicker: string;
  title: string;
  children: ReactNode;
  tone?: "neutral" | "danger" | "ok" | "warn" | "info";
}) {
  const accent = {
    neutral: "border-zinc-300",
    danger: "border-red-300",
    ok: "border-emerald-300",
    warn: "border-amber-300",
    info: "border-sky-300",
  }[tone];

  return (
    <section className={`rounded-lg border ${accent} bg-white shadow-sm`}>
      <header className="border-b border-zinc-100 px-5 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          {kicker}
        </p>
        <h2 className="mt-0.5 text-base font-semibold tracking-tight text-zinc-900">{title}</h2>
      </header>
      <div className="px-5 py-4 text-sm">{children}</div>
    </section>
  );
}

function DataRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-1 text-xs">
      <span className="w-40 shrink-0 text-zinc-500">{label}</span>
      <span className="min-w-0 flex-1 text-zinc-800">{children}</span>
    </div>
  );
}

/* -------------------------------------------------------------------- page */

export default function DemoPage() {
  const [step, setStep] = useState(1);
  const [approved, setApproved] = useState(false);
  const [decision, setDecision] = useState<string | null>(null);
  const [history, setHistory] = useState<{
    status: "loading" | "ok" | "down";
    found?: number;
    sample?: string;
    reason?: string;
  }>({ status: "loading" });
  const [retain, setRetain] = useState<{
    status: "idle" | "writing" | "ok" | "down";
    written?: number;
    alreadyPresent?: boolean;
    factId?: string;
    text?: string;
    reason?: string;
  }>({ status: "idle" });
  const [future, setFuture] = useState<{
    status: "idle" | "loading" | "ok" | "down";
    items?: StoredMemory[];
    reason?: string;
  }>({ status: "idle" });
  const [error, setError] = useState<string | null>(null);

  /* --- step 1: prove the historical case actually exists in Hindsight ---
   *
   * Fired on mount (the walkthrough always opens on step 1) with the loading
   * state declared inline, so the effect body itself only ever resolves into a
   * callback — no synchronous state update, no cascade.
   */
  useEffect(() => {
    let cancelled = false;
    getStoredMemories(`Case #${HISTORY.caseId}`).then((res) => {
      if (cancelled) return;
      if (res.status === "down") {
        setHistory({ status: "down", reason: res.reason });
      } else {
        setHistory({
          status: "ok",
          found: res.items.length,
          sample: res.items[0]?.text,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* --- step 11: actually write the lesson back --- */
  const startRetain = useCallback(() => {
    if (retain.status !== "idle") return;
    setRetain({ status: "writing" });
    api
      .post<{
        memory: {
          ok: boolean;
          written: number;
          alreadyPresent?: boolean;
          factId?: string;
          text?: string;
          reason?: string;
        };
      }>("/api/memories", {
        caseId: "901",
        controlId: HISTORY.controlId,
        lesson:
          "Before reusing an automated HR to IAM deprovisioning fix on AC-2(3), verify synchronization coverage for every identity type — including contractors — and enforce event-driven revocation at the identity provider.",
        dedupe: true,
      })
      .then((res) => {
        const m = res.memory;
        if (!m.ok) {
          setRetain({ status: "down", reason: m.reason });
        } else {
          setRetain({
            status: "ok",
            written: m.written,
            alreadyPresent: Boolean(m.alreadyPresent),
            factId: m.factId,
            text: m.text,
          });
        }
      })
      .catch((e: unknown) => {
        setRetain({
          status: "down",
          reason: e instanceof Error ? e.message : "The write to Hindsight failed",
        });
      });
  }, [retain.status]);

  /* --- step 12: read the memory back to show the loop closes --- */
  const startFutureRecall = useCallback(() => {
    if (future.status !== "idle") return;
    setFuture({ status: "loading" });
    getStoredMemories(FUTURE_QUERY).then((res) => {
      if (res.status === "down") setFuture({ status: "down", reason: res.reason });
      else setFuture({ status: "ok", items: res.items });
    });
  }, [future.status]);

  /** Move to any step, starting whichever live Hindsight call that step needs. */
  const goto = useCallback(
    (target: number) => {
      const next = Math.min(STEPS.length, Math.max(1, target));
      setStep(next);
      if (next === 11) startRetain();
      if (next === 12) startFutureRecall();
    },
    [startRetain, startFutureRecall],
  );

  const restart = useCallback(() => {
    setApproved(false);
    setDecision(null);
    setRetain({ status: "idle" });
    setFuture({ status: "idle" });
    setError(null);
    setStep(1);
  }, []);

  const current = STEPS.find((s) => s.n === step) ?? STEPS[0];

  const lifecycleStatus = !approved
    ? "PROPOSED"
    : step >= 11
      ? "SUCCESSFUL"
      : step >= 9
        ? "VERIFIED"
        : step >= 8
          ? "IMPLEMENTED"
          : "APPROVED";

  const outcome = step >= 10 ? "SUCCESS" : null;

  function advance() {
    setError(null);
    goto(step + 1);
  }

  function goBack() {
    setError(null);
    goto(step - 1);
  }

  function approve(value: string) {
    setDecision(value);
    setApproved(value === "APPROVED");
    if (value === "APPROVED") advance();
    else setError(`Recorded "${value}". In a real run the workflow would stop here for a human to resolve.`);
  }

  /* --------------------------------------------------------- step content */
  function renderStep() {
    switch (step) {
      case 1:
        return (
          <Panel kicker="Step 01 · historical memory" title="The organisation already fixed this once — and it did not hold." tone="warn">
            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <DataRow label="Case id"><span className="font-mono">#{HISTORY.caseId}</span></DataRow>
                <DataRow label="Finding">{HISTORY.title}</DataRow>
                <DataRow label="Control">
                  {HISTORY.controlId} · {categoryLabel(HISTORY.category)}
                </DataRow>
                <DataRow label="System">{HISTORY.system}</DataRow>
                <DataRow label="Root cause">{HISTORY.rootCause}</DataRow>
                <DataRow label="Remediation">{HISTORY.remediation}</DataRow>
                <DataRow label="Outcome">
                  <Badge tone={outcomeTone(HISTORY.outcome)}>{outcomeLabel(HISTORY.outcome)}</Badge>
                  <span className="ml-2">the finding returned after {HISTORY.daysToRecurrence} days</span>
                </DataRow>
                <DataRow label="Lesson">
                  <span className="border-l-2 border-amber-400 pl-2">{HISTORY.lesson}</span>
                </DataRow>
              </div>

              <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Stored in Hindsight — verified live
                </p>
                {history.status === "loading" ? (
                  <p className="mt-2 flex items-center gap-2 text-xs text-zinc-600">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-sky-500" />
                    Querying the memory bank…
                  </p>
                ) : history.status === "down" ? (
                  <p className="mt-2 text-xs text-red-700">
                    Historical memory temporarily unavailable: {history.reason}. The walkthrough
                    continues from the stored case record — REMEDY does not invent one.
                  </p>
                ) : (
                  <>
                    <p className="mt-2 text-xs text-zinc-700">
                      <strong className="tabular">{history.found}</strong> memor{history.found === 1 ? "y" : "ies"} matched
                      <span className="font-mono"> Case #{HISTORY.caseId}</span>.
                    </p>
                    {history.sample && (
                      <p className="mt-2 max-h-32 overflow-y-auto rounded border border-zinc-200 bg-white p-2 text-[11px] leading-relaxed text-zinc-600">
                        {history.sample}
                      </p>
                    )}
                    <p className="mt-2 text-[11px] text-zinc-500">
                      Read live from <span className="font-mono">bank:remedy</span> — this is a real
                      query, not a mock.
                    </p>
                  </>
                )}
              </div>
            </div>
          </Panel>
        );

      case 2:
        return (
          <Panel kicker="Step 02 · new finding" title="The same control fails again, one quarter later." tone="info">
            <DataRow label="Finding id"><span className="font-mono">{NEW_FINDING.id}</span></DataRow>
            <DataRow label="Control">
              {NEW_FINDING.controlId} · {categoryLabel(NEW_FINDING.category)}
            </DataRow>
            <DataRow label="Severity"><Badge tone="danger">{NEW_FINDING.severity}</Badge></DataRow>
            <DataRow label="Finding">{NEW_FINDING.title}</DataRow>
            <DataRow label="System">{NEW_FINDING.system}</DataRow>
            <p className="mt-2 text-xs text-zinc-600">{NEW_FINDING.description}</p>
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Evidence</p>
            <ul className="mt-1 flex flex-col gap-1.5">
              {NEW_FINDING.evidence.map((e) => (
                <li key={e} className="rounded border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-700">
                  {e}
                </li>
              ))}
            </ul>
            <DataRow label="Root cause">{NEW_FINDING.rootCause}</DataRow>
          </Panel>
        );

      case 3:
        return (
          <Panel kicker="Step 03 · without hindsight memory" title="What any agent would say having seen only this finding." tone="neutral">
            <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50/70 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Recommendation A — stateless
                </span>
                <Badge>no history consulted</Badge>
              </div>
              <p className="text-sm leading-relaxed text-zinc-800">{WITHOUT_MEMORY}</p>
            </div>
            <p className="mt-3 text-xs text-zinc-600">
              Plausible. Textbook. And it is precisely the fix that already failed on this control.
              Nothing in this answer knows that, because nothing in this answer has seen the past.
            </p>
          </Panel>
        );

      case 4:
        return (
          <Panel kicker="Step 04 · hindsight recall" title="History is now consulted — and it disagrees." tone="warn">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-md border border-red-200 bg-red-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-red-700">Case #102 · FAILED</p>
                <p className="mt-1 text-xs text-zinc-800">{HISTORY.remediation}</p>
                <p className="mt-1 text-[11px] text-zinc-600">recurred after {HISTORY.daysToRecurrence} days</p>
              </div>
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Case #087 · SUCCESS</p>
                <p className="mt-1 text-xs text-zinc-800">Event-driven revocation wired to the termination feed</p>
                <p className="mt-1 text-[11px] text-zinc-600">held for 180 days, no recurrence</p>
              </div>
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Case #091 · PARTIAL</p>
                <p className="mt-1 text-xs text-zinc-800">Scheduled export extended to contractors</p>
                <p className="mt-1 text-[11px] text-zinc-600">reduced the gap, did not close it</p>
              </div>
            </div>
            <Callout tone="warn" title="Conflict detected between memory and current evidence">
              The current evidence still points at the same fix history rejected. REMEDY surfaces
              the disagreement rather than quietly picking a side — a human resolves it.
            </Callout>
          </Panel>
        );

      case 5:
        return (
          <Panel kicker="Step 05 · memory changed the answer" title="Same finding, different memory, different recommendation." tone="info">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50/70 p-3">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  A · without memory
                </p>
                <p className="text-sm leading-relaxed text-zinc-700">{WITHOUT_MEMORY}</p>
              </div>
              <div className="rounded-md border border-amber-400 bg-amber-50 p-3">
                <p className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                  B · with hindsight memory <Badge tone="warn">CHANGED</Badge>
                </p>
                <p className="text-sm font-medium leading-relaxed text-zinc-900">{WITH_MEMORY}</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-zinc-600">
              B does not merely restate A with a warning attached. History removed an action A
              proposed and inserted a validation step A never mentioned.
            </p>
          </Panel>
        );

      case 6:
        return (
          <Panel kicker="Step 06 · why the decision changed" title="Provenance, not a reasoning trace." tone="neutral">
            <div className="rounded-md border border-zinc-300 bg-white p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Why the decision changed</p>
              <p className="mt-1 text-xs leading-relaxed text-zinc-700">{WHY_CHANGED}</p>
            </div>

            <p className="mt-3 mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Cases cited
            </p>
            <ul className="flex flex-col gap-2">
              <li className="rounded border border-zinc-200 p-2.5 text-xs">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold">Historical Case #102</span>
                  <Badge tone="danger">FAILED</Badge>
                  <Badge tone="danger">recurred after 43 days</Badge>
                </div>
                <p><span className="text-zinc-500">Fix attempted: </span>{HISTORY.remediation}</p>
                <p className="mt-0.5"><span className="text-zinc-500">Lesson: </span>{HISTORY.lesson}</p>
              </li>
              <li className="rounded border border-zinc-200 p-2.5 text-xs">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold">Historical Case #087</span>
                  <Badge tone="ok">SUCCESS</Badge>
                </div>
                <p><span className="text-zinc-500">Fix attempted: </span>Event-driven revocation wired to the termination feed</p>
                <p className="mt-0.5"><span className="text-zinc-500">Lesson: </span>Scheduled reconciliation leaves a window; event-driven revocation closes it.</p>
              </li>
            </ul>

            <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                Rejected prior action — history vetoed this
              </p>
              <p className="mt-1 text-xs line-through decoration-red-400">{HISTORY.remediation}</p>
              <p className="mt-1 text-xs text-zinc-700">
                Case #102 applied it, verification passed, and the finding still returned after 43
                days.
              </p>
            </div>
          </Panel>
        );

      case 7:
        return (
          <Panel kicker="Step 07 · human approval" title="Nothing happens until a person decides." tone="warn">
            <Callout tone="warn" title="Simulated remediation — approval required">
              REMEDY never modifies real infrastructure and never executes model output. Approving
              records a human decision and advances the lifecycle.
            </Callout>

            <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                Recommendation on the table
              </p>
              <p className="mt-1 text-xs font-medium leading-relaxed text-zinc-900">{WITH_MEMORY}</p>
            </div>

            {decision ? (
              <div className="mt-3 rounded-md border border-zinc-300 p-3 text-xs">
                <Badge tone={decision === "APPROVED" ? "ok" : "danger"}>{humanize(decision)}</Badge>{" "}
                <span className="text-zinc-700">recorded by security-compliance-engineer.</span>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => approve("APPROVED")}>Approve</Button>
                <Button variant="secondary" onClick={() => approve("REQUEST_MORE_EVIDENCE")}>
                  Request more evidence
                </Button>
                <Button variant="danger" onClick={() => approve("REJECTED")}>Reject</Button>
              </div>
            )}
          </Panel>
        );

      case 8:
        return (
          <Panel kicker="Step 08 · remediation" title="The fix is implemented — in simulation only." tone="neutral">
            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs">
              <p className="text-zinc-500">Implemented action</p>
              <p className="mt-1 text-sm font-medium text-zinc-900">{WITH_MEMORY}</p>
            </div>
            <ul className="mt-3 flex flex-col gap-1.5 text-xs text-zinc-700">
              <li>✓ Contractor identities added to the synchronization input set</li>
              <li>✓ Event-driven revocation listener attached to the termination feed</li>
              <li>✓ Alerting added on synchronization job failure and zero-identity runs</li>
            </ul>
            <p className="mt-3 text-[11px] text-zinc-500">
              Applied at {formatDateTime(new Date().toISOString())} · simulated · no real system was
              contacted.
            </p>
          </Panel>
        );

      case 9:
        return (
          <Panel kicker="Step 09 · verification" title="Did it actually work? Evidence is required." tone="info">
            <DataRow label="Method">
              <Badge tone="info">Automated rescan</Badge>
            </DataRow>
            <DataRow label="Verifier">security-compliance-engineer</DataRow>
            <DataRow label="Result"><Badge tone="ok">PASS</Badge></DataRow>
            <DataRow label="Evidence">
              Rescan of the IAM entitlement export returns zero privileged roles held by identities
              terminated in the last 45 days, across employees and contractors.
            </DataRow>
            <Callout tone="neutral" title="Verification is not the end of the story">
              A pass here is a point-in-time observation. What matters for memory is whether the fix
              holds — which is exactly what the next step records, and what step 12 tests.
            </Callout>
          </Panel>
        );

      case 10:
        return (
          <Panel kicker="Step 10 · outcome" title="SUCCESS — and the lesson that comes with it." tone="ok">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="ok">SUCCESS</Badge>
              <span className="text-xs text-zinc-600">recorded {formatDateTime(new Date().toISOString())}</span>
            </div>
            <DataRow label="Outcome">SUCCESS · finding closed, no recurrence recorded</DataRow>
            <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                Lesson learned
              </p>
              <p className="mt-1 text-xs leading-relaxed text-emerald-950">
                Synchronization coverage — not another scheduled deprovisioning job — is what closed
                this gap. Coverage must include contractor identities and must be verified before
                any similar remediation is approved again.
              </p>
            </div>
          </Panel>
        );

      case 11:
        return (
          <Panel
            kicker="Step 11 · memory update"
            title="REMEDY learned this — and it is now retrievable."
            tone={retain.status === "ok" ? "ok" : retain.status === "down" ? "danger" : "info"}
          >
            <div className="relative h-1.5 overflow-hidden rounded-full bg-zinc-100">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  retain.status === "ok" ? "w-full bg-emerald-500" : retain.status === "down" ? "w-full bg-red-400" : "remedy-sweep w-full bg-sky-400"
                }`}
              />
            </div>

            {retain.status === "idle" || retain.status === "writing" ? (
              <p className="mt-3 flex items-center gap-2 text-xs text-zinc-700">
                <span className="h-2 w-2 animate-pulse rounded-full bg-sky-500" />
                Writing the lesson to Hindsight… fact extraction runs on the local model, so this can
                take a minute or two.
              </p>
            ) : retain.status === "down" ? (
              <div className="mt-3">
                <EmptyState
                  tone="danger"
                  title="Memory write did not complete"
                  body={`The outcome could not be retained: ${retain.reason}. Everything else in this walkthrough completed — only the write-back failed, and REMEDY says so rather than implying the memory changed.`}
                />
              </div>
            ) : (
              <div className="mt-3 flex flex-col gap-2">
                <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                    Memory updated{retain.alreadyPresent ? " — already stored from a previous run" : ""}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-emerald-950">
                    RETAIN completed: {retain.written} memory item{retain.written === 1 ? "" : "s"}{" "}
                    {retain.alreadyPresent ? "confirmed" : "written"} in bank{" "}
                    <span className="font-mono">remedy</span>.
                  </p>
                  {retain.factId && (
                    <p className="mt-1 font-mono text-[11px] text-emerald-800">
                      fact {retain.factId}
                    </p>
                  )}
                </div>
                <p className="text-xs text-zinc-700">
                  REMEDY learned that <strong>synchronization coverage validation</strong> prevented
                  recurrence on {HISTORY.controlId} — and that fact is now something every future
                  recall can surface.
                </p>
              </div>
            )}
          </Panel>
        );

      case 12:
      default:
        return (
          <Panel kicker="Step 12 · future finding" title="The loop closes: the next answer starts further ahead." tone="ok">
            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                Related future finding
              </p>
              <p className="mt-1 text-sm font-medium text-zinc-900">{FUTURE_FINDING.title}</p>
              <p className="mt-1 text-xs text-zinc-600">{FUTURE_FINDING.evidence}</p>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-dashed border-zinc-300 bg-white p-3">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Without the stored outcome
                </p>
                <p className="text-xs leading-relaxed text-zinc-700">{FUTURE_WITHOUT_MEMORY}</p>
              </div>
              <div className="rounded-md border border-emerald-400 bg-emerald-50 p-3">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                  With hindsight memory
                </p>
                <p className="text-xs font-medium leading-relaxed text-zinc-900">
                  {FUTURE_WITH_MEMORY}
                </p>
              </div>
            </div>

            <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Retrieval proof — read live from Hindsight
            </p>
            {future.status === "idle" || future.status === "loading" ? (
              <p className="mt-2 flex items-center gap-2 text-xs text-zinc-600">
                <span className="h-2 w-2 animate-pulse rounded-full bg-sky-500" />
                Recalling for the future finding…
              </p>
            ) : future.status === "down" ? (
              <p className="mt-2 text-xs text-red-700">
                Historical memory temporarily unavailable: {future.reason}. The comparison above is
                the deterministic walkthrough; the retrieval could not be shown.
              </p>
            ) : (future.items ?? []).length === 0 ? (
              <p className="mt-2 text-xs text-zinc-600">
                No memories matched this query. The stored lesson remains retrievable by its case id.
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1.5">
                {(future.items ?? []).slice(0, 4).map((item) => (
                  <li
                    key={item.factId}
                    className={`rounded border px-2.5 py-1.5 text-[11px] leading-relaxed ${
                      item.caseId === "901"
                        ? "border-emerald-400 bg-emerald-50 text-emerald-950"
                        : "border-zinc-200 bg-white text-zinc-600"
                    }`}
                  >
                    {item.caseId === "901" && (
                      <span className="mr-1.5 font-semibold uppercase">retained at step 11 ·</span>
                    )}
                    {item.text}
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-3 text-xs text-zinc-700">
              The failure at {HISTORY.daysToRecurrence} days is no longer a paragraph in a wiki — it
              is a retrievable fact that removes a fix from the recommendation before a human has to.
            </p>
          </Panel>
        );
    }
  }

  const canContinue =
    step !== 7 ? true : decision !== null;

  return (
    <div className="remedy-rise">
      <PageHeader
        eyebrow="Demo Mode"
        title="Run REMEDY demo"
        description="A fixed twelve-step walkthrough of the learning loop. The narrative is deterministic so it never drifts mid-presentation; the Hindsight reads and writes at steps 1, 11 and 12 are real."
        actions={
          <>
            <Link
              href="/investigate"
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
            >
              Open the live workflow
            </Link>
            <Button variant="secondary" onClick={restart}>Restart demo</Button>
          </>
        }
      />

      <ErrorNote message={error} />

      {/* ------------------------------------------------------ progress rail */}
      <div className="mb-4 rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-zinc-800">
            Step <span className="tabular">{String(step).padStart(2, "0")}</span> of 12 — {current.title}
          </p>
          <p className="text-[11px] text-zinc-500">{current.caption}</p>
        </div>
        <div className="flex gap-1">
          {STEPS.map((s) => {
            const reached = s.n <= step;
            const isCurrent = s.n === step;
            return (
              <button
                key={s.n}
                type="button"
                title={`${s.n}. ${s.title}`}
                aria-label={`Go to step ${s.n}: ${s.title}`}
                onClick={() => goto(s.n)}
                className={`h-2 flex-1 rounded-full transition-colors ${
                  isCurrent
                    ? "bg-zinc-900"
                    : reached
                      ? "bg-emerald-500"
                      : "bg-zinc-200 hover:bg-zinc-300"
                }`}
              />
            );
          })}
        </div>
        <div className="mt-1.5 hidden gap-1 sm:flex">
          {STEPS.map((s) => (
            <span
              key={s.n}
              className={`flex-1 text-center text-[9px] uppercase tracking-wide ${
                s.n === step ? "text-zinc-800" : "text-zinc-400"
              }`}
            >
              {s.title}
            </span>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          <div key={step} className="remedy-rise">
            {renderStep()}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={goBack} disabled={step === 1}>
              ← Previous
            </Button>
            <Button onClick={advance} disabled={step === STEPS.length || !canContinue}>
              {step === 7 ? "Approve to continue" : step === STEPS.length ? "Demo complete" : "Continue →"}
            </Button>
            {step === STEPS.length && (
              <Link
                href="/findings"
                className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
              >
                Open the findings table →
              </Link>
            )}
            <span className="ml-auto text-[11px] text-zinc-500">
              {step === 1 || step === 11 || step === 12
                ? "Live Hindsight call in progress or complete"
                : "Deterministic step — no model call"}
            </span>
          </div>
        </div>

        {/* -------------------------------------------------- state rail */}
        <aside className="flex h-fit flex-col gap-3 lg:sticky lg:top-4">
          <div className="rounded-lg border border-zinc-200 bg-white px-3 py-3 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Walkthrough state
            </p>
            <dl className="mt-2 flex flex-col gap-2 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-zinc-500">Historical case</dt>
                <dd>
                  <Badge tone={history.status === "ok" ? "ok" : history.status === "down" ? "danger" : "neutral"}>
                    {history.status === "ok"
                      ? `${history.found} memories`
                      : history.status === "down"
                        ? "unavailable"
                        : "checking…"}
                  </Badge>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-zinc-500">Approval</dt>
                <dd>
                  <Badge tone={decision === "APPROVED" ? "ok" : decision ? "danger" : "warn"}>
                    {decision ?? "PENDING"}
                  </Badge>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-zinc-500">Outcome</dt>
                <dd>
                  <Badge tone={outcome ? "ok" : "neutral"}>{outcome ?? "not recorded"}</Badge>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-zinc-500">Memory write</dt>
                <dd>
                  <Badge
                    tone={
                      retain.status === "ok" ? "ok" : retain.status === "down" ? "danger" : retain.status === "writing" ? "info" : "neutral"
                    }
                  >
                    {retain.status === "ok"
                      ? retain.alreadyPresent
                        ? "already stored"
                        : `${retain.written} written`
                      : retain.status === "down"
                        ? "failed"
                        : retain.status === "writing"
                          ? "writing…"
                          : "pending"}
                  </Badge>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-zinc-500">Future retrieval</dt>
                <dd>
                  <Badge tone={future.status === "ok" ? "ok" : future.status === "down" ? "danger" : "neutral"}>
                    {future.status === "ok"
                      ? `${future.items?.length ?? 0} recalled`
                      : future.status === "down"
                        ? "unavailable"
                        : future.status === "loading"
                          ? "recalling…"
                          : "pending"}
                  </Badge>
                </dd>
              </div>
            </dl>
          </div>

          <LifecycleTrack status={lifecycleStatus} outcome={outcome} />

          <div className="rounded-lg border border-zinc-200 bg-white px-3 py-3 text-[11px] leading-relaxed text-zinc-500 shadow-sm">
            <p className="mb-1 font-semibold uppercase tracking-wide text-zinc-600">Score of the loop</p>
            <p>
              Finding → evidence → root cause → <strong className="text-zinc-700">Hindsight recall</strong> →
              recommendation → <strong className="text-zinc-700">human approval</strong> → simulated
              remediation → verification → outcome →{" "}
              <strong className="text-zinc-700">Hindsight retain</strong> → next finding.
            </p>
            <p className="mt-2">
              Historical case used: <span className="font-mono">#{HISTORY.caseId}</span> · closed{" "}
              {formatDate("2025-11-14")}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
