/**
 * Query layer for application state.
 *
 * Plain, parameterised statements — model output is never interpolated into SQL.
 */
import { getDb, newId, parseJson } from './index';
import {
  type CreateFinding,
  type Evidence,
  type Finding,
  type RootCause,
} from '../models/schemas';
import { FindingStatus, RemediationStatus } from '../models/enums';

interface FindingRow {
  id: string;
  control_id: string;
  title: string;
  description: string;
  severity: string;
  category: string;
  affected_system: string;
  status: string;
  first_detected_at: string;
  recurrence_of: string | null;
  created_at: string;
  updated_at: string;
}

function toFinding(row: FindingRow, evidence: Evidence[]): Finding {
  return {
    id: row.id,
    controlId: row.control_id,
    title: row.title,
    description: row.description,
    severity: row.severity as Finding['severity'],
    category: row.category as Finding['category'],
    affectedSystem: row.affected_system,
    status: row.status as FindingStatus,
    evidence,
    firstDetectedAt: row.first_detected_at,
    recurrenceOf: row.recurrence_of ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getEvidence(findingId: string): Evidence[] {
  const rows = getDb()
    .prepare('SELECT * FROM evidence WHERE finding_id = ? ORDER BY collected_at')
    .all(findingId) as Array<{
    id: string;
    source: string;
    observation: string;
    supports_hypothesis: string | null;
    collected_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    observation: r.observation,
    supportsHypothesis: r.supports_hypothesis ?? undefined,
    collectedAt: r.collected_at,
  }));
}

