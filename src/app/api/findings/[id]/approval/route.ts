import { z } from "zod";

import { submitApproval } from "@/lib/agent";
import { closeDb, ensureDb } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/http";
import { approvalRequestSchema } from "@/lib/models/schemas";

export const runtime = "nodejs";

const idParams = z.object({ id: z.string().min(1) });

/**
 * The single human gate.
 *
 * There is no code path from PROPOSED to IMPLEMENTED that does not come through
 * this handler — rejection and "request more evidence" both stop the flow.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    ensureDb();
    const { id } = idParams.parse(await context.params);
    const decision = await readJson(request, approvalRequestSchema);
    return ok(submitApproval(id, decision));
  } catch (error) {
    return fail(error);
  } finally {
    closeDb();
  }
}
