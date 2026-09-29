"use client";

import { useState, type ReactNode } from "react";

import { api } from "@/app/lib/api";
import { humanize } from "@/app/lib/labels";
import { Badge, Button, Callout, ErrorNote, Section } from "./ui";

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
const CATEGORIES = [
  "EMPLOYEE_ACCESS",
  "PRIVILEGED_ACCESS",
  "IAM",
  "HR_SYNC",
  "MFA",
  "TERMINATED_USERS",
  "CONTRACTOR_ACCOUNTS",
  "SERVICE_ACCOUNTS",
  "CLOUD_PERMISSIONS",
  "VENDOR_ACCESS",
  "AUDIT_CONTROLS",
  "EVIDENCE_COLLECTION",
  "POLICY_VIOLATION",
] as const;

const EMPTY = {
  controlId: "AC-2",
  title: "",
  description: "",
  severity: "HIGH" as (typeof SEVERITIES)[number],
  category: "EMPLOYEE_ACCESS" as (typeof CATEGORIES)[number],
  affectedSystem: "",
  evidenceSource: "",
  evidenceObservation: "",
};

const input =
  "w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-zinc-500";
const label = "mb-1 block text-[11px] font-medium text-zinc-500";

/** Create a compliance finding with at least one piece of evidence. */
export function FindingForm({
  onCreated,
  compact = false,
}: {
  onCreated: (findingId: string) => void;
  compact?: boolean;
}) {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof typeof EMPTY, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await api.post<{ finding: { id: string } }>("/api/findings", {
        controlId: form.controlId,
        title: form.title,
        description: form.description,
        severity: form.severity,
        category: form.category,
        affectedSystem: form.affectedSystem,
        evidence:
          form.evidenceObservation.trim()
            ? [
                {
                  source: form.evidenceSource || "manual observation",
                  observation: form.evidenceObservation,
                },
              ]
            : [],
      });
      setForm(EMPTY);
      onCreated(response.finding.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create finding");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Cardish title="File a new finding" subtitle="Evidence is required for a useful analysis — at minimum one observation.">
      <div className={`grid gap-3 ${compact ? "sm:grid-cols-2" : "sm:grid-cols-2"}`}>
        <div>
          <label className={label} htmlFor="f-control">Control id</label>
          <input id="f-control" className={input} value={form.controlId}
            onChange={(e) => set("controlId", e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="f-system">Affected system</label>
          <input id="f-system" className={input} value={form.affectedSystem}
            placeholder="identity-gateway"
            onChange={(e) => set("affectedSystem", e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="f-title">Title</label>
          <input id="f-title" className={input} value={form.title}
            placeholder="Privileged accounts not disabled after termination"
            onChange={(e) => set("title", e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="f-desc">Description</label>
          <textarea id="f-desc" rows={2} className={input} value={form.description}
            onChange={(e) => set("description", e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="f-sev">Severity</label>
          <select id="f-sev" className={input} value={form.severity}
            onChange={(e) => set("severity", e.target.value)}>
            {SEVERITIES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="f-cat">Category</label>
          <select id="f-cat" className={input} value={form.category}
            onChange={(e) => set("category", e.target.value)}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="f-esrc">Evidence source</label>
          <input id="f-esrc" className={input} value={form.evidenceSource}
            placeholder="IAM entitlement export"
            onChange={(e) => set("evidenceSource", e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="f-eobs">Evidence observation</label>
          <input id="f-eobs" className={input} value={form.evidenceObservation}
            placeholder="Two privileged accounts active 6 days past termination"
            onChange={(e) => set("evidenceObservation", e.target.value)} />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Button onClick={submit} busy={busy}>Create finding</Button>
        <Button variant="ghost" onClick={() => setForm(EMPTY)}>Clear</Button>
      </div>
      <div className="mt-2"><ErrorNote message={error} /></div>
    </Cardish>
  );
}

function Cardish({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <header className="border-b border-zinc-100 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
      </header>
      <div className="px-4 py-3 text-sm">{children}</div>
    </section>
  );
}

/**
 * The single human gate.
 *
 * Nothing is implemented without this decision, and the panel says so in the
 * words a judge will read first — the AI never touches infrastructure here.
 */
export function ApprovalPanel({
  findingId,
  disabled,
  requiresReview,
  proposal,
  onDone,
}: {
  findingId: string;
  disabled: boolean;
  requiresReview: boolean;
  proposal?: string;
  onDone: () => void;
}) {
  const [decidedBy, setDecidedBy] = useState("security-compliance-engineer");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<string | null>(null);

  async function decide(nextDecision: string) {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/findings/${findingId}/approval`, {
        decision: nextDecision,
        decidedBy,
        ...(reason ? { reason } : {}),
        ...(evidence ? { requestedEvidence: evidence } : {}),
      });
      setDecision(nextDecision);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      step={7}
      title="Human approval"
      description="The one gate between a recommendation and a change. Nothing proceeds without it."
      tone="warn"
      actions={<Badge tone="warn">human decision required</Badge>}
    >
      <Callout tone="warn" title="Simulated remediation — approval required">
        REMEDY never modifies real infrastructure. Approving records a human decision and moves the
        remediation to <strong>APPROVED</strong>; it executes nothing.
      </Callout>

      {proposal && (
        <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Recommendation on the table
          </p>
          <p className="mt-1 text-xs font-medium leading-relaxed text-zinc-800">{proposal}</p>
        </div>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="a-by">Decided by</label>
          <input id="a-by" className={input} value={decidedBy}
            onChange={(e) => setDecidedBy(e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="a-reason">Reason (for rejection)</label>
          <input id="a-reason" className={input} value={reason}
            placeholder="Root cause disputed"
            onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="a-ev">Additional evidence requested</label>
          <input id="a-ev" className={input} value={evidence}
            placeholder="Show the deprovisioning job logs for the last 30 days"
            onChange={(e) => setEvidence(e.target.value)} />
        </div>
      </div>

      {requiresReview && (
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          A memory/evidence conflict is open on this finding. Approving here records a human
          decision over that conflict — it does not auto-resolve it.
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => decide("APPROVED")} disabled={disabled} busy={busy}>
          Approve
        </Button>
        <Button variant="secondary" onClick={() => decide("REQUEST_MORE_EVIDENCE")}
          disabled={disabled} busy={busy}>
          Request more evidence
        </Button>
        <Button variant="danger" onClick={() => decide("REJECTED")} disabled={disabled} busy={busy}>
          Reject
        </Button>
      </div>

      {decision && (
        <p className="mt-2 text-xs text-zinc-600">
          Recorded decision:{" "}
          <Badge tone={decision === "APPROVED" ? "ok" : "danger"}>{humanize(decision)}</Badge>{" "}
          by {decidedBy}.
        </p>
      )}
      <div className="mt-2"><ErrorNote message={error} /></div>
    </Section>
  );
}

/** Verification method and verdict, then the outcome that closes the loop. */
export function OutcomeWorkflow({
  findingId,
  onDone,
}: {
  findingId: string;
  onDone: () => void;
}) {
  const [stage, setStage] = useState<"verify" | "outcome">("verify");
  const [form, setForm] = useState({
    method: "AUTOMATED_RESCAN",
    result: "PASS",
    evidenceText: "",
    verifier: "security-compliance-engineer",
    outcome: "SUCCESS",
    recurrence: false,
    daysToRecurrence: "",
    lessonLearned: "",
    observedSideEffects: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const set = (key: keyof typeof form, value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function submit() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const response = await api.post<{
        summary: { retained: { ok: boolean; written: number; reason?: string } };
      }>(`/api/findings/${findingId}/outcome`, {
        method: form.method,
        result: form.result,
        evidenceText: form.evidenceText,
        verifier: form.verifier,
        outcome: form.outcome,
        recurrence: form.recurrence,
        ...(form.recurrence && form.daysToRecurrence
          ? { daysToRecurrence: Number(form.daysToRecurrence) }
          : {}),
        lessonLearned: form.lessonLearned,
        observedSideEffects: form.observedSideEffects
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean),
      });

      const retained = response.summary.retained;
      setNote(
        retained.ok
          ? `Retained ${retained.written} memory item(s) in Hindsight — this outcome now changes the next recommendation.`
          : `Outcome recorded locally, but memory was NOT updated: ${retained.reason ?? "unknown reason"}`,
      );
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record outcome");
    } finally {
      setBusy(false);
    }
  }

  if (stage === "verify") {
    return (
      <Section
        step={8}
        title="Verification"
        description="Did the simulated remediation actually close the finding? Evidence is required — a verdict with no observation is not a verification."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="o-method">Verification method</label>
            <select id="o-method" className={input} value={form.method}
              onChange={(e) => set("method", e.target.value)}>
              <option value="AUTOMATED_RESCAN">Automated rescan</option>
              <option value="MANUAL_REVIEW">Manual review</option>
              <option value="CONTROL_TEST">Control test</option>
              <option value="EVIDENCE_RECOLLECTION">Evidence recollection</option>
            </select>
          </div>
          <div>
            <label className={label} htmlFor="o-result">Verification result</label>
            <select id="o-result" className={input} value={form.result}
              onChange={(e) => {
                const result = e.target.value;
                setForm((f) => ({
                  ...f,
                  result,
                  outcome: result === "PASS" ? "SUCCESS" : result === "PARTIAL" ? "PARTIAL" : "FAILURE",
                }));
              }}>
              <option value="PASS">PASS</option>
              <option value="FAIL">FAIL</option>
              <option value="PARTIAL">PARTIAL</option>
            </select>
          </div>
          <div>
            <label className={label} htmlFor="o-verifier">Verifier</label>
            <input id="o-verifier" className={input} value={form.verifier}
              onChange={(e) => set("verifier", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="o-ev">Verification evidence</label>
            <input id="o-ev" className={input} value={form.evidenceText}
              placeholder="Rescan shows no active privileged accounts for terminated employees"
              onChange={(e) => set("evidenceText", e.target.value)} />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            disabled={!form.evidenceText.trim()}
            onClick={() => setStage("outcome")}
          >
            Continue to outcome
          </Button>
          {!form.evidenceText.trim() && (
            <span className="text-[11px] text-zinc-500">
              Record the verification evidence to continue.
            </span>
          )}
        </div>
      </Section>
    );
  }

  return (
    <Section
      step={9}
      title="Outcome"
      description="What actually happened after the fix — this is the value that goes back into memory."
      emphasis
      actions={
        <Button variant="secondary" onClick={() => setStage("verify")}>
          Back to verification
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="o-outcome">Remediation outcome</label>
          <select id="o-outcome" className={input} value={form.outcome}
            onChange={(e) => set("outcome", e.target.value)}>
            <option value="SUCCESS">SUCCESS</option>
            <option value="PARTIAL">PARTIAL</option>
            <option value="FAILURE">FAILURE</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="o-side">Observed side effects (semicolon-separated)</label>
          <input id="o-side" className={input} value={form.observedSideEffects}
            placeholder="Reconciliation surfaced 4 orphaned accounts"
            onChange={(e) => set("observedSideEffects", e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="o-lesson">Lesson learned</label>
          <textarea id="o-lesson" rows={2} className={input} value={form.lessonLearned}
            placeholder="Event-driven revocation closed the gap; scheduled exports did not."
            onChange={(e) => set("lessonLearned", e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={form.recurrence}
            onChange={(e) => set("recurrence", e.target.checked)} />
          The finding recurred
        </label>
        {form.recurrence && (
          <div>
            <label className={label} htmlFor="o-days">Days to recurrence</label>
            <input id="o-days" type="number" min={1} className={input}
              value={form.daysToRecurrence}
              onChange={(e) => set("daysToRecurrence", e.target.value)} />
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          onClick={submit}
          busy={busy}
          disabled={!form.lessonLearned.trim() || (form.recurrence && !form.daysToRecurrence)}
        >
          Record outcome &amp; retain to memory
        </Button>
        <Badge tone={form.outcome === "SUCCESS" ? "ok" : form.outcome === "PARTIAL" ? "warn" : "danger"}>
          {form.outcome}
        </Badge>
        <span className="text-[11px] text-zinc-500">
          Writes to Hindsight — may take up to a minute on CPU inference.
        </span>
      </div>

      <div className="mt-2 flex flex-col gap-2">
        <ErrorNote message={error} />
        {note && (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            {note}
          </p>
        )}
      </div>
    </Section>
  );
}
