/**
 * End-to-end pipeline test with a fake Hindsight client.
 *
 * Runs the real orchestrator (`analyzeFinding`) three times against the *same*
 * finding, varying only what the memory layer returns:
 *
 *   A. memory unavailable   -> stateless answer, explicitly labelled
 *   B. history says it failed -> different answer, action rejected
 *   C. history says it worked -> different again, confidence up
 *
 * SQLite is a real in-memory database; only the network is faked, so this
 * exercises the actual wiring the API routes depend on.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { analyzeFinding, submitApproval } from '@/lib/agent';
import { closeDb, getDb } from '@/lib/db';
import { createFinding, getFinding, getLatestRemediation, listRuns } from '@/lib/db/queries';
import { setHindsightClient } from '@/lib/memory/hindsight';
import { FindingStatus, MemoryStatus } from '@/lib/models/enums';
import type { CreateFinding } from '@/lib/models/schemas';
import { createFindingSchema } from '@/lib/models/schemas';

const DRAFT: CreateFinding = createFindingSchema.parse({
  controlId: 'AC-2',
  title: 'Privileged accounts not disabled after termination',
  description:
    'Two privileged VPN accounts belonging to terminated employees remained active 6 days after termination.',
  severity: 'HIGH',
  category: 'EMPLOYEE_ACCESS',
  affectedSystem: 'identity-gateway',
  evidence: [
    {
      source: 'IAM entitlement export',
      observation: 'Two privileged accounts active 6 days past termination date',
    },
  ],
});

/** Hindsight fact in the exact wire shape, including the `id` field. */
function fact(
  id: string,
  text: string,
  metadata: Record<string, string>,
  finalScore: number,
): Record<string, unknown> {
  return {
    id,
    text,
    type: 'world',
    context: metadata.stage ?? 'compliance',
    metadata,
    scores: { final: finalScore, reranker: finalScore, semantic: finalScore, keyword: 0.1 },
  };
}

/** The historical case whose prior fix failed and recurred. */
const FAILED_HISTORY = [
  fact(
    'f1',
    'Case #H-102: Privileged accounts not disabled after termination.',
    {
      caseId: 'H-102',
      stage: 'finding',
      controlId: 'AC-2',
      category: 'EMPLOYEE_ACCESS',
      severity: 'HIGH',
      outcome: 'FAILURE',
      recurrence: 'true',
      daysToRecurrence: '21',
    },
    0.62,
  ),
  fact(
    'f2',
    'Case #H-102 root cause: Manual HR export was skipped during a holiday period.',
    { caseId: 'H-102', stage: 'root_cause', recurrence: 'true' },
    0.6,
  ),
  fact(
    'f3',
    'Case #H-102 remediation attempted: Remove access for inactive employees and automate deprovisioning on termination.',
    { caseId: 'H-102', stage: 'remediation', outcome: 'FAILURE' },
    0.6,
  ),
  fact(
    'f4',
    'Case #H-102 outcome: FAILURE. The finding recurred after 21 days.',
    { caseId: 'H-102', stage: 'outcome', outcome: 'FAILURE', recurrence: 'true', daysToRecurrence: '21' },
    0.62,
  ),
  fact(
    'f5',
    'Case #H-102 lesson learned: Event-driven revocation is required; scheduled exports leave a window the audit still flags.',
    { caseId: 'H-102', stage: 'lesson' },
    0.55,
  ),
];

/** A case where the approach held. */
const SUCCESS_HISTORY = [
  fact(
    's1',
    'Case #H-052: Privileged accounts not disabled after termination.',
    {
      caseId: 'H-052',
      stage: 'finding',
      controlId: 'AC-2',
      category: 'EMPLOYEE_ACCESS',
      severity: 'HIGH',
      outcome: 'SUCCESS',
      recurrence: 'false',
    },
    0.6,
  ),
  fact(
    's3',
    'Case #H-052 remediation attempted: Replaced manual export with an event-driven integration revoking VPN entitlements within 5 minutes.',
    { caseId: 'H-052', stage: 'remediation', outcome: 'SUCCESS' },
    0.58,
  ),
  fact(
    's4',
    'Case #H-052 outcome: SUCCESS. The finding did not recur.',
    { caseId: 'H-052', stage: 'outcome', outcome: 'SUCCESS', recurrence: 'false' },
    0.6,
  ),
];

function clientReturning(results: Record<string, unknown>[]) {
  return { recall: async () => ({ results }) } as never;
}

function clientThatIsDown() {
  return {
    recall: async () => {
      throw new Error('fetch failed: ECONNREFUSED 127.0.0.1:0');
    },
  } as never;
}

beforeEach(() => {
  process.env.DATABASE_PATH = ':memory:';
  closeDb();
  getDb();
});

afterEach(() => {
  setHindsightClient(null);
  closeDb();
});

