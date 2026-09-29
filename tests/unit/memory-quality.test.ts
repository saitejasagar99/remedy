/**
 * Extracted history must be the content REMEDY retained, not metadata echoes.
 *
 * Two production defects are pinned here because both were invisible to the
 * A ≠ B assertion while silently degrading what it asserted:
 *
 *  1. The fact extractor emits short `key: value` facts alongside the prose —
 *     `recurrence: true`, `Outcome: FAILURE` — inheriting the stage they were
 *     filed under. They are one line long, so they out-scored the sentences
 *     they summarise, and a case ended up reporting its *remediation attempted*
 *     as `recurrence: true`.
 *  2. Recall returns fragments as well as the sentence that opened with
 *     `Case #<id>`. Taking the first fact per stage therefore picked fragments
 *     at random depending on relevance ordering.
 *
 * Both bugs produced a confident, well-formed, wrong answer — which is exactly
 * what an explanation panel is supposed to make impossible.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { assembleHistoricalCases, didNotHold } from '@/lib/agent/historical';
import { runRecall } from '@/lib/memory/recall';
import { setHindsightClient } from '@/lib/memory/hindsight';
import { isMetadataEcho, toMemoryReference } from '@/lib/memory/memory-types';
import type { MemoryReference } from '@/lib/models/schemas';

/** Hindsight fact in the wire shape. */
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

function referenceOf(raw: Record<string, unknown>): MemoryReference {
  const mapped = toMemoryReference(raw);
  if (!mapped) throw new Error('test fixture did not map to a MemoryReference');
  return mapped;
}

afterEach(() => {
  setHindsightClient(null);
});

describe('isMetadataEcho', () => {
  it('recognises scalar restatements of metadata, provenance included', () => {
    expect(isMetadataEcho('recurrence: true | When: Wednesday, March 11, 2026')).toBe(true);
    expect(isMetadataEcho('Outcome: FAILURE | When: 2026-03-11')).toBe(true);
    expect(isMetadataEcho('Days to recurrence: 22')).toBe(true);
    expect(isMetadataEcho('Verification result: PASS | When: 2026-03-11')).toBe(true);
    expect(isMetadataEcho('ControlId: AC-2(3) | When: Monday, June 1, 2026')).toBe(true);
    expect(isMetadataEcho('Remediation attempt for Case #134')).toBe(true);
  });

  it('never mistakes REMEDY\'s own retained prose for an echo', () => {
    // The `Case #` guard is what keeps `outcome: FAILURE` content and
    // `Outcome: FAILURE` noise separable — they differ only by that prefix.
    expect(isMetadataEcho('Case #119 outcome: FAILURE. The finding recurred after 30 days.')).toBe(
      false,
    );
    expect(isMetadataEcho('Case #119 verification result: PASS | When: 2026-03-11')).toBe(false);
    expect(isMetadataEcho('Case #119 recurrence: none recorded.')).toBe(false);
    expect(isMetadataEcho('Case #087 remediation attempted')).toBe(false);
    expect(
      isMetadataEcho(
        'Implementation: Set account end-dating from the procurement contract record at creation, with a nightly job expiring accounts past their end date.',
      ),
    ).toBe(false);
    expect(
      isMetadataEcho(
        'Audit sampling found 14 contractor accounts active more than 90 days past their contract end date',
      ),
    ).toBe(false);
  });
});

describe('runRecall', () => {
  it('drops echoes before ranking so they cannot take a real fact\'s slot', async () => {
    setHindsightClient({
      recall: async () => ({
        results: [
          fact(
            'echo',
            'recurrence: true | When: Wednesday, March 11, 2026',
            { caseId: '119', stage: 'remediation', recurrence: 'true' },
            0.99,
          ),
          fact(
            'real',
            'Case #119 remediation attempted: Implement automatic expiry dates on contractor accounts.',
            { caseId: '119', stage: 'remediation' },
            0.70,
          ),
        ],
      }),
    } as never);

    const bundle = await runRecall('anything');

    expect(bundle.historicalMemoryAvailable).toBe(true);
    expect(bundle.memories).toHaveLength(1);
    expect(bundle.memories[0].factId).toBe('real');
  });
});

