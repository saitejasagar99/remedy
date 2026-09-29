import { closeDb, ensureDb } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { seedHistoricalCases } from "@/lib/seed";

export const runtime = "nodejs";
export const maxDuration = 180;

/**
 * Load the synthetic compliance history into Hindsight.
 *
 * Idempotent: cases already present in the bank are skipped, so re-running
 * never duplicates memory.
 */
export async function POST() {
  try {
    ensureDb();
    const seeded = await seedHistoricalCases();
    return ok({ seeded });
  } catch (error) {
    return fail(error);
  } finally {
    closeDb();
  }
}
