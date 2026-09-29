/**
 * Presentation vocabulary, defined once.
 *
 * Status colouring and label wording are load-bearing: a judge reads
 * "FAILED" vs "SUCCESS" before reading anything else, so the mapping lives in
 * one module rather than being re-declared (and quietly diverging) per panel.
 */

export const OUTCOME_TONE = {
  SUCCESS: "ok",
  PARTIAL: "warn",
  FAILURE: "danger",
} as const;

export function outcomeTone(outcome?: string): "ok" | "warn" | "danger" | "neutral" {
  if (outcome && outcome in OUTCOME_TONE) return OUTCOME_TONE[outcome as keyof typeof OUTCOME_TONE];
  return "neutral";
}

/** Human wording for an outcome — `FAILURE` reads as "FAILED" on screen. */
export function outcomeLabel(outcome?: string): string {
  if (outcome === "FAILURE") return "FAILED";
  return outcome ?? "UNKNOWN";
}

export const SEVERITY_TONE: Record<string, "danger" | "warn" | "info" | "neutral"> = {
  CRITICAL: "danger",
  HIGH: "danger",
  MEDIUM: "warn",
  LOW: "neutral",
};

export const FINDING_STATUS_TONE: Record<string, "ok" | "warn" | "danger" | "info" | "neutral"> = {
  OPEN: "info",
  INVESTIGATING: "info",
  ROOT_CAUSE_IDENTIFIED: "info",
  REMEDIATION_PROPOSED: "warn",
  AWAITING_APPROVAL: "warn",
  REMEDIATING: "warn",
  VERIFYING: "warn",
  RESOLVED: "ok",
  RECURRED: "danger",
};

export const REMEDIATION_STATUS_TONE: Record<string, "ok" | "warn" | "danger" | "info" | "neutral"> = {
  PROPOSED: "info",
  APPROVED: "info",
  IMPLEMENTED: "warn",
  VERIFIED: "ok",
  SUCCESSFUL: "ok",
  PARTIAL: "warn",
  FAILED: "danger",
  RECURRED: "danger",
};

/** Pipeline stage → the label shown in the stage audit. */
export const STAGE_LABEL: Record<string, string> = {
  evidence: "Evidence analysis",
  root_cause: "Root-cause hypothesis",
  hindsight_recall: "Historical memory recall",
  recommendation: "Recommendation",
  hindsight_retain_outcome: "Memory write-back",
};

/** Memory lifecycle stage → the category used by the Memory page. */
export const MEMORY_STAGE_LABEL: Record<string, string> = {
  finding: "Findings",
  root_cause: "Root Causes",
  remediation: "Remediations",
  verification: "Verifications",
  outcome: "Outcomes",
  recurrence: "Recurrences",
  lesson: "Lessons",
};

export const MEMORY_STAGES = [
  "finding",
  "root_cause",
  "remediation",
  "outcome",
  "recurrence",
  "lesson",
] as const;

/** What each memory status means, in plain language, for a non-technical reader. */
export const MEMORY_STATUS_COPY: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "neutral"; explain: string }> = {
  AVAILABLE: {
    label: "History recalled",
    tone: "ok",
    explain: "Hindsight returned relevant prior cases and they shaped this answer.",
  },
  EMPTY: {
    label: "No relevant history",
    tone: "neutral",
    explain: "The memory layer answered, but nothing matched this finding closely enough to use.",
  },
  LOW_CONFIDENCE: {
    label: "Weak history",
    tone: "warn",
    explain: "History was recalled but the match is weak, so it informed rather than decided the answer.",
  },
  UNAVAILABLE: {
    label: "History unavailable",
    tone: "danger",
    explain: "Hindsight could not be reached. The recommendation is stateless and ignores all organisational experience.",
  },
};

/** The single workflow, as a track. Used by the detail page and Remediations. */
export const LIFECYCLE_STAGES = [
  "PROPOSED",
  "APPROVED",
  "IMPLEMENTED",
  "VERIFIED",
  "OUTCOME",
  "RECURRENCE MONITORING",
] as const;

export function severityTone(severity: string): "danger" | "warn" | "info" | "neutral" {
  return SEVERITY_TONE[severity] ?? "neutral";
}

/**
 * Words that are acronyms in this domain, kept in capitals after conversion.
 *
 * Without this, `MFA` becomes "Mfa" — which reads as a typo rather than
 * multi-factor authentication, and does the exact opposite of the exercise.
 */
const ACRONYMS = new Set([
  "API",
  "AWS",
  "CDN",
  "DLP",
  "GCP",
  "GDPR",
  "HIPAA",
  "IAM",
  "KMS",
  "MFA",
  "PAM",
  "PCI",
  "RPO",
  "RTO",
  "SLA",
  "SLD",
  "SOC2",
  "SSO",
  "VPN",
]);

/**
 * Turn an internal enum into words a person reads without decoding.
 *
 * Stored values are SCREAMING_SNAKE_CASE because that is what the schema
 * validates, but a compliance engineer should never have to parse
 * `AWAITING_APPROVAL` on screen. The first word keeps its capital, the rest
 * drop to sentence case, acronyms stay in capitals, and already-readable
 * input passes through unchanged.
 *
 * Severity and outcome keep their capitals elsewhere on purpose — `CRITICAL`
 * and `FAILED` are conventions, not identifiers.
 */
export function humanize(value?: string | null): string {
  if (!value) return "—";

  const prepared = value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!prepared) return "—";

  return prepared
    .split(" ")
    .map((word, index) => {
      if (!word) return word;
      const upper = word.toUpperCase();
      if (ACRONYMS.has(upper)) return upper;

      // A SCREAMING word that is not an acronym: sentence-case it.
      if (word === upper) {
        const lower = word.toLowerCase();
        return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
      }

      // Already-readable input ("CloudTrail", "entitlement") passes through,
      // except that a leading word still gets its capital.
      if (index === 0 && word === word.toLowerCase()) {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }
      return word;
    })
    .join(" ");
}

/** `AWAITING_APPROVAL` → `Awaiting approval`. */
export function findingStatusLabel(status?: string | null): string {
  return humanize(status);
}

/** `AUDIT_CONTROLS` → `Audit controls`. */
export function categoryLabel(category?: string | null): string {
  return humanize(category);
}
