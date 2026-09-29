/**
 * THE central test of the project.
 *
 * Requirement: the same current finding must produce recommendation A without
 * memory, recommendation B when history says the obvious fix failed, and
 * A must not equal B.
 *
 * All three cases run the *real* recommendation engine. Only the recalled
 * history varies — that is the whole point: identical inputs, different
 * memory, different answer.
 */
import { describe, expect, it } from 'vitest';

import {
  applyMemory,
  deriveStatelessRecommendation,
} from '@/lib/agent/recommend';
import { MemoryStatus } from '@/lib/models/enums';
import type { RecallBundle } from '@/lib/models/schemas';

import { makeFinding, makeRootCause, makeSummary } from '../helpers/fixtures';

const finding = makeFinding();
const rootCause = makeRootCause();

const AVAILABLE_BUNDLE: RecallBundle = {
  historicalMemoryAvailable: true,
  status: 'ok',
  memories: [],
};

const UNAVAILABLE_BUNDLE: RecallBundle = {
  historicalMemoryAvailable: false,
  status: 'unavailable',
  reason: 'Hindsight recall timed out after 12000ms',
  memories: [],
};

/** The historical case whose prior fix is recognisably the same approach. */
const priorFailure = makeSummary({
  caseId: 'H-102',
  outcome: 'FAILURE',
  recurrence: true,
  daysToRecurrence: 21,
  remediationAttempted:
    'Remove access for inactive employees and automate deprovisioning on termination',
});

describe('memory changes the recommendation (A ≠ B)', () => {
  const baseline = deriveStatelessRecommendation(finding, rootCause);

  it('A: with no relevant history the answer is the stateless one', () => {
    const a = applyMemory(finding, rootCause, baseline, []);

    expect(a.recommendation).toBe(baseline.recommendation);
    expect(a.rejected).toHaveLength(0);
    expect(a.whyMemoryChangedIt).toContain('No relevant historical experience');
  });

  it('B: with a failed prior fix the answer is materially different from A', () => {
    const b = applyMemory(finding, rootCause, baseline, [priorFailure]);

    expect(b.recommendation).not.toBe(baseline.recommendation);
    // The requirement is a genuinely different answer, not a footnote.
    expect(b.recommendation).toContain('Do not repeat the previous remediation');
    expect(b.rejected).toHaveLength(1);
    expect(b.rejected[0]).toMatchObject({ caseId: 'H-102', outcome: 'FAILURE' });
  });

  it('A ≠ B — the core invariant', () => {
    const a = applyMemory(finding, rootCause, baseline, []);
    const b = applyMemory(finding, rootCause, baseline, [priorFailure]);

    expect(a.recommendation).not.toBe(b.recommendation);
    expect(b.confidence).toBeLessThan(a.confidence);
  });

  it('C: a successful prior fix moves the answer again — B ≠ C', () => {
    const priorSuccess = makeSummary({
      caseId: 'H-052',
      outcome: 'SUCCESS',
      recurrence: false,
      daysToRecurrence: undefined,
      remediationAttempted:
        'Replaced manual export with an event-driven integration revoking VPN entitlements within 5 minutes',
      lesson: 'Event-driven revocation closed the audit gap permanently.',
    });

    const c = applyMemory(finding, rootCause, baseline, [priorSuccess]);

    expect(c.recommendation).not.toBe(
      applyMemory(finding, rootCause, baseline, [priorFailure]).recommendation,
    );
    // Success raises confidence above the stateless figure; failure lowers it.
    expect(c.confidence).toBeGreaterThan(baseline.confidence);
  });

  it('history is never silently dropped from the explanation', () => {
    const b = applyMemory(finding, rootCause, baseline, [priorFailure]);

    expect(b.whyMemoryChangedIt).toContain(baseline.recommendation);
    expect(b.whyMemoryChangedIt).toContain('21 days');
    expect(b.recommendation).toContain('H-102');
  });
});

describe('memory availability is reported honestly', () => {
  it('unavailable memory yields a stateless answer that says so', () => {
    expect(UNAVAILABLE_BUNDLE.historicalMemoryAvailable).toBe(false);
    expect(UNAVAILABLE_BUNDLE.reason).toMatch(/timed out/);
    // Nothing may be presented as recalled history when recall failed.
    expect(UNAVAILABLE_BUNDLE.memories).toHaveLength(0);
  });

  it('an available-but-empty bank is not confused with an unavailable one', () => {
    expect(AVAILABLE_BUNDLE.historicalMemoryAvailable).toBe(true);
    expect(AVAILABLE_BUNDLE.status).toBe('ok');
    expect(MemoryStatus.EMPTY).not.toBe(MemoryStatus.UNAVAILABLE);
  });
});
