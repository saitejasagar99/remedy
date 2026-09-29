/**
 * Dashboard arithmetic must be derived, never asserted by hand.
 *
 * The product rule is that every number on the dashboard comes from rows the
 * application actually wrote. These tests pin the rollup logic down so a
 * counter can never drift into being a decorative figure — if
 * `memory.avoidedFailedFix` says 2, two stored analyses must carry a rejected
 * prior action.
 */
import { describe, expect, it } from 'vitest';

import { computeDashboardStats, controlFamily, type DashboardInput } from '@/lib/dashboard';
import { friendlyError, verificationNote } from '@/app/lib/errors';
import { makeFinding } from '../helpers/fixtures';

function empty(): DashboardInput {
  return { findings: [], analyses: [], outcomes: [], remediations: [] };
}

describe('controlFamily', () => {
  it('strips an enhancement back to its base control', () => {
    expect(controlFamily('AC-2(3)')).toBe('AC-2');
    expect(controlFamily('AC-2')).toBe('AC-2');
    expect(controlFamily('IA-2(1)(a)')).toBe('IA-2');
  });

  it('falls back to the raw identifier when nothing matches', () => {
    expect(controlFamily('custom-control')).toBe('CUSTOM-CONTROL');
  });
});

describe('computeDashboardStats', () => {
  it('is all zeros for an empty workspace', () => {
    const stats = computeDashboardStats(empty());

    expect(stats.totals.findings).toBe(0);
    expect(stats.memory.analyzed).toBe(0);
    expect(stats.systemic).toEqual([]);
    expect(stats.lastActivityAt).toBeNull();
  });

  it('separates open from resolved findings', () => {
    const stats = computeDashboardStats({
      ...empty(),
      findings: [
        makeFinding({ id: 'A', status: 'OPEN' }),
        makeFinding({ id: 'B', status: 'AWAITING_APPROVAL' }),
        makeFinding({ id: 'C', status: 'RESOLVED' }),
      ],
    });

    expect(stats.totals.findings).toBe(3);
    expect(stats.totals.open).toBe(2);
    expect(stats.totals.resolved).toBe(1);
    expect(stats.totals.awaitingApproval).toBe(1);
  });

  it('counts a finding as recurring from any of the three signals', () => {
    const stats = computeDashboardStats({
      ...empty(),
      findings: [
        makeFinding({ id: 'A', status: 'RECURRED' }),
        makeFinding({ id: 'B', recurrenceOf: 'A' }),
        makeFinding({ id: 'C' }),
      ],
      // A finding that was re-opened because a prior fix came back.
      outcomes: [{ findingId: 'D', result: 'FAILURE', recurrence: true, recordedAt: '2026-01-01' }],
    });

    // A and B are findings; D has no finding row so it only shows up in the
    // recurrence count through its own outcome, never as a phantom finding.
    expect(stats.totals.recurring).toBe(2);
    expect(stats.totals.findings).toBe(3);
    expect(stats.remediation.recurred).toBe(1);
  });

  it('tallies outcomes and lifecycle statuses separately', () => {
    const stats = computeDashboardStats({
      ...empty(),
      outcomes: [
        { findingId: 'A', result: 'SUCCESS', recurrence: false, recordedAt: '2026-01-01' },
        { findingId: 'B', result: 'FAILURE', recurrence: true, recordedAt: '2026-01-02' },
        { findingId: 'C', result: 'PARTIAL', recurrence: false, recordedAt: '2026-01-03' },
      ],
      remediations: [
        { findingId: 'A', status: 'PROPOSED', proposedAt: 'x', approvedAt: null, implementedAt: null },
        { findingId: 'B', status: 'APPROVED', proposedAt: 'x', approvedAt: 'y', implementedAt: null },
        { findingId: 'C', status: 'IMPLEMENTED', proposedAt: 'x', approvedAt: 'y', implementedAt: 'z' },
        { findingId: 'D', status: 'VERIFIED', proposedAt: 'x', approvedAt: 'y', implementedAt: 'z' },
      ],
    });

    expect(stats.remediation.successful).toBe(1);
    expect(stats.remediation.failed).toBe(1);
    expect(stats.remediation.partial).toBe(1);
    expect(stats.remediation.proposed).toBe(1);
    expect(stats.remediation.approved).toBe(1);
    expect(stats.remediation.implemented).toBe(1);
    expect(stats.remediation.verified).toBe(1);
  });

  it('derives memory impact from stored analyses only', () => {
    const stats = computeDashboardStats({
      ...empty(),
      analyses: [
        {
          findingId: 'A',
          memoryStatus: 'ok',
          memoryInfluenced: true,
          casesUsed: 3,
          rejected: 1,
          conflicts: 0,
          changed: true,
          createdAt: '2026-01-01',
        },
        {
          findingId: 'B',
          memoryStatus: 'ok',
          memoryInfluenced: true,
          casesUsed: 2,
          rejected: 0,
          conflicts: 1,
          changed: false,
          createdAt: '2026-01-02',
        },
        {
          findingId: 'C',
          memoryStatus: 'unavailable',
          memoryInfluenced: false,
          casesUsed: 0,
          rejected: 0,
          conflicts: 0,
          changed: false,
          createdAt: '2026-01-03',
        },
      ],
    });

    expect(stats.memory.analyzed).toBe(3);
    expect(stats.memory.influenced).toBe(2);
    expect(stats.memory.changedAnswer).toBe(1);
    expect(stats.memory.avoidedFailedFix).toBe(1);
    expect(stats.memory.analysesWithConflict).toBe(1);
    expect(stats.memory.casesRecalled).toBe(5);
    expect(stats.memory.byStatus).toEqual({ ok: 2, unavailable: 1 });
    expect(stats.totals.analyzed).toBe(3);
  });

  it('treats a control family as systemic only on evidence of a pattern', () => {
    const stats = computeDashboardStats({
      ...empty(),
      findings: [
        makeFinding({ id: 'A', controlId: 'AC-2(3)' }),
        makeFinding({ id: 'B', controlId: 'AC-2(1)' }),
        makeFinding({ id: 'C', controlId: 'AU-2' }),
      ],
      outcomes: [{ findingId: 'B', result: 'FAILURE', recurrence: false, recordedAt: '2026-01-01' }],
    });

    const ac2 = stats.systemic.find((s) => s.controlFamily === 'AC-2');
    expect(ac2).toBeDefined();
    expect(ac2?.findings).toBe(2);
    expect(ac2?.failed).toBe(1);
    // Newest control first — the one the auditor just flagged.
    expect(ac2?.controls).toEqual(['AC-2(1)', 'AC-2(3)']);

    // AU-2 appears once and never failed, so it is an incident, not a pattern.
    expect(stats.systemic.some((s) => s.controlFamily === 'AU-2')).toBe(false);
  });

  it('orders systemic issues by recurrence, then failure, then volume', () => {
    const stats = computeDashboardStats({
      ...empty(),
      findings: [
        makeFinding({ id: 'A', controlId: 'AU-2' }),
        makeFinding({ id: 'B', controlId: 'AU-2' }),
        makeFinding({ id: 'C', controlId: 'AU-2' }),
        makeFinding({ id: 'D', controlId: 'AC-2', status: 'RECURRED' }),
      ],
    });

    expect(stats.systemic.map((s) => s.controlFamily)).toEqual(['AC-2', 'AU-2']);
  });

  it('reports the newest activity timestamp across every source', () => {
    const stats = computeDashboardStats({
      findings: [makeFinding({ id: 'A', updatedAt: '2026-01-05T00:00:00.000Z' })],
      analyses: [
        {
          findingId: 'A',
          memoryStatus: 'ok',
          memoryInfluenced: true,
          casesUsed: 1,
          rejected: 0,
          conflicts: 0,
          changed: true,
          createdAt: '2026-01-09T00:00:00.000Z',
        },
      ],
      outcomes: [
        { findingId: 'A', result: 'SUCCESS', recurrence: false, recordedAt: '2026-01-07T00:00:00.000Z' },
      ],
      remediations: [],
    });

    expect(stats.lastActivityAt).toBe('2026-01-09T00:00:00.000Z');
  });
});

