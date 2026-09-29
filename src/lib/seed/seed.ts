/**
 * Seeding — load the synthetic compliance history into Hindsight.
 *
 * Idempotent *at the stage level*, not merely per case. That distinction
 * matters: `retainHistoricalCase` writes a case's lifecycle stages one at a
 * time and reports `ok:false` when any of them fails, so a timed-out run leaves
 * a case partially written. Keying idempotency on `caseId` alone would then
 * treat that partial case as complete on the next run and it would never be
 * repaired.
 *
 * So we page the bank and collect `caseId -> set(stages)` first, compute exactly
 * which stages each case is missing, and write only those. Re-running never
 * duplicates memory, and an interrupted run resumes cleanly.
 *
 * The `caseId` in memory metadata is the only join key between a recalled fact
 * and the case it came from — losing it would make recall unattributable.
 */
import { hindsightConfig } from '../config';
import { HISTORICAL_CASES } from './historical-cases';
import { describeMemoryError, getHindsightClient } from '../memory/hindsight';
import {
  retainCaseStage,
  type MemoryWriteResult,
} from '../memory/retain';
import { stagesFor } from '../memory/memory-types';
import { historicalCaseSchema, type HistoricalCase } from '../models/schemas';

export interface SeedResult {
  /** Bank that was written to. */
  bankId: string;
  /** Cases already fully present before this run. */
  alreadyPresent: number;
  /** Cases this run completed (all stages written). */
  seeded: number;
  /** Cases still missing stages after this run. */
  failed: number;
  /** Individual lifecycle stages written by this run. */
  memoriesWritten: number;
  /** Cases that were only partially present and got topped up. */
  resumed: number;
  /** Per-case failures — never a stack trace. */
  errors: Array<{ caseId: string; reason: string }>;
  /** True when Hindsight could not be reached at all. */
  reachable: boolean;
}

interface ListedMemory {
  metadata?: { caseId?: unknown; stage?: unknown };
}

/**
 * Page through the bank collecting `caseId -> stages already stored`.
 *
 * The list endpoint returns a `total`, so we walk deterministically rather
 * than guessing a page size large enough to cover everything.
 */
async function existingStages(): Promise<Map<string, Set<string>>> {
  const client = getHindsightClient();
  const found = new Map<string, Set<string>>();
  const limit = 100;
  let offset = 0;

  // Hard stop at 10k memories: far beyond the seed set, and it guarantees the
  // loop terminates even if the server reports an inflated total.
  for (let guard = 0; guard < 100; guard += 1) {
    const page = (await client.listMemories(hindsightConfig.bankId, {
      limit,
      offset,
    })) as { items?: ListedMemory[]; total?: number };

    for (const item of page.items ?? []) {
      const { caseId, stage } = item.metadata ?? {};
      if (typeof caseId !== 'string' || !caseId) continue;
      const set = found.get(caseId) ?? new Set<string>();
      if (typeof stage === 'string' && stage) set.add(stage);
      found.set(caseId, set);
    }

    const total = page.total ?? 0;
    offset += limit;
    if (offset >= total) break;
  }

  return found;
}

/**
 * Load every historical case into Hindsight.
 *
 * Returns a structured result rather than throwing, so both the CLI script and
 * the `/api/seed` route can report partial success honestly.
 */
export async function seedHistoricalCases(): Promise<SeedResult> {
  const result: SeedResult = {
    bankId: hindsightConfig.bankId,
    alreadyPresent: 0,
    seeded: 0,
    failed: 0,
    memoriesWritten: 0,
    resumed: 0,
    errors: [],
    reachable: true,
  };

  let present: Map<string, Set<string>>;
  try {
    present = await existingStages();
  } catch (error) {
    return {
      ...result,
      reachable: false,
      errors: [{ caseId: 'connectivity', reason: describeMemoryError(error) }],
    };
  }

  for (const raw of HISTORICAL_CASES) {
    const parsed = historicalCaseSchema.safeParse(raw);
    if (!parsed.success) {
      result.failed += 1;
      result.errors.push({
        caseId: String((raw as { caseId?: unknown }).caseId ?? 'unknown'),
        reason: `Invalid historical case: ${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      });
      continue;
    }

    const record: HistoricalCase = parsed.data;
    const expected = stagesFor(record);
    const already = present.get(record.caseId) ?? new Set<string>();
    const missing = expected.filter((stage) => !already.has(stage));

    // Fully present: nothing to do. This is the only "skip" condition.
    if (missing.length === 0) {
      result.alreadyPresent += 1;
      continue;
    }

    const wasPartial = already.size > 0;
    let written = 0;
    let firstError: string | undefined;

    for (const stage of missing) {
      const write: MemoryWriteResult = await retainCaseStage(record, stage);
      if (write.ok) {
        written += 1;
        already.add(stage);
      } else {
        firstError ??= write.reason;
      }
    }

    result.memoriesWritten += written;
    present.set(record.caseId, already);

    if (firstError) {
      result.failed += 1;
      if (wasPartial) result.resumed += 1;
      result.errors.push({
        caseId: record.caseId,
        reason: `${firstError} (${expected.length - already.size} of ${expected.length} stages still missing)`,
      });
    } else {
      result.seeded += 1;
      if (wasPartial) result.resumed += 1;
    }
  }

  return result;
}
