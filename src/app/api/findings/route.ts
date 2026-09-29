import { closeDb, ensureDb } from "@/lib/db";
import { createFinding, listFindings, listLatestAnalyses } from "@/lib/db/queries";
import { fail, ok, readJson } from "@/lib/http";
import { createFindingSchema } from "@/lib/models/schemas";

export const runtime = "nodejs";

/**
 * List findings, each with a compact summary of the last analysis run.
 *
 * The summaries ride along here rather than requiring a detail request per
 * row: the findings table shows "Memory" for every row, and fanning out N
 * requests to render one table would be the wrong shape for it.
 */
export async function GET() {
  try {
    ensureDb();
    const summaries: Record<
      string,
      {
        memoryStatus: string;
        memoryInfluenced: boolean;
        casesUsed: number;
        rejected: number;
        conflicts: number;
        changed: boolean;
        createdAt: string;
      }
    > = {};
    for (const row of listLatestAnalyses()) {
      summaries[row.findingId] = {
        memoryStatus: row.memoryStatus,
        memoryInfluenced: row.memoryInfluenced,
        casesUsed: row.casesUsed,
        rejected: row.rejected,
        conflicts: row.conflicts,
        changed: row.changed,
        createdAt: row.createdAt,
      };
    }
    return ok({ findings: listFindings(), summaries });
  } catch (error) {
    return fail(error);
  } finally {
    closeDb();
  }
}

export async function POST(request: Request) {
  try {
    ensureDb();
    const draft = await readJson(request, createFindingSchema);
    const finding = createFinding(draft);
    return ok({ finding }, { status: 201 });
  } catch (error) {
    return fail(error);
  } finally {
    closeDb();
  }
}