describe('friendlyError', () => {
  it('translates a memory-layer failure into its consequence, not its stack', () => {
    const message = friendlyError('fetch failed: ECONNREFUSED 127.0.0.1:8888 (Hindsight)');

    expect(message).toMatch(/Historical memory is temporarily unavailable/i);
    expect(message).toMatch(/does not use any organisational experience|stateless/i);
    expect(message).not.toContain('ECONNREFUSED');
  });

  it('explains an LLM failure as a fallback rather than a dead end', () => {
    expect(friendlyError('LLM request timed out')).toMatch(/deterministic reasoning/i);
    expect(friendlyError('Ollama returned 500')).toMatch(/deterministic reasoning/i);
  });

  it('distinguishes a timeout from a validation problem', () => {
    expect(friendlyError('Request timed out after 120000ms')).toMatch(/stopped/i);
    expect(friendlyError('Zod validation failed on evidence')).toMatch(/highlighted fields/i);
  });

  it('passes an unrecognised message through instead of inventing one', () => {
    expect(friendlyError('disk is full')).toBe('disk is full');
  });
});

describe('verificationNote', () => {
  it('flags the two results that must not be treated as closed', () => {
    expect(verificationNote('FAIL')).toMatch(/stays open/i);
    expect(verificationNote('PARTIAL')).toMatch(/partial/i);
  });

  it('says nothing when verification passed', () => {
    expect(verificationNote('PASS')).toBeNull();
  });
});
