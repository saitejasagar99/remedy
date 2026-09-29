/**
 * Hindsight integration — exercises the REAL server at `HINDSIGHT_URL`.
 *
 *   npm run test:hindsight
 *
 * This exists because unit tests with a fake client prove only that our own
 * code agrees with itself. These tests prove the thing the project actually
 * claims: that Hindsight stores REMEDY's history and hands it back with enough
 * structure for the recommendation step to attribute it.
 *
 * The LLM is stubbed out (points at a dead port) — memory is the subject here.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hindsightConfig } from '@/lib/config';
import { getHindsightStatus } from '@/lib/memory';
import { runRecall } from '@/lib/memory/recall';
import { retainLesson } from '@/lib/memory/retain';
import { assembleHistoricalCases, gatherHistoricalContext } from '@/lib/agent/historical';
import { applyMemory, deriveStatelessRecommendation } from '@/lib/agent/recommend';
import type { Finding, MemoryReference, RootCause } from '@/lib/models/schemas';

let reachable = false;

/**
 * Self-skip rather than fail when the server is down.
 *
 * `npm test` only runs the `unit` project, so this never affects it — but
 * running `npm run test:hindsight` with Hindsight stopped should explain
 * itself, not produce a wall of red assertion failures.
 */
beforeAll(async () => {
  const status = await getHindsightStatus();
  reachable = status.reachable;
  if (!reachable) {
    console.warn(
      `\n[hindsight] SKIPPED — Hindsight unreachable at ${hindsightConfig.baseUrl}: ` +
        `${status.reason ?? 'unknown'}\n` +
        'Start it with `npm run hindsight:start`, then re-run `npm run test:hindsight`.\n',
    );
  }
}, 30_000);

function itLive(name: string, fn: () => Promise<void> | void): void {
  it(
    name,
    async (ctx) => {
      if (!reachable) return ctx.skip();
      await fn();
    },
    // Retain runs fact extraction through a local model on CPU, which can take
    // a couple of minutes per call. This is a ceiling against a hung server,
    // not an expectation of how long a healthy one takes.
    300_000,
  );
}

const finding: Finding = {
  id: 'CF_live0001',
  controlId: 'AC-2',
  title: 'Privileged accounts not disabled after termination',
  description:
    'Two privileged VPN accounts remained active 6 days after termination.',
  severity: 'HIGH',
  category: 'EMPLOYEE_ACCESS',
  affectedSystem: 'identity-gateway',
  status: 'OPEN',
  evidence: [
    {
      id: 'EV_live1',
      source: 'IAM entitlement export',
      observation: 'Two privileged accounts active 6 days past termination date',
      collectedAt: '2026-01-15T10:00:00.000Z',
    },
  ],
  firstDetectedAt: '2026-01-15T10:00:00.000Z',
  createdAt: '2026-01-15T10:00:00.000Z',
  updatedAt: '2026-01-15T10:00:00.000Z',
};

const rootCause: RootCause = {
  id: 'rc_live',
  findingId: finding.id,
  rootCause: 'Termination events are not wired into the deprovisioning pipeline',
  contributingFactors: [],
  confidence: 0.78,
  identifiedAt: '2026-01-15T10:00:00.000Z',
  method: 'HUMAN',
};

afterAll(() => {
  // Nothing to clean up: the probe writes one lesson into the shared bank, which
  // is the same bank the app reads. Clearing it would destroy real history.
});

describe('Hindsight is reachable', () => {
  itLive('answers its version endpoint', async () => {
    const status = await getHindsightStatus();
    expect(
      status.reachable,
      `Hindsight is not reachable at ${status.baseUrl}: ${status.reason ?? 'unknown'}`,
    ).toBe(true);
    expect(status.version).toBeTruthy();
    expect(status.bankId).toBe(hindsightConfig.bankId);
  });
});

