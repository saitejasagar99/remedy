/**
 * Robust JSON extraction for LLM output.
 *
 * Local models frequently wrap JSON in markdown fences, add a preamble, or emit
 * trailing prose. Rather than failing the whole pipeline on a formatting slip,
 * we try progressively looser strategies and validate the result with Zod.
 *
 * Nothing here is ever *executed* — only parsed and validated.
 */
/**
 * Structural schema contract.
 *
 * Deliberately *not* `ZodType<T>`: Zod schemas that use `.default()` have
 * different input and output types, and pinning both to `T` either rejects
 * valid schemas or erases the output type to `unknown`. Declaring only the
 * `safeParse` surface keeps inference exact while staying decoupled from Zod's
 * generic arity (which changed between major versions).
 */
export interface JsonSchema<T> {
  safeParse(
    data: unknown,
  ):
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> };
      };
}

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; raw: string };

const FENCE = /```(?:json)?\s*([\s\S]*?)```/i;

/** Pull the balanced JSON object/array starting at `start`. */
function extractBalanced(text: string, start: number): string | null {
  const open = text[start];
  const close = open === '{' ? '}' : open === '[' ? ']' : null;
  if (!close) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Every plausible JSON candidate, best-first. */
function candidates(raw: string): string[] {
  const out: string[] = [];
  const push = (v: string | null) => {
    if (v && !out.includes(v)) out.push(v);
  };

  const trimmed = raw.trim();
  push(trimmed);

  const fenced = raw.match(FENCE);
  if (fenced?.[1]) push(fenced[1].trim());

  const objectStart = raw.indexOf('{');
  if (objectStart !== -1) push(extractBalanced(raw, objectStart));

  const arrayStart = raw.indexOf('[');
  if (arrayStart !== -1) push(extractBalanced(raw, arrayStart));

  return out;
}

/**
 * Parse and validate LLM output against a Zod schema.
 *
 * Returns a discriminated result rather than throwing so callers can degrade
 * gracefully (e.g. fall back to memory-only reasoning) instead of 500ing.
 */
export function parseLLMJson<T>(
  raw: string,
  schema: JsonSchema<T>,
): ParseResult<T> {
  if (!raw || !raw.trim()) {
    return { ok: false, error: 'Model returned an empty response', raw: raw ?? '' };
  }

  let lastError = 'no JSON candidate found';
  for (const candidate of candidates(raw)) {
    let value: unknown;
    try {
      value = JSON.parse(candidate);
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'invalid JSON';
      continue;
    }
    const parsed = schema.safeParse(value);
    if (parsed.success) return { ok: true, data: parsed.data };
    lastError = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
  }

  return { ok: false, error: `Model output did not match the expected shape — ${lastError}`, raw };
}
