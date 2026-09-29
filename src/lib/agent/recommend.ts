/**
 * Remediation Agent — the memory-aware recommendation engine.
 *
 * This is where "same current problem + different memory = different
 * recommendation" is actually implemented. It has two clearly separated paths:
 *
 *  1. STATELESS — what any agent would say having seen only the current finding.
 *     Always computed, and always returned as `baselineRecommendation` so the
 *     before/after contrast is explicit rather than implied.
 *
 *  2. MEMORY-AWARE — re-derived with the organisation's recalled history:
 *     which fixes failed, why they failed, which succeeded, what recurred, and
 *     which lessons were recorded.
 *
 * The memory-aware path is not a display of history — history is allowed to
 * *veto* an action and to *prepend* a validation step. That is what makes the
 * recommendation genuinely different rather than merely annotated.
 *
 * Deterministic adjustment runs *before* optional LLM polish, so the core
 * behaviour holds even when no model is available (and is unit-testable
 * without one).
 */
import { chatJSON } from '../llm/client';
import { llmRecommendationSchema } from '../models/schemas';
import { extractKeyTerms } from './conflict';
import type {
  Finding,
  HistoricalCaseUsed,
  MemoryConflict,
  Recommendation,
  RejectedPriorAction,
  RootCause,
} from '../models/schemas';
import type { RecallBundle } from '../models/schemas';
import type { HistoricalCaseSummary } from './historical';
import { didNotHold } from './historical';
import type { EvidenceAnalysis } from './evidence';
import { MemoryStatus, type OutcomeResult } from '../models/enums';

/** The obvious, textbook fix per category — the "stateless agent" answer. */
const STANDARD_ACTIONS: Record<string, string> = {
  EMPLOYEE_ACCESS:
    'Remove access for inactive employees and automate deprovisioning on termination.',
  PRIVILEGED_ACCESS:
    'Automate HR to IAM deprovisioning so inactive employees lose privileged access.',
  IAM: 'Automate identity provisioning and deprovisioning through the IAM pipeline.',
  HR_SYNC: 'Automate HR to IAM synchronization so joiner/mover/leaver events propagate.',
  MFA: 'Enforce multi-factor authentication for all privileged and remote access.',
  TERMINATED_USERS:
    'Automate termination-driven revocation across all connected systems.',
  CONTRACTOR_ACCOUNTS:
    'Apply fixed-term expiry dates to contractor accounts and automate offboarding.',
  SERVICE_ACCOUNTS:
    'Inventory service accounts, rotate credentials and remove unused privileges.',
  CLOUD_PERMISSIONS:
    'Remove excessive cloud permissions and enforce least-privilege role assignments.',
  VENDOR_ACCESS: 'Time-bound vendor access and review it on a fixed schedule.',
  AUDIT_CONTROLS:
    'Enable audit logging for the affected control and retain evidence for the audit period.',
  EVIDENCE_COLLECTION:
    'Automate evidence collection for the control so artifacts are captured each period.',
  POLICY_VIOLATION: 'Enforce the policy technically rather than relying on manual review.',
};

