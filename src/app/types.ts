/**
 * Types for the shapes the API routes actually return.
 *
 * These mirror `src/lib/models/schemas.ts` but are written as plain interfaces
 * so client components never import server-only modules (Zod schemas, SQLite).
 */
import type {
  Finding,
  HistoricalCaseUsed,
  MemoryConflict,
  Recommendation,
  RejectedPriorAction,
  RootCause,
} from "@/lib/models/schemas";

export interface StageTraceDto {
  stage: string;
  ok: boolean;
  durationMs: number;
  error?: string;
}

export interface HindsightStatusDto {
  reachable: boolean;
  baseUrl: string;
  bankId: string;
  version?: string;
  reason?: string;
}

export interface AnalysisDto {
  finding: Finding;
  rootCause: RootCause;
  memory: {
    status: string;
    cases: Array<{
      caseId: string;
      title: string;
      controlId?: string;
      outcome?: string;
      remediationAttempted?: string;
      rootCause?: string;
      lesson?: string;
      recurrence: boolean;
      daysToRecurrence?: number;
      relevance: number | null;
      mentionedAt?: string;
    }>;
    bundle: {
      historicalMemoryAvailable: boolean;
      status: string;
      reason?: string;
    };
  };
  conflicts: MemoryConflict[];
  recommendation: Recommendation;
  remediationId: string;
  stages: StageTraceDto[];
}

export interface AnalysisSummary {
  memoryStatus: string;
  memoryInfluenced: boolean;
  casesUsed: number;
  rejected: number;
  conflicts: number;
  changed: boolean;
  createdAt: string;
}

export interface FindingDetailDto {
  finding: Finding;
  rootCause: RootCause | null;
  remediation: {
    id: string;
    proposed_action: string;
    owner: string;
    status: string;
    rationale: string;
    proposed_at: string;
    approved_at: string | null;
    implemented_at: string | null;
  } | null;
  approvals: Array<{
    id: string;
    decision: string;
    decidedBy: string;
    reason: string | null;
    decidedAt: string;
  }>;
  outcomes: Array<{
    id: string;
    result: string;
    recurrence: boolean;
    daysToRecurrence: number | null;
    lessonLearned: string;
    recordedAt: string;
  }>;
  runs: Array<Record<string, unknown>>;
  /**
   * The most recent analysis, persisted so the recommendation — and the proof
   * that memory changed it — survives a reload. Null until the pipeline runs.
   */
  analysis: AnalysisDto | null;
  analysisSummary: AnalysisSummary | null;
}

/** `GET /api/findings` — every finding plus its last analysis summary. */
export interface FindingsListDto {
  findings: Finding[];
  summaries: Record<string, AnalysisSummary>;
}

export interface ApiError {
  ok: false;
  error: string;
  details?: unknown;
}

export type { Finding, Recommendation, HistoricalCaseUsed, RejectedPriorAction, MemoryConflict };
