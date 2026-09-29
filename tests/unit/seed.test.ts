/**
 * Seeding must be idempotent.
 *
 * `npm run seed` is expected to be safe to re-run — a duplicated memory bank
 * would make "what happened last time" ambiguous, which is exactly the
 * ambiguity REMEDY exists to remove.
 */
import { describe, expect, it, vi } from 'vitest';

import { seedHistoricalCases } from '@/lib/seed/seed';
import { HISTORICAL_CASES } from '@/lib/seed/historical-cases';
import { setHindsightClient } from '@/lib/memory/hindsight';
import { stagesFor } from '@/lib/memory/memory-types';
import { historicalCaseSchema } from '@/lib/models/schemas';

interface RetainCall {
  content: string;
  metadata?: Record<string, string>;
}

/** Every lifecycle stage one case is expected to have stored. */
function stagesOf(index: number): string[] {
  const parsed = historicalCaseSchema.parse(HISTORICAL_CASES[index]);
  return stagesFor(parsed);
}

/** Records retains and answers `listMemories` from what it has seen. */
function recordingClient(
  initial: Array<{ metadata?: { caseId?: string; stage?: string } }> = [],
) {
  const stored = [...initial];
  const retains: RetainCall[] = [];

  const client = {
    listMemories: vi.fn(async (_bank: string, opts?: { limit?: number; offset?: number }) => ({
      items: stored,
      total: stored.length,
      limit: opts?.limit ?? 100,
      offset: opts?.offset ?? 0,
    })),
    retain: vi.fn(async (_bank: string, content: string, options?: { metadata?: Record<string, string> }) => {
      retains.push({ content, metadata: options?.metadata });
      stored.push({ metadata: options?.metadata });
      return { success: true, bank_id: 'remedy', items_count: 1, async: false };
    }),
  };

  return { client: client as never, retains, stored };
}

/** Bank contents in which the first `count` cases are *fully* stored. */
function fullBank(count: number): Array<{ metadata: { caseId: string; stage: string } }> {
  const items: Array<{ metadata: { caseId: string; stage: string } }> = [];
  for (let i = 0; i < count; i += 1) {
    const caseId = HISTORICAL_CASES[i].caseId;
    for (const stage of stagesOf(i)) items.push({ metadata: { caseId, stage } });
  }
  return items;
}

/** Bank contents where `caseId` has only its first stage — a partial write. */
function partialBank(caseId: string, stage: string) {
  return [{ metadata: { caseId, stage } }];
}

function restore(): void {
  setHindsightClient(null);
}

