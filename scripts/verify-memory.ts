/**
 * Live Hindsight round-trip probe.
 *
 *   npx tsx --env-file=.env scripts/verify-memory.ts
 *
 * Writes one synthetic memory, recalls it back, and asserts that
 * `metadata.caseId` survived the round-trip — the join key every explanation
 * in REMEDY depends on. Read-only with respect to the seeded bank: it uses a
 * dedicated probe caseId and says so in the recalled text.
 */
import { hindsightConfig } from '../src/lib/config';
import { getHindsightClient, describeMemoryError } from '../src/lib/memory/hindsight';

const PROBE_CASE_ID = 'PROBE-ROUNDTRIP';
const PROBE_TEXT = [
  `Case #${PROBE_CASE_ID}: probe record for verifying metadata round-trip.`,
  'Control AC-2, IAM, HIGH severity, identity-gateway.',
  'Root cause: probe-only fact with no operational meaning.',
  'Remediation attempted: none, this record exists solely to confirm recall.',
  'Outcome: SUCCESS. The finding did not recur. Side effects: none observed.',
  'Lesson learned: probe metadata must survive retain then recall.',
].join(' ');

function fail(message: string): never {
  console.error(`\nFAIL: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const client = getHindsightClient();
  console.log(`Hindsight: ${hindsightConfig.baseUrl}  bank: ${hindsightConfig.bankId}`);

  // --- retain -------------------------------------------------------------
  // `retain` reports success and token usage, not the ids it created, so the
  // only way to confirm the write landed is to read it back.
  const retained = (await client.retain(hindsightConfig.bankId, PROBE_TEXT, {
    context: 'probe verification',
    metadata: { caseId: PROBE_CASE_ID, stage: 'probe' },
    async: false,
  })) as { success?: boolean; items_count?: number };
  console.log(`retain -> success=${retained.success} items=${retained.items_count}`);
  if (retained.success !== true) fail('retain reported success=false');

  // --- recall -------------------------------------------------------------
  // Extraction is synchronous here, but indexing can lag by a moment; a short
  // retry distinguishes "eventually consistent" from a real defect.
  const query = 'probe record for verifying metadata round-trip compliance finding';
  let results: Array<Record<string, unknown>> = [];
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const recall = (await client.recall(hindsightConfig.bankId, query, {
      maxTokens: 1200,
    })) as { results?: Array<Record<string, unknown>> };
    results = recall.results ?? [];
    if (results.length > 0) break;
    console.log(`recall attempt ${attempt}: empty, retrying...`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  console.log(`recall -> ${results.length} result(s)`);

  if (results.length === 0) {
    fail(
      'recall returned nothing. Hindsight extraction may still be processing; ' +
        're-run in a few seconds before treating this as a defect.',
    );
  }

  // --- verify the join key survived --------------------------------------
  let matched: Record<string, unknown> | null = null;
  for (const item of results) {
    const metadata = item.metadata as Record<string, unknown> | undefined;
    console.log(
      `  - id=${String(item.id)} caseId=${String(metadata?.caseId)} ` +
        `final=${String((item.scores as Record<string, unknown> | undefined)?.final)}`,
    );
    if (metadata?.caseId === PROBE_CASE_ID) matched = item;
  }

  if (!matched) {
    fail(
      `no recalled memory carried metadata.caseId=${PROBE_CASE_ID}. ` +
        'RecallResult.metadata is not round-tripping; explanations would be unattributable.',
    );
  }

  const scores = matched.scores as Record<string, number> | undefined;
  console.log('\nOK: retain -> recall round-trip verified.');
  console.log(`  matched fact id: ${String(matched.id)}`);
  console.log(`  metadata:        ${JSON.stringify(matched.metadata)}`);
  console.log(`  scores:          ${JSON.stringify(scores ?? {})}`);
  console.log(
    '  note: scores are relative to this query only, not calibrated similarity.',
  );
}

main().catch((error: unknown) => {
  console.error(`\nFAIL: ${describeMemoryError(error)}`);
  process.exit(1);
});
