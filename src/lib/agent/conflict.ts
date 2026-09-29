/**
 * Historical vs. current evidence conflict detection.
 *
 * REMEDY must never blindly trust memory. When history asserts a root cause but
 * the *current* evidence says that part of the system is fine, the
 * recommendation is downgraded and human review is forced.
 *
 * This module is deliberately deterministic (lexical, no LLM) so the behaviour
 * is predictable and unit-testable without a model in the loop.
 */
import type {
  Finding,
  MemoryConflict,
} from '../models/schemas';
import { ConflictKind } from '../models/enums';

import type { HistoricalCaseSummary } from './historical';

/** Words too common to signal anything about a root cause. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'were', 'was', 'are',
  'has', 'have', 'had', 'not', 'but', 'its', 'into', 'when', 'then', 'than',
  'because', 'due', 'root', 'cause', 'caused', 'failure', 'failed', 'issue',
  'issues', 'problem', 'problems', 'finding', 'case', 'analysis', 'system',
]);

/**
 * Terms that identify the *subject* of a historical root cause, e.g.
 * "HR → IAM synchronization failure" → {synchronization, pipeline, …}.
 */
export function extractKeyTerms(text: string): Set<string> {
  const terms = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4) continue;
    if (STOPWORDS.has(raw)) continue;
    terms.add(raw);
    // crude stemming so "synchronize"/"synchronization" both match
    if (raw.endsWith('ation')) terms.add(raw.slice(0, -4));
    if (raw.endsWith('ing')) terms.add(raw.slice(0, -3));
    if (raw.endsWith('ed')) terms.add(raw.slice(0, -2));
    if (raw.endsWith('s')) terms.add(raw.slice(0, -1));
  }
  return terms;
}

/** Patterns that make an observation an assertion that something is working. */
const HEALTHY_PATTERNS: readonly RegExp[] = [
  /\bhealthy\b/i,
  /\bwork(?:s|ing|ed)\b/i,
  /\bpassing\b/i,
  /\boperating\s+(?:normally|correctly)\b/i,
  /\bno\s+(?:failure|failures|error|errors|issue|issues|problem|problems)\b/i,
  /\bfunctioning\s+correctly\b/i,
  /\bintact\b/i,
  /\bin\s+good\s+order\b/i,
  /\bconfirmed\s+(?:ok|working)\b/i,
  /\bdid\s+not\s+fail\b/i,
  /\bappears\s+(?:correct|sound|healthy)\b/i,
];

/**
 * Does this observation assert that something is *working*, and therefore
 * potentially contradict a historical root cause about it?
 */
export function isHealthyAssertion(text: string): boolean {
  return HEALTHY_PATTERNS.some((re) => re.test(text));
}

/** Does a healthy assertion actually concern one of the historical key terms? */
function assertsHealthyAbout(
  observation: string,
  terms: Set<string>,
): { hit: boolean; term?: string } {
  if (!isHealthyAssertion(observation)) return { hit: false };
  const words = new Set(
    observation.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean),
  );
  for (const term of terms) {
    for (const w of words) {
      if (w.length < 4) continue; // "a", "is" would match almost anything
      if (w === term) return { hit: true, term };
      // Allow prefix matching only when both sides are long enough to be
      // meaningful ("sync" ↔ "synchronization") and neither is trivially short.
      if (w.length >= 5 && term.length >= 5 && (w.startsWith(term) || term.startsWith(w))) {
        return { hit: true, term };
      }
    }
  }
  return { hit: false };
}

export interface ConflictInput {
  finding: Finding;
  cases: HistoricalCaseSummary[];
}

/**
 * Detect disagreements between recalled history and current evidence.
 *
 * Returns an empty array when memory is unavailable — an absent memory cannot
 * conflict with anything, and claiming otherwise would be a fabrication.
 */
export function detectConflicts(input: ConflictInput): MemoryConflict[] {
  const conflicts: MemoryConflict[] = [];
  const evidence = input.finding.evidence;

  for (const historicalCase of input.cases) {
    const rootCause = historicalCase.rootCause;
    if (!rootCause || historicalCase.anonymous) continue;

    const terms = extractKeyTerms(rootCause);
    if (terms.size === 0) continue;

    for (const item of evidence) {
      const { hit } = assertsHealthyAbout(item.observation, terms);
      if (!hit) continue;

      conflicts.push({
        id: `conflict-${historicalCase.caseId}-${item.id}`,
        kind: ConflictKind.ROOT_CAUSE_DISAGREEMENT,
        historicalClaim: `Historical Case #${historicalCase.caseId} attributes this finding to: ${rootCause}`,
        currentEvidence: `Current evidence (${item.source}) indicates the relevant control is sound: "${item.observation}"`,
        // A recurrence means the stakes of getting this wrong are higher.
        severity: historicalCase.recurrence ? 'HIGH' : 'MEDIUM',
        requiresHumanReview: true,
      });
      break; // one conflict per historical case is enough to force review
    }
  }

  return conflicts;
}

/** True when any conflict requires a human to adjudicate. */
export function requiresHumanReview(conflicts: MemoryConflict[]): boolean {
  return conflicts.length > 0;
}
