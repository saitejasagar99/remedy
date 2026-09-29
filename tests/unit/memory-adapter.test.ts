/**
 * Adapter tests: a live Hindsight `RecallResult` must become a `MemoryReference`
 * without losing or inventing anything.
 *
 * Regression cover for a bug found against the real server: the wire format
 * calls the identifier `id`, the domain calls it `factId`, and a naive
 * `safeParse` rejected 31/31 live results.
 */
import { describe, expect, it } from 'vitest';

import {
  dedupeById,
  finaliseBundle,
  toMemoryReference,
} from '@/lib/memory/memory-types';
import { MemoryStage } from '@/lib/models/enums';

import { rawRecallResult } from '../helpers/fixtures';

describe('toMemoryReference', () => {
  it('renames the wire `id` to the domain `factId`', () => {
    const raw = rawRecallResult();
    const ref = toMemoryReference(raw);

    expect(ref).not.toBeNull();
    expect(ref?.factId).toBe(raw.id);
  });

  it('round-trips metadata.caseId — the join key for every explanation', () => {
    const ref = toMemoryReference(rawRecallResult());
    expect(ref?.metadata?.caseId).toBe('H-102');
    expect(ref?.caseId).toBe('H-102');
    expect(ref?.stage).toBe(MemoryStage.OUTCOME);
  });

  it('flags scores as relative, never as a calibrated percentage', () => {
    const ref = toMemoryReference(rawRecallResult());
    expect(ref?.scoresAreRelative).toBe(true);
    expect(ref?.scores?.final).toBe(0.51);
  });

  it('normalises an unexpected fact type rather than dropping the fact', () => {
    const ref = toMemoryReference(rawRecallResult({ type: 'something_new' }));
    expect(ref?.type).toBe('world');
  });

  it('stringifies numeric and boolean metadata values', () => {
    const ref = toMemoryReference(
      rawRecallResult({ metadata: { caseId: 'H-102', recurrence: true, days: 21 } }),
    );
    expect(ref?.metadata).toEqual({ caseId: 'H-102', recurrence: 'true', days: '21' });
  });

  it('omits metadata values with no faithful string rendering', () => {
    const ref = toMemoryReference(
      rawRecallResult({ metadata: { caseId: 'H-102', nested: { a: 1 } } }),
    );
    expect(ref?.metadata).toEqual({ caseId: 'H-102' });
    expect(ref?.metadata).not.toHaveProperty('nested');
  });

  it('rejects a malformed result instead of inventing fields', () => {
    expect(toMemoryReference(rawRecallResult({ id: undefined, factId: undefined }))).toBeNull();
    expect(toMemoryReference(rawRecallResult({ text: undefined }))).toBeNull();
    expect(toMemoryReference(null)).toBeNull();
    expect(toMemoryReference('not an object')).toBeNull();
  });
});

describe('dedupeById', () => {
  it('removes duplicates while preserving Hindsight relevance order', () => {
    const a = toMemoryReference(
      rawRecallResult({ id: 'fact-a', scores: { final: 0.9 } }),
    )!;
    const b = toMemoryReference(
      rawRecallResult({ id: 'fact-b', text: 'other', scores: { final: 0.1 } }),
    )!;
    const c = toMemoryReference(
      rawRecallResult({ id: 'fact-c', text: 'third', scores: { final: 0.5 } }),
    )!;

    const out = dedupeById([a, b, a, c]);
    expect(out.map((m) => m.factId)).toEqual(['fact-a', 'fact-b', 'fact-c']);
    expect(out.map((m) => m.scores?.final)).toEqual([0.9, 0.1, 0.5]);
  });
});

describe('finaliseBundle', () => {
  it('reports an empty bank as available-but-empty, not unavailable', () => {
    const bundle = finaliseBundle([]);
    expect(bundle.historicalMemoryAvailable).toBe(true);
    expect(bundle.status).toBe('empty');
  });

  it('separates a weak tail from clearly relevant results', () => {
    const strong = toMemoryReference(rawRecallResult({ scores: { final: 0.6 } }))!;
    expect(finaliseBundle([strong]).status).toBe('ok');

    const weak = toMemoryReference(rawRecallResult({ scores: { final: 0.01 } }))!;
    expect(finaliseBundle([weak]).status).toBe('low_confidence');
  });
});