describe('analyzeFinding — same finding, different memory, different answer', () => {
  it('A: with Hindsight down, falls back to the stateless answer and says so', async () => {
    setHindsightClient(clientThatIsDown());
    const finding = createFinding(DRAFT);

    const analysis = await analyzeFinding(finding.id);

    expect(analysis.memory.status).toBe(MemoryStatus.UNAVAILABLE);
    expect(analysis.memory.bundle.historicalMemoryAvailable).toBe(false);
    expect(analysis.recommendation.memoryInfluenced).toBe(false);
    expect(analysis.recommendation.recommendation).toBe(
      analysis.recommendation.baselineRecommendation,
    );
    expect(analysis.recommendation.whyMemoryChangedIt).toContain('stateless');
    expect(analysis.recommendation.historicalCasesUsed).toHaveLength(0);
    expect(analysis.recommendation.rejectedPriorActions).toHaveLength(0);
  });

  it('B: with a failed prior fix, the answer differs from A and rejects it', async () => {
    setHindsightClient(clientReturning(FAILED_HISTORY));
    const finding = createFinding(DRAFT);

    const analysis = await analyzeFinding(finding.id);

    expect(analysis.memory.status).toBe(MemoryStatus.AVAILABLE);
    expect(analysis.recommendation.memoryInfluenced).toBe(true);

    // Not the stateless answer.
    expect(analysis.recommendation.recommendation).not.toBe(
      analysis.recommendation.baselineRecommendation,
    );
    expect(analysis.recommendation.recommendation).toContain(
      'Do not repeat the previous remediation',
    );

    // History is attributed, not paraphrased into anonymity.
    expect(analysis.recommendation.rejectedPriorActions.map((r) => r.caseId)).toContain('H-102');
    expect(analysis.recommendation.historicalCasesUsed.map((c) => c.caseId)).toContain('H-102');
    expect(analysis.recommendation.whyMemoryChangedIt).toContain('H-102');
    expect(analysis.recommendation.whyMemoryChangedIt).toContain('21 days');
  });

  it('A ≠ B — the core invariant, through the real pipeline', async () => {
    setHindsightClient(clientThatIsDown());
    const a = await analyzeFinding(createFinding(DRAFT).id);

    closeDb();
    getDb();
    setHindsightClient(clientReturning(FAILED_HISTORY));
    const b = await analyzeFinding(createFinding(DRAFT).id);

    expect(a.recommendation.recommendation).not.toBe(b.recommendation.recommendation);
    expect(b.recommendation.confidence).toBeLessThan(a.recommendation.confidence);
  });

  it('B ≠ C — success history produces a third, distinct answer', async () => {
    setHindsightClient(clientReturning(FAILED_HISTORY));
    const b = await analyzeFinding(createFinding(DRAFT).id);

    closeDb();
    getDb();
    setHindsightClient(clientReturning(SUCCESS_HISTORY));
    const c = await analyzeFinding(createFinding(DRAFT).id);

    expect(c.recommendation.recommendation).not.toBe(b.recommendation.recommendation);
    expect(c.recommendation.rejectedPriorActions).toHaveLength(0);
    expect(c.recommendation.confidence).toBeGreaterThan(
      b.recommendation.confidence,
    );
  });

  it('records every stage in the audit trail, including the failure reason', async () => {
    setHindsightClient(clientThatIsDown());
    const finding = createFinding(DRAFT);

    await analyzeFinding(finding.id);

    const runs = listRuns(finding.id).map((r) => String(r.stage));
    expect(runs).toEqual([
      'evidence',
      'root_cause',
      'hindsight_recall',
      'recommendation',
    ]);

    const recallRun = listRuns(finding.id).find((r) => r.stage === 'hindsight_recall');
    expect(Number(recallRun?.ok)).toBe(0);
    expect(String(recallRun?.error)).toMatch(/ECONNREFUSED|fetch/i);
  });

  it('moves the finding to AWAITING_APPROVAL and proposes a remediation', async () => {
    setHindsightClient(clientReturning(FAILED_HISTORY));
    const finding = createFinding(DRAFT);

    const analysis = await analyzeFinding(finding.id);

    expect(getFinding(finding.id)?.status).toBe(FindingStatus.AWAITING_APPROVAL);
    expect(getLatestRemediation(finding.id)).not.toBeNull();
    expect(analysis.remediationId).toBeTruthy();
  });
});

describe('human approval gate', () => {
  it('approval moves the finding to REMEDIATING', async () => {
    setHindsightClient(clientReturning(FAILED_HISTORY));
    const finding = createFinding(DRAFT);
    await analyzeFinding(finding.id);

    const result = submitApproval(finding.id, {
      decision: 'APPROVED',
      decidedBy: 'security-compliance-engineer',
    });

    expect(result.status).toBe(FindingStatus.REMEDIATING);
    expect(getFinding(finding.id)?.status).toBe(FindingStatus.REMEDIATING);
  });

  it('rejection stops the flow and returns to investigation', async () => {
    setHindsightClient(clientReturning(FAILED_HISTORY));
    const finding = createFinding(DRAFT);
    await analyzeFinding(finding.id);

    const result = submitApproval(finding.id, {
      decision: 'REJECTED',
      decidedBy: 'security-compliance-engineer',
      reason: 'Owner disagrees with the root-cause hypothesis',
    });

    expect(result.status).toBe(FindingStatus.INVESTIGATING);
    expect(getFinding(finding.id)?.status).toBe(FindingStatus.INVESTIGATING);
    // Nothing was implemented.
    expect(getLatestRemediation(finding.id)?.status).toBe('PROPOSED');
  });

  it('refuses approval when no remediation has been proposed', () => {
    const finding = createFinding(DRAFT);

    expect(() =>
      submitApproval(finding.id, { decision: 'APPROVED', decidedBy: 'eng' }),
    ).toThrowError(/No remediation/);
  });
});
