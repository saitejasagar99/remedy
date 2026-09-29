/**
 * Zod is the single source of truth, so these tests pin the contract that both
 * the API routes and the LLM output parsing depend on.
 */
import { describe, expect, it } from 'vitest';

import {
  approvalRequestSchema,
  createFindingSchema,
  outcomeRequestSchema,
  recommendationSchema,
  RELATIVE_SCORE_CAVEAT,
} from '@/lib/models/schemas';

describe('createFindingSchema', () => {
  const valid = {
    controlId: 'AC-2',
    title: 'Privileged accounts not disabled',
    description: 'Two accounts active after termination.',
    severity: 'HIGH',
    category: 'EMPLOYEE_ACCESS',
    affectedSystem: 'identity-gateway',
  };

  it('accepts a minimal finding and defaults evidence to empty', () => {
    const parsed = createFindingSchema.parse(valid);
    expect(parsed.evidence).toEqual([]);
  });

  it('rejects an unknown severity rather than coercing it', () => {
    expect(
      createFindingSchema.safeParse({ ...valid, severity: 'SEVERE' }).success,
    ).toBe(false);
  });

  it('rejects an unknown category', () => {
    expect(
      createFindingSchema.safeParse({ ...valid, category: 'SOMETHING' }).success,
    ).toBe(false);
  });

  it('rejects blank strings, not just missing ones', () => {
    expect(createFindingSchema.safeParse({ ...valid, title: '   ' }).success).toBe(false);
  });

  it('applies the evidence shape', () => {
    const parsed = createFindingSchema.parse({
      ...valid,
      evidence: [{ source: 'Export', observation: 'Two accounts active' }],
    });
    expect(parsed.evidence[0].supportsHypothesis).toBeUndefined();
  });
});

describe('approvalRequestSchema', () => {
  it('accepts each legal decision', () => {
    for (const decision of ['APPROVED', 'REJECTED', 'REQUEST_MORE_EVIDENCE']) {
      expect(
        approvalRequestSchema.safeParse({ decision, decidedBy: 'eng' }).success,
      ).toBe(true);
    }
  });

  it('rejects a decision that skips the human gate', () => {
    expect(
      approvalRequestSchema.safeParse({ decision: 'AUTO_APPLY', decidedBy: 'eng' }).success,
    ).toBe(false);
  });

  it('requires a named decider so decisions are attributable', () => {
    expect(
      approvalRequestSchema.safeParse({ decision: 'APPROVED', decidedBy: '  ' }).success,
    ).toBe(false);
  });
});

describe('outcomeRequestSchema', () => {
  const valid = {
    method: 'AUTOMATED_RESCAN',
    result: 'PASS',
    evidenceText: 'Rescan shows no active privileged accounts.',
    verifier: 'eng',
    outcome: 'SUCCESS',
    lessonLearned: 'Event-driven revocation closed the gap.',
  };

  it('accepts a successful closure', () => {
    const parsed = outcomeRequestSchema.parse(valid);
    expect(parsed.recurrence).toBe(false);
    expect(parsed.observedSideEffects).toEqual([]);
  });

  it('rejects an outcome outside the vocabulary', () => {
    expect(outcomeRequestSchema.safeParse({ ...valid, outcome: 'MAYBE' }).success).toBe(false);
  });

  it('accepts a recurrence whose day count was never recorded', () => {
    // `daysToRecurrence` is optional because real investigations sometimes
    // cannot pin the date; renderStage says "an unrecorded number of days"
    // rather than inventing one.
    const parsed = outcomeRequestSchema.safeParse({ ...valid, recurrence: true });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.daysToRecurrence).toBeUndefined();
  });

  it('rejects a non-positive day count', () => {
    expect(
      outcomeRequestSchema.safeParse({
        ...valid,
        recurrence: true,
        daysToRecurrence: 0,
      }).success,
    ).toBe(false);
  });

  it('accepts a recurrence with a day count', () => {
    expect(
      outcomeRequestSchema.safeParse({
        ...valid,
        recurrence: true,
        daysToRecurrence: 21,
      }).success,
    ).toBe(true);
  });
});

describe('recommendationSchema', () => {
  const base = {
    id: 'rec-1',
    findingId: 'CF-1',
    recommendation: 'Validate before remediating.',
    confidence: 0.5,
    memoryInfluenced: true,
    memoryStatus: 'AVAILABLE',
    historicalCasesUsed: [],
    rejectedPriorActions: [],
    risks: [],
    assumptions: [],
    conflicts: [],
  };

  it('accepts a well-formed recommendation', () => {
    expect(recommendationSchema.safeParse(base).success).toBe(true);
  });

  it('clamps confidence to 0..1 so a model cannot emit 87', () => {
    expect(recommendationSchema.safeParse({ ...base, confidence: 87 }).success).toBe(false);
    expect(recommendationSchema.safeParse({ ...base, confidence: -1 }).success).toBe(false);
  });

  it('marks every cited case relevance as relative', () => {
    const parsed = recommendationSchema.parse({
      ...base,
      historicalCasesUsed: [
        {
          caseId: 'H-102',
          relevance: 0.62,
          outcome: 'FAILURE',
          recurrenceDays: 21,
        },
      ],
    });
    expect(parsed.historicalCasesUsed[0].relevanceIsRelative).toBe(true);
  });

  it('never renders a bare relevance as a similarity percentage', () => {
    // `relevance` is an ordering signal; the flag that says so must be present
    // by default so no consumer can read 0.62 as "62% similar".
    const parsed = recommendationSchema.parse({
      ...base,
      historicalCasesUsed: [
        { caseId: 'H-102', relevance: 0.62, outcome: 'FAILURE', recurrenceDays: null },
      ],
    });
    expect(parsed.historicalCasesUsed[0].relevanceIsRelative).toBe(true);
    expect(RELATIVE_SCORE_CAVEAT).toMatch(/not calibrated/i);
  });

  it('requires every conflict to demand human review', () => {
    const parsed = recommendationSchema.safeParse({
      ...base,
      conflicts: [
        {
          id: 'c1',
          kind: 'ROOT_CAUSE_DISAGREEMENT',
          historicalClaim: 'History says sync failed',
          currentEvidence: 'Evidence says sync is healthy',
          severity: 'HIGH',
          requiresHumanReview: true,
        },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.conflicts[0].requiresHumanReview).toBe(true);
    }
  });
});

describe('RELATIVE_SCORE_CAVEAT', () => {
  it('states explicitly that scores are not calibrated percentages', () => {
    expect(RELATIVE_SCORE_CAVEAT).toMatch(/relative to a single query/i);
    expect(RELATIVE_SCORE_CAVEAT).toMatch(/not calibrated/i);
  });
});