/** Jaccard overlap of two phrases' significant terms. */
function similarity(a: string, b: string): number {
  const ta = extractKeyTerms(a);
  const tb = extractKeyTerms(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

/**
 * Resolve a control to its base family: `AC-2(3)` and `AC-2(j)` are both `AC-2`.
 *
 * An enhancement belongs to its base control, so a fix that failed against
 * AC-2(3) is evidence about an AC-2 finding. That is the compliance domain's
 * own notion of "the same problem", and unlike a lexical threshold it does not
 * hinge on how a particular fix happened to be phrased — "scheduled job
 * consumed the HR termination feed" and "automate deprovisioning on
 * termination" are the same approach but share almost no words.
 */
function controlRoot(controlId?: string): string | undefined {
  const match = /^([A-Za-z]{2,4}-\d+)/.exec(controlId ?? '');
  return match ? match[1].toUpperCase() : undefined;
}

function sameControlFamily(a: string | undefined, b: string | undefined): boolean {
  const root = controlRoot(a);
  return root !== undefined && root === controlRoot(b);
}

/** The problem being fixed now, expressed as text for comparison. */
function problemStatement(finding: Finding, rootCause: RootCause): string {
  return [finding.title, finding.description, rootCause.rootCause].join(' ');
}

/**
 * How on-point a historical case is for *this* problem.
 *
 * Used to choose which failed case to centre the validation step on and which
 * successful case to cite as the alternative — relevance order alone would
 * happily centre a contractor-account root cause on an employee-access finding.
 * Ranks only; it never decides whether memory is allowed to act.
 */
function problemMatch(
  c: HistoricalCaseSummary,
  finding: Finding,
  rootCause: RootCause,
): number {
  const problem = problemStatement(finding, rootCause);
  let score = similarity(c.title, problem) + similarity(c.remediationAttempted ?? '', problem);
  if (c.category && c.category === finding.category) score += 0.5;
  if (sameControlFamily(c.controlId, finding.controlId)) score += 0.25;
  return score;
}

/** Highest-scoring entry, first one winning ties so relevance order breaks them. */
function pickMostOnPoint<T>(
  items: T[],
  score: (item: T) => number,
): T | undefined {
  let best: T | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const s = score(item);
    if (s > bestScore) {
      best = item;
      bestScore = s;
    }
  }
  return best;
}

/**
 * The answer REMEDY would give with no memory at all.
 *
 * Deliberately the straightforward, obvious remediation — this is the answer a
 * stateless agent produces, retained verbatim for the before/after comparison.
 */
export function deriveStatelessRecommendation(
  finding: Finding,
  rootCause: RootCause,
): {
  recommendation: string;
  confidence: number;
  risks: string[];
  assumptions: string[];
} {
  const standard =
    STANDARD_ACTIONS[finding.category] ??
    `Remediate the ${finding.controlId} finding on ${finding.affectedSystem}.`;
  return {
    recommendation: standard,
    // A stateless agent cannot know whether the obvious fix has failed before,
    // so its confidence reflects only the root-cause hypothesis.
    confidence: Math.round(rootCause.confidence * 100) / 100,
    risks: ['No organisational remediation history considered.'],
    assumptions: [`The obvious remediation for ${finding.category} has not failed previously.`],
  };
}

/**
 * Prior fixes that history says did not work.
 *
 * "Did not hold" alone is not enough to veto an action — REMEDY must not reject
 * a fix because some unrelated corner of the bank failed. A failed case is only
 * on point for this finding when it is about the same problem: same control
 * family, recognisably the same action as ours, or a fix aimed at the same
 * stated problem. The gate is deliberately generous about relevance and strict
 * about outcome: it rejects, and only rejects, actions history already ruled out.
 */
export function collectRejectedPriorActions(
  cases: HistoricalCaseSummary[],
  finding: Finding,
  rootCause: RootCause,
  rejectedPhrase: string,
): RejectedPriorAction[] {
  const problem = problemStatement(finding, rootCause);
  const out: RejectedPriorAction[] = [];
  for (const c of cases) {
    if (!didNotHold(c) || !c.remediationAttempted) continue;
    const onPoint =
      sameControlFamily(c.controlId, finding.controlId) ||
      similarity(c.remediationAttempted, rejectedPhrase) >= 0.15 ||
      similarity(c.remediationAttempted, problem) >= 0.15;
    if (!onPoint) continue;
    out.push({
      action: c.remediationAttempted,
      caseId: c.caseId,
      outcome: (c.outcome ?? 'FAILURE') as OutcomeResult,
      reason: c.recurrence
        ? `The finding recurred after ${c.daysToRecurrence ?? 'an unrecorded number of'} days.`
        : `Recorded outcome: ${c.outcome}.`,
    });
  }
  return out;
}

/** Cases worth citing, best first. */
function selectInfluentialCases(cases: HistoricalCaseSummary[]): HistoricalCaseUsed[] {
  return cases
    .slice(0, 4)
    .map((c) => ({
      caseId: c.caseId,
      title: c.title,
      relevance: c.relevance,
      relevanceIsRelative: true as const,
      outcome: (c.outcome ?? 'FAILURE') as OutcomeResult,
      remediationAttempted: c.remediationAttempted ?? '',
      recurrenceDays: c.daysToRecurrence ?? null,
      lesson: c.lesson ?? '',
      whyRelevant: c.rootCause
        ? `Historical root cause: ${c.rootCause}`
        : 'Recalled as a similar compliance finding.',
    }));
}

/**
 * Build the memory-aware recommendation deterministically.
 *
 * Used as the guaranteed-correct baseline and as the fallback when no LLM is
 * available. Even here, memory is allowed to change the answer: a previously
 * failed fix is rejected and replaced by a validation-first step.
 */
export function applyMemory(
  finding: Finding,
  rootCause: RootCause,
  baseline: ReturnType<typeof deriveStatelessRecommendation>,
  cases: HistoricalCaseSummary[],
): {
  recommendation: string;
  confidence: number;
  rejected: RejectedPriorAction[];
  risks: string[];
  assumptions: string[];
  whyMemoryChangedIt: string;
} {
  if (cases.length === 0) {
    return {
      ...baseline,
      rejected: [],
      whyMemoryChangedIt:
        'No relevant historical experience was recalled, so the recommendation matches the stateless answer.',
    };
  }

  const rejected = collectRejectedPriorActions(
    cases,
    finding,
    rootCause,
    baseline.recommendation,
  );
  const onPoint = (c: HistoricalCaseSummary): number =>
    problemMatch(c, finding, rootCause);
  const failedCase = pickMostOnPoint(cases.filter((c) => didNotHold(c)), onPoint);
  const successful = pickMostOnPoint(
    cases.filter((c) => c.outcome === 'SUCCESS' && !c.recurrence),
    onPoint,
  );

  if (rejected.length === 0) {
    const lessons = cases.filter((c) => c.lesson).slice(0, 2);
    return {
      recommendation: baseline.recommendation,
      confidence: Math.min(0.95, baseline.confidence + 0.1),
      rejected: [],
      risks: baseline.risks,
      assumptions: [
        ...baseline.assumptions,
        ...lessons.map((c) => `Lesson from Case #${c.caseId}: ${c.lesson}`),
      ],
      whyMemoryChangedIt: `Recommendation influenced by ${cases.length} historical case(s); history corroborates this approach.`,
    };
  }

  // History says the obvious fix does not hold here.
  const focus = failedCase?.rootCause ?? failedCase?.lesson ?? 'the historical root cause';
  // Cite the same case in the explanation that the validation step points at —
  // naming Case #119 while quoting Case #102's recurrence window would be a
  // claim the memory does not actually support.
  const cited = rejected.find((r) => r.caseId === failedCase?.caseId) ?? rejected[0];
  const citedCase = cases.find((c) => c.caseId === cited.caseId);

  const parts = [
    `Do not repeat the previous remediation without validation: history shows it did not hold (${rejected
      .map((r) => `Case #${r.caseId} — ${r.reason}`)
      .join(' ')})`,
    `First validate ${focus}`,
  ];
  if (successful) {
    parts.push(
      `Then consider the approach that previously succeeded (Case #${successful.caseId}: ${successful.remediationAttempted})`,
    );
  } else {
    parts.push('Then remediate the confirmed cause rather than the symptom');
  }

  return {
    recommendation: `${parts.join('. ')}.`,
    // History demonstrates real uncertainty, so confidence drops relative to
    // the stateless figure. Floored at 0 rather than at a fixed 0.25: a floor
    // above the baseline would let memory *raise* confidence, inverting the
    // meaning when the root-cause hypothesis is itself weak.
    confidence: Math.max(0, Math.round((baseline.confidence - 0.15) * 100) / 100),
    rejected,
    risks: [
      ...baseline.risks,
      'Historical evidence indicates the straightforward remediation may recur.',
    ],
    assumptions: [
      `Current conditions resemble Case #${failedCase?.caseId ?? 'unknown'}`,
      'Historical outcomes remain applicable unless contradicted by current evidence.',
    ],
    whyMemoryChangedIt: `Without historical memory the recommendation would have been: "${baseline.recommendation}" Case #${cited.caseId} shows that approach previously ${
      citedCase?.recurrence
        ? `recurred after ${citedCase.daysToRecurrence ?? 'an unrecorded number of'} days`
        : `ended in outcome ${cited.outcome}`
    }, so REMEDY now requires validation before remediation.`,
  };
}

