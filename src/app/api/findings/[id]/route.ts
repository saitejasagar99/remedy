import { z } from "zod";

import { closeDb, ensureDb } from "@/lib/db";
import { getFindingDetail } from "@/lib/db/queries";
import { fail, ok } from "@/lib/http";

export const runtime = "nodejs";

const idParams = z.object({ id: z.string().min(1) });

/** Full detail: finding, root cause, remediation, approvals, outcomes, stage audit. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    ensureDb();
    const { id } = idParams.parse(await context.params);
    return ok({ detail: getFindingDetail(id) ?? null });
  } catch (error) {
    return fail(error);
  } finally {
    closeDb();
  }
}
