/**
 * SQLite application state.
 *
 * This stores what is *in flight* — findings, approvals, agent runs — not the
 * organisation's memory. Historical experience lives exclusively in Hindsight;
 * keeping the two apart is what makes "memory" a real, retrievable thing rather
 * than rows in a table the query layer could trivially fake.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { resolveDatabasePath } from '../config';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS findings (
  id                TEXT PRIMARY KEY,
  control_id        TEXT NOT NULL,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  severity          TEXT NOT NULL,
  category          TEXT NOT NULL,
  affected_system   TEXT NOT NULL,
  status            TEXT NOT NULL,
  first_detected_at TEXT NOT NULL,
  recurrence_of     TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence (
  id                   TEXT PRIMARY KEY,
  finding_id           TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  source               TEXT NOT NULL,
  observation          TEXT NOT NULL,
  supports_hypothesis  TEXT,
  collected_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS root_causes (
  id                   TEXT PRIMARY KEY,
  finding_id           TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  root_cause           TEXT NOT NULL,
  contributing_factors TEXT NOT NULL DEFAULT '[]',
  confidence           REAL NOT NULL,
  identified_at        TEXT NOT NULL,
  method               TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS remediations (
  id                    TEXT PRIMARY KEY,
  finding_id            TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  proposed_action       TEXT NOT NULL,
  implementation_details TEXT NOT NULL DEFAULT '',
  owner                 TEXT NOT NULL,
  status                TEXT NOT NULL,
  rationale             TEXT NOT NULL DEFAULT '',
  proposed_at           TEXT NOT NULL,
  approved_at           TEXT,
  implemented_at        TEXT
);

CREATE TABLE IF NOT EXISTS approvals (
  id                 TEXT PRIMARY KEY,
  remediation_id     TEXT NOT NULL REFERENCES remediations(id) ON DELETE CASCADE,
  decision           TEXT NOT NULL,
  decided_by         TEXT NOT NULL,
  reason             TEXT,
  requested_evidence TEXT,
  decided_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verifications (
  id             TEXT PRIMARY KEY,
  remediation_id TEXT NOT NULL REFERENCES remediations(id) ON DELETE CASCADE,
  method         TEXT NOT NULL,
  result         TEXT NOT NULL,
  evidence_text  TEXT NOT NULL,
  verified_at    TEXT NOT NULL,
  verifier       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outcomes (
  id                      TEXT PRIMARY KEY,
  remediation_id          TEXT NOT NULL REFERENCES remediations(id) ON DELETE CASCADE,
  result                  TEXT NOT NULL,
  recurrence              INTEGER NOT NULL DEFAULT 0,
  days_to_recurrence      INTEGER,
  observed_side_effects   TEXT NOT NULL DEFAULT '[]',
  lesson_learned          TEXT NOT NULL,
  additional_investigation TEXT,
  recorded_at             TEXT NOT NULL
);

/*
 * The latest analysis for each finding, kept so the recommendation survives a
 * page reload. Without it the "did memory change the answer?" question could
 * only be answered while the browser still held the response, and the
 * dashboard would have to invent a number for "findings influenced by
 * historical memory".
 * Append-only: getLatestAnalysis reads the newest row, so the audit trail of
 * how an answer moved as memory accumulated is preserved.
 */
CREATE TABLE IF NOT EXISTS analyses (
  id                TEXT PRIMARY KEY,
  finding_id        TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  payload           TEXT NOT NULL,
  memory_status     TEXT NOT NULL,
  memory_influenced INTEGER NOT NULL DEFAULT 0,
  cases_used        INTEGER NOT NULL DEFAULT 0,
  rejected          INTEGER NOT NULL DEFAULT 0,
  conflicts         INTEGER NOT NULL DEFAULT 0,
  changed           INTEGER NOT NULL DEFAULT 0,
  baseline          TEXT NOT NULL DEFAULT '',
  recommendation    TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id            TEXT PRIMARY KEY,
  finding_id    TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  stage         TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  ok            INTEGER NOT NULL DEFAULT 1,
  error         TEXT,
  memory_status TEXT,
  llm_model     TEXT,
  duration_ms   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_evidence_finding ON evidence(finding_id);
CREATE INDEX IF NOT EXISTS idx_runs_finding ON agent_runs(finding_id);
CREATE INDEX IF NOT EXISTS idx_analyses_finding ON analyses(finding_id);
`;

let db: Database.Database | null = null;

/** Open (and migrate) the database. Cached per process. */
export function getDb(): Database.Database {
  if (db) return db;
  const path = resolveDatabasePath();
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

/**
 * Ensure the schema exists without handing the handle back.
 *
 * `getDb()` already migrates on first use; this just makes a route handler's
 * intent ("make sure state is ready") read clearly.
 */
export function ensureDb(): void {
  getDb();
}

/**
 * Delete every application-state table.
 *
 * Deliberately scoped to SQLite: Hindsight memory is never touched, because
 * organisational experience is not application state and must not be
 * resettable from the UI.
 */
export function resetDatabase(): void {
  const connection = getDb();
  connection.exec(`
    DELETE FROM evidence;
    DELETE FROM root_causes;
    DELETE FROM verifications;
    DELETE FROM outcomes;
    DELETE FROM approvals;
    DELETE FROM remediations;
    DELETE FROM analyses;
    DELETE FROM agent_runs;
    DELETE FROM findings;
  `);
}

/** Test seam — close the cached handle so a temp DB can be swapped in. */
export function closeDb(): void {
  db?.close();
  db = null;
}

/** Test seam — inject an already-open database. */
export function setDb(next: Database.Database | null): void {
  db = next;
}

/** Generate a short, human-readable id with a prefix. */
export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now()
    .toString(36)
    .slice(-4)}`;
}

/** `JSON.parse` that never throws — malformed rows degrade to a safe default. */
export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