/* --------------------------------------------------------------- LLM polish */

const SYSTEM = `You are a security/compliance engineer choosing how to remediate a compliance finding.
You are given the current finding, a root-cause hypothesis, and the organisation's HISTORICAL REMEDIATION EXPERIENCE (each case includes whether the fix worked, whether the finding recurred, and the lesson learned).

Rules:
- Historical experience MUST change your answer when a prior fix failed or recurred.
- Never recommend repeating an action history shows failed, unless you first add a validation step that addresses the historical failure cause.
- Prefer a previously successful approach when the situations match.
- If history and current evidence disagree, say so explicitly and require human review.
- Be concrete and actionable. No generic compliance advice.

Return ONLY a JSON object:
  recommendation        string   — what to do, in order
  confidence            number   — 0..1
  risks                 string[]
  assumptions           string[]
  whyMemoryChangedIt    string   — how history altered the answer vs the obvious fix
  conflictingEvidence   string?  — set only if history and current evidence disagree
No prose outside the JSON.`;

function renderCases(cases: HistoricalCaseSummary[]): string {
  if (cases.length === 0) return '(no relevant historical cases found)';
  return cases
    .map((c, i) => {
      const lines = [
        `Case #${c.caseId}${c.anonymous ? ' (unattributed)' : ''} — relevance ${c.relevance ?? 'n/a'} (relative)`,
        c.rootCause ? `  root cause: ${c.rootCause}` : '',
        c.remediationAttempted ? `  remediation: ${c.remediationAttempted}` : '',
        `  outcome: ${c.outcome ?? 'unknown'}${c.recurrence ? ` — RECURRED after ${c.daysToRecurrence ?? '?'} days` : ''}`,
        c.lesson ? `  lesson: ${c.lesson}` : '',
      ];
      return `${i + 1}. ${lines.filter(Boolean).join('\n')}`;
    })
    .join('\n');
}

