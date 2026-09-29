/**
 * Memory-layer types and pure helpers.
 *
 * Responsibilities:
 *  - turn domain objects into the text/metadata Hindsight stores
 *  - turn raw Hindsight responses into `MemoryReference` without losing or
 *    inventing information
 *  - build `RecallBundle` states that are explicit about memory availability
 *
 * No network calls live here.
 */
import type { HistoricalCase } from '../models/schemas';
import {
  type MemoryStage,
  type OutcomeResult,
  MemoryStage as Stages,
} from '../models/enums';
import {
  type MemoryReference,
  type RecallBundle,
  memoryReferenceSchema,
} from '../models/schemas';

/** Metadata attached to every retained memory — `caseId` is the join key. */
export function caseMetadata(
  caseId: string,
  stage: MemoryStage,
  extra: Record<string, string> = {},
): Record<string, string> {
  return { caseId, stage, ...extra };
}

/**
 * Render a lifecycle stage as prose.
 *
 * Hindsight's extractor works on natural language, so each stage is written as
 * a self-contained sentence that still identifies its case when read in
 * isolation — this keeps a recalled fact attributable even if metadata is
 * missing from a given result.
 */
export function renderStage(
  record: HistoricalCase,
  stage: MemoryStage,
): string {
  const id = `Case #${record.caseId}`;
  const head = `${id}: ${record.title} (${record.controlId}, ${record.severity}, ${record.affectedSystem}).`;

  switch (stage) {
    case Stages.FINDING:
      return `${head} Historical compliance finding in category ${record.category}. ${record.description}`;
    case Stages.ROOT_CAUSE:
      return `${id} root cause: ${record.rootCause} Contributing factors: ${
        record.contributingFactors.join('; ') || 'none recorded'
      }.`;
    case Stages.REMEDIATION:
      return `${id} remediation attempted: ${record.remediationAttempted} Implementation: ${
        record.implementationDetails || 'not detailed'
      }.`;
    case Stages.VERIFICATION:
      return `${id} verification result: ${record.verificationResult}.`;
    case Stages.OUTCOME:
      return `${id} outcome: ${record.outcome}. ${
        record.recurrence
          ? `The finding recurred after ${record.daysToRecurrence ?? 'an unrecorded number of'} days.`
          : 'The finding did not recur.'
      } Side effects: ${record.observedSideEffects.join('; ') || 'none observed'}.`;
    case Stages.RECURRENCE:
      return record.recurrence
        ? `${id} recurrence: the finding returned after ${record.daysToRecurrence} days despite remediation. Additional investigation: ${
            record.additionalInvestigation || 'none recorded'
          }.`
        : `${id} recurrence: none recorded.`;
    case Stages.LESSON:
      return `${id} lesson learned: ${record.lessonLearned}`;
    default:
      return `${head}`;
  }
}

/** The `context` label stored alongside each stage (used by Hindsight). */
export function stageContext(stage: MemoryStage): string {
  switch (stage) {
    case Stages.FINDING:
      return 'compliance finding';
    case Stages.ROOT_CAUSE:
      return 'root cause analysis';
    case Stages.REMEDIATION:
      return 'remediation attempt';
    case Stages.VERIFICATION:
      return 'verification result';
    case Stages.OUTCOME:
      return 'remediation outcome';
    case Stages.RECURRENCE:
      return 'finding recurrence';
    case Stages.LESSON:
      return 'lesson learned';
    default:
      return 'compliance remediation experience';
  }
}

/**
 * Stages retained for one historical case.
 *
 * Splitting the lifecycle means each part is independently retrievable and
 * individually typed, rather than one large blob that recall can only match as
 * a whole.
 */
export const CASE_STAGES: readonly MemoryStage[] = [
  Stages.FINDING,
  Stages.ROOT_CAUSE,
  Stages.REMEDIATION,
  Stages.VERIFICATION,
  Stages.OUTCOME,
  Stages.LESSON,
  Stages.RECURRENCE,
];

/** Stages that only carry signal when the case actually recurred. */
export function stagesFor(record: HistoricalCase): MemoryStage[] {
  const stages: MemoryStage[] = [...CASE_STAGES];
  if (!record.recurrence) return stages.filter((s) => s !== Stages.RECURRENCE);
  return stages;
}

/** Fact types Hindsight uses; anything else is normalised to `world`. */
const FACT_TYPES = new Set(['world', 'experience', 'observation']);

/**
 * Adapt a raw Hindsight `RecallResult` to the shape `memoryReferenceSchema`
 * expects.
 *
 * Two field names genuinely differ between the wire and our domain model, and
 * conflating them is how recall silently returned zero results:
 *   - Hindsight calls the identifier `id`; the domain calls it `factId`
 *   - Hindsight's `type` is nullable and open-ended; the domain is a closed enum
 *
 * This is a *rename*, not a default: the value is copied across unchanged. Only
 * a `type` outside the documented set is normalised, and missing text/`id` are
 * left absent so validation still fails rather than inventing a fact.
 */
function adaptRecallResult(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const source = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...source };

  if (out.factId === undefined && typeof source.id === 'string') {
    out.factId = source.id;
  }
  if (typeof out.type !== 'string' || !FACT_TYPES.has(out.type)) {
    out.type = 'world';
  }

  // The domain model stores metadata as `Record<string, string>`; the server
  // does not guarantee the value type. Scalars are stringified faithfully and
  // anything representable as one is kept, so the `caseId` join key survives
  // regardless of how the server serialised it.
  if (out.metadata && typeof out.metadata === 'object' && !Array.isArray(out.metadata)) {
    const metadata: Record<string, string> = {};
    for (const [key, value] of Object.entries(out.metadata as Record<string, unknown>)) {
      if (typeof value === 'string') metadata[key] = value;
      else if (typeof value === 'number' || typeof value === 'boolean') {
        metadata[key] = String(value);
      } else if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
        metadata[key] = value.join(', ');
      }
      // Null / objects / mixed arrays are omitted: there is no faithful
      // string rendering, and guessing one would invent a fact.
    }
    out.metadata = metadata;
  }

  return out;
}

