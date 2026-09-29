/**
 * Hindsight client — the ONLY module in the application that talks to Hindsight.
 *
 * Everything else goes through the application-level functions in `retain.ts`
 * and `recall.ts`. Keeping the wire protocol here means a server upgrade or a
 * switch to Hindsight Cloud is a single-file change.
 *
 * Design rules enforced by this module:
 *  - every external call is bounded by a timeout (a hung server never hangs a request)
 *  - every failure is converted into an explicit, typed status
 *  - nothing is ever fabricated: if Hindsight cannot answer, callers are told so
 */
import { HindsightClient, HindsightError } from '@vectorize-io/hindsight-client';

import { hindsightConfig } from '../config';

export { HindsightError };

/** Explicit, non-fabricated failure information. */
export class MemoryUnavailableError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'MemoryUnavailableError';
    this.cause = cause;
  }
}

let client: HindsightClient | null = null;

/**
 * Lazily construct the singleton client.
 *
 * `apiKey` is only sent when configured — a self-hosted server needs none, and
 * sending an empty Bearer token would be rejected as a bad credential.
 */
export function getHindsightClient(): HindsightClient {
  if (client) return client;
  const options: ConstructorParameters<typeof HindsightClient>[0] = {
    baseUrl: hindsightConfig.baseUrl,
    // Conservative: two attempts for idempotent reads, writes are never retried.
    maxAttempts: 2,
    userAgent: 'remedy-compliance-memory/1.0',
  };
  if (hindsightConfig.apiKey) options.apiKey = hindsightConfig.apiKey;
  client = new HindsightClient(options);
  return client;
}

/** Test seam — lets integration tests inject a client without touching globals. */
export function setHindsightClient(next: HindsightClient | null): void {
  client = next;
}

/**
 * Run `fn` under a hard timeout.
 *
 * The Hindsight client has its own retry behaviour but no overall deadline, so
 * this is the guarantee that a wedged server surfaces as `MemoryUnavailableError`
 * rather than stalling the whole pipeline.
 */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await Promise.race([
      fn(controller.signal),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener(
          'abort',
          () =>
            reject(
              new MemoryUnavailableError(
                `${label} timed out after ${timeoutMs}ms`,
              ),
            ),
          { once: true },
        );
      }),
    ]);
  } catch (error) {
    throw toMemoryError(error, label);
  } finally {
    clearTimeout(timer);
  }
}

/** Normalise any thrown value into a readable memory error. */
function toMemoryError(error: unknown, label: string): Error {
  if (error instanceof MemoryUnavailableError) return error;
  if (error instanceof HindsightError) {
    const status = error.statusCode ? ` (HTTP ${error.statusCode})` : '';
    return new MemoryUnavailableError(`${label} failed${status}: ${error.message}`, error);
  }
  if (error instanceof Error) {
    // fetch() rejects with a bare TypeError on connection failure.
    if (error.name === 'AbortError') {
      return new MemoryUnavailableError(`${label} was aborted`, error);
    }
    return new MemoryUnavailableError(`${label} failed: ${error.message}`, error);
  }
  return new MemoryUnavailableError(`${label} failed with an unknown error`, error);
}

/** Read a human-readable reason without leaking internals to the UI. */
export function describeMemoryError(error: unknown): string {
  if (error instanceof MemoryUnavailableError) {
    // Drop the trailing technical suffix for the user-facing string.
    return error.message.split(' (HTTP')[0];
  }
  if (error instanceof Error) return error.message;
  return 'Unknown memory error';
}

export interface HindsightStatus {
  reachable: boolean;
  baseUrl: string;
  bankId: string;
  version?: string;
  reason?: string;
}

/**
 * Health probe used by the status endpoint and by the UI to decide whether to
 * render the "historical memory unavailable" state.
 */
export async function getHindsightStatus(): Promise<HindsightStatus> {
  const base: HindsightStatus = {
    reachable: false,
    baseUrl: hindsightConfig.baseUrl,
    bankId: hindsightConfig.bankId,
  };
  try {
    const version = await withTimeout(
      (signal) => getHindsightClient().getVersion({ signal }),
      5_000,
      'Hindsight version check',
    );
    return { ...base, reachable: true, version: version.api_version };
  } catch (error) {
    return { ...base, reason: describeMemoryError(error) };
  }
}
