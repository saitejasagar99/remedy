/**
 * Pipeline orchestrator.
 *
 * Wires the five logical agents into the documented flow:
 *
 *   Finding → Evidence → Root Cause → Hindsight Recall → Historical Analysis
 *          → Recommendation → Human Approval → Remediation → Verification
 *          → Outcome → Hindsight Retain → Future Decision
 *
 * The "agents" are modules, not services. This file owns sequencing,
 * per-stage audit recording, and status transitions — no business rules.
 */
import { recordRun, saveAnalysis } from '../db/queries';
import {
  getFinding,
  getLatestRemediation,
  getRootCause,
  saveApproval,
  saveOutcome,
  saveProposedRemediation,
  saveRootCause,
  saveVerification,
  updateFindingStatus,
  updateRemediationStatus,
} from '../db/queries';
import { llmConfig } from '../config';
import { FindingStatus, MemoryStatus, RemediationStatus } from '../models/enums';
import type {
  ApprovalRequest,
  Finding,
  MemoryConflict,
  OutcomeRequest,
  Recommendation,
  RootCause,
} from '../models/schemas';
import { getHindsightStatus } from '../memory/hindsight';
import { retainRemediationOutcome } from '../memory/retain';

import { analyzeEvidence, type EvidenceAnalysis } from './evidence';
import { detectConflicts } from './conflict';
import { gatherHistoricalContext, type HistoricalCaseSummary } from './historical';
import { generateRecommendation } from './recommend';
import { analyzeRootCause } from './root-cause';
import { buildVerificationOutcome } from './verify';
import type { RecallBundle } from '../models/schemas';

export interface StageTrace {
  stage: string;
  ok: boolean;
  durationMs: number;
  error?: string;
}

export interface AnalysisResult {
  finding: Finding;
  evidence: EvidenceAnalysis;
  rootCause: RootCause;
  memory: {
    bundle: RecallBundle;
    cases: HistoricalCaseSummary[];
    status: MemoryStatus;
  };
  conflicts: MemoryConflict[];
  recommendation: Recommendation;
  remediationId: string;
  stages: StageTrace[];
  usedModel: boolean;
}

/** Run one stage, time it, and persist an audit row. */
async function stage<T>(
  name: string,
  findingId: string,
  traces: StageTrace[],
  fn: () => Promise<{ value: T; error?: string }>,
): Promise<T> {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  try {
    const { value, error } = await fn();
    const durationMs = Date.now() - start;
    traces.push({ stage: name, ok: !error, durationMs, ...(error ? { error } : {}) });
    recordRun({
      findingId,
      stage: name,
      startedAt,
      ok: !error,
      durationMs,
      ...(error ? { error } : {}),
    });
    return value;
  } catch (error) {
    const durationMs = Date.now() - start;
    const message = error instanceof Error ? error.message : String(error);
    traces.push({ stage: name, ok: false, durationMs, error: message });
    recordRun({ findingId, stage: name, startedAt, ok: false, error: message, durationMs });
    throw error;
  }
}

function memoryStatusOf(bundle: RecallBundle, cases: HistoricalCaseSummary[]): MemoryStatus {
  if (!bundle.historicalMemoryAvailable) return MemoryStatus.UNAVAILABLE;
  if (cases.length === 0) return MemoryStatus.EMPTY;
  if (bundle.status === 'low_confidence') return MemoryStatus.LOW_CONFIDENCE;
  return MemoryStatus.AVAILABLE;
}

/**
 * Run the full analysis pipeline for a finding.
 *
 * Never throws for a degraded dependency: a missing LLM or an unreachable
 * Hindsight is recorded as a stage result and reflected in `memoryStatus`, so
 * the caller always receives a usable (if weaker) recommendation.
 */