export interface RecommendInput {
  finding: Finding;
  rootCause: RootCause;
  evidence: EvidenceAnalysis;
  cases: HistoricalCaseSummary[];
  bundle: RecallBundle;
  conflicts: MemoryConflict[];
}

/**
 * Produce the final `Recommendation`.
 *
 * Always returns a `baselineRecommendation` alongside the memory-aware answer,
 * so the API response itself carries the before/after proof.
 */
export async function generateRecommendation(
  input: RecommendInput,
): Promise<{ recommendation: Recommendation; usedModel: boolean; error?: string }> {
  const { finding, rootCause, cases, bundle, conflicts } = input;

  const baseline = deriveStatelessRecommendation(finding, rootCause);
  const deterministic = applyMemory(finding, rootCause, baseline, cases);

  const memoryStatus: MemoryStatus = !bundle.historicalMemoryAvailable
    ? MemoryStatus.UNAVAILABLE
    : cases.length === 0
      ? MemoryStatus.EMPTY
      : bundle.status === 'low_confidence'
        ? MemoryStatus.LOW_CONFIDENCE
        : MemoryStatus.AVAILABLE;

  const base: Recommendation = {
    id: `rec-${finding.id}`,
    findingId: finding.id,
    recommendation: deterministic.recommendation,
    confidence: deterministic.confidence,
    memoryInfluenced: cases.length > 0 && memoryStatus === MemoryStatus.AVAILABLE,
    memoryStatus,
    memoryReason: bundle.reason,
    historicalCasesUsed: selectInfluentialCases(cases),
    rejectedPriorActions: deterministic.rejected,
    risks: deterministic.risks,
    assumptions: deterministic.assumptions,
    whyMemoryChangedIt: deterministic.whyMemoryChangedIt,
    baselineRecommendation: baseline.recommendation,
    conflicts,
  };

  if (memoryStatus === MemoryStatus.UNAVAILABLE) {
    return {
      recommendation: {
        ...base,
        recommendation: baseline.recommendation,
        confidence: baseline.confidence,
        memoryInfluenced: false,
        whyMemoryChangedIt:
          'Historical memory unavailable — this recommendation is stateless and ignores all organisational experience.',
        risks: [
          'Historical memory unavailable: previous remediation outcomes were not consulted.',
        ],
        assumptions: [baseline.assumptions[0] ?? 'No historical memory was available.'],
        historicalCasesUsed: [],
        rejectedPriorActions: [],
      },
      usedModel: false,
      error: bundle.reason,
    };
  }

  // Optional LLM polish. The deterministic result above is already correct and
  // memory-aware, so a model failure degrades quality, never correctness.
  const system = cases.length > 0 ? SYSTEM : `${SYSTEM}\nNo historical cases were found; reason from the current finding only.`;
  const result = await chatJSON({
    system,
    user: [
      `Finding: ${finding.title}`,
      `Control: ${finding.controlId} | Category: ${finding.category} | Severity: ${finding.severity}`,
      `Affected system: ${finding.affectedSystem}`,
      `Description: ${finding.description}`,
      '',
      `Root-cause hypothesis: ${rootCause.rootCause} (confidence ${rootCause.confidence})`,
      `Evidence: ${input.evidence.summary}`,
      `Evidence gaps: ${input.evidence.gaps.join('; ') || 'none'}`,
      '',
      `Stateless answer (no memory) that you MUST improve on: ${baseline.recommendation}`,
      '',
      'HISTORICAL REMEDIATION EXPERIENCE:',
      renderCases(cases),
      conflicts.length > 0
        ? `\nCONFLICTS WITH CURRENT EVIDENCE:\n${conflicts
            .map((c) => `- ${c.historicalClaim} vs ${c.currentEvidence}`)
            .join('\n')}`
        : '',
    ].join('\n'),
    schema: llmRecommendationSchema,
  });

  if (!result.ok) {
    return { recommendation: base, usedModel: false, error: result.error };
  }

  const polished = result.data;
  const modelRejected =
    polished.recommendation !== baseline.recommendation
      ? base.rejectedPriorActions
      : base.rejectedPriorActions;

  return {
    recommendation: {
      ...base,
      recommendation: polished.recommendation,
      confidence: Math.min(1, Math.max(0, polished.confidence)),
      risks: polished.risks.length > 0 ? polished.risks : base.risks,
      assumptions: polished.assumptions.length > 0 ? polished.assumptions : base.assumptions,
      whyMemoryChangedIt:
        polished.whyMemoryChangedIt || base.whyMemoryChangedIt,
      rejectedPriorActions: modelRejected,
      conflicts:
        polished.conflictingEvidence && conflicts.length === 0
          ? [
              {
                id: `conflict-${finding.id}-model`,
                kind: 'ROOT_CAUSE_DISAGREEMENT' as const,
                historicalClaim: polished.conflictingEvidence,
                currentEvidence: input.evidence.summary,
                severity: 'MEDIUM' as const,
                requiresHumanReview: true as const,
              },
            ]
          : conflicts,
    },
    usedModel: true,
  };
}
