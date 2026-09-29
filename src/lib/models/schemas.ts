/**
 * Zod schemas — the single source of truth for every domain shape.
 *
 * TypeScript types are *inferred from* these schemas, so runtime validation and
 * compile-time types cannot drift apart. Enumerations are derived from
 * `enums.ts`, keeping the vocabulary defined in exactly one place.
 */
import { z } from 'zod';

import {
  ApprovalDecision,
  ConflictKind,
  FindingCategory,
  FindingStatus,
  MemoryStage,
  MemoryStatus,
  OutcomeResult,
  RemediationStatus,
  Severity,
  VerificationMethod,
  VerificationResult,
} from './enums';

/**
 * Build a Zod enum from a `as const` record while preserving the literal union
 * as the output type. `Object.values()` widens to `string[]` on its own, so the
 * cast re-narrows it to a non-empty tuple of the union.
 */
function enumOf<T extends string>(values: Readonly<Record<string, T>>) {
  return z.enum(Object.values(values) as unknown as [T, ...T[]]);
}

/* ------------------------------------------------------------------ enums */

export const severitySchema = enumOf(Severity);
export const findingStatusSchema = enumOf(FindingStatus);
export const remediationStatusSchema = enumOf(RemediationStatus);
export const outcomeResultSchema = enumOf(OutcomeResult);
export const approvalDecisionSchema = enumOf(ApprovalDecision);
export const memoryStatusSchema = enumOf(MemoryStatus);
export const findingCategorySchema = enumOf(FindingCategory);
export const verificationMethodSchema = enumOf(VerificationMethod);
export const verificationResultSchema = enumOf(VerificationResult);
export const memoryStageSchema = enumOf(MemoryStage);
export const conflictKindSchema = enumOf(ConflictKind);

/* ----------------------------------------------------------- primitives */

const isoDate = z.string().datetime({ offset: true }).or(z.string().min(1));
const confidence = z.number().min(0).max(1);
const nonEmpty = z.string().trim().min(1, 'must not be empty');

/* ------------------------------------------------------------ entities */

export const evidenceSchema = z.object({
  id: z.string(),
  source: nonEmpty,
  observation: nonEmpty,
  collectedAt: isoDate,
  supportsHypothesis: z.string().optional(),
});
export type EvidenceInput = z.input<typeof evidenceSchema>;
export type Evidence = z.output<typeof evidenceSchema>;

export const rootCauseSchema = z.object({
  id: z.string(),
  findingId: z.string(),
  rootCause: nonEmpty,
  contributingFactors: z.array(z.string()).default([]),
  confidence,
  identifiedAt: isoDate,
  method: z.enum(['LLM_ANALYSIS', 'HUMAN']).default('LLM_ANALYSIS'),
});
export type RootCause = z.output<typeof rootCauseSchema>;
export type RootCauseInput = z.input<typeof rootCauseSchema>;

export const approvalSchema = z.object({
  id: z.string(),
  remediationId: z.string(),
  decision: approvalDecisionSchema,
  decidedBy: nonEmpty,
  reason: z.string().optional(),
  requestedEvidence: z.string().optional(),
  decidedAt: isoDate,
});
export type Approval = z.output<typeof approvalSchema>;

export const remediationSchema = z.object({
  id: z.string(),
  findingId: z.string(),
  proposedAction: nonEmpty,
  implementationDetails: z.string().default(''),
  owner: nonEmpty,
  status: remediationStatusSchema,
  rationale: z.string().default(''),
  approval: approvalSchema.optional(),
  proposedAt: isoDate,
  approvedAt: isoDate.optional(),
  implementedAt: isoDate.optional(),
});
export type Remediation = z.output<typeof remediationSchema>;
export type RemediationInput = z.input<typeof remediationSchema>;

export const verificationSchema = z.object({
  id: z.string(),
  remediationId: z.string(),
  method: verificationMethodSchema,
  result: verificationResultSchema,
  evidenceText: nonEmpty,
  verifiedAt: isoDate,
  verifier: nonEmpty,
});
export type Verification = z.output<typeof verificationSchema>;