describe('recall against the live server', () => {
  itLive('returns an available bundle with valid MemoryReferences', async () => {
    const bundle = await runRecall(
      'compliance finding root cause remediation outcome lesson',
    );

    expect(bundle.historicalMemoryAvailable).toBe(true);
    expect(bundle.memories.length).toBeGreaterThan(0);
    expect(bundle.durationMs).toBeGreaterThanOrEqual(0);

    for (const memory of bundle.memories) {
      // Every fact must be attributable or explicitly anonymous — never a
      // half-parsed object presented as history.
      expect(memory.factId).toBeTruthy();
      expect(memory.text).toBeTruthy();
      expect(memory.scoresAreRelative).toBe(true);
      if (memory.metadata?.caseId) expect(memory.caseId).toBe(memory.metadata.caseId);
    }
  });

  itLive('survives the id -> factId adapter for every live result', async () => {
    const bundle = await runRecall('remediation attempted verification result');
    // A mapping failure shows up as `status: 'error'` with zero memories.
    expect(bundle.status).not.toBe('error');
    expect(bundle.historicalMemoryAvailable).toBe(true);
  });
});

describe('retain -> recall round trip', () => {
  const CASE_ID = 'IT-PROBE';

  itLive('writes a memory that recall can find and attribute', async () => {
    const write = await retainLesson({
      caseId: CASE_ID,
      controlId: 'AC-2',
      lesson:
        'Integration probe: event-driven revocation is required for terminated privileged accounts.',
      context: 'integration probe',
    });

    expect(write.ok, write.reason ?? '').toBe(true);
    expect(write.written).toBeGreaterThan(0);

    // Extraction + indexing are synchronous on `async: false`, but allow a
    // brief settle so this does not fail on timing alone.
    let found: MemoryReference | undefined;
    for (let attempt = 0; attempt < 5 && !found; attempt += 1) {
      const bundle = await runRecall(
        'integration probe event-driven revocation terminated privileged accounts',
      );
      found = bundle.memories.find((m) => m.caseId === CASE_ID);
      if (!found) await new Promise((r) => setTimeout(r, 1500));
    }

    expect(
      found,
      'memory written with caseId metadata was not recallable with that caseId',
    ).toBeTruthy();
    expect(found?.metadata?.caseId).toBe(CASE_ID);
    expect(found?.stage).toBe('lesson');
  });
});

describe('gatherHistoricalContext over live memory', () => {
  itLive('assembles attributed historical cases, not loose fragments', async () => {
    const { bundle, cases } = await gatherHistoricalContext(finding);

    expect(bundle.historicalMemoryAvailable).toBe(true);
    expect(cases.length).toBeGreaterThan(0);

    for (const c of cases) {
      expect(c.caseId).toBeTruthy();
      expect(c.facts.length).toBeGreaterThan(0);
      expect(c.relevance).not.toBeNull();
    }
    // Cases must be ordered most-relevant first.
    const relevances = cases.map((c) => c.relevance ?? -1);
    expect([...relevances].sort((a, b) => b - a)).toEqual(relevances);
  });

  itLive('changes the recommendation relative to the stateless answer', async () => {
    const { cases } = await gatherHistoricalContext(finding);

    const baseline = deriveStatelessRecommendation(finding, rootCause);
    const stateless = applyMemory(finding, rootCause, baseline, []);
    const withMemory = applyMemory(finding, rootCause, baseline, cases);

    // The whole point: identical finding, different memory, different answer.
    expect(cases.length).toBeGreaterThan(0);
    expect(withMemory.recommendation).not.toBe(stateless.recommendation);
    expect(withMemory.whyMemoryChangedIt).not.toBe(stateless.whyMemoryChangedIt);
  });
});

