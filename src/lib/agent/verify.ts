/**
 * Verification Agent.
 *
 * Runs *after* a human-approved remediation. It records the verification
 * result, derives the outcome, and — crucially — decides what must be written
 * back to Hindsight so the organisation learns from this attempt.
 *
 * Remediation is simulated: nothing here touches real infrastructure, and every
 * value comes from the human operator or the simulated control test.
 */
import { newId } from '../db';
import type { Outcome, Verification } from '../models/schemas';
import type { OutcomeRequest } from '../models/schemas';
import { OutcomeResult } from '../models/enums';

export interface VerificationOutcomePair {
  verification: Verification;
  outcome: Outcome;
  /** Human-readable explanation of what happens next. */
  note: string;
}

/**
 * Build the verification + outcome pair for a remediation.
 *
 * The outcome's `lessonLearned` is mandatory by schema — every remediation
 * attempt must leave something behind, including the successful ones.
 */
export function buildVerificationOutcome(input: {
  remediationId: string;
  request: OutcomeRequest;
}): VerificationOutcomePair {
  const now = new Date().toISOString();
  const { request } = input;

  const verification: Verification = {
    id: newId('VER'),
    remediationId: input.remediationId,
    method: request.method,
    result: request.result,
    evidenceText: request.evidenceText,
    verifiedAt: now,
    verifier: request.verifier,
  };

  if (request.recurrence && !request.daysToRecurrence) {
    throw new Error('daysToRecurrence is required when recurrence is true');
  }

  const outcome: Outcome = {
    id: newId('OUT'),
    remediationId: input.remediationId,
    result: request.outcome,
    recurrence: request.recurrence,
    daysToRecurrence: request.daysToRecurrence,
    observedSideEffects: request.observedSideEffects,
    lessonLearned: request.lessonLearned,
    additionalInvestigation: request.additionalInvestigation,
    recordedAt: now,
  };

  return {
    verification,
    outcome,
    note: buildNote(outcome),
  };
}

function buildNote(outcome: Outcome): string {
  if (outcome.recurrence) {
    return `Recurrence recorded after ${outcome.daysToRecurrence} days. The next similar finding will be advised against repeating this remediation.`;
  }
  if (outcome.result === OutcomeResult.SUCCESS) {
    return 'Success recorded. This approach is now available as a proven option for similar future findings.';
  }
  if (outcome.result === OutcomeResult.PARTIAL) {
    return 'Partial result recorded. Future recommendations will treat this approach as incomplete.';
  }
  return 'Failure recorded. Future recommendations will reject this approach unless its root cause is addressed first.';
}
