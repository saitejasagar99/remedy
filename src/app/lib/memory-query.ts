/**
 * Query contract for the Memory Inspector's read endpoint.
 *
 * Kept out of the route file so it can be unit-tested directly: this is the
 * part of the API most likely to be quietly wrong, because Zod's object schema
 * cannot read a `URLSearchParams` instance by key — `params['q']` is
 * `undefined` on it, so every filter silently falls back to its default and the
 * endpoint returns the same page no matter what was asked for. Flattening to a
 * plain object first is the whole point of this module.
 */
import { z } from "zod";

/** Hard ceiling on one inspection pass so a large bank cannot stall a request. */
export const MAX_PAGE = 100;

export const listQuerySchema = z.object({
  /** Free-text search across retained fact text. */
  q: z.string().trim().max(300).optional(),
  /** Lifecycle category: finding, root_cause, remediation, ... */
  stage: z.string().trim().max(40).optional(),
  type: z.enum(["world", "experience", "observation"]).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  /** Finding id to rank memories against; presence turns relevance on. */
  scoreAgainst: z.string().trim().min(1).optional(),
});

export type ListQuery = z.output<typeof listQuerySchema>;

/**
 * Parse `?q=...&limit=...` from a request URL.
 *
 * Accepts an absolute URL (as `request.url` is) or a path with a query.
 */
export function parseListQuery(url: string): ListQuery {
  const search = new URL(url, "http://remedy.local").searchParams;
  return listQuerySchema.parse(Object.fromEntries(search));
}
