import { z } from "zod";

import { closeDb, ensureDb } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/http";
import {
  listStoredMemories,
  retainLesson,
  scoreMemoriesAgainst,
  type StoredMemory,
} from "@/lib/memory";
import { parseListQuery } from "@/app/lib/memory-query";

export const runtime = "nodejs";
/** A relevance scoring pass runs one recall, which is CPU-bound on the reranker. */
export const maxDuration = 90;

/**
 * Read the organisation's memory back.
 *
 * `available: false` is a first-class response: the Memory page must say
 * "historical memory temporarily unavailable" rather than implying the bank is
 * empty when the server cannot be reached.
 */
export async function GET(request: Request) {
  try {
    ensureDb();
    const params = parseListQuery(request.url);

    const listing = await listStoredMemories({
      ...(params.q ? { q: params.q } : {}),
      ...(params.type ? { type: params.type } : {}),
    });

    if (!listing.available) {
      return ok({
        memory: listing,
        relevance: null,
        page: { limit: params.limit, offset: params.offset, total: 0 },
      });
    }

    // Lifecycle filtering happens here rather than in the server query: the
    // stage lives in metadata, so a server-side filter would need to know it.
    const filtered = params.stage
      ? listing.items.filter((m) => m.stage === params.stage)
      : listing.items;

    const page = filtered.slice(params.offset, params.offset + params.limit);

    const relevance = params.scoreAgainst
      ? await scoreMemoriesAgainst(params.scoreAgainst)
      : null;

    return ok({
      memory: { ...listing, items: page, total: filtered.length },
      relevance,
      page: { limit: params.limit, offset: params.offset, total: filtered.length },
    });
  } catch (error) {
    return fail(error);
  } finally {
    closeDb();
  }
}

const writeSchema = z.object({
  caseId: z.string().trim().min(1).max(64),
  controlId: z.string().trim().min(1).max(32),
  lesson: z.string().trim().min(8).max(600),
  /**
   * Skip the write when an identical lesson for the same case is already
   * stored. The demo runs repeatedly; without this every run would add another
   * copy of the same fact and slowly distort recall for real findings.
   */
  dedupe: z.boolean().default(true),
});

/**
 * Write one lesson into the memory layer.
 *
 * Used by Demo Mode to close the loop for real — the demo's own outcome becomes
 * a retrievable fact instead of a claim on screen. It writes a lesson and
 * nothing else: no recommendation is ever executed, and the payload is
 * Zod-validated before it reaches Hindsight.
 */
export async function POST(request: Request) {
  try {
    ensureDb();
    const body = await readJson(request, writeSchema);

    if (body.dedupe) {
      const existing = await listStoredMemories({
        q: `Case #${body.caseId} lesson learned`,
      });
      const duplicate: StoredMemory | undefined = existing.available
        ? existing.items.find(
            (m) => m.caseId === body.caseId && m.stage === "lesson",
          )
        : undefined;
      if (duplicate) {
        return ok({
          memory: {
            ok: true,
            written: 0,
            alreadyPresent: true,
            factId: duplicate.factId,
            text: duplicate.text,
          },
        });
      }
    }

    const result = await retainLesson({
      caseId: body.caseId,
      controlId: body.controlId,
      lesson: body.lesson,
    });

    return ok({
      memory: {
        ok: result.ok,
        written: result.written,
        alreadyPresent: false,
        ...(result.reason ? { reason: result.reason } : {}),
      },
    });
  } catch (error) {
    return fail(error);
  } finally {
    closeDb();
  }
}
