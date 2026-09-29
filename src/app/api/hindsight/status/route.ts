import { closeDb, ensureDb, getDb } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { getHindsightStatus } from "@/lib/memory";

export const runtime = "nodejs";

function countFindings(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM findings").get() as
    | { n?: number }
    | undefined;
  return row?.n ?? 0;
}

/**
 * Health of the memory layer, plus how much is currently stored.
 *
 * `reachable: false` is a normal, expected state — the UI renders the
 * "historical memory unavailable" explanation from it rather than erroring.
 */
export async function GET() {
  try {
    ensureDb();
    const status = await getHindsightStatus();
    return ok({ status, localFindings: countFindings() });
  } catch (error) {
    return fail(error);
  } finally {
    closeDb();
  }
}
