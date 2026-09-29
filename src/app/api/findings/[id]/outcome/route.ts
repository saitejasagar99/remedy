import { z } from "zod";

import { recordRemediationOutcome } from "@/lib/agent";
import { closeDb, ensureDb } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/http";
import { outcomeRequestSchema } from "@/lib/models/schemas";

export const runtime = "nodejs";
export const maxDuration = 120;

const idParams = z.object({ id: z.string().min(1) });

/**
 * Record verification + outcome, then write the result back to Hindsight.
 *
 * This is the step that closes the loop: today's outcome becomes tomorrow's
 * historical memory and changes the next recommendation.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    ensureDb();
    const { id } = idParams.parse(await context.params);
    const report = await readJson(request, outcomeRequestSchema);
    const summary = await recordRemediationOutcome(id, report);
    return ok({ summary });
  } catch (error) {
    return fail(error);
  } finally {
    closeDb();
  }
}
