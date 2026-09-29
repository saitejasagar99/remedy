/**
 * Memory Retrieval / Reasoning Agent.
 *
 * Turns raw recalled facts into structured historical cases the recommendation
 * step can reason about. Grouping by `caseId` is what allows REMEDY to say
 * "Case #102 failed" rather than quoting an unattributable fragment.
 *
 * Pure functions only — no network, no LLM. This makes the behaviour that
 * matters most (memory changing the recommendation) directly unit-testable.
 */
import type { Finding, MemoryReference, RecallBundle } from '../models/schemas';
import type { FindingCategory, OutcomeResult, Severity } from '../models/enums';
import { MemoryStage, OutcomeResult as Outcomes } from '../models/enums';

import { groupByCase } from '../memory/recall';
import { recallFailedFixes, recallHistoricalRemediations, recallLessons, recallSimilarFindings, recallSuccessfulFixes, mergeBundles } from '../memory/recall';
import { isMetadataEcho, stripProvenance } from '../memory/memory-types';

/** One historical case, assembled from its recalled lifecycle memories. */
export interface HistoricalCaseSummary {
  caseId: string;
  /** `true` when the case id could not be recovered from metadata. */
  anonymous: boolean;
  title: string;
  controlId?: string;
  category?: FindingCategory;
  affectedSystem?: string;
  severity?: Severity;
  outcome?: OutcomeResult;
  remediationAttempted?: string;
  rootCause?: string;
  lesson?: string;
  recurrence: boolean;
  daysToRecurrence?: number;
  /** Best relative relevance across this case's facts (ordering signal only). */
  relevance: number | null;
  /**
   * When the case's memories were stamped — the retained case's close date.
   * Used only for ordering a recurrence timeline; absent when no fact carried
   * a timestamp, in which case the timeline shows no date rather than a guess.
   */
  mentionedAt?: string;
  facts: MemoryReference[];
}

const STAGE_PREFIX: Record<string, RegExp> = {
  [MemoryStage.FINDING]: /^Case #\S+:?\s*/i,
  [MemoryStage.ROOT_CAUSE]: /^Case #\S+ root cause\b[:\s]*/i,
  [MemoryStage.REMEDIATION]: /^Case #\S+ remediation attempted\b[:\s]*/i,
  [MemoryStage.LESSON]: /^Case #\S+ lesson learned\b[:\s]*/i,
};

/**
 * Strip provenance and the identifying prefix so a field holds content only.
 *
 * The prefix patterns tolerate a missing colon because the fact extractor can
 * split `Case #087 remediation attempted: <fix>` into a label-only fact.
 */
function stripPrefix(stage: string, text: string): string {
  const clean = stripProvenance(text);
  const re = STAGE_PREFIX[stage];
  return re ? clean.replace(re, '').trim() : clean;
}

function bestRelevance(facts: MemoryReference[]): number | null {
  let best: number | null = null;
  for (const f of facts) {
    const s = f.scores?.final;
    if (typeof s === 'number' && (best === null || s > best)) best = s;
  }
  return best;
}

/**
 * Choose one fact per lifecycle stage.
 *
 * Recall returns facts in *relevance* order and the bank holds more than the
 * prose REMEDY retained: the fact extractor splits each retained sentence into
 * several facts, so a stage arrives as fragments (`Implementation: …`) alongside
 * the sentence that opened with `Case #<id>`, plus metadata echoes
 * (`recurrence: true`). Taking the first fact per stage therefore picked at
 * random — which is how a case came to report its remediation as
 * `recurrence: true`.
 *
 * Rank instead, keeping relevance order to break ties:
 *   0 — the retained sentence, with content (what we wrote; always preferred)
 *   1 — a fragment with content (the extractor split the sentence)
 *   2 — the retained sentence's label only, content lost to the split
 *   3 — anything else, echoes worst of all
 */