describe('seedHistoricalCases', () => {
  it('writes every case on an empty bank', async () => {
    const { client, retains } = recordingClient();
    setHindsightClient(client);

    const result = await seedHistoricalCases();
    restore();

    expect(result.reachable).toBe(true);
    expect(result.seeded).toBe(HISTORICAL_CASES.length);
    expect(result.alreadyPresent).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors).toEqual([]);
    expect(retains.length).toBeGreaterThan(HISTORICAL_CASES.length);
  });

  it('skips cases already complete in the bank — re-running never duplicates memory', async () => {
    const { client } = recordingClient(fullBank(5));
    setHindsightClient(client);

    const result = await seedHistoricalCases();
    restore();

    expect(result.alreadyPresent).toBe(5);
    expect(result.seeded).toBe(HISTORICAL_CASES.length - 5);
    expect(result.resumed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it('writes nothing at all when every case is already complete', async () => {
    const { client, retains } = recordingClient(fullBank(HISTORICAL_CASES.length));
    setHindsightClient(client);

    const result = await seedHistoricalCases();
    restore();

    expect(result.seeded).toBe(0);
    expect(result.alreadyPresent).toBe(HISTORICAL_CASES.length);
    expect(result.resumed).toBe(0);
    expect(retains).toHaveLength(0);
  });

  it('resumes a partially written case instead of skipping it as "already present"', async () => {
    // Regression: a timed-out run leaves a case with only its first stage.
    // Keying idempotency on caseId alone would treat it as complete forever.
    const target = HISTORICAL_CASES[0];
    const expected = stagesOf(0);
    expect(expected.length).toBeGreaterThan(1);

    const { client, retains } = recordingClient(partialBank(target.caseId, expected[0]));
    setHindsightClient(client);

    const result = await seedHistoricalCases();
    restore();

    expect(result.alreadyPresent).toBe(0);
    expect(result.resumed).toBe(1);
    // The partial case completed, and the 17 never-seeded cases were written.
    expect(result.seeded).toBe(HISTORICAL_CASES.length);
    expect(result.failed).toBe(0);

    // For the partial case specifically: exactly the missing stages were
    // written, and the stage already present was not written again.
    const targetRetains = retains.filter((r) => r.metadata?.caseId === target.caseId);
    expect(targetRetains).toHaveLength(expected.length - 1);
    const writtenStages = targetRetains.map((r) => r.metadata?.stage);
    expect(writtenStages).not.toContain(expected[0]);
    for (const stage of expected.slice(1)) expect(writtenStages).toContain(stage);
  });

  it('reports unreachable Hindsight instead of throwing', async () => {
    setHindsightClient({
      listMemories: async () => {
        throw new Error('fetch failed: ECONNREFUSED 127.0.0.1:0');
      },
    } as never);

    const result = await seedHistoricalCases();
    restore();

    expect(result.reachable).toBe(false);
    expect(result.seeded).toBe(0);
    expect(result.errors[0]?.caseId).toBe('connectivity');
  });

  it('attaches caseId metadata to every retained memory', async () => {
    const { client, retains } = recordingClient();
    setHindsightClient(client);

    await seedHistoricalCases();
    restore();

    // At least one memory per case, every one carrying the join key.
    const caseIds = new Set(retains.map((r) => r.metadata?.caseId));
    expect(caseIds.size).toBe(HISTORICAL_CASES.length);
    for (const r of retains) {
      expect(r.metadata?.caseId).toBeTruthy();
      expect(r.metadata?.stage).toBeTruthy();
    }
  });
});

describe('the seeded fixture set', () => {
  it('contains 10-20 cases, all schema-valid', () => {
    expect(HISTORICAL_CASES.length).toBeGreaterThanOrEqual(10);
    expect(HISTORICAL_CASES.length).toBeLessThanOrEqual(20);

    for (const raw of HISTORICAL_CASES) {
      const parsed = historicalCaseSchema.safeParse(raw);
      expect(
        parsed.success,
        `${String((raw as { caseId?: unknown }).caseId)}: ${
          parsed.success ? '' : JSON.stringify(parsed.error.issues)
        }`,
      ).toBe(true);
    }
  });

  it('has unique case ids', () => {
    const ids = HISTORICAL_CASES.map((c) => c.caseId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('varies its outcomes so memory can actually change an answer', () => {
    const outcomes = new Set(HISTORICAL_CASES.map((c) => c.outcome));
    expect(outcomes.has('SUCCESS')).toBe(true);
    expect(outcomes.has('FAILURE')).toBe(true);
    expect(outcomes.has('PARTIAL')).toBe(true);
    expect(HISTORICAL_CASES.some((c) => c.recurrence)).toBe(true);
  });

  it('includes same-control cases with different root causes and outcomes', () => {
    const byControl = new Map<string, Array<(typeof HISTORICAL_CASES)[number]>>();
    for (const c of HISTORICAL_CASES) {
      const list = byControl.get(c.controlId) ?? [];
      list.push(c);
      byControl.set(c.controlId, list);
    }

    const clusters = [...byControl.values()].filter((g) => g.length >= 2);
    expect(clusters.length).toBeGreaterThan(0);

    const contrast = clusters.find(
      (g) =>
        new Set(g.map((c) => c.outcome)).size > 1 &&
        new Set(g.map((c) => c.rootCause)).size > 1,
    );
    expect(contrast, 'no control cluster contrasts outcome AND root cause').toBeTruthy();
  });
});
