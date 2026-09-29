/**
 * Seed Hindsight with REMEDY's synthetic compliance history.
 *
 *   npm run seed
 *
 * Safe to re-run: cases already present in the bank are skipped.
 */
import { hindsightConfig } from '../src/lib/config';
import { getHindsightStatus } from '../src/lib/memory';
import { seedHistoricalCases } from '../src/lib/seed';

async function main(): Promise<void> {
  const status = await getHindsightStatus();

  console.log(`Hindsight: ${hindsightConfig.baseUrl}`);
  console.log(`  reachable: ${status.reachable}`);
  console.log(`  version:   ${status.version ?? 'unknown'}`);
  console.log(`  bank:      ${hindsightConfig.bankId}`);

  if (!status.reachable) {
    console.error(`\nCannot reach Hindsight: ${status.reason ?? 'unknown error'}`);
    console.error('Start it with:  npm run hindsight:start');
    process.exitCode = 1;
    return;
  }

  const result = await seedHistoricalCases();

  console.log('\nSeed result:');
  console.log(`  already complete: ${result.alreadyPresent}`);
  console.log(`  seeded:           ${result.seeded}`);
  console.log(`  resumed (partial): ${result.resumed}`);
  console.log(`  stages written:   ${result.memoriesWritten}`);
  console.log(`  still incomplete: ${result.failed}`);

  if (result.errors.length > 0) {
    console.error('\nErrors:');
    for (const error of result.errors) {
      console.error(`  [${error.caseId}] ${error.reason}`);
    }
  }

  if (!result.reachable || result.failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
