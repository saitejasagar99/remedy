/**
 * Recall must degrade honestly.
 *
 * The requirement is explicit: never fabricate history. When Hindsight cannot
 * answer, the bundle must say `historicalMemoryAvailable: false` — and the
 * recommendation layer must then fall back to a stateless answer rather than
 * presenting one.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { runRecall, mergeBundles } from '@/lib/memory/recall';
import { setHindsightClient } from '@/lib/memory/hindsight';

import { rawRecallResult } from '../helpers/fixtures';

/** Minimal stand-in for `HindsightClient` — only the methods recall touches. */
function fakeClient(
  behaviour: () => Promise<unknown> | unknown,
): Parameters<typeof setHindsightClient>[0] {
  return { recall: behaviour } as never;
}

afterEach(() => {
  setHindsightClient(null);
});

describe('runRecall', () => {
  it('returns an unavailable bundle when the server cannot be reached', async () => {
    setHindsightClient(
      fakeClient(() => {
        throw new Error('fetch failed: ECONNREFUSED 127.0.0.1:0');
      }),
    );

    const bundle = await runRecall('anything');

    expect(bundle.historicalMemoryAvailable).toBe(false);
    expect(bundle.status).toBe('unavailable');
    expect(bundle.memories).toHaveLength(0);
    expect(bundle.reason).toBeTruthy();
  });

  it('maps a healthy response and preserves case attribution', async () => {
    setHindsightClient(fakeClient(() => ({ results: [rawRecallResult()] })));

    const bundle = await runRecall('anything');

    expect(bundle.historicalMemoryAvailable).toBe(true);
    expect(bundle.memories).toHaveLength(1);
    expect(bundle.memories[0].caseId).toBe('H-102');
  });

  it('reports an empty bank as available-but-empty, not as failure', async () => {
    setHindsightClient(fakeClient(() => ({ results: [] })));

    const bundle = await runRecall('anything');

    expect(bundle.historicalMemoryAvailable).toBe(true);
    expect(bundle.status).toBe('empty');
  });

  it('reports an error rather than claiming "no memory" when parsing fails', async () => {
    setHindsightClient(
      fakeClient(() => ({
        results: [{ unexpected: 'shape' }, { alsoUnexpected: true }],
      })),
    );

    const bundle = await runRecall('anything');

    expect(bundle.historicalMemoryAvailable).toBe(false);
    expect(bundle.status).toBe('error');
    expect(bundle.memories).toHaveLength(0);
  });
});

describe('mergeBundles', () => {
  it('keeps the worst availability status across arms', () => {
    const ok = {
      historicalMemoryAvailable: true,
      status: 'ok' as const,
      memories: [rawRecallResult()].map((raw) => ({
        factId: String(raw.id),
        text: String(raw.text),
        type: 'world' as const,
        scoresAreRelative: true as const,
        metadata: undefined,
      })),
    };
    const down = {
      historicalMemoryAvailable: false,
      status: 'unavailable' as const,
      reason: 'Hindsight recall timed out after 12000ms',
      memories: [],
    };

    // One arm up, one down: history that partially arrived is still real, and
    // the merge must not discard it because a sibling query failed.
    const merged = mergeBundles([ok, down]);
    expect(merged.historicalMemoryAvailable).toBe(true);
    expect(merged.memories).toHaveLength(1);

    // Every arm down: nothing may be presented as recalled history.
    const allDown = mergeBundles([down, { ...down }]);
    expect(allDown.historicalMemoryAvailable).toBe(false);
    expect(allDown.memories).toHaveLength(0);
    expect(allDown.reason).toMatch(/timed out/);
  });
});
