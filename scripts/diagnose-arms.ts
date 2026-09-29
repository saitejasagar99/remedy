/**
 * Run each recall arm on its own and report which cases it returns, at what
 * score, so a case that vanishes from the assembled top-6 can be traced to the
 * arm that stopped returning it.
 *
 *   npx tsx --env-file=.env scripts/diagnose-arms.ts
 */
import {
  recallFailedFixes,
  recallHistoricalRemediations,
  recallLessons,
  recallSimilarFindings,
  recallSuccessfulFixes,
} from '../src/lib/memory/recall';
import type { Finding, RecallBundle } from '../src/lib/models/schemas';

const finding: Finding = {
  id: 'CF_live0001',
  controlId: 'AC-2',
  title: 'Privileged accounts not disabled after termination',
  description: 'Two privileged VPN accounts remained active 6 days after termination.',
  severity: 'HIGH',
  category: 'EMPLOYEE_ACCESS',
  affectedSystem: 'identity-gateway',
  status: 'OPEN',
  evidence: [
    {
      id: 'EV_live1',
      source: 'IAM entitlement export',
      observation: 'Two privileged accounts active 6 days past termination date',
      collectedAt: '2026-01-15T10:00:00.000Z',
    },
  ],
  firstDetectedAt: '2026-01-15T10:00:00.000Z',
  createdAt: '2026-01-15T10:00:00.000Z',
  updatedAt: '2026-01-15T10:00:00.000Z',
};

const arms: Array<[string, (f: Finding) => Promise<RecallBundle>]> = [
  ['similar', recallSimilarFindings],
  ['remediated', recallHistoricalRemediations],
  ['failed', recallFailedFixes],
  ['successful', recallSuccessfulFixes],
  ['lessons', recallLessons],
];

async function main(): Promise<void> {
  for (const [name, run] of arms) {
    const started = Date.now();
    const bundle = await run(finding);
    const ms = Date.now() - started;
    const byCase = new Map<string, number>();
    for (const m of bundle.memories) {
      const key = m.caseId ?? 'unknown';
      const s = m.scores?.final ?? -1;
      const prev = byCase.get(key) ?? -1;
      if (s > prev) byCase.set(key, s);
    }
    const ranked = [...byCase.entries()].sort((a, b) => b[1] - a[1]);
    console.log(
      `\n[${name}] ${ms}ms available=${bundle.historicalMemoryAvailable} ` +
        `status=${bundle.status} facts=${bundle.memories.length} cases=${ranked.length}`,
    );
    if (bundle.reason) console.log(`  reason: ${bundle.reason}`);
    console.log(
      `  ${ranked.map(([id, s]) => `${id}:${s.toFixed(4)}`).join('  ')}`,
    );
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exitCode = 1;
});