/**
 * Convert a raw Hindsight result into a `MemoryReference`.
 *
 * Strictly defensive: unknown/malformed results are rejected rather than
 * patched with defaults, because a half-parsed memory would let the UI present
 * an invented fact as retrieved history.
 */
export function toMemoryReference(raw: unknown): MemoryReference | null {
  const parsed = memoryReferenceSchema.safeParse(adaptRecallResult(raw));
  if (!parsed.success) return null;
  const value = parsed.data;

  const caseId = value.metadata?.caseId;
  const rawStage = value.metadata?.stage;
  const validStage = Object.values(Stages).includes(rawStage as MemoryStage)
    ? (rawStage as MemoryStage)
    : undefined;

  return {
    ...value,
    caseId: caseId || undefined,
    stage: validStage,
  };
}

export function unavailableBundle(reason: string): RecallBundle {
  return {
    historicalMemoryAvailable: false,
    status: 'unavailable',
    reason,
    memories: [],
  };
}

export function errorBundle(reason: string): RecallBundle {
  return {
    historicalMemoryAvailable: false,
    status: 'error',
    reason,
    memories: [],
  };
}

export function emptyBundle(): RecallBundle {
  return {
    historicalMemoryAvailable: true,
    status: 'empty',
    memories: [],
  };
}

/** Relevance floor below which a recall is reported as low-confidence. */
export const LOW_CONFIDENCE_FLOOR = 0.05;

/**
 * Finalise a bundle: decide between `ok` and `low_confidence`.
 *
 * Uses the ranking score Hindsight returns. Scores are relative to the query,
 * so this is only ever used to separate "clearly relevant" from "weak tail" —
 * never surfaced as a percentage.
 */
export function finaliseBundle(memories: MemoryReference[]): RecallBundle {
  if (memories.length === 0) return emptyBundle();
  const best = memories.reduce((acc, m) => {
    const s = m.scores?.final;
    return typeof s === 'number' && s > acc ? s : acc;
  }, 0);
  return {
    historicalMemoryAvailable: true,
    status: best < LOW_CONFIDENCE_FLOOR ? 'low_confidence' : 'ok',
    memories,
  };
}

/**
 * Deduplicate recalled facts by id, preserving Hindsight's relevance order.
 * Multi-strategy recall can surface the same fact through more than one arm.
 */
export function dedupeById(memories: MemoryReference[]): MemoryReference[] {
  const seen = new Set<string>();
  const out: MemoryReference[] = [];
  for (const m of memories) {
    if (seen.has(m.factId)) continue;
    seen.add(m.factId);
    out.push(m);
  }
  return out;
}

/** Outcome → the vocabulary used when reporting a prior case's result. */
export function outcomeLabel(outcome: OutcomeResult): string {
  switch (outcome) {
    case 'SUCCESS':
      return 'SUCCESS';
    case 'PARTIAL':
      return 'PARTIAL';
    case 'FAILURE':
      return 'FAILED';
    default:
      return outcome;
  }
}

/**
 * Hindsight appends its own provenance to a fact's text — `| When: <date>`,
 * `| Involving: <entities>` — useful when reading raw recall, noise once a
 * field has been extracted, and it drags stray date/entity terms into the
 * similarity comparison the rejection gate depends on.
 */
const PROVENANCE_SUFFIX = /\s*\|\s*(?:When|Involving|Due to)\b[\s\S]*$/i;

export function stripProvenance(text: string): string {
  return text.replace(PROVENANCE_SUFFIX, '').trim();
}

/** Scalars a metadata echo can carry — never prose. */
const SCALAR_VALUE =
  /^(?:true|false|yes|no|none|unknown|n\/a|-?\d+(?:\.\d+)?|success|failure|partial|pass|fail)$/i;
/** `AC-2(3)`, so `ControlId: AC-2(3)` is recognised as an echo too. */
const CONTROL_ID = /^[a-z]{2,4}-\d+(?:\([^)]+\))?$/i;
/** `<label> for Case #<id>`, the shape the extractor produces from `context`. */
const CASE_LABEL = /^[a-z][a-z ]{0,40} for Case #\S+$/i;

/**
 * Is this fact a restatement of metadata rather than content?
 *
 * The fact extractor does not only split the prose REMEDY retained — it also
 * emits short facts mirroring the metadata that came with it: `recurrence: true`,
 * `Outcome: FAILURE`, `Days to recurrence: 30`, `Verification result: PASS`.
 * They inherit the stage they were filed under and, being one line long, they
 * routinely out-score the prose they summarise, so "first fact per stage" picked
 * them: a case ended up reporting its *remediation attempted* as
 * `recurrence: true`.
 *
 * Dropping them hides no history — every value they repeat is stored separately
 * as real prose (`Case #119 outcome: FAILURE`) and still recalled on its own.
 * REMEDY's own retained text always opens with `Case #`, so it is never
 * mistaken for an echo regardless of shape.
 */
export function isMetadataEcho(text: string): boolean {
  const bare = stripProvenance(text);
  if (!bare || /^case #/i.test(bare)) return false;
  if (CASE_LABEL.test(bare)) return true;
  const colon = bare.lastIndexOf(':');
  if (colon <= 0 || colon >= bare.length - 1) return false;
  const value = bare.slice(colon + 1).trim();
  return SCALAR_VALUE.test(value) || CONTROL_ID.test(value);
}
