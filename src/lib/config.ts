/**
 * Central configuration.
 *
 * Every external dependency is env-driven so the app can be pointed at a
 * different Hindsight server or LLM without a code change. Values are parsed
 * and validated once, at import time, so a bad configuration fails loudly
 * instead of surfacing as a mysterious runtime error.
 */

/** Parse a positive integer env var, falling back to a default. */
function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: expected a positive integer, got "${raw}"`);
  }
  return parsed;
}

function requiredEnv(name: string): string {
  const raw = process.env[name];
  if (!raw) throw new Error(`Missing required environment variable: ${name}`);
  return raw;
}

/** Hindsight connection settings. */
export const hindsightConfig = {
  /** Base URL of the Hindsight server (local bare-metal by default). */
  baseUrl: process.env.HINDSIGHT_URL ?? 'http://localhost:8888',
  /** Tenant segment in the REST path. Self-hosted servers use `default`. */
  tenant: process.env.HINDSIGHT_TENANT ?? 'default',
  /** Memory bank that holds all REMEDY organisational experience. */
  bankId: process.env.HINDSIGHT_BANK ?? 'remedy',
  /**
   * Only meaningful for Hindsight Cloud. A self-hosted server ignores it;
   * leaving it empty is normal and is not treated as a misconfiguration.
   */
  apiKey: process.env.HINDSIGHT_API_KEY ?? '',
  retainTimeoutMs: intEnv('HINDSIGHT_RETAIN_TIMEOUT_MS', 120_000),
  /**
   * Per recall request. Five run concurrently (see `gatherHistoricalContext`)
   * and share one CPU-bound reranker, so each waits on the others: ~6s alone,
   * ~30s for the batch, with the slowest arm landing on the deadline.
   *
   * A recall that exceeds this fails *silently* — `mergeBundles` still reports
   * "available" when the sibling arms answer, so a lost arm surfaces as a
   * missing case rather than as an error, and a missing case can be the one
   * that would have changed the recommendation. 30s cost an arm per batch;
   * 60s gives the contention room it needs.
   */
  recallTimeoutMs: intEnv('HINDSIGHT_RECALL_TIMEOUT_MS', 60_000),
} as const;

/** LLM connection settings (any OpenAI-compatible endpoint). */
export const llmConfig = {
  /** OpenAI-compatible base URL, e.g. Ollama's `http://localhost:11434/v1`. */
  baseUrl: requiredEnv('LLM_BASE_URL'),
  model: process.env.LLM_MODEL ?? 'gemma3:4b',
  /** Most OpenAI-compatible local servers accept any non-empty value. */
  apiKey: process.env.LLM_API_KEY ?? 'ollama',
  timeoutMs: intEnv('LLM_TIMEOUT_MS', 120_000),
  temperature: Number(process.env.LLM_TEMPERATURE ?? '0.2'),
} as const;

/** SQLite application-state location (findings/runs/approvals — NOT memory). */
export const databasePath = process.env.DATABASE_PATH ?? './data/remedy.db';

/**
 * Validate the runtime configuration on demand.
 *
 * The values above are read (and `requiredEnv` enforced) at import time, so in
 * practice this always passes — it exists so request handlers have a single,
 * explicit pre-flight they can point at when something is misconfigured, and so
 * tests can assert the failure mode without importing every module first.
 */
export function requireConfig(): void {
  requiredEnv('LLM_BASE_URL');
  if (!hindsightConfig.baseUrl) {
    throw new Error('Missing required environment variable: HINDSIGHT_URL');
  }
  if (!hindsightConfig.bankId) {
    throw new Error('Missing required environment variable: HINDSIGHT_BANK');
  }
}

/**
 * Absolute path to the SQLite file.
 *
 * Next.js route handlers resolve relative paths against the project root, but
 * background scripts may run from elsewhere — anchoring here keeps both
 * pointing at the same database.
 */
export function resolveDatabasePath(): string {
  const path = databasePath;
  if (path === ':memory:' || /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('/')) {
    return path;
  }
  const cwd = process.cwd();
  return `${cwd}/${path.replace(/^\.?\//, '')}`;
}
