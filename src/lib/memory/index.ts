/**
 * Public memory façade.
 *
 * Import from here — never reach into `hindsight.ts` directly. This keeps the
 * application code decoupled from the transport and makes it obvious, at a
 * glance, which functions touch the memory layer.
 */
export {
  getHindsightClient,
  getHindsightStatus,
  HindsightError,
  MemoryUnavailableError,
  describeMemoryError,
  setHindsightClient,
  type HindsightStatus,
} from './hindsight';

export {
  retainCaseStage,
  retainHistoricalCase,
  retainLesson,
  retainRemediationOutcome,
  type MemoryWriteResult,
} from './retain';

export {
  listStoredMemories,
  scoreMemoriesAgainst,
  type MemoryListing,
  type RelevanceResult,
  type StoredMemory,
} from './inspect';

export {
  buildQuery,
  groupByCase,
  recallFailedFixes,
  recallHistoricalRemediations,
  recallLessons,
  recallSimilarFindings,
  recallSuccessfulFixes,
  mergeBundles,
  runRecall,
  type RecallOptions,
} from './recall';

export {
  CASE_STAGES,
  finaliseBundle,
  outcomeLabel,
  renderStage,
  stageContext,
  stagesFor,
} from './memory-types';

export type { MemoryReference, RecallBundle } from '../models/schemas';
