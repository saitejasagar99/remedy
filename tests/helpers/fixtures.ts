/**
 * Shared test fixtures.
 *
 * Deliberately hand-built rather than generated: every field here is something
 * a test asserts on, so a reader can see exactly what the input was.
 */
import type { Finding, HistoricalCase, RootCause } from '@/lib/models/schemas';
import type { MemoryReference } from '@/lib/models/schemas';
import { MemoryStage } from '@/lib/models/enums';
import type { HistoricalCaseSummary } from '@/lib/agent/historical';

const NOW = '2026-01-15T10:00:00.000Z';

/** The finding every memory test uses — deliberately identical across cases. */
export function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'CF_test0001',
    controlId: 'AC-2',
    title: 'Privileged accounts not disabled after termination',
    description:
      'Two privileged VPN accounts belonging to terminated employees remained active 6 days after termination.',
    severity: 'HIGH',
    category: 'EMPLOYEE_ACCESS',
    affectedSystem: 'identity-gateway',
    status: 'OPEN',
    evidence: [
      {
        id: 'EV_1',
        source: 'IAM entitlement export',
        observation:
          'Two privileged accounts active 6 days past termination effective date',
        collectedAt: NOW,
      },
      {
        id: 'EV_2',
        source: 'HR leaver report',
        observation: 'Both employees terminated on 2026-01-05',
        collectedAt: NOW,
      },
    ],
    firstDetectedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function makeRootCause(overrides: Partial<RootCause> = {}): RootCause {
  return {
    id: 'RC_test0001',
    findingId: 'CF_test0001',
    rootCause: 'Termination events are not wired into the deprovisioning pipeline',
    contributingFactors: ['Manual HR export runs hourly'],
    confidence: 0.78,
    identifiedAt: NOW,
    method: 'HUMAN',
    ...overrides,
  };
}

/** The historical case whose failure is the whole point of the A≠B test. */
export function makeHistoricalCase(
  overrides: Partial<HistoricalCase> = {},
): HistoricalCase {
  return {
    caseId: 'H-102',
    controlId: 'AC-2',
    category: 'EMPLOYEE_ACCESS',
    affectedSystem: 'identity-gateway',
    title: 'Privileged accounts not disabled after termination',
    description:
      'Historical twin of the current finding: privileged accounts stayed active after leavers exited.',
    severity: 'HIGH',
    rootCause: 'Manual HR export was skipped during a holiday period',
    contributingFactors: ['Hourly manual export'],
    remediationAttempted:
      'Remove access for inactive employees and automate deprovisioning on termination',
    implementationDetails: 'Scheduled deprovisioning job added',
    verificationResult: 'PASS',
    outcome: 'FAILURE',
    recurrence: true,
    daysToRecurrence: 21,
    lessonLearned:
      'Event-driven revocation is required; scheduled exports leave a window the audit still flags.',
    observedSideEffects: [],
    closedAt: '2025-11-02T09:00:00.000Z',
    ...overrides,
  };
}

/** A summary as the recommendation step consumes it — post-recall. */
export function makeSummary(
  overrides: Partial<HistoricalCaseSummary> = {},
): HistoricalCaseSummary {
  return {
    caseId: 'H-102',
    anonymous: false,
    title: 'Privileged accounts not disabled after termination',
    controlId: 'AC-2',
    category: 'EMPLOYEE_ACCESS',
    affectedSystem: 'identity-gateway',
    severity: 'HIGH',
    outcome: 'FAILURE',
    remediationAttempted:
      'Remove access for inactive employees and automate deprovisioning on termination',
    rootCause: 'Manual HR export was skipped during a holiday period',
    lesson:
      'Event-driven revocation is required; scheduled exports leave a window the audit still flags.',
    recurrence: true,
    daysToRecurrence: 21,
    relevance: 0.62,
    facts: [],
    ...overrides,
  };
}

let factCounter = 0;

/**
 * Build a `MemoryReference` shaped exactly like a live Hindsight `RecallResult`
 * — including the `id` field the adapter must rename to `factId`.
 */
export function makeRecalledFact(
  overrides: Partial<MemoryReference> & { id?: string } = {},
): MemoryReference & { id: string } {
  const { id, ...rest } = overrides;
  const factId = id ?? `fact-${(factCounter += 1)}`;
  return {
    id: factId,
    factId,
    text: 'Case #H-102 lesson learned: event-driven revocation is required.',
    type: 'world',
    context: 'lesson learned',
    metadata: { caseId: 'H-102', stage: MemoryStage.LESSON },
    scores: { final: 0.42, reranker: 0.4, semantic: 0.5, keyword: 0.2 },
    scoresAreRelative: true,
    ...rest,
  } as MemoryReference & { id: string };
}

/** Unmodified wire shape, for adapter tests. */
export function rawRecallResult(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'a42cbb03-c29c-48e9-bce7-23abe7af1d61',
    text: 'Case #H-102 outcome: FAILURE. The finding recurred after 21 days.',
    type: 'world',
    entities: ['H-102'],
    context: 'remediation outcome',
    metadata: { caseId: 'H-102', stage: 'outcome', recurrence: 'true' },
    scores: { final: 0.51, reranker: 0.5, semantic: 0.6, keyword: 0.3 },
    ...overrides,
  };
}
