/**
 * Conflict detection — REMEDY must never blindly trust memory.
 *
 * When a historical case asserts a root cause but the *current* evidence says
 * that part of the system is healthy, the conflict must be raised, severity
 * assigned, and human review forced. Never auto-resolved.
 */
import { describe, expect, it } from 'vitest';

import {
  detectConflicts,
  extractKeyTerms,
  isHealthyAssertion,
  requiresHumanReview,
} from '@/lib/agent/conflict';

import { makeFinding, makeSummary } from '../helpers/fixtures';

const finding = makeFinding();

describe('extractKeyTerms', () => {
  it('keeps the subject of a root cause and drops stopwords', () => {
    const terms = extractKeyTerms(
      'HR to IAM synchronization was not wired into the deprovisioning pipeline',
    );
    expect(terms.has('synchronization')).toBe(true);
    expect(terms.has('pipeline')).toBe(true);
    expect(terms.has('the')).toBe(false);
    expect(terms.has('root')).toBe(false);
  });

  it('stems so plural and derived variants can still match', () => {
    // "-ation" drops 4 chars, "-s" drops 1: both are how the matcher bridges
    // "revocation"/"revocat" and "entitlements"/"entitlement".
    const terms = extractKeyTerms('automated revocation of entitlements');
    expect(terms.has('revocation')).toBe(true);
    expect(terms.has('revoca')).toBe(true);
    expect(terms.has('entitlements')).toBe(true);
    expect(terms.has('entitlement')).toBe(true);
  });
});

describe('isHealthyAssertion', () => {
  it('recognises evidence asserting the control works', () => {
    expect(isHealthyAssertion('Integration is healthy and passing')).toBe(true);
    expect(isHealthyAssertion('Revocation jobs are working normally')).toBe(true);
    expect(isHealthyAssertion('No failures observed in the last 30 days')).toBe(true);
  });

  it('does not mistake a problem report for a healthy one', () => {
    expect(isHealthyAssertion('Two privileged accounts remained active')).toBe(false);
    expect(isHealthyAssertion('Revocation lagged the termination date')).toBe(false);
  });
});

describe('detectConflicts', () => {
  const historyClaimingSync = makeSummary({
    caseId: 'H-087',
    rootCause: 'HR to IAM synchronization pipeline failed intermittently',
    recurrence: true,
  });

  it('raises a conflict when current evidence contradicts the historical cause', () => {
    const contradicting = makeFinding({
      evidence: [
        {
          id: 'EV_9',
          source: 'Integration health check',
          observation: 'The synchronization pipeline is healthy and passing today',
          collectedAt: '2026-01-15T10:00:00.000Z',
        },
      ],
    });

    const conflicts = detectConflicts({
      finding: contradicting,
      cases: [historyClaimingSync],
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      kind: 'ROOT_CAUSE_DISAGREEMENT',
      severity: 'HIGH', // recurrence raises the stakes
      requiresHumanReview: true,
    });
    expect(conflicts[0].historicalClaim).toContain('H-087');
    expect(conflicts[0].currentEvidence).toContain('healthy');
    expect(requiresHumanReview(conflicts)).toBe(true);
  });

  it('returns no conflict when evidence agrees with history', () => {
    const conflicts = detectConflicts({ finding, cases: [historyClaimingSync] });
    expect(conflicts).toHaveLength(0);
    expect(requiresHumanReview(conflicts)).toBe(false);
  });

  it('returns no conflict when memory is absent — an absent memory cannot disagree', () => {
    expect(detectConflicts({ finding, cases: [] })).toEqual([]);
  });

  it('never treats an unattributed (anonymous) memory as authoritative', () => {
    const anonymous = makeSummary({
      caseId: 'unknown',
      anonymous: true,
      rootCause: 'synchronization pipeline failure',
    });
    const contradicting = makeFinding({
      evidence: [
        {
          id: 'EV_9',
          source: 'Health check',
          observation: 'The synchronization pipeline is healthy',
          collectedAt: '2026-01-15T10:00:00.000Z',
        },
      ],
    });

    expect(detectConflicts({ finding: contradicting, cases: [anonymous] })).toEqual([]);
  });

  it('emits at most one conflict per historical case', () => {
    const contradicting = makeFinding({
      evidence: [
        {
          id: 'EV_9',
          source: 'Health check',
          observation: 'The synchronization pipeline is healthy and passing',
          collectedAt: '2026-01-15T10:00:00.000Z',
        },
        {
          id: 'EV_10',
          source: 'Second health check',
          observation: 'Synchronization confirmed working again',
          collectedAt: '2026-01-15T11:00:00.000Z',
        },
      ],
    });

    const conflicts = detectConflicts({
      finding: contradicting,
      cases: [historyClaimingSync],
    });
    expect(conflicts).toHaveLength(1);
  });
});
