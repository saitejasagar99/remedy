import path from 'node:path';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;
const alias = { '@': path.resolve(root, 'src') };

/**
 * Two projects with deliberately different characters:
 *
 *  - `unit` - fast, hermetic, no network. Runs by default via `npm test`.
 *  - `hindsight` - exercises the real Hindsight server. Opt-in via
 *    `npm run test:hindsight` so CI and offline work never depend on it.
 */
export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
          env: {
            // Required at import time by config.ts. These point at nothing
            // real because every unit test stubs the network.
            LLM_BASE_URL: 'http://127.0.0.1:0',
            LLM_MODEL: 'test-model',
            HINDSIGHT_URL: 'http://127.0.0.1:0',
            HINDSIGHT_BANK: 'remedy-test',
            DATABASE_PATH: ':memory:',
          },
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'hindsight',
          environment: 'node',
          include: ['tests/hindsight/**/*.test.ts'],
          // Retain runs fact extraction through the local model on CPU and can
          // take minutes; these are ceilings against a hang, not expectations.
          testTimeout: 300_000,
          hookTimeout: 60_000,
          // Hindsight is read from the environment; only the LLM is stubbed,
          // because memory is exactly what this project exists to exercise.
          env: {
            LLM_BASE_URL: 'http://127.0.0.1:0',
            LLM_MODEL: 'test-model',
          },
        },
      },
    ],
  },
});
