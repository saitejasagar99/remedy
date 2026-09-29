/**
 * Show exactly why memory does or does not change the recommendation.
 *
 *   npx tsx --env-file=.env scripts/diagnose-recommend.ts
 */
import { gatherHistoricalContext } from '../src/lib/agent/historical';
import {
  applyMemory,
  deriveStatelessRecommendation,
} from '../src/lib/agent/recommend';
import type { Finding, RootCause } from '../src/lib/models/schemas';

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

const rootCause: RootCause = {
  id: 'rc_live',
  findingId: finding.id,
  rootCause: 'Termination events are not wired into the deprovisioning pipeline',
  contributingFactors: [],
  confidence: 0.78,
  identifiedAt: '2026-01-15T10:00:00.000Z',
  method: 'HUMAN',
};

async function main(): Promise<void> {
  const { bundle, cases } = await gatherHistoricalContext(finding);
  console.log(`available=${bundle.historicalMemoryAvailable} cases=${cases.length}`);

  // Pre-truncation ranking, so a case missing from `cases` can be told apart
  // from a case that was never recalled.
  const best = new Map<string, number>();
  for (const m of bundle.memories) {
    const key = m.caseId ?? 'unknown';
    const s = m.scores?.final ?? -1;
    if (s > (best.get(key) ?? -1)) best.set(key, s);
  }
  const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]);
  console.log(
    `pool facts=${bundle.memories.length} cases=${ranked.length}: ` +
      ranked.map(([id, s]) => `${id}:${s.toFixed(4)}`).join('  '),
  );

  for (const c of cases) {
    console.log(
      `  ${c.caseId} outcome=${c.outcome ?? '-'} recurrence=${c.recurrence} ` +
        `days=${c.daysToRecurrence ?? '-'} rel=${c.relevance?.toFixed(4) ?? '-'} ` +
        `ctrl=${c.controlId ?? '-'} cat=${c.category ?? '-'}`,
    );
    console.log(`      title: ${(c.title ?? '').slice(0, 90)}`);
    console.log(`      remediation: ${(c.remediationAttempted ?? '-').slice(0, 90)}`);
  }

  const baseline = deriveStatelessRecommendation(finding, rootCause);
  const stateless = applyMemory(finding, rootCause, baseline, []);
  const withMemory = applyMemory(finding, rootCause, baseline, cases);

  console.log('\n--- stateless ---');
  console.log(`rec:  ${stateless.recommendation}`);
  console.log(`why:  ${stateless.whyMemoryChangedIt}`);
  console.log(`rej:  ${JSON.stringify(stateless.rejected)}`);
  console.log(`conf: ${stateless.confidence}`);

  console.log('\n--- with memory ---');
  console.log(`rec:  ${withMemory.recommendation}`);
  console.log(`why:  ${withMemory.whyMemoryChangedIt}`);
  console.log(`rej:  ${JSON.stringify(withMemory.rejected)}`);
  console.log(`conf: ${withMemory.confidence}`);

  console.log(`\nchanged: ${stateless.recommendation !== withMemory.recommendation}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exitCode = 1;
});
