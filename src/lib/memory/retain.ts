/**
 * Retain operations — writing REMEDY's organisational experience into Hindsight.
 *
 * These are the *only* writes into the memory layer. Application state
 * (findings, approvals, runs) lives in SQLite and is never written here.
 *
 * Every function returns a `MemoryWriteResult` instead of throwing: a failed
 * memory write must degrade the run, not destroy it, and the caller always has
 * an explicit signal to surface.
 */
import { hindsightConfig } from '../config';
import type { HistoricalCase } from '../models/schemas';
import { MemoryStage } from '../models/enums';

import {
  MemoryUnavailableError,
  describeMemoryError,
  getHindsightClient,
  withTimeout,
} from './hindsight';
import {
  caseMetadata,
  renderStage,
  stageContext,
  stagesFor,
} from './memory-types';

export interface MemoryWriteResult {
  ok: boolean;
  /** Number of memories actually written. */
  written: number;
  /** Present when `ok` is false — never a stack trace. */
  reason?: string;
}

const OK = (written: number): MemoryWriteResult => ({ ok: true, written });
const FAIL = (reason: string): MemoryWriteResult => ({
  ok: false,
  written: 0,
  reason,
});

/**
 * Retain a single lifecycle stage.
 *
 * `async: false` keeps the write synchronous so a caller can confirm the memory
 * landed before reporting success — the seed script and tests depend on that.
 */
async function retainStage(
  record: HistoricalCase,
  stage: MemoryStage,
): Promise<MemoryWriteResult> {
  try {
    await withTimeout(
      (signal) =>
        getHindsightClient().retain(
          hindsightConfig.bankId,
          renderStage(record, stage),
          {
            context: stageContext(stage),
            metadata: caseMetadata(record.caseId, stage, {
              controlId: record.controlId,
              category: record.category,
              severity: record.severity,
              outcome: record.outcome,
              recurrence: String(record.recurrence),
              ...(record.daysToRecurrence
                ? { daysToRecurrence: String(record.daysToRecurrence) }
                : {}),
            }),
            timestamp: record.closedAt,
            async: false,
            signal,
          },
        ),
      hindsightConfig.retainTimeoutMs,
      `retain(${stage})`,
    );
    return OK(1);
  } catch (error) {
    return FAIL(describeMemoryError(error));
  }
}

/**
 * Retain one stage of a historical case. Exposed for targeted write-backs
 * (e.g. recording only a new lesson).
 */
export async function retainCaseStage(
  record: HistoricalCase,
  stage: MemoryStage,
): Promise<MemoryWriteResult> {
  return retainStage(record, stage);
}

/**
 * Retain the complete lifecycle of a historical case.
 *
 * Stages are written sequentially: concurrent retains on one bank can contend
 * on entity resolution, and the seed set is small enough that latency is not a
 * concern. A failure part-way through reports how many landed, so seeding can
 * be resumed rather than restarted.
 */
export async function retainHistoricalCase(
  record: HistoricalCase,
): Promise<MemoryWriteResult> {
  const stages = stagesFor(record);
  let written = 0;
  let firstError: string | undefined;

  for (const stage of stages) {
    const result = await retainStage(record, stage);
    if (result.ok) written += 1;
    else firstError ??= result.reason;
  }

  if (written === 0 && firstError) return FAIL(firstError);
  return { ok: written === stages.length, written, reason: firstError };
}

/**
 * Write an outcome back after a remediation is verified.
 *
 * This is the step that closes the loop: the *new* outcome becomes history that
 * changes the next recommendation.
 */
export async function retainRemediationOutcome(input: {
  caseId: string;
  controlId: string;
  title: string;
  affectedSystem: string;
  remediationAttempted: string;
  outcome: HistoricalCase['outcome'];
  recurrence: boolean;
  daysToRecurrence?: number;
  lessonLearned: string;
  additionalInvestigation?: string;
  observedSideEffects?: string[];
}): Promise<MemoryWriteResult> {
  const record: HistoricalCase = {
    caseId: input.caseId,
    controlId: input.controlId,
    category: 'IAM',
    affectedSystem: input.affectedSystem,
    title: input.title,
    description: input.title,
    severity: 'HIGH',
    rootCause: 'not re-derived for write-back',
    contributingFactors: [],
    remediationAttempted: input.remediationAttempted,
    implementationDetails: '',
    verificationResult: 'PASS',
    outcome: input.outcome,
    recurrence: input.recurrence,
    daysToRecurrence: input.daysToRecurrence,
    lessonLearned: input.lessonLearned,
    additionalInvestigation: input.additionalInvestigation,
    observedSideEffects: input.observedSideEffects ?? [],
    closedAt: new Date().toISOString(),
  };

  const stages: MemoryStage[] = [MemoryStage.OUTCOME, MemoryStage.LESSON];
  if (input.recurrence) stages.push(MemoryStage.RECURRENCE);

  let written = 0;
  let firstError: string | undefined;
  for (const stage of stages) {
    const result = await retainStage(record, stage);
    if (result.ok) written += 1;
    else firstError ??= result.reason;
  }

  if (written === 0 && firstError) return FAIL(firstError);
  return { ok: written === stages.length, written, reason: firstError };
}

/** Retain a standalone lesson (used when a human supplies one directly). */
export async function retainLesson(input: {
  caseId: string;
  controlId: string;
  lesson: string;
  context?: string;
}): Promise<MemoryWriteResult> {
  try {
    await withTimeout(
      (signal) =>
        getHindsightClient().retain(
          hindsightConfig.bankId,
          `Case #${input.caseId} lesson learned: ${input.lesson}`,
          {
            context: input.context ?? stageContext(MemoryStage.LESSON),
            metadata: caseMetadata(input.caseId, MemoryStage.LESSON, {
              controlId: input.controlId,
            }),
            async: false,
            signal,
          },
        ),
      hindsightConfig.retainTimeoutMs,
      'retainLesson',
    );
    return OK(1);
  } catch (error) {
    if (error instanceof MemoryUnavailableError) return FAIL(error.message);
    return FAIL(describeMemoryError(error));
  }
}