export async function analyzeFinding(findingId: string): Promise<AnalysisResult> {
  const finding = getFinding(findingId);
  if (!finding) throw Object.assign(new Error(`Finding not found: ${findingId}`), { status: 404 });

  const traces: StageTrace[] = [];

  const evidence = await stage('evidence', findingId, traces, async () => {
    const result = await analyzeEvidence(finding);
    return { value: result.analysis, ...(result.usedModel ? {} : { error: result.error }) };
  });

  const rootCauseResult = await stage('root_cause', findingId, traces, async () => {
    const result = await analyzeRootCause(finding, evidence);
    return {
      value: result,
      ...(result.usedModel ? {} : { error: result.error ?? 'LLM unavailable' }),
    };
  });
  const rootCause = rootCauseResult.rootCause;
  saveRootCause(rootCause);
  updateFindingStatus(findingId, FindingStatus.ROOT_CAUSE_IDENTIFIED);

  // Hindsight recall — failures become an explicit status, never an exception.
  const { bundle, cases } = await stage('hindsight_recall', findingId, traces, async () => {
    const context = await gatherHistoricalContext(finding);
    return {
      value: context,
      ...(context.bundle.historicalMemoryAvailable
        ? {}
        : { error: context.bundle.reason ?? 'Hindsight unavailable' }),
    };
  });

  const conflicts = detectConflicts({ finding, cases });

  const recommendationResult = await stage('recommendation', findingId, traces, async () => {
    const result = await generateRecommendation({
      finding,
      rootCause,
      evidence,
      cases,
      bundle,
      conflicts,
    });
    return {
      value: result,
      ...(result.usedModel ? {} : { error: result.error ?? 'LLM unavailable' }),
    };
  });
  const recommendation = recommendationResult.recommendation;
  const memoryStatus = memoryStatusOf(bundle, cases);

  updateFindingStatus(findingId, FindingStatus.AWAITING_APPROVAL);

  const remediationId = saveProposedRemediation({
    findingId,
    proposedAction: recommendation.recommendation,
    implementationDetails:
      'Simulated remediation. Approval is required before any action is taken; REMEDY never modifies real infrastructure.',
    owner: 'security-compliance-engineer',
    rationale: recommendation.whyMemoryChangedIt,
  });

  const analysis: AnalysisResult = {
    finding,
    evidence,
    rootCause,
    memory: { bundle, cases, status: memoryStatus },
    conflicts,
    recommendation,
    remediationId,
    stages: traces,
    usedModel: recommendationResult.usedModel,
  };

  // Persist so "did memory change the answer?" is answerable after a reload
  // and across runs, rather than only while the browser still holds the POST.
  saveAnalysis({
    findingId,
    memoryStatus,
    memoryInfluenced: recommendation.memoryInfluenced,
    casesUsed: recommendation.historicalCasesUsed.length,
    rejected: recommendation.rejectedPriorActions.length,
    conflicts: conflicts.length,
    baseline: recommendation.baselineRecommendation,
    recommendation: recommendation.recommendation,
    payload: analysis,
  });

  return analysis;
}

export interface ApprovalOutcome {
  findingId: string;
  remediationId: string;
  decision: string;
  status: FindingStatus;
  message: string;
}

/**
 * Apply the single human gate.
 *
 * There is no code path that moves a remediation to IMPLEMENTED without this
 * call — rejection and "request more evidence" both stop the flow.
 */
export function submitApproval(findingId: string, request: ApprovalRequest): ApprovalOutcome {
  const finding = getFinding(findingId);
  if (!finding) throw Object.assign(new Error(`Finding not found: ${findingId}`), { status: 404 });

  const remediation = getLatestRemediation(findingId);
  if (!remediation) {
    throw Object.assign(new Error('No remediation has been proposed for this finding'), {
      status: 409,
    });
  }

  saveApproval({
    remediationId: remediation.id,
    decision: request.decision,
    decidedBy: request.decidedBy,
    reason: request.reason,
    requestedEvidence: request.requestedEvidence,
  });

  if (request.decision === 'APPROVED') {
    updateRemediationStatus(remediation.id, RemediationStatus.APPROVED, {
      approvedAt: new Date().toISOString(),
    });
    updateFindingStatus(findingId, FindingStatus.REMEDIATING);
    return {
      findingId,
      remediationId: remediation.id,
      decision: request.decision,
      status: FindingStatus.REMEDIATING,
      message: 'Approved. Proceed to simulated remediation and verification.',
    };
  }

  if (request.decision === 'REJECTED') {
    updateFindingStatus(findingId, FindingStatus.INVESTIGATING);
    return {
      findingId,
      remediationId: remediation.id,
      decision: request.decision,
      status: FindingStatus.INVESTIGATING,
      message: `Rejected: ${request.reason ?? 'no reason recorded'}. Returning to investigation.`,
    };
  }

  updateFindingStatus(findingId, FindingStatus.INVESTIGATING);
  return {
    findingId,
    remediationId: remediation.id,
    decision: request.decision,
    status: FindingStatus.INVESTIGATING,
    message: `More evidence requested: ${request.requestedEvidence ?? 'unspecified'}.`,
  };
}

