import { closeDb, ensureDb } from "@/lib/db";
import { resetDatabase } from "@/lib/db";
import { fail, ok } from "@/lib/http";

export const runtime = "nodejs";

/**
 * Wipe local application state (findings, analyses, approvals, runs).
 *
 * Hindsight memory is deliberately untouched: organisational experience is not
 * application state and must not be clearable from the UI.
 */
export async function POST() {
  try {
    resetDatabase();
    ensureDb();
    return ok({ reset: true });
  } catch (error) {
    return fail(error);
  } finally {
    closeDb();
  }
}
