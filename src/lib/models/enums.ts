/**
 * Domain enums.
 *
 * These are the vocabulary of the single workflow REMEDY supports:
 * recurring compliance finding → historical memory → remediation recommendation.
 */

/** Lifecycle of a compliance finding. */
export const FindingStatus = {
  OPEN: 'OPEN',
  INVESTIGATING: 'INVESTIGATING',
  ROOT_CAUSE_IDENTIFIED: 'ROOT_CAUSE_IDENTIFIED',
  REMEDIATION_PROPOSED: 'REMEDIATION_PROPOSED',
  AWAITING_APPROVAL: 'AWAITING_APPROVAL',
  REMEDIATING: 'REMEDIATING',
  VERIFYING: 'VERIFYING',
  RESOLVED: 'RESOLVED',
  RECURRED: 'RECURRED',
} as const;
export type FindingStatus = (typeof FindingStatus)[keyof typeof FindingStatus];

/** Lifecycle of a remediation attempt. */
export const RemediationStatus = {
  PROPOSED: 'PROPOSED',
  APPROVED: 'APPROVED',
  IMPLEMENTED: 'IMPLEMENTED',
  VERIFIED: 'VERIFIED',
  FAILED: 'FAILED',
  PARTIAL: 'PARTIAL',
  SUCCESSFUL: 'SUCCESSFUL',
  RECURRED: 'RECURRED',
} as const;
export type RemediationStatus =
  (typeof RemediationStatus)[keyof typeof RemediationStatus];

/** Final result of a remediation, as observed after verification. */
export const OutcomeResult = {
  SUCCESS: 'SUCCESS',
  PARTIAL: 'PARTIAL',
  FAILURE: 'FAILURE',
} as const;
export type OutcomeResult = (typeof OutcomeResult)[keyof typeof OutcomeResult];

/** The one human decision that gates every remediation. */
export const ApprovalDecision = {
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  REQUEST_MORE_EVIDENCE: 'REQUEST_MORE_EVIDENCE',
} as const;
export type ApprovalDecision =
  (typeof ApprovalDecision)[keyof typeof ApprovalDecision];

/**
 * Whether historical memory was usable for a given run.
 *
 * This is deliberately distinct per case so the UI can explain *why* a
 * recommendation did not draw on history, rather than a single boolean.
 */
export const MemoryStatus = {
  /** Hindsight reachable and returned relevant memories. */
  AVAILABLE: 'AVAILABLE',
  /** Hindsight reachable but nothing matched. */
  EMPTY: 'EMPTY',
  /** Memories returned but relevance is weak. */
  LOW_CONFIDENCE: 'LOW_CONFIDENCE',
  /** Hindsight unreachable, timed out, or errored. */
  UNAVAILABLE: 'UNAVAILABLE',
} as const;
export type MemoryStatus = (typeof MemoryStatus)[keyof typeof MemoryStatus];

/** Severity, ordered most to least severe. */
export const Severity = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
} as const;
export type Severity = (typeof Severity)[keyof typeof Severity];

/**
 * Compliance categories. Scoped to one persona (security/compliance engineer)
 * and one workflow (recurring access & audit findings).
 */
export const FindingCategory = {
  EMPLOYEE_ACCESS: 'EMPLOYEE_ACCESS',
  PRIVILEGED_ACCESS: 'PRIVILEGED_ACCESS',
  IAM: 'IAM',
  HR_SYNC: 'HR_SYNC',
  MFA: 'MFA',
  TERMINATED_USERS: 'TERMINATED_USERS',
  CONTRACTOR_ACCOUNTS: 'CONTRACTOR_ACCOUNTS',
  SERVICE_ACCOUNTS: 'SERVICE_ACCOUNTS',
  CLOUD_PERMISSIONS: 'CLOUD_PERMISSIONS',
  VENDOR_ACCESS: 'VENDOR_ACCESS',
  AUDIT_CONTROLS: 'AUDIT_CONTROLS',
  EVIDENCE_COLLECTION: 'EVIDENCE_COLLECTION',
  POLICY_VIOLATION: 'POLICY_VIOLATION',
} as const;
export type FindingCategory =
  (typeof FindingCategory)[keyof typeof FindingCategory];

/** How a verification was performed. */
export const VerificationMethod = {
  AUTOMATED_RESCAN: 'AUTOMATED_RESCAN',
  MANUAL_REVIEW: 'MANUAL_REVIEW',
  CONTROL_TEST: 'CONTROL_TEST',
  EVIDENCE_RECOLLECTION: 'EVIDENCE_RECOLLECTION',
} as const;
export type VerificationMethod =
  (typeof VerificationMethod)[keyof typeof VerificationMethod];

/** Verification verdict. */
export const VerificationResult = { PASS: 'PASS', FAIL: 'FAIL', PARTIAL: 'PARTIAL' } as const;
export type VerificationResult =
  (typeof VerificationResult)[keyof typeof VerificationResult];

/** Lifecycle stage a memory was written for — used as `metadata.stage`. */
export const MemoryStage = {
  FINDING: 'finding',
  ROOT_CAUSE: 'root_cause',
  REMEDIATION: 'remediation',
  VERIFICATION: 'verification',
  OUTCOME: 'outcome',
  RECURRENCE: 'recurrence',
  LESSON: 'lesson',
} as const;
export type MemoryStage = (typeof MemoryStage)[keyof typeof MemoryStage];

/** Types of historical/current disagreement the conflict detector reports. */
export const ConflictKind = {
  ROOT_CAUSE_DISAGREEMENT: 'ROOT_CAUSE_DISAGREEMENT',
  EVIDENCE_DISAGREEMENT: 'EVIDENCE_DISAGREEMENT',
  OUTCOME_DISAGREEMENT: 'OUTCOME_DISAGREEMENT',
} as const;
export type ConflictKind = (typeof ConflictKind)[keyof typeof ConflictKind];