describe('assembleHistoricalCases', () => {
  it('reports the retained remediation, not the highest-scoring fragment', () => {
    const cases = assembleHistoricalCases(
      [
        // Recall order, deliberately hostile: echoes first, canonical last.
        fact(
          'e1',
          'recurrence: true | When: Wednesday, March 11, 2026',
          { caseId: '119', stage: 'remediation', outcome: 'FAILURE' },
          0.99,
        ),
        fact(
          'e2',
          'Outcome: FAILURE | When: Wednesday, March 11, 2026',
          { caseId: '119', stage: 'remediation', outcome: 'FAILURE' },
          0.98,
        ),
        fact(
          'p1',
          'Implementation: Set account end-dating from the procurement contract record.',
          { caseId: '119', stage: 'remediation' },
          0.90,
        ),
        fact(
          'c1',
          'Case #119 remediation attempted: Implement automatic expiry dates on contractor accounts.',
          { caseId: '119', stage: 'remediation' },
          0.70,
        ),
        fact(
          't2',
          'Historical compliance finding in category CONTRACTOR_ACCOUNTS | When: Wednesday, March 11, 2026',
          { caseId: '119', stage: 'finding' },
          0.95,
        ),
        fact(
          't1',
          'Case #119: Contractor accounts remain active beyond contract end (AC-2(11), HIGH, ContractorPro). Historical compliance finding in category CONTRACTOR_ACCOUNTS.',
          { caseId: '119', stage: 'finding', controlId: 'AC-2(11)', category: 'CONTRACTOR_ACCOUNTS' },
          0.80,
        ),
      ].map(referenceOf),
    );

    expect(cases).toHaveLength(1);
    expect(cases[0].remediationAttempted).toBe(
      'Implement automatic expiry dates on contractor accounts.',
    );
    expect(cases[0].title.startsWith('Contractor accounts remain active beyond contract end')).toBe(
      true,
    );
    expect(cases[0].controlId).toBe('AC-2(11)');
  });

  it('prefers a fragment with content over a prefix-only label', () => {
    // The extractor can split `Case #087 remediation attempted: <fix>` so only
    // the label survives; reporting an empty field would be worse than
    // reporting the implementation sentence that did survive.
    const cases = assembleHistoricalCases(
      [
        fact(
          'l1',
          'Case #087 remediation attempted',
          { caseId: '087', stage: 'remediation' },
          0.90,
        ),
        fact(
          'l2',
          'Implementation: Removed employeeType filter, added replay of missed events after an outage.',
          { caseId: '087', stage: 'remediation' },
          0.50,
        ),
      ].map(referenceOf),
    );

    expect(cases[0].remediationAttempted).toMatch(/^Implementation:/);
  });

  it('never lets a relevance cut drop the only prior failure', () => {
    // Six unrelated successes outrank the one failure that matters. A pure
    // top-N cut would assemble an all-success history, the rejection gate
    // would find nothing to reject, and the answer would silently revert to
    // the stateless one — indistinguishable from "no memory was found".
    const memories: MemoryReference[] = [];
    const successes = ['S7', 'S6', 'S5', 'S4', 'S3', 'S2', 'S1'];
    successes.forEach((id, i) => {
      memories.push(
        referenceOf(
          fact(
            `${id}-f`,
            `Case #${id}: Cached entitlement export is stale (AC-2, LOW, Scheduler). Historical compliance finding in category EMPLOYEE_ACCESS.`,
            {
              caseId: id,
              stage: 'finding',
              controlId: 'AC-2',
              category: 'EMPLOYEE_ACCESS',
              outcome: 'SUCCESS',
              recurrence: 'false',
            },
            0.95 - i * 0.03,
          ),
        ),
        referenceOf(
          fact(
            `${id}-r`,
            `Case #${id} remediation attempted: rebuilt the export scheduler.`,
            { caseId: id, stage: 'remediation', outcome: 'SUCCESS' },
            0.9 - i * 0.03,
          ),
        ),
      );
    });
    memories.push(
      referenceOf(
        fact(
          'F1-f',
          'Case #F1: Privileged accounts not disabled after termination (AC-2, HIGH, Identity). Historical compliance finding in category EMPLOYEE_ACCESS.',
          {
            caseId: 'F1',
            stage: 'finding',
            controlId: 'AC-2',
            category: 'EMPLOYEE_ACCESS',
            outcome: 'FAILURE',
            recurrence: 'true',
            daysToRecurrence: '43',
          },
          0.30,
        ),
      ),
      referenceOf(
        fact(
          'F1-r',
          'Case #F1 remediation attempted: automated deprovisioning on termination.',
          { caseId: 'F1', stage: 'remediation', outcome: 'FAILURE' },
          0.28,
        ),
      ),
    );

    const cases = assembleHistoricalCases(memories, 6);

    expect(cases).toHaveLength(6);
    expect(cases.filter(didNotHold)).toHaveLength(1);
    expect(cases[0].caseId).toBe('S7'); // order is still relevance-first
    const failure = cases.find(didNotHold);
    expect(failure?.caseId).toBe('F1');
    expect(failure?.remediationAttempted).toBe(
      'automated deprovisioning on termination.',
    );
    // Both sides of the contrast survive, not just the failure.
    expect(cases.filter((c) => c.outcome === 'SUCCESS').length).toBeGreaterThanOrEqual(1);
  });
});
