/**
 * Recall operations — retrieving the organisation's remediation history.
 *
 * Every function here returns a `RecallBundle`. None of them throw and none of
 * them invent history: when Hindsight cannot answer, the bundle says so and the
 * recommendation layer is forced to fall back to a stateless answer.
 */
import { hindsightConfig } from '../config';
import type { Finding } from '../models/schemas';
import { MemoryStage } from '../models/enums';

import {
  describeMemoryError,
  getHindsightClient,
  withTimeout,
} from './hindsight';
import {
  dedupeById,
  errorBundle,
  finaliseBundle,
  isMetadataEcho,
  toMemoryReference,
  unavailableBundle,
} from './memory-types';
import type { MemoryReference, RecallBundle } from '../models/schemas';

/** Maximum tokens of memory injected into a single reasoning step. */
const DEFAULT_MAX_TOKENS = 2000;

export interface RecallOptions {
  maxTokens?: number;
  budget?: 'low' | 'mid' | 'high';
  /** Restrict to specific memory stages via their metadata. */
  stages?: MemoryStage[];
}

/**
 * Build the search query for a finding.
 *
 * Deliberately includes the control, category, system and evidence text —
 * Hindsight runs semantic, keyword, graph and temporal retrieval in parallel,
 * so richer queries give each arm something to match on.
 */
export function buildQuery(finding: Finding, intent: string): string {
  const evidence = finding.evidence
    .map((e) => e.observation)
    .slice(0, 5)
    .join('; ');
  return [
    intent,
    `control ${finding.controlId}`,
    finding.title,
    `category ${finding.category}`,
    `system ${finding.affectedSystem}`,
    evidence ? `evidence: ${evidence}` : '',
  ]
    .filter(Boolean)
    .join('. ');
}

/**
 * Core recall. Transports every failure into a bundle status.
 */
export async function runRecall(
  query: string,
  options: RecallOptions = {},
): Promise<RecallBundle> {
  const started = Date.now();
  try {
    const response = await withTimeout(
      (signal) =>
        getHindsightClient().recall(hindsightConfig.bankId, query, {
          // Include observations so consolidated organisational lessons
          // surface alongside the raw facts they were built from.
          types: ['world', 'experience', 'observation'],
          preferObservations: true,
          maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
          budget: options.budget ?? 'mid',
          signal,
        }),
      hindsightConfig.recallTimeoutMs,
      'Hindsight recall',
    );

    const raw = response?.results ?? [];
    const mapped = raw
      .map(toMemoryReference)
      .filter((m): m is MemoryReference => m !== null);

    if (mapped.length < raw.length) {
      // Malformed server output: keep what parsed, but never silently drop.
      // An empty mapping is reported as an error rather than "no memory".
      if (mapped.length === 0 && raw.length > 0) {
        return {
          ...errorBundle('Hindsight returned malformed memory results'),
          durationMs: Date.now() - started,
        };
      }
    }

    const filtered = options.stages
      ? mapped.filter((m) => m.stage && options.stages?.includes(m.stage))
      : mapped;

    // Metadata echoes are dropped before ranking so they cannot occupy a
    // relevance slot a real fact would otherwise have taken. See
    // `isMetadataEcho` for why they exist and why removing them hides nothing.
    const substance = filtered.filter((m) => !isMetadataEcho(m.text));

    return { ...finaliseBundle(dedupeById(substance)), durationMs: Date.now() - started };
  } catch (error) {
    const reason = describeMemoryError(error);
    const bundle =
      reason.includes('timed out') || reason.includes('fetch') || reason.includes('ECONNREFUSED')
        ? unavailableBundle(reason)
        : errorBundle(reason);
    return { ...bundle, durationMs: Date.now() - started };
  }
}

/** Historical findings that resemble the current one. */
export function recallSimilarFindings(
  finding: Finding,
  options?: RecallOptions,
): Promise<RecallBundle> {
  return runRecall(
    buildQuery(
      finding,
      'Similar historical compliance finding, previous root cause and recurrence',
    ),
    options,
  );
}

/** What was tried before for this kind of finding. */
export function recallHistoricalRemediations(
  finding: Finding,
  options?: RecallOptions,
): Promise<RecallBundle> {
  return runRecall(
    buildQuery(finding, 'Remediation attempted previously and how it was implemented'),
    options,
  );
}

/**
 * Remediations that failed or recurred.
 *
 * This is the query that makes REMEDY refuse to repeat a fix that history says
 * does not hold — the core "different memory → different recommendation" lever.
 */
export function recallFailedFixes(
  finding: Finding,
  options?: RecallOptions,
): Promise<RecallBundle> {
  return runRecall(
    buildQuery(
      finding,
      'Remediation that FAILED or PARTIAL or the finding RECURRED after the fix, with time to recurrence',
    ),
    { ...options, budget: options?.budget ?? 'high' },
  );
}

/** Remediations that genuinely held. */
export function recallSuccessfulFixes(
  finding: Finding,
  options?: RecallOptions,
): Promise<RecallBundle> {
  return runRecall(
    buildQuery(finding, 'Remediation that SUCCESSFULLY resolved the finding and did not recur'),
    options,
  );
}

/** Distilled lessons tied to this control or category. */
export function recallLessons(
  finding: Finding,
  options?: RecallOptions,
): Promise<RecallBundle> {
  return runRecall(
    buildQuery(finding, 'Lesson learned, what to check first, contributing factors'),
    options,
  );
}

/**
 * Group recalled facts by the historical case they belong to.
 *
 * Facts without a `caseId` are grouped under an `unknown` key so nothing is
 * silently discarded — they still reach the model, just without a case header.
 */
export function groupByCase(
  memories: MemoryReference[],
): Map<string, MemoryReference[]> {
  const groups = new Map<string, MemoryReference[]>();
  for (const m of memories) {
    const key = m.caseId ?? 'unknown';
    const list = groups.get(key);
    if (list) list.push(m);
    else groups.set(key, [m]);
  }
  return groups;
}

/** Merge several bundles, keeping the worst availability status. */
export function mergeBundles(bundles: RecallBundle[]): RecallBundle {
  const usable = bundles.filter((b) => b.historicalMemoryAvailable);
  const memories = dedupeById(usable.flatMap((b) => b.memories));

  if (usable.length === 0) {
    const first = bundles[0];
    return {
      historicalMemoryAvailable: false,
      status: 'unavailable',
      reason: first?.reason ?? 'Historical memory unavailable',
      memories: [],
    };
  }

  const merged = finaliseBundle(memories);
  if (merged.status === 'empty') {
    const err = bundles.find((b) => b.status === 'error');
    if (err) return merged;
  }
  return merged;
}
