/**
 * Memory inspection — reading the bank back for the Memory page.
 *
 * This is deliberately separate from `recall.ts`: recall answers "what is
 * relevant to *this* finding", while inspection answers "what does the
 * organisation actually remember". Both read the same bank, but they have
 * different honesty requirements — a recall that finds nothing must say
 * "no relevant memory", and an inspection that cannot reach the server must
 * say "unavailable", never "empty".
 */
import type { ListMemoryUnitsResponse } from '@vectorize-io/hindsight-client';

import { hindsightConfig } from '../config';
import type { MemoryReference } from '../models/schemas';
import { MemoryStage } from '../models/enums';

import {
  describeMemoryError,
  getHindsightClient,
  withTimeout,
} from './hindsight';
import { getFinding } from '../db/queries';
import { recallSimilarFindings } from './recall';

type RawItem = ListMemoryUnitsResponse['items'][number];

/** One memory as the Memory page renders it. */
export interface StoredMemory {
  factId: string;
  text: string;
  type: string;
  stage?: MemoryStage;
  caseId?: string;
  controlId?: string;
  category?: string;
  severity?: string;
  outcome?: string;
  recurrence: boolean;
  daysToRecurrence?: number;
  context?: string;
  occurredAt?: string;
  mentionedAt?: string;
  entities: string[];
  tags: string[];
}

export interface MemoryListing {
  available: boolean;
  /** Present only when `available` is false. Human-readable, never a stack trace. */
  reason?: string;
  items: StoredMemory[];
  /** Total matching the query, before pagination. */
  total: number;
  /** Counts per lifecycle stage across everything the bank holds. */
  stageCounts: Record<string, number>;
}

const STAGES = new Set<string>(Object.values(MemoryStage));

function stringOf(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function adapt(item: RawItem): StoredMemory | null {
  if (!item || typeof item.id !== 'string' || !item.text) return null;
  const meta = (item.metadata ?? {}) as Record<string, unknown>;

  const rawStage = stringOf(meta.stage);
  const stage = rawStage && STAGES.has(rawStage) ? (rawStage as MemoryStage) : undefined;
  const days = stringOf(meta.daysToRecurrence);
  const parsedDays = days ? Number.parseInt(days, 10) : Number.NaN;

  const entities = typeof item.entities === 'string' && item.entities
    ? item.entities.split(',').map((e) => e.trim()).filter(Boolean)
    : [];

  return {
    factId: item.id,
    text: item.text,
    type: item.fact_type ?? 'world',
    stage,
    caseId: stringOf(meta.caseId),
    controlId: stringOf(meta.controlId),
    category: stringOf(meta.category),
    severity: stringOf(meta.severity),
    outcome: stringOf(meta.outcome),
    recurrence: stringOf(meta.recurrence) === 'true',
    ...(Number.isNaN(parsedDays) ? {} : { daysToRecurrence: parsedDays }),
    context: item.context ?? undefined,
    occurredAt: item.occurred_start ?? item.date ?? undefined,
    mentionedAt: item.mentioned_at ?? undefined,
    entities,
    tags: item.tags ?? [],
  };
}

/** How many memories a single inspection pass will read. */
const MAX_INSPECT = 1000;

/**
 * List memories, optionally filtered by free text.
 *
 * Returns `available: false` rather than an empty list when Hindsight cannot
 * be reached, so the UI can distinguish "the organisation remembers nothing
 * relevant" from "the memory layer is down".
 */
export async function listStoredMemories(options: {
  q?: string;
  type?: string;
} = {}): Promise<MemoryListing> {
  try {
    const response = await withTimeout(
      (signal) =>
        getHindsightClient().listMemories(hindsightConfig.bankId, {
          limit: MAX_INSPECT,
          ...(options.q ? { q: options.q } : {}),
          ...(options.type ? { type: options.type } : {}),
          signal,
        }),
      hindsightConfig.recallTimeoutMs,
      'Hindsight memory listing',
    );

    const items: StoredMemory[] = [];
    const stageCounts: Record<string, number> = {};
    for (const raw of response.items ?? []) {
      const mapped = adapt(raw);
      if (!mapped) continue;
      items.push(mapped);
      const key = mapped.stage ?? 'untagged';
      stageCounts[key] = (stageCounts[key] ?? 0) + 1;
    }

    return {
      available: true,
      items,
      total: items.length,
      stageCounts,
    };
  } catch (error) {
    return {
      available: false,
      reason: describeMemoryError(error),
      items: [],
      total: 0,
      stageCounts: {},
    };
  }
}

export interface RelevanceResult {
  available: boolean;
  reason?: string;
  findingId: string;
  /** Fact ids the recall returned, with their relative rank score. */
  matches: Array<{ factId: string; score: number | null }>;
  /** Highest score in this query — the denominator for a relative match bar. */
  topScore: number | null;
}

/**
 * Score stored memories against one finding with a single recall.
 *
 * One query, not the five the pipeline runs: this is an explanation aid for the
 * Memory page, not a recommendation input. Scores are relative to the query and
 * are surfaced as such — never as a similarity percentage.
 */
export async function scoreMemoriesAgainst(
  findingId: string,
): Promise<RelevanceResult> {
  const finding = getFinding(findingId);
  if (!finding) {
    return {
      available: false,
      reason: 'Finding not found',
      findingId,
      matches: [],
      topScore: null,
    };
  }

  const bundle = await recallSimilarFindings(finding, { budget: 'mid' });
  if (!bundle.historicalMemoryAvailable) {
    return {
      available: false,
      reason: bundle.reason ?? 'Historical memory unavailable',
      findingId,
      matches: [],
      topScore: null,
    };
  }

  const matches: RelevanceResult['matches'] = bundle.memories.map(
    (m: MemoryReference) => ({
      factId: m.factId,
      score: m.scores?.final ?? null,
    }),
  );
  const topScore = matches.reduce<number | null>((best, m) => {
    if (m.score === null) return best;
    return best === null || m.score > best ? m.score : best;
  }, null);

  return { available: true, findingId, matches, topScore };
}
