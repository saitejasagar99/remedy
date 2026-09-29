/**
 * Dashboard rollups.
 *
 * Every number the dashboard shows is derived here from rows that actually
 * exist in SQLite — findings, their stored analyses, their remediations and
 * their recorded outcomes. Nothing is estimated, extrapolated or hard-coded:
 * if a counter says "6 findings were influenced by historical memory", six
 * `analyses` rows carry `memory_influenced = 1`.
 *
 * Pure by design: no database handle, no network. That keeps the arithmetic
 * unit-testable and keeps the route handler a thin adapter.
 */
import type { AnalysisSummaryRow } from './db/queries';
import type { Finding } from './models/schemas';

export interface DashboardInput {
  findings: Finding[];
  /** Newest analysis per analysed finding. */
  analyses: AnalysisSummaryRow[];
  outcomes: Array<{ findingId: string; result: string; recurrence: boolean; recordedAt: string }>;
  remediations: Array<{
    findingId: string;
    status: string;
    proposedAt: string;
    approvedAt: string | null;
    implementedAt: string | null;
  }>;
}

export interface SystemicIssue {
  /** Base control, e.g. `AC-2` for `AC-2(3)`. */
  controlFamily: string;
  label: string;
  findings: number;
  recurring: number;
  failed: number;
  /** Controls involved, newest control first. */
  controls: string[];
}

export interface DashboardStats {
  totals: {
    findings: number;
    open: number;
    recurring: number;
    analyzed: number;
    awaitingApproval: number;
    resolved: number;
  };
  remediation: {
    successful: number;
    partial: number;
    failed: number;
    recurred: number;
    proposed: number;
    approved: number;
    implemented: number;
    verified: number;
  };
  memory: {
    /** Findings that have at least one stored analysis. */
    analyzed: number;
    /** Analyses whose recommendation drew on recalled history. */
    influenced: number;
    /** Analyses where the memory-aware answer differs from the stateless one. */
    changedAnswer: number;
    /** Analyses where history vetoed at least one prior fix. */
    avoidedFailedFix: number;
    analysesWithConflict: number;
    casesRecalled: number;
    byStatus: Record<string, number>;
  };
  severity: Record<string, number>;
  systemic: SystemicIssue[];
  lastActivityAt: string | null;
}

const CLOSED_STATUSES = new Set(['RESOLVED']);

/** `AC-2(3)` → `AC-2`. An enhancement belongs to its base control. */
export function controlFamily(controlId: string): string {
  const match = /^([A-Za-z]{2,4}-\d+)/.exec(controlId);
  return match ? match[1].toUpperCase() : controlId.toUpperCase();
}

function emptyCount(): Record<string, number> {
  return { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
}

export function computeDashboardStats(input: DashboardInput): DashboardStats {
  const outcomeByFinding = new Map<string, Array<{ result: string; recurrence: boolean }>>();
  for (const o of input.outcomes) {
    const list = outcomeByFinding.get(o.findingId) ?? [];
    list.push(o);
    outcomeByFinding.set(o.findingId, list);
  }

  const severity = emptyCount();
  const families = new Map<string, SystemicIssue>();

  let open = 0;
  let recurring = 0;
  let awaitingApproval = 0;
  let resolved = 0;

  for (const finding of input.findings) {
    severity[finding.severity] = (severity[finding.severity] ?? 0) + 1;

    const outcomes = outcomeByFinding.get(finding.id) ?? [];
    const isRecurring =
      finding.status === 'RECURRED' ||
      Boolean(finding.recurrenceOf) ||
      outcomes.some((o) => o.recurrence);

    if (isRecurring) recurring += 1;
    if (CLOSED_STATUSES.has(finding.status)) resolved += 1;
    else open += 1;
    if (finding.status === 'AWAITING_APPROVAL') awaitingApproval += 1;

    const family = controlFamily(finding.controlId);
    const entry =
      families.get(family) ??
      {
        controlFamily: family,
        label: family,
        findings: 0,
        recurring: 0,
        failed: 0,
        controls: [],
      };
    entry.findings += 1;
    if (isRecurring) entry.recurring += 1;
    if (outcomes.some((o) => o.result === 'FAILURE')) entry.failed += 1;
    if (!entry.controls.includes(finding.controlId)) entry.controls.unshift(finding.controlId);
    families.set(family, entry);
  }

  const memory = {
    analyzed: 0,
    influenced: 0,
    changedAnswer: 0,
    avoidedFailedFix: 0,
    analysesWithConflict: 0,
    casesRecalled: 0,
    byStatus: {} as Record<string, number>,
  };
  for (const analysis of input.analyses) {
    memory.analyzed += 1;
    if (analysis.memoryInfluenced) memory.influenced += 1;
    if (analysis.changed) memory.changedAnswer += 1;
    if (analysis.rejected > 0) memory.avoidedFailedFix += 1;
    if (analysis.conflicts > 0) memory.analysesWithConflict += 1;
    memory.casesRecalled += analysis.casesUsed;
    memory.byStatus[analysis.memoryStatus] =
      (memory.byStatus[analysis.memoryStatus] ?? 0) + 1;
  }

  const remediation = {
    successful: 0,
    partial: 0,
    failed: 0,
    recurred: 0,
    proposed: 0,
    approved: 0,
    implemented: 0,
    verified: 0,
  };
  for (const outcome of input.outcomes) {
    if (outcome.result === 'SUCCESS') remediation.successful += 1;
    else if (outcome.result === 'PARTIAL') remediation.partial += 1;
    else remediation.failed += 1;
    if (outcome.recurrence) remediation.recurred += 1;
  }
  for (const r of input.remediations) {
    if (r.status === 'PROPOSED') remediation.proposed += 1;
    else if (r.status === 'APPROVED') remediation.approved += 1;
    else if (r.status === 'IMPLEMENTED') remediation.implemented += 1;
    else if (r.status === 'VERIFIED') remediation.verified += 1;
  }

  const systemic = [...families.values()]
    // A control family is systemic when it shows up more than once, or when a
    // single instance already failed or recurred — both are what an auditor
    // would call a pattern rather than an incident.
    .filter((f) => f.findings > 1 || f.recurring > 0 || f.failed > 0)
    .sort((a, b) => b.recurring - a.recurring || b.failed - a.failed || b.findings - a.findings);

  const timestamps = [
    ...input.findings.map((f) => f.updatedAt),
    ...input.outcomes.map((o) => o.recordedAt),
    ...input.analyses.map((a) => a.createdAt),
  ].filter(Boolean);

  return {
    totals: {
      findings: input.findings.length,
      open,
      recurring,
      analyzed: memory.analyzed,
      awaitingApproval,
      resolved,
    },
    remediation,
    memory,
    severity,
    systemic,
    lastActivityAt: timestamps.sort().at(-1) ?? null,
  };
}