function pickCanonicalStages(
  caseId: string,
  facts: MemoryReference[],
): Map<string, MemoryReference> {
  const canonical = `Case #${caseId}`;
  const byStage = new Map<string, MemoryReference>();
  const best = new Map<string, number>();

  for (const f of facts) {
    if (!f.stage) continue;
    const body = stripPrefix(f.stage, f.text);
    const rank = isMetadataEcho(f.text)
      ? 3
      : f.text.startsWith(canonical)
        ? body
          ? 0
          : 2
        : body
          ? 1
          : 3;
    if ((best.get(f.stage) ?? Number.POSITIVE_INFINITY) <= rank) continue;
    byStage.set(f.stage, f);
    best.set(f.stage, rank);
  }
  return byStage;
}

/**
 * Outcome means history says this fix did not hold.
 *
 * Shared with the recommendation step: the truncation cut and the rejection
 * gate have to agree on what counts as a failure, or one can reserve a case the
 * other will not act on.
 */
export function didNotHold(c: HistoricalCaseSummary): boolean {
  if (c.recurrence) return true;
  return c.outcome === 'FAILURE' || c.outcome === 'PARTIAL';
}

/**
 * Assemble historical cases from recalled memories.
 *
 * Cases are ordered by best relevance so the most relevant history reaches the
 * model first, and truncated so a long memory tail cannot crowd out the current
 * finding. Membership is relevance-ordered but not relevance-only — see
 * `selectCases`.
 */
export function assembleHistoricalCases(
  memories: MemoryReference[],
  limit = 6,
): HistoricalCaseSummary[] {
  const groups = groupByCase(memories);
  const summaries: HistoricalCaseSummary[] = [];

  for (const [caseId, facts] of groups) {
    const byStage = pickCanonicalStages(caseId, facts);

    const any = facts[0];
    const anonymous = caseId === 'unknown';

    /**
     * Metadata is attached per lifecycle stage, and Hindsight returns facts in
     * *relevance* order — so `facts[0]` is frequently a lesson or root-cause
     * fact that never carried `outcome`. Reading the case's outcome from
     * `facts[0]` alone therefore dropped it at random, which in turn stopped
     * `didNotHold()` from rejecting a fix history had already shown to fail.
     *
     * Scan every fact instead, preferring the stage the field belongs to.
     */
    function metaFrom(stages: MemoryStage[]): Record<string, string> {
      for (const stage of stages) {
        const fact = byStage.get(stage);
        if (fact?.metadata) return fact.metadata;
      }
      for (const f of facts) if (f.metadata?.outcome) return f.metadata;
      return any.metadata ?? {};
    }

    const outcomeMeta = metaFrom([MemoryStage.OUTCOME]);
    const caseMeta = outcomeMeta.outcome ? outcomeMeta : metaFrom([MemoryStage.FINDING]);

    const recurrence =
      caseMeta.recurrence === 'true' || outcomeMeta.recurrence === 'true';
    const daysRaw = caseMeta.daysToRecurrence ?? outcomeMeta.daysToRecurrence;
    const days = daysRaw ? Number.parseInt(daysRaw, 10) : Number.NaN;

    const rawOutcome =
      caseMeta.outcome ?? outcomeMeta.outcome ?? metaFrom([]).outcome;
    const outcome = (Object.values(Outcomes) as string[]).includes(rawOutcome ?? '')
      ? (rawOutcome as OutcomeResult)
      : undefined;

    const rootCauseFact = byStage.get(MemoryStage.ROOT_CAUSE);
    const remFact = byStage.get(MemoryStage.REMEDIATION);
    const lessonFact = byStage.get(MemoryStage.LESSON);
    const findingFact = byStage.get(MemoryStage.FINDING);

    const shared = metaFrom([MemoryStage.FINDING]);

    summaries.push({
      caseId,
      anonymous,
      title: (findingFact ? stripPrefix(MemoryStage.FINDING, findingFact.text) : '') || any.text,
      controlId: shared.controlId,
      category: shared.category as FindingCategory | undefined,
      // Not retained as metadata today, so it stays unset rather than guessed.
      affectedSystem: undefined,
      severity: (shared.severity ?? caseMeta.severity) as Severity | undefined,
      outcome,
      remediationAttempted: remFact
        ? stripPrefix(MemoryStage.REMEDIATION, remFact.text) || undefined
        : undefined,
      rootCause: rootCauseFact
        ? stripPrefix(MemoryStage.ROOT_CAUSE, rootCauseFact.text) || undefined
        : undefined,
      lesson: lessonFact ? stripPrefix(MemoryStage.LESSON, lessonFact.text) || undefined : undefined,
      recurrence,
      daysToRecurrence: Number.isNaN(days) ? undefined : days,
      relevance: bestRelevance(facts),
      mentionedAt: facts.map((f) => f.mentionedAt).find((d): d is string => Boolean(d)),
      facts,
    });
  }

  return selectCases(
    summaries.sort((a, b) => (b.relevance ?? -1) - (a.relevance ?? -1)),
    limit,
  );
}