/** Create a finding plus its evidence. */
export function createFinding(input: CreateFinding): Finding {
  const connection = getDb();
  const now = new Date().toISOString();
  const id = newId('CF');

  connection
    .prepare(
      `INSERT INTO findings
        (id, control_id, title, description, severity, category, affected_system,
         status, first_detected_at, recurrence_of, created_at, updated_at)
       VALUES (@id, @controlId, @title, @description, @severity, @category, @affectedSystem,
               @status, @firstDetectedAt, @recurrenceOf, @createdAt, @updatedAt)`,
    )
    .run({
      id,
      controlId: input.controlId,
      title: input.title,
      description: input.description,
      severity: input.severity,
      category: input.category,
      affectedSystem: input.affectedSystem,
      status: FindingStatus.OPEN,
      firstDetectedAt: input.firstDetectedAt ?? now,
      recurrenceOf: input.recurrenceOf ?? null,
      createdAt: now,
      updatedAt: now,
    });

  const insertEvidence = connection.prepare(
    `INSERT INTO evidence (id, finding_id, source, observation, supports_hypothesis, collected_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const item of input.evidence) {
    insertEvidence.run(
      newId('EV'),
      id,
      item.source,
      item.observation,
      item.supportsHypothesis ?? null,
      now,
    );
  }

  return getFinding(id) as Finding;
}

export function listFindings(): Finding[] {
  const rows = getDb()
    .prepare('SELECT * FROM findings ORDER BY created_at DESC')
    .all() as FindingRow[];
  return rows.map((row) => toFinding(row, getEvidence(row.id)));
}

export function getFinding(id: string): Finding | null {
  const row = getDb().prepare('SELECT * FROM findings WHERE id = ?').get(id) as
    | FindingRow
    | undefined;
  if (!row) return null;
  return toFinding(row, getEvidence(row.id));
}

export function updateFindingStatus(id: string, status: FindingStatus): void {
  getDb()
    .prepare('UPDATE findings SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, new Date().toISOString(), id);
}

export function saveRootCause(rc: RootCause): void {
  getDb()
    .prepare(
      `INSERT INTO root_causes (id, finding_id, root_cause, contributing_factors, confidence, identified_at, method)
       VALUES (@id, @findingId, @rootCause, @contributingFactors, @confidence, @identifiedAt, @method)
       ON CONFLICT(id) DO UPDATE SET
         root_cause = excluded.root_cause,
         contributing_factors = excluded.contributing_factors,
         confidence = excluded.confidence,
         identified_at = excluded.identified_at`,
    )
    .run({
      id: rc.id,
      findingId: rc.findingId,
      rootCause: rc.rootCause,
      contributingFactors: JSON.stringify(rc.contributingFactors),
      confidence: rc.confidence,
      identifiedAt: rc.identifiedAt,
      method: rc.method,
    });
}

export function getRootCause(findingId: string): RootCause | null {
  const row = getDb()
    .prepare('SELECT * FROM root_causes WHERE finding_id = ? ORDER BY identified_at DESC LIMIT 1')
    .get(findingId) as
    | {
        id: string;
        finding_id: string;
        root_cause: string;
        contributing_factors: string;
        confidence: number;
        identified_at: string;
        method: string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    findingId: row.finding_id,
    rootCause: row.root_cause,
    contributingFactors: parseJson<string[]>(row.contributing_factors, []),
    confidence: row.confidence,
    identifiedAt: row.identified_at,
    method: row.method as RootCause['method'],
  };
}

/** Persist a remediation created by the recommendation step. */
export function saveProposedRemediation(input: {
  findingId: string;
  proposedAction: string;
  implementationDetails: string;
  owner: string;
  rationale: string;
}): string {
  const id = newId('REM');
  getDb()
    .prepare(
      `INSERT INTO remediations
        (id, finding_id, proposed_action, implementation_details, owner, status, rationale, proposed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.findingId,
      input.proposedAction,
      input.implementationDetails,
      input.owner,
      RemediationStatus.PROPOSED,
      input.rationale,
      new Date().toISOString(),
    );
  return id;
}

export interface RemediationRow {
  id: string;
  finding_id: string;
  proposed_action: string;
  implementation_details: string;
  owner: string;
  status: string;
  rationale: string;
  proposed_at: string;
  approved_at: string | null;
  implemented_at: string | null;
}

export function getRemediation(id: string): RemediationRow | null {
  return (
    (getDb().prepare('SELECT * FROM remediations WHERE id = ?').get(id) as
      | RemediationRow
      | undefined) ?? null
  );
}

export function getLatestRemediation(findingId: string): RemediationRow | null {
  return (
    (getDb()
      .prepare('SELECT * FROM remediations WHERE finding_id = ? ORDER BY proposed_at DESC LIMIT 1')
      .get(findingId) as RemediationRow | undefined) ?? null
  );
}

export function updateRemediationStatus(
  id: string,
  status: RemediationStatus,
  extra: { approvedAt?: string; implementedAt?: string } = {},
): void {
  getDb()
    .prepare(
      `UPDATE remediations SET status = ?,
        approved_at = COALESCE(?, approved_at),
        implemented_at = COALESCE(?, implemented_at)
       WHERE id = ?`,
    )
    .run(status, extra.approvedAt ?? null, extra.implementedAt ?? null, id);
}

/** Record an approval decision. Returns the remediation id it applied to. */
export function saveApproval(input: {
  remediationId: string;
  decision: string;
  decidedBy: string;
  reason?: string;
  requestedEvidence?: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO approvals (id, remediation_id, decision, decided_by, reason, requested_evidence, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      newId('APR'),
      input.remediationId,
      input.decision,
      input.decidedBy,
      input.reason ?? null,
      input.requestedEvidence ?? null,
      new Date().toISOString(),
    );
}

export function saveVerification(input: {
  remediationId: string;
  method: string;
  result: string;
  evidenceText: string;
  verifier: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO verifications (id, remediation_id, method, result, evidence_text, verified_at, verifier)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      newId('VER'),
      input.remediationId,
      input.method,
      input.result,
      input.evidenceText,
      new Date().toISOString(),
      input.verifier,
    );
}

export function saveOutcome(input: {
  remediationId: string;
  result: string;
  recurrence: boolean;
  daysToRecurrence?: number;
  observedSideEffects: string[];
  lessonLearned: string;
  additionalInvestigation?: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO outcomes
        (id, remediation_id, result, recurrence, days_to_recurrence,
         observed_side_effects, lesson_learned, additional_investigation, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      newId('OUT'),
      input.remediationId,
      input.result,
      input.recurrence ? 1 : 0,
      input.daysToRecurrence ?? null,
      JSON.stringify(input.observedSideEffects),
      input.lessonLearned,
      input.additionalInvestigation ?? null,
      new Date().toISOString(),
    );
}

/** Append-only audit of each pipeline stage. */
export function recordRun(input: {
  findingId: string;
  stage: string;
  startedAt: string;
  ok: boolean;
  error?: string;
  memoryStatus?: string;
  llmModel?: string;
  durationMs: number;
}): string {
  const id = newId('RUN');
  getDb()
    .prepare(
      `INSERT INTO agent_runs
        (id, finding_id, stage, started_at, finished_at, ok, error, memory_status, llm_model, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.findingId,
      input.stage,
      input.startedAt,
      new Date().toISOString(),
      input.ok ? 1 : 0,
      input.error ?? null,
      input.memoryStatus ?? null,
      input.llmModel ?? null,
      input.durationMs,
    );
  return id;
}

export function listRuns(findingId: string): Array<Record<string, unknown>> {
  return getDb()
    .prepare('SELECT * FROM agent_runs WHERE finding_id = ? ORDER BY started_at')
    .all(findingId) as Array<Record<string, unknown>>;
}

/** One approval row, shaped for the API rather than the database. */
export interface ApprovalRecord {
  id: string;
  remediationId: string;
  decision: string;
  decidedBy: string;
  reason: string | null;
  requestedEvidence: string | null;
  decidedAt: string;
}

export function listApprovals(remediationId: string): ApprovalRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM approvals WHERE remediation_id = ? ORDER BY decided_at')
    .all(remediationId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    remediationId: String(r.remediation_id),
    decision: String(r.decision),
    decidedBy: String(r.decided_by),
    reason: (r.reason as string | null) ?? null,
    requestedEvidence: (r.requested_evidence as string | null) ?? null,
    decidedAt: String(r.decided_at),
  }));
}

export interface OutcomeRecord {
  id: string;
  remediationId: string;
  result: string;
  recurrence: boolean;
  daysToRecurrence: number | null;
  observedSideEffects: string[];
  lessonLearned: string;
  additionalInvestigation: string | null;
  recordedAt: string;
}

export function listOutcomes(remediationId: string): OutcomeRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM outcomes WHERE remediation_id = ? ORDER BY recorded_at')
    .all(remediationId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    remediationId: String(r.remediation_id),
    result: String(r.result),
    recurrence: Number(r.recurrence) === 1,
    daysToRecurrence:
      r.days_to_recurrence === null || r.days_to_recurrence === undefined
        ? null
        : Number(r.days_to_recurrence),
    observedSideEffects: parseJson<string[]>(r.observed_side_effects as string, []),
    lessonLearned: String(r.lesson_learned),
    additionalInvestigation:
      (r.additional_investigation as string | null) ?? null,
    recordedAt: String(r.recorded_at),
  }));
}

/**
 * Persist one completed analysis so the recommendation outlives the request.
 *
 * `payload` is the full pipeline result; the scalar columns beside it exist
 * only so the dashboard can aggregate "how often did memory change the answer"
 * with one query instead of parsing every blob.
 */
export function saveAnalysis(input: {
  findingId: string;
  memoryStatus: string;
  memoryInfluenced: boolean;
  casesUsed: number;
  rejected: number;
  conflicts: number;
  baseline: string;
  recommendation: string;
  payload: unknown;
}): string {
  const id = newId('ANL');
  getDb()
    .prepare(
      `INSERT INTO analyses
        (id, finding_id, payload, memory_status, memory_influenced, cases_used,
         rejected, conflicts, changed, baseline, recommendation, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.findingId,
      JSON.stringify(input.payload),
      input.memoryStatus,
      input.memoryInfluenced ? 1 : 0,
      input.casesUsed,
      input.rejected,
      input.conflicts,
      input.recommendation === input.baseline ? 0 : 1,
      input.baseline,
      input.recommendation,
      new Date().toISOString(),
    );
  return id;
}

export interface StoredAnalysis {
  id: string;
  findingId: string;
  createdAt: string;
  memoryStatus: string;
  memoryInfluenced: boolean;
  casesUsed: number;
  rejected: number;
  conflicts: number;
  changed: boolean;
  baseline: string;
  recommendation: string;
  /** The complete pipeline result, as returned by `analyzeFinding`. */
  payload: unknown;
}

/** Newest analysis for a finding — the one the detail view renders. */
export function getLatestAnalysis(findingId: string): StoredAnalysis | null {
  const row = getDb()
    .prepare('SELECT * FROM analyses WHERE finding_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
    .get(findingId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    findingId: String(row.finding_id),
    createdAt: String(row.created_at),
    memoryStatus: String(row.memory_status),
    memoryInfluenced: Number(row.memory_influenced) === 1,
    casesUsed: Number(row.cases_used),
    rejected: Number(row.rejected),
    conflicts: Number(row.conflicts),
    changed: Number(row.changed) === 1,
    baseline: String(row.baseline),
    recommendation: String(row.recommendation),
    payload: parseJson<unknown>(row.payload as string, null),
  };
}

/** Aggregate row per finding that has been analysed — the dashboard's source of truth. */
export interface AnalysisSummaryRow {
  findingId: string;
  memoryStatus: string;
  memoryInfluenced: boolean;
  casesUsed: number;
  rejected: number;
  conflicts: number;
  changed: boolean;
  createdAt: string;
}

export function listLatestAnalyses(): AnalysisSummaryRow[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM analyses ORDER BY created_at ASC, rowid ASC',
    )
    .all() as Array<Record<string, unknown>>;

  // Ordered oldest → newest, so the last row seen per finding is the latest.
  const latest = new Map<string, AnalysisSummaryRow>();
  for (const row of rows) {
    latest.set(String(row.finding_id), {
      findingId: String(row.finding_id),
      memoryStatus: String(row.memory_status),
      memoryInfluenced: Number(row.memory_influenced) === 1,
      casesUsed: Number(row.cases_used),
      rejected: Number(row.rejected),
      conflicts: Number(row.conflicts),
      changed: Number(row.changed) === 1,
      createdAt: String(row.created_at),
    });
  }
  return [...latest.values()];
}

/** Every outcome with the finding it belongs to, for cross-finding rollups. */
export function listAllOutcomes(): Array<{
  findingId: string;
  result: string;
  recurrence: boolean;
  recordedAt: string;
}> {
  const rows = getDb()
    .prepare(
      `SELECT r.finding_id AS finding_id, o.result, o.recurrence, o.recorded_at
         FROM outcomes o JOIN remediations r ON r.id = o.remediation_id
        ORDER BY o.recorded_at`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    findingId: String(row.finding_id),
    result: String(row.result),
    recurrence: Number(row.recurrence) === 1,
    recordedAt: String(row.recorded_at),
  }));
}

/** Latest remediation status per finding — drives the lifecycle rollup. */
export function listLatestRemediationStatuses(): Array<{
  findingId: string;
  status: string;
  proposedAt: string;
  approvedAt: string | null;
  implementedAt: string | null;
}> {
  const rows = getDb()
    .prepare('SELECT * FROM remediations ORDER BY proposed_at ASC, rowid ASC')
    .all() as Array<Record<string, unknown>>;

  const latest = new Map<string, { findingId: string; status: string; proposedAt: string; approvedAt: string | null; implementedAt: string | null }>();
  for (const row of rows) {
    latest.set(String(row.finding_id), {
      findingId: String(row.finding_id),
      status: String(row.status),
      proposedAt: String(row.proposed_at),
      approvedAt: (row.approved_at as string | null) ?? null,
      implementedAt: (row.implemented_at as string | null) ?? null,
    });
  }
  return [...latest.values()];
}

/**
 * Everything the detail view needs for one finding, assembled in one place so
 * the route handler stays a thin adapter.
 */
export function getFindingDetail(findingId: string) {
  const finding = getFinding(findingId);
  if (!finding) return null;

  const remediation = getLatestRemediation(findingId);
  const analysis = getLatestAnalysis(findingId);
  return {
    finding,
    rootCause: getRootCause(findingId),
    remediation,
    approvals: remediation ? listApprovals(remediation.id) : [],
    outcomes: remediation ? listOutcomes(remediation.id) : [],
    runs: listRuns(findingId),
    /** The last analysis run, including its recommendation — null until analysed. */
    analysis: (analysis?.payload as Record<string, unknown> | null) ?? null,
    analysisSummary: analysis
      ? {
          createdAt: analysis.createdAt,
          memoryStatus: analysis.memoryStatus,
          memoryInfluenced: analysis.memoryInfluenced,
          casesUsed: analysis.casesUsed,
          rejected: analysis.rejected,
          changed: analysis.changed,
          conflicts: analysis.conflicts,
        }
      : null,
  };
}
