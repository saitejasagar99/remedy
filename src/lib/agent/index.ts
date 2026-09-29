/**
 * Barrel for the agent pipeline.
 *
 * Route handlers import from `@/lib/agent` so the orchestration surface is a
 * single, obvious import.
 */
export {
  analyzeFinding,
  submitApproval,
  recordRemediationOutcome,
  currentRootCause,
  type AnalysisResult,
  type ApprovalOutcome,
  type OutcomeResultDto,
  type StageTrace,
} from './pipeline';

export { deriveStatelessRecommendation, applyMemory } from './recommend';
export { detectConflicts } from './conflict';