export interface OutcomeResultDto {
  verification: ReturnType<typeof buildVerificationOutcome>['verification'];
  outcome: ReturnType<typeof buildVerificationOutcome>['outcome'];
  note: string;
  retained: { ok: boolean; written: number; reason?: string };
}

/**
 * Record verification + outcome, then write the result back to Hindsight.
 *
 * This is the step that makes the loop close: today's outcome becomes
 * tomorrow's historical memory.
 */
export async function recordRemediationOutcome(
  findingId: string,
  request: OutcomeRequest,
): Promise<OutcomeResultDto> {
  const finding = getFinding(findingId);
  if (!finding) throw Object.assign(new Error(`Finding not found: ${findingId}`), { status: 404 });

  const remediation = getLatestRemediation(findingId);
  if (!remediation) {
    throw Object.assign(new Error('No remediation exists for this finding'), { status: 409 });
  }

  const { verification, outcome, note } = buildVerificationOutcome({
    remediationId: remediation.id,
    request,
  });

  saveVerification({
    remediationId: verification.remediationId,
    method: verification.method,
    result: verification.result,
    evidenceText: verification.evidenceText,
    verifier: verification.verifier,
  });
  saveOutcome({
    remediationId: outcome.remediationId,
    result: outcome.result,
    recurrence: outcome.recurrence,
    daysToRecurrence: outcome.daysToRecurrence,
    observedSideEffects: outcome.observedSideEffects,
    lessonLearned: outcome.lessonLearned,
    additionalInvestigation: outcome.additionalInvestigation,
  });

  const status = remediationStatusFor(outcome.result, outcome.recurrence);
  updateRemediationStatus(remediation.id, status, {
    implementedAt: new Date().toISOString(),
  });
  updateFindingStatus(
    findingId,
    outcome.recurrence ? FindingStatus.RECURRED : FindingStatus.RESOLVED,
  );

  // --- close the loop: the outcome becomes Hindsight memory ---
  const hindsight = await getHindsightStatus();
  let retained: OutcomeResultDto['retained'] = {
    ok: false,
    written: 0,
    reason: 'Hindsight unreachable — outcome recorded locally but not retained as memory',
  };

  if (hindsight.reachable) {
    retained = await retainRemediationOutcome({
      caseId: finding.id,
      controlId: finding.controlId,
      title: finding.title,
      affectedSystem: finding.affectedSystem,
      remediationAttempted: remediation.proposed_action,
      outcome: outcome.result,
      recurrence: outcome.recurrence,
      daysToRecurrence: outcome.daysToRecurrence,
      lessonLearned: outcome.lessonLearned,
      additionalInvestigation: outcome.additionalInvestigation,
      observedSideEffects: outcome.observedSideEffects,
    });
  }

  recordRun({
    findingId,
    stage: 'hindsight_retain_outcome',
    startedAt: new Date().toISOString(),
    ok: retained.ok,
    durationMs: 0,
    memoryStatus: retained.ok ? MemoryStatus.AVAILABLE : MemoryStatus.UNAVAILABLE,
    ...(retained.reason ? { error: retained.reason } : {}),
  });

  return { verification, outcome, note, retained };
}

function remediationStatusFor(
  result: OutcomeRequest['outcome'],
  recurrence: boolean,
): RemediationStatus {
  if (recurrence) return RemediationStatus.RECURRED;
  switch (result) {
    case 'SUCCESS':
      return RemediationStatus.SUCCESSFUL;
    case 'PARTIAL':
      return RemediationStatus.PARTIAL;
    default:
      return RemediationStatus.FAILED;
  }
}

/** Convenience for the UI: the last analysis for a finding, if one ran. */
export function currentRootCause(findingId: string): RootCause | null {
  return getRootCause(findingId);
}

export { llmConfig };
