import { z } from "zod";

import { analyzeFinding } from "@/lib/agent";
import { closeDb, ensureDb } from "@/lib/db";
import { fail, ok } from "@/lib/http";

export const runtime = "nodejs";
/** LLM + Hindsight round-trips can exceed the 10s default on a cold Ollama start. */
export const maxDuration = 120;

const idParams = z.object({ id: z.string().min(1) });

/**
 * Run the full pipeline for one finding:
 * evidence -> root cause -> Hindsight recall -> recommendation.
 *
 * Re-runnable: each run appends to `agent_runs` rather than overwriting, so the
 * audit trail shows how the recommendation changed as memory accumulated.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    ensureDb();
    const { id } = idParams.parse(await context.params);
    // `request` is unused: analysis is driven entirely by the finding id, so a
    // re-run needs no body.
    void request;
    const analysis = await analyzeFinding(id);
    return ok({ analysis });
  } catch (error) {
    return fail(error);
  } finally {
    closeDb();
  }
}
