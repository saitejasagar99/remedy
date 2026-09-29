/**
 * Load the sample workspace through the real API.
 *
 * The fixtures come from `src/app/lib/samples.ts` — the exact same list the
 * dashboard's "Load sample findings" button posts — so this script cannot drift
 * from what the UI creates. It is idempotent: re-running adds only what is
 * missing, and the recurrence link is wired after the first finding exists.
 *
 * Usage: `npm run samples` with the dev server running on :3000.
 */
import { SAMPLE_FINDINGS } from '../src/app/lib/samples';

const BASE = process.env.REMEDY_BASE_URL ?? 'http://localhost:3000';

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => null)) as T | null;
  if (!res.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status} ${JSON.stringify(body)}`);
  }
  return body as T;
}

async function main(): Promise<void> {
  const existing = await json<{ findings: Array<{ id: string; title: string }> }>('/api/findings');
  const byTitle = new Map(existing.findings.map((f) => [f.title, f]));

  const created: Array<{ id: string; title: string }> = [];
  let createdCount = 0;
  let alreadyPresent = 0;

  for (const sample of SAMPLE_FINDINGS) {
    const found = byTitle.get(sample.title);
    if (found) {
      created.push(found);
      alreadyPresent += 1;
      continue;
    }

    const parent =
      sample.recurrenceOfIndex !== undefined ? created[sample.recurrenceOfIndex] : undefined;

    const res = await json<{ finding: { id: string; title: string } }>('/api/findings', {
      method: 'POST',
      body: JSON.stringify({
        controlId: sample.controlId,
        title: sample.title,
        description: sample.description,
        severity: sample.severity,
        category: sample.category,
        affectedSystem: sample.affectedSystem,
        evidence: sample.evidence,
        ...(sample.firstDetectedAt ? { firstDetectedAt: sample.firstDetectedAt } : {}),
        ...(parent ? { recurrenceOf: parent.id } : {}),
      }),
    });

    created.push(res.finding);
    createdCount += 1;
  }

  console.log(`samples: ${createdCount} created, ${alreadyPresent} already present`);
  for (const f of created) console.log(`  ${f.id}  ${f.title}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
