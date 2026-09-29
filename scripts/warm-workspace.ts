/**
 * Warm the workspace so the dashboard shows real numbers.
 *
 * Runs the full pipeline on every stored finding (evidence -> root cause ->
 * Hindsight recall -> recommendation -> persisted analysis). Re-running is safe:
 * `getLatestAnalysis` always reads the newest row, so each run simply replaces
 * what a reviewer would see.
 *
 * Usage: `npm run warm` with the dev server on :3000.
 */
const BASE = process.env.REMEDY_BASE_URL ?? 'http://localhost:3000';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => null)) as T | null;
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status}`);
  return body as T;
}

async function main(): Promise<void> {
  const { findings } = await call<{ findings: Array<{ id: string; title: string }> }>(
    '/api/findings',
  );
  console.log(`warming ${findings.length} findings`);

  for (const [index, finding] of findings.entries()) {
    const started = Date.now();
    try {
      const res = await call<{ analysis: { memory: { status: string }; recommendation: { memoryInfluenced: boolean } } }>(
        `/api/findings/${finding.id}/analyze`,
        { method: 'POST' },
      );
      console.log(
        `[${index + 1}/${findings.length}] ok   ${finding.id}  ` +
          `memory=${res.analysis.memory.status} influenced=${res.analysis.recommendation.memoryInfluenced}  ` +
          `(${Math.round((Date.now() - started) / 1000)}s)`,
      );
    } catch (error) {
      console.log(
        `[${index + 1}/${findings.length}] FAIL ${finding.id}  ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  const dash = await call<{ stats: { memory: { analyzed: number; influenced: number; changedAnswer: number } } }>(
    '/api/dashboard',
  );
  console.log('dashboard memory impact:', JSON.stringify(dash.stats.memory));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
