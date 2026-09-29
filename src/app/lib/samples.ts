/**
 * The workspace a judge lands on.
 *
 * Sample findings are *real* findings created through the real `POST
 * /api/findings` endpoint — they are application state, not a fixture. The
 * loader is idempotent: re-running it adds only what is missing, so the demo
 * workspace can be rebuilt without duplicating rows.
 */
import { api } from "./api";
import type { Finding } from "@/app/types";

export interface SampleFinding {
  controlId: string;
  title: string;
  description: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  category: string;
  affectedSystem: string;
  evidence: Array<{ source: string; observation: string }>;
  /**
   * Index into this list. Set when the finding is a *recurrence* of an earlier
   * one — recorded in application state exactly as an analyst would record it.
   */
  recurrenceOfIndex?: number;
  firstDetectedAt?: string;
}

export const SAMPLE_FINDINGS: readonly SampleFinding[] = [
  {
    controlId: "AC-2(3)",
    title: "12 inactive employees retain privileged access",
    description:
      "Quarterly access review found 12 employees terminated in the last 60 days still holding privileged roles in the identity provider and two downstream finance systems.",
    severity: "HIGH",
    category: "PRIVILEGED_ACCESS",
    affectedSystem: "Okta + SAP SuccessFactors integration",
    evidence: [
      {
        source: "IAM entitlement export",
        observation:
          "12 accounts belonging to employees terminated within 60 days still hold privileged roles in the identity provider.",
      },
      {
        source: "HR termination feed",
        observation:
          "Termination events for the same 12 identities were emitted, but no revocation event followed within 24 hours.",
      },
    ],
    firstDetectedAt: "2026-06-14T09:00:00.000Z",
  },
  {
    controlId: "AC-2(3)",
    title: "8 inactive employees again retain privileged access",
    description:
      "The following quarter's review found 8 employees terminated in the last 45 days still holding privileged access, despite the deprovisioning job reporting success on every run.",
    severity: "HIGH",
    category: "PRIVILEGED_ACCESS",
    affectedSystem: "Okta + SAP SuccessFactors integration",
    evidence: [
      {
        source: "IAM entitlement export",
        observation:
          "8 accounts of employees terminated within 45 days still hold privileged roles; the deprovisioning job logs show no failures.",
      },
      {
        source: "Deprovisioning job logs",
        observation:
          "Every scheduled run completed with status SUCCESS and processed 0 contractor identities.",
      },
      {
        source: "HR roster comparison",
        observation:
          "19 contractor identities active in HR are absent from the deprovisioning job's input set.",
      },
    ],
    recurrenceOfIndex: 0,
    firstDetectedAt: "2026-07-27T09:00:00.000Z",
  },
  {
    controlId: "AC-2(7)",
    title: "Terminated contractors retain remote access",
    description:
      "Offboarding alerts showed 5 contractor identities with valid VPN sessions established after their contract end date.",
    severity: "HIGH",
    category: "TERMINATED_USERS",
    affectedSystem: "GlobalProtect VPN",
    evidence: [
      {
        source: "VPN session log",
        observation: "5 contractor accounts established sessions after their contract end date.",
      },
    ],
    firstDetectedAt: "2026-08-03T09:00:00.000Z",
  },
  {
    controlId: "IA-2(1)",
    title: "MFA not enforced for two administrator accounts",
    description:
      "Configuration review found 2 administrator accounts exempt from the MFA requirement after an organizational-unit move.",
    severity: "CRITICAL",
    category: "MFA",
    affectedSystem: "Okta global session policy",
    evidence: [
      {
        source: "Policy export",
        observation:
          "2 administrator accounts sit outside the organizational unit the MFA policy is scoped to.",
      },
    ],
    firstDetectedAt: "2026-08-11T09:00:00.000Z",
  },
  {
    controlId: "AC-6",
    title: "Service account holds standing administrator privileges",
    description:
      "A build automation service account carries AdministratorAccess with no identified owner.",
    severity: "HIGH",
    category: "SERVICE_ACCOUNTS",
    affectedSystem: "AWS IAM",
    evidence: [
      {
        source: "Cloud posture scan",
        observation: "Service account ci-deployer holds AdministratorAccess and has no owner tag.",
      },
    ],
    firstDetectedAt: "2026-08-19T09:00:00.000Z",
  },
  {
    controlId: "AU-11",
    title: "Access review evidence incomplete for audit sample",
    description:
      "Auditors requested 15 access review artifacts for the period; 6 could not be produced in the required format.",
    severity: "MEDIUM",
    category: "EVIDENCE_COLLECTION",
    affectedSystem: "Access review platform",
    evidence: [
      {
        source: "Audit request log",
        observation: "6 of 15 requested access review artifacts could not be produced.",
      },
    ],
    firstDetectedAt: "2026-08-25T09:00:00.000Z",
  },
  {
    controlId: "AC-2(j)",
    title: "Vendor guest accounts persist without expiry",
    description:
      "Guest accounts for 9 vendors had no expiration configured and 3 belonged to vendors with no active contract.",
    severity: "MEDIUM",
    category: "VENDOR_ACCESS",
    affectedSystem: "Azure AD B2B",
    evidence: [
      {
        source: "Guest account export",
        observation: "9 external guest accounts have no expiry date configured.",
      },
    ],
    firstDetectedAt: "2026-09-02T09:00:00.000Z",
  },
  {
    controlId: "AU-2",
    title: "Audit logging not enabled in a new region",
    description:
      "Audit preparation found one operating region had no central audit trail configured.",
    severity: "HIGH",
    category: "AUDIT_CONTROLS",
    affectedSystem: "AWS CloudTrail",
    evidence: [
      {
        source: "Region inventory",
        observation: "eu-west-2 has no organization-level trail configured.",
      },
    ],
    firstDetectedAt: "2026-09-09T09:00:00.000Z",
  },
];

export interface LoadResult {
  created: number;
  alreadyPresent: number;
}

/**
 * Create every sample finding that does not already exist.
 *
 * Recurrence links are wired after the fact so finding #2 points at the real
 * id of finding #1 — the same way an analyst would file it.
 */
export async function loadSampleFindings(): Promise<LoadResult> {
  const existing = await api.get<{ findings: Finding[] }>("/api/findings");
  const byTitle = new Map(existing.findings.map((f) => [f.title, f]));

  const created: Finding[] = [];
  let alreadyPresent = 0;
  let newCount = 0;

  for (const sample of SAMPLE_FINDINGS) {
    const found = byTitle.get(sample.title);
    if (found) {
      alreadyPresent += 1;
      created.push(found);
      continue;
    }

    const parent =
      sample.recurrenceOfIndex !== undefined ? created[sample.recurrenceOfIndex] : undefined;

    const response = await api.post<{ finding: Finding }>("/api/findings", {
      controlId: sample.controlId,
      title: sample.title,
      description: sample.description,
      severity: sample.severity,
      category: sample.category,
      affectedSystem: sample.affectedSystem,
      evidence: sample.evidence,
      ...(sample.firstDetectedAt ? { firstDetectedAt: sample.firstDetectedAt } : {}),
      ...(parent ? { recurrenceOf: parent.id } : {}),
    });
    created.push(response.finding);
    newCount += 1;
  }

  return { created: newCount, alreadyPresent };
}
