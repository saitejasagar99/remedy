import { closeDb, ensureDb } from "@/lib/db";
import {
  listAllOutcomes,
  listFindings,
  listLatestAnalyses,
  listLatestRemediationStatuses,
} from "@/lib/db/queries";
import { computeDashboardStats } from "@/lib/dashboard";
import { fail, ok } from "@/lib/http";

export const runtime = "nodejs";

/**
 * Everything the dashboard counts, computed from application state in one pass.
 *
 * There is no separate analytics store: each figure is a rollup over findings,
 * their stored analyses, their remediations and their recorded outcomes, so
 * what the dashboard reports is what actually happened.
 */
export async function GET() {
  try {
    ensureDb();
    const stats = computeDashboardStats({
      findings: listFindings(),
      analyses: listLatestAnalyses(),
      outcomes: listAllOutcomes(),
      remediations: listLatestRemediationStatuses(),
    });
    return ok({ stats });
  } catch (error) {
    return fail(error);
  } finally {
    closeDb();
  }
}