describe('assembleHistoricalCases', () => {
  it('groups recalled facts by caseId so history is attributable', () => {
    const memories = [
      {
        factId: 'a',
        caseId: 'H-1',
        stage: 'finding',
        text: 'Case #H-1 finding text',
        type: 'world',
        scores: { final: 0.5 },
        scoresAreRelative: true,
        metadata: { caseId: 'H-1', stage: 'finding', outcome: 'FAILURE', recurrence: 'true' },
      },
      {
        factId: 'b',
        caseId: 'H-1',
        stage: 'remediation',
        text: 'Case #H-1 remediation attempted: the obvious fix',
        type: 'world',
        scores: { final: 0.4 },
        scoresAreRelative: true,
        metadata: { caseId: 'H-1', stage: 'remediation' },
      },
      {
        factId: 'c',
        caseId: 'H-2',
        stage: 'finding',
        text: 'Case #H-2 other finding',
        type: 'world',
        scores: { final: 0.3 },
        scoresAreRelative: true,
        metadata: { caseId: 'H-2', stage: 'finding', outcome: 'SUCCESS', recurrence: 'false' },
      },
    ] as unknown as MemoryReference[];

    const cases = assembleHistoricalCases(memories);

    expect(cases).toHaveLength(2);
    expect(cases[0].caseId).toBe('H-1'); // most relevant first
    expect(cases[0].outcome).toBe('FAILURE');
    expect(cases[0].recurrence).toBe(true);
    expect(cases[0].daysToRecurrence).toBeUndefined();
    expect(cases[0].remediationAttempted).toBe('the obvious fix');
    expect(cases[1].caseId).toBe('H-2');
  });

  it('recovers the outcome regardless of the order Hindsight returns facts in', () => {
    // Regression: Hindsight ranks by relevance, so the first fact of a group is
    // often a lesson/root-cause fact with no `outcome` metadata. Reading the
    // outcome from `facts[0]` alone used to drop it, which stopped the engine
    // from rejecting a fix history had already shown to fail.
    const lessonFirst = [
      {
        factId: 'l1',
        caseId: 'H-9',
        stage: 'lesson',
        text: 'Case #H-9 lesson learned: validate first',
        type: 'world',
        scores: { final: 0.99 },
        scoresAreRelative: true,
        // No `outcome` on this fact — this is the case that used to break.
        metadata: { caseId: 'H-9', stage: 'lesson' },
      },
      {
        factId: 'o1',
        caseId: 'H-9',
        stage: 'outcome',
        text: 'Case #H-9 outcome: FAILURE. The finding recurred after 30 days.',
        type: 'world',
        scores: { final: 0.2 },
        scoresAreRelative: true,
        metadata: {
          caseId: 'H-9',
          stage: 'outcome',
          outcome: 'FAILURE',
          recurrence: 'true',
          daysToRecurrence: '30',
        },
      },
      {
        factId: 'r1',
        caseId: 'H-9',
        stage: 'remediation',
        text: 'Case #H-9 remediation attempted: the obvious fix',
        type: 'world',
        scores: { final: 0.15 },
        scoresAreRelative: true,
        metadata: { caseId: 'H-9', stage: 'remediation', outcome: 'FAILURE' },
      },
    ] as unknown as MemoryReference[];

    const cases = assembleHistoricalCases(lessonFirst);

    expect(cases).toHaveLength(1);
    expect(cases[0].outcome).toBe('FAILURE');
    expect(cases[0].recurrence).toBe(true);
    expect(cases[0].daysToRecurrence).toBe(30);
    expect(cases[0].remediationAttempted).toBe('the obvious fix');
    expect(cases[0].lesson).toBe('validate first');
  });

  it('ignores an outcome value outside the vocabulary rather than trusting it', () => {
    const bogus = [
      {
        factId: 'b1',
        caseId: 'H-10',
        stage: 'outcome',
        text: 'Case #H-10 outcome: MIRACULOUS',
        type: 'world',
        scores: { final: 0.5 },
        scoresAreRelative: true,
        metadata: { caseId: 'H-10', stage: 'outcome', outcome: 'MIRACULOUS' },
      },
    ] as unknown as MemoryReference[];

    expect(assembleHistoricalCases(bogus)[0].outcome).toBeUndefined();
  });

  it('groups facts with no caseId under "unknown" instead of dropping them', () => {
    const orphan = {
      factId: 'x',
      text: 'Some unattributed observation',
      type: 'world',
      scores: { final: 0.9 },
      scoresAreRelative: true,
      metadata: { stage: 'lesson' },
    } as unknown as MemoryReference;

    const cases = assembleHistoricalCases([orphan]);

    expect(cases).toHaveLength(1);
    expect(cases[0].caseId).toBe('unknown');
    expect(cases[0].anonymous).toBe(true);
  });
});