/**
 * Cut the assembled cases to `limit` without cutting away the contrast.
 *
 * Order is relevance; membership is not relevance alone. The recommendation
 * needs one prior failure to reject and one prior success to offer instead, so
 * both are reserved before the remaining slots are filled by rank.
 *
 * This matters because Hindsight's scores are *relative* to the query, so
 * neighbouring cases routinely sit a few hundredths apart. A pure top-N cut
 * makes "can history change the answer at all?" depend on that margin: a
 * failure ranking seventh behind six unrelated successes is dropped, the
 * rejection gate finds nothing to reject, and the output reverts to the
 * stateless answer. That is the one failure an explanation panel cannot report
 * — from the outside it looks exactly like an honest "no relevant memory".
 *
 * Reserving a *quotable* failure first is deliberate: the gate quotes the action
 * it rejects, so a failure with no recorded fix can inform the answer but can
 * never veto one.
 */
function selectCases(
  ordered: HistoricalCaseSummary[],
  limit: number,
): HistoricalCaseSummary[] {
  if (ordered.length <= limit) return ordered;

  const keep: HistoricalCaseSummary[] = [];
  const seen = new Set<HistoricalCaseSummary>();
  const reserve = (c: HistoricalCaseSummary | undefined): void => {
    if (!c || seen.has(c) || keep.length >= limit) return;
    keep.push(c);
    seen.add(c);
  };

  reserve(
    ordered.find((c) => didNotHold(c) && c.remediationAttempted) ??
      ordered.find(didNotHold),
  );
  reserve(ordered.find((c) => c.outcome === 'SUCCESS' && !c.recurrence));

  for (const c of ordered) {
    if (keep.length >= limit) break;
    reserve(c);
  }

  return keep.sort((a, b) => (b.relevance ?? -1) - (a.relevance ?? -1));
}

/**
 * Retrieve everything the recommendation step needs in one pass.
 *
 * Five targeted queries run in parallel rather than one broad query: Hindsight
 * ranks within a single query, so separate intents produce sharper rankings for
 * "what failed" vs "what worked" than a single blended search would.
 *
 * The remediation arm is load-bearing rather than redundant. "What failed" tends
 * to return the outcome (`recurrence: true`, `finding returned after 30 days`)
 * while the prose describing *what was actually done* ranks lower under that
 * intent — and `remediationAttempted` is the field the rejection gate reads. A
 * case whose fix we cannot quote is a case the gate cannot reject, so the arm
 * that asks for the fix itself has to be asked.
 */
export async function gatherHistoricalContext(
  finding: Finding,
): Promise<{ bundle: RecallBundle; cases: HistoricalCaseSummary[] }> {
  const [similar, remediated, failed, successful, lessons] = await Promise.all([
    recallSimilarFindings(finding),
    recallHistoricalRemediations(finding),
    recallFailedFixes(finding),
    recallSuccessfulFixes(finding),
    recallLessons(finding),
  ]);

  const bundle = mergeBundles([similar, remediated, failed, successful, lessons]);
  if (!bundle.historicalMemoryAvailable) {
    return { bundle, cases: [] };
  }
  return { bundle, cases: assembleHistoricalCases(bundle.memories) };
}