export const outcomeSchema = z.object({
  id: z.string(),
  remediationId: z.string(),
  result: outcomeResultSchema,
  recurrence: z.boolean(),
  daysToRecurrence: z.number().int().positive().optional(),
  observedSideEffects: z.array(z.string()).default([]),
  lessonLearned: nonEmpty,
  additionalInvestigation: z.string().optional(),
  recordedAt: isoDate,
});
export type Outcome = z.output<typeof outcomeSchema>;
export type OutcomeInput = z.input<typeof outcomeSchema>;

export const findingSchema = z.object({
  id: z.string(),
  controlId: nonEmpty,
  title: nonEmpty,
  description: nonEmpty,
  severity: severitySchema,
  category: findingCategorySchema,
  affectedSystem: nonEmpty,
  status: findingStatusSchema,
  evidence: z.array(evidenceSchema).default([]),
  firstDetectedAt: isoDate,
  recurrenceOf: z.string().optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Finding = z.output<typeof findingSchema>;

/**
 * A historical case assembled from its retained lifecycle stages.
 * Persisted in Hindsight — SQLite holds only in-flight application state.
 */
export const historicalCaseSchema = z.object({
  caseId: nonEmpty,
  controlId: nonEmpty,
  category: findingCategorySchema,
  affectedSystem: nonEmpty,
  title: nonEmpty,
  description: nonEmpty,
  severity: severitySchema,
  rootCause: nonEmpty,
  contributingFactors: z.array(z.string()).default([]),
  remediationAttempted: nonEmpty,
  implementationDetails: z.string().default(''),
  verificationResult: verificationResultSchema,
  outcome: outcomeResultSchema,
  recurrence: z.boolean(),
  daysToRecurrence: z.number().int().positive().optional(),
  lessonLearned: nonEmpty,
  additionalInvestigation: z.string().optional(),
  observedSideEffects: z.array(z.string()).default([]),
  closedAt: isoDate,
});
export type HistoricalCase = z.output<typeof historicalCaseSchema>;
export type HistoricalCaseInput = z.input<typeof historicalCaseSchema>;

/* -------------------------------------------------------------- memory */

/**
 * Per-stage scores exactly as Hindsight returns them.
 * Upstream documents these as *relative to one query*, not calibrated
 * probabilities — hence `scoresAreRelative`, so the UI never renders them as
 * a fabricated "91% similarity".
 */
export const memoryScoresSchema = z
  .object({
    final: z.number().nullable().optional(),
    reranker: z.number().nullable().optional(),
    semantic: z.number().nullable().optional(),
    keyword: z.number().nullable().optional(),
  })
  .nullish();

export const memoryReferenceSchema = z.object({
  /** Hindsight fact id — present for real memories, absent only on local cache. */
  factId: z.string(),
  caseId: z.string().optional(),
  stage: memoryStageSchema.optional(),
  text: z.string(),
  type: z.enum(['world', 'experience', 'observation']),
  context: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.string()).nullish(),
  entities: z.array(z.string()).nullish(),
  scores: memoryScoresSchema,
  scoresAreRelative: z.literal(true).default(true),
  mentionedAt: z.string().nullish(),
});
export type MemoryReference = z.output<typeof memoryReferenceSchema>;

/**
 * Result of a recall call. Explicit about failure so the UI can distinguish
 * "no history matched" from "history is unavailable".
 */
export const recallBundleSchema = z.object({
  historicalMemoryAvailable: z.boolean(),
  status: z.enum(['ok', 'unavailable', 'empty', 'low_confidence', 'error']),
  reason: z.string().optional(),
  memories: z.array(memoryReferenceSchema).default([]),
  durationMs: z.number().optional(),
});
export type RecallBundle = z.output<typeof recallBundleSchema>;

/** A historical disagreement with current evidence. Never auto-resolved. */
export const memoryConflictSchema = z.object({
  id: z.string(),
  kind: conflictKindSchema,
  historicalClaim: nonEmpty,
  currentEvidence: nonEmpty,
  severity: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  requiresHumanReview: z.literal(true),
});
export type MemoryConflict = z.output<typeof memoryConflictSchema>;

/** One historical case that materially shaped the recommendation. */
export const historicalCaseUsedSchema = z.object({
  caseId: nonEmpty,
  title: z.string().default(''),
  relevance: z.number().nullable(),
  /**
   * Defaults to `true` so the flag is always present. `relevance` is an
   * ordering signal within one query; leaving the marker optional would let a
   * consumer render 0.62 as "62% similar", which upstream explicitly says it is
   * not.
   */
  relevanceIsRelative: z.literal(true).default(true),
  outcome: outcomeResultSchema,
  remediationAttempted: z.string().default(''),
  recurrenceDays: z.number().nullable(),
  lesson: z.string().default(''),
  whyRelevant: z.string().default(''),
});
export type HistoricalCaseUsed = z.output<typeof historicalCaseUsedSchema>;

/** A prior action history says did *not* work. */
export const rejectedPriorActionSchema = z.object({
  action: nonEmpty,
  caseId: nonEmpty,
  outcome: outcomeResultSchema,
  reason: nonEmpty,
});
export type RejectedPriorAction = z.output<typeof rejectedPriorActionSchema>;

export const recommendationSchema = z.object({
  id: z.string(),
  findingId: z.string(),
  recommendation: nonEmpty,
  confidence,
  memoryInfluenced: z.boolean(),
  memoryStatus: memoryStatusSchema,
  memoryReason: z.string().optional(),
  historicalCasesUsed: z.array(historicalCaseUsedSchema).default([]),
  rejectedPriorActions: z.array(rejectedPriorActionSchema).default([]),
  risks: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  whyMemoryChangedIt: z.string().default(''),
  /** The stateless answer, kept so the before/after contrast is explicit. */
  baselineRecommendation: z.string().default(''),
  conflicts: z.array(memoryConflictSchema).default([]),
});
export type Recommendation = z.output<typeof recommendationSchema>;

/* --------------------------------------------------------------- requests */

export const createFindingSchema = z.object({
  controlId: nonEmpty,
  title: nonEmpty,
  description: nonEmpty,
  severity: severitySchema,
  category: findingCategorySchema,
  affectedSystem: nonEmpty,
  evidence: z
    .array(
      z.object({
        source: nonEmpty,
        observation: nonEmpty,
        supportsHypothesis: z.string().optional(),
      }),
    )
    .default([]),
  firstDetectedAt: isoDate.optional(),
  recurrenceOf: z.string().optional(),
});
export type CreateFindingInput = z.input<typeof createFindingSchema>;
/** After defaults are applied — what handlers should consume. */
export type CreateFinding = z.output<typeof createFindingSchema>;

export const approvalRequestSchema = z.object({
  decision: approvalDecisionSchema,
  decidedBy: nonEmpty,
  reason: z.string().optional(),
  requestedEvidence: z.string().optional(),
});
export type ApprovalRequest = z.input<typeof approvalRequestSchema>;

export const outcomeRequestSchema = z.object({
  method: verificationMethodSchema,
  result: verificationResultSchema,
  evidenceText: nonEmpty,
  verifier: nonEmpty,
  outcome: outcomeResultSchema,
  recurrence: z.boolean().default(false),
  daysToRecurrence: z.number().int().positive().optional(),
  lessonLearned: nonEmpty,
  observedSideEffects: z.array(z.string()).default([]),
  additionalInvestigation: z.string().optional(),
});
export type OutcomeRequest = z.output<typeof outcomeRequestSchema>;
/** Before defaults are applied — what the raw HTTP body looks like. */
export type OutcomeRequestBody = z.input<typeof outcomeRequestSchema>;

/* ------------------------------------------- LLM response contracts (strict) */

export const llmRootCauseSchema = z.object({
  rootCause: nonEmpty,
  contributingFactors: z.array(z.string()).default([]),
  confidence,
  alternativeHypotheses: z.array(z.string()).default([]),
});
export type LlmRootCause = z.output<typeof llmRootCauseSchema>;

export const llmRecommendationSchema = z.object({
  recommendation: nonEmpty,
  confidence,
  risks: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  whyMemoryChangedIt: z.string().default(''),
  conflictingEvidence: z.string().optional(),
});
export type LlmRecommendation = z.output<typeof llmRecommendationSchema>;

/**
 * Acknowledged upstream constraint: Hindsight recall scores are relative to a
 * single query. Everything downstream must treat them as ordering signals.
 */
export const RELATIVE_SCORE_CAVEAT =
  'Hindsight recall scores are relative to a single query and are not calibrated similarity percentages.' as const;
