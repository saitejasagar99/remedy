/**
 * Synthetic enterprise compliance history.
 *
 * 18 realistic historical cases used to seed Hindsight. This dataset is
 * deliberately constructed with VARIATION, because variation is what makes
 * memory change reasoning:
 *
 *  - successes, failures and partial results
 *  - findings that recurred after a fix, and ones that did not
 *  - several *similar* findings with *different* root causes
 *  - the same proposed fix succeeding in one context and failing in another
 *
 * Cases 102 / 087 / 091 / 052 form the demonstration cluster: the same
 * surface-level finding ("inactive employees hold privileged access") resolved
 * four different ways with four different outcomes.
 *
 * All names, controls and identifiers are invented. No real organisation,
 * employee or contractor is represented.
 */
import type { HistoricalCaseInput } from '../models/schemas';

export const HISTORICAL_CASES: readonly HistoricalCaseInput[] = [
  {
    caseId: '102',
    controlId: 'AC-2(3)',
    category: 'PRIVILEGED_ACCESS',
    affectedSystem: 'Okta + SAP SuccessFactors integration',
    title: '12 inactive employees retain privileged access',
    description:
      'Quarterly access review found 12 employees terminated in the last 60 days still holding privileged roles in the identity provider and two downstream finance systems.',
    severity: 'HIGH',
    rootCause:
      'HR to IAM synchronization failure: the deprovisioning pipeline processed employee records only, so terminated identities were never revoked.',
    contributingFactors: [
      'No alerting on sync job failure',
      'Access review sampled only active-directory accounts',
    ],
    remediationAttempted: 'Automated HR to IAM deprovisioning on termination event',
    implementationDetails:
      'A scheduled job consumed the HR termination feed and disabled accounts within 15 minutes of the termination effective date.',
    verificationResult: 'PASS',
    outcome: 'FAILURE',
    recurrence: true,
    daysToRecurrence: 43,
    lessonLearned:
      'Contractor identities were excluded from the synchronization pipeline, so the fix addressed the symptom but not the full population.',
    additionalInvestigation:
      'Follow-up confirmed the sync job filtered on employeeType=EMPLOYEE, silently dropping contractor and agency records.',
    observedSideEffects: ['None observed before recurrence'],
    closedAt: '2025-11-14T09:00:00.000Z',
  },
  {
    caseId: '087',
    controlId: 'AC-2(3)',
    category: 'PRIVILEGED_ACCESS',
    affectedSystem: 'Okta + SAP SuccessFactors integration',
    title: 'Inactive staff hold privileged access after HR sync gap',
    description:
      'Access review identified 9 terminated users with privileged roles remaining active, following a partial HR feed outage.',
    severity: 'HIGH',
    rootCause:
      'HR to IAM synchronization gap caused by an incomplete identity scope in the deprovisioning feed.',
    contributingFactors: ['Feed outage recovered without replaying missed events'],
    remediationAttempted:
      'Automated HR to IAM deprovisioning with synchronization coverage expanded to all identity types',
    implementationDetails:
      'Removed the employeeType filter, added replay of missed events after an outage, and added a reconciliation job comparing HR active identities to IAM entitlements.',
    verificationResult: 'PASS',
    outcome: 'SUCCESS',
    recurrence: false,
    lessonLearned:
      'Synchronization coverage must include every identity type, and outage recovery must replay missed events rather than resuming from the current offset.',
    observedSideEffects: ['Reconciliation job surfaced 4 additional orphaned accounts'],
    closedAt: '2026-02-03T09:00:00.000Z',
  },
  {
    caseId: '091',
    controlId: 'AC-2(3)',
    category: 'EMPLOYEE_ACCESS',
    affectedSystem: 'Microsoft Entra ID',
    title: 'Former employees retain access due to disabled revocation job',
    description:
      'Offboarding alerts showed 6 terminated users with active sessions and assigned licenses more than 30 days after exit.',
    severity: 'HIGH',
    rootCause:
      'The deprovisioning job had been disabled during a migration and never re-enabled, so no revocation events fired.',
    contributingFactors: ['Migration runbook did not include re-enabling the scheduled job'],
    remediationAttempted:
      'Re-enable automated deprovisioning and add alerting when the job does not run',
    implementationDetails:
      'Restored the scheduled job, added a dead-man switch that alerts if no revocation event is seen in 24 hours.',
    verificationResult: 'PASS',
    outcome: 'SUCCESS',
    recurrence: false,
    lessonLearned:
      'A control that is configured but not running is indistinguishable from one that never existed; monitor for absence of activity, not just errors.',
    observedSideEffects: [],
    closedAt: '2025-12-08T09:00:00.000Z',
  },
  {
    caseId: '052',
    controlId: 'AC-2(3)',
    category: 'HR_SYNC',
    affectedSystem: 'Workday to Okta SCIM',
    title: 'Terminated users remain active following HR feed outage',
    description:
      'A 9-hour HR API outage left 23 leaver events unprocessed; identities remained active across 5 connected applications.',
    severity: 'CRITICAL',
    rootCause:
      'The HR API rate limit silently dropped leaver events, and there was no dead-letter queue to recover them.',
    contributingFactors: [
      'Rate-limit responses logged at debug level',
      'No replay mechanism for dropped events',
    ],
    remediationAttempted:
      'Raise API rate limits and add a dead-letter queue with automatic replay for failed synchronization events',
    implementationDetails:
      'Implemented exponential backoff, a persistent dead-letter queue, and a daily reconciliation comparing HR leavers against IAM state.',
    verificationResult: 'PASS',
    outcome: 'SUCCESS',
    recurrence: false,
    lessonLearned:
      'Integration failures must be retried and observable; a queue that drops events quietly converts a transient outage into a standing access-control failure.',
    observedSideEffects: ['Dead-letter queue replayed 31 historical events on first run'],
    closedAt: '2025-09-22T09:00:00.000Z',
  },
  {
    caseId: '115',
    controlId: 'IA-2(1)',
    category: 'MFA',
    affectedSystem: 'Okta global session policy',
    title: 'MFA not enforced for administrator roles',
    description:
      'Configuration review found 4 administrator accounts exempt from the MFA requirement after an organizational-unit move.',
    severity: 'CRITICAL',
    rootCause:
      'The MFA policy was scoped to an organizational unit; accounts moved out of that unit silently lost the requirement.',
    contributingFactors: ['No drift detection on policy scope changes'],
    remediationAttempted:
      'Apply MFA policy at the tenant level and add configuration drift detection',
    implementationDetails:
      'Replaced OU-scoped policy with a tenant-wide policy requiring phishing-resistant MFA, plus daily drift alerts on policy scope.',
    verificationResult: 'PASS',
    outcome: 'SUCCESS',
    recurrence: false,
    lessonLearned:
      'Scope-based security policies fail closed in the wrong direction: moving an object out of scope removes protection without raising an error.',
    observedSideEffects: [],
    closedAt: '2026-01-19T09:00:00.000Z',
  },
  {
    caseId: '064',
    controlId: 'AC-2(7)',
    category: 'TERMINATED_USERS',
    affectedSystem: 'GlobalProtect VPN',
    title: 'Terminated users retain VPN access',
    description:
      'Security monitoring showed 7 terminated users with valid VPN sessions established after their termination date.',
    severity: 'HIGH',
    rootCause:
      'Termination events were transmitted by an hourly manual export, so revocation lagged the termination effective time.',
    contributingFactors: ['Manual export was skipped during a holiday period'],
    remediationAttempted:
      'Automate termination-driven revocation from the HR system to the VPN gateway',
    implementationDetails:
      'Replaced manual export with an event-driven integration revoking VPN entitlements within 5 minutes.',
    verificationResult: 'PARTIAL',
    outcome: 'PARTIAL',
    recurrence: false,
    lessonLearned:
      'Automation covered employees but agency staff still terminated through a separate process; the population boundary must be defined before declaring the control effective.',
    additionalInvestigation:
      'Agency workers are provisioned from a different source system that was not connected to the new integration.',
    observedSideEffects: [],
    closedAt: '2025-10-30T09:00:00.000Z',
  },
  {
    caseId: '119',
    controlId: 'AC-2(11)',
    category: 'CONTRACTOR_ACCOUNTS',
    affectedSystem: 'Okta + Coupa vendor records',
    title: 'Contractor accounts remain active beyond contract end',
    description:
      'Audit sampling found 14 contractor accounts active more than 90 days past their contract end date.',
    severity: 'HIGH',
    rootCause:
      'Contractor accounts were created without a fixed expiry date, so nothing triggered deprovisioning when the contract ended.',
    contributingFactors: [
      'Contract end dates held in the procurement system, not the identity provider',
    ],
    remediationAttempted: 'Implement automatic expiry dates on contractor accounts',
    implementationDetails:
      'Set account end-dating from the procurement contract record at creation, with a nightly job expiring accounts past their end date.',
    verificationResult: 'PASS',
    outcome: 'FAILURE',
    recurrence: true,
    daysToRecurrence: 30,
    lessonLearned:
      'Contract extensions updated the procurement record but never refreshed the identity end date, so extended contractors were expired mid-engagement and others lapsed.',
    additionalInvestigation:
      'The expiry job read the value captured at creation time instead of re-reading the current contract record.',
    observedSideEffects: ['11 legitimate extended contractors were locked out'],
    closedAt: '2026-03-11T09:00:00.000Z',
  },
  {
    caseId: '073',
    controlId: 'AC-6',
    category: 'SERVICE_ACCOUNTS',
    affectedSystem: 'AWS IAM',
    title: 'Service account holds standing administrator privileges',
    description:
      'A build automation service account carried AdministratorAccess with no identified owner.',
    severity: 'HIGH',
    rootCause:
      'No ownership registry existed for service accounts, so privileges granted during an incident were never revisited.',
    contributingFactors: ['Break-glass grants had no expiry'],
    remediationAttempted:
      'Create a service account ownership registry and enforce least-privilege roles with expiry on elevated grants',
    implementationDetails:
      'Registered every service account with a named owner, replaced AdministratorAccess with task-specific roles, and set 30-day expiry on elevated grants.',
    verificationResult: 'PASS',
    outcome: 'SUCCESS',
    recurrence: false,
    lessonLearned:
      'Ownership is the precondition for least privilege: an unowned credential cannot be reviewed, rotated or revoked with confidence.',
    observedSideEffects: ['3 unowned accounts identified and decommissioned'],
    closedAt: '2025-08-14T09:00:00.000Z',
  },
  {
    caseId: '098',
    controlId: 'IA-5(1)',
    category: 'SERVICE_ACCOUNTS',
    affectedSystem: 'Legacy integration servers',
    title: 'Service account credentials never rotated',
    description:
      'Credential inventory showed 8 service accounts with secrets older than 400 days.',
    severity: 'MEDIUM',
    rootCause:
      'The rotation policy explicitly excluded legacy integration servers that could not reload secrets without a restart.',
    contributingFactors: ['Restart windows never scheduled with application owners'],
    remediationAttempted: 'Enforce automated credential rotation for all service accounts',
    implementationDetails:
      'Deployed a secrets manager and scheduled rotation every 90 days across all registered accounts.',
    verificationResult: 'PASS',
    outcome: 'FAILURE',
    recurrence: true,
    daysToRecurrence: 61,
    lessonLearned:
      'The rotation excluded accounts that failed health checks after restart, so rotation silently skipped exactly the oldest credentials it targeted.',
    additionalInvestigation:
      'Failures were recorded as warnings in the rotation job and no alert was configured on skipped accounts.',
    observedSideEffects: [],
    closedAt: '2026-04-02T09:00:00.000Z',
  },
  {
    caseId: '045',
    controlId: 'AC-6(5)',
    category: 'CLOUD_PERMISSIONS',
    affectedSystem: 'AWS IAM',
    title: 'Wildcard IAM policy grants unrestricted access',
    description:
      'A production role attached a policy allowing actions on all resources in three regions.',
    severity: 'CRITICAL',
    rootCause:
      'The policy was written to unblock a launch and never scoped down afterwards.',
    contributingFactors: ['No policy linting in the deployment pipeline'],
    remediationAttempted:
      'Replace wildcard policy with resource-scoped least-privilege policy',
    implementationDetails:
      'Rewrote the policy to explicit actions and resource ARNs, with policy linting blocking wildcard grants in CI.',
    verificationResult: 'PASS',
    outcome: 'SUCCESS',
    recurrence: false,
    lessonLearned:
      'Blocking the pattern at deployment time prevents recurrence far more reliably than a one-off cleanup.',
    observedSideEffects: [],
    closedAt: '2025-07-09T09:00:00.000Z',
  },
  {
    caseId: '126',
    controlId: 'AC-6(5)',
    category: 'CLOUD_PERMISSIONS',
    affectedSystem: 'Terraform pipeline to AWS',
    title: 'Excessive cloud permissions granted by deployment pipeline',
    description:
      'Cloud posture scan flagged 6 roles with permissions beyond their declared workload requirements.',
    severity: 'HIGH',
    rootCause:
      'The infrastructure pipeline defaulted every workload role to administrator privileges for simplicity.',
    contributingFactors: ['No least-privilege template for new services'],
    remediationAttempted:
      'Change the pipeline default to a least-privilege baseline role and require justification for elevation',
    implementationDetails:
      'Replaced the administrator default with a scoped baseline module; elevation now requires an approved ticket recorded in the role description.',
    verificationResult: 'PASS',
    outcome: 'SUCCESS',
    recurrence: false,
    lessonLearned:
      'Changing the default beats auditing the exceptions: the population shrank without any per-role cleanup work.',
    observedSideEffects: ['Existing roles migrated over three sprints'],
    closedAt: '2026-05-20T09:00:00.000Z',
  },
  {
    caseId: '057',
    controlId: 'AC-2(j)',
    category: 'VENDOR_ACCESS',
    affectedSystem: 'Okta + supplier portal',
    title: 'Third-party access not reviewed quarterly',
    description:
      'Two consecutive quarterly reviews of vendor access were recorded as complete with no underlying evidence.',
    severity: 'MEDIUM',
    rootCause:
      'The review was a manual spreadsheet exercise with no system of record, so completion was self-attested.',
    contributingFactors: ['No linkage between reviewer sign-off and actual entitlement data'],
    remediationAttempted:
      'Introduce a quarterly access review workflow with mandatory evidence capture',
    implementationDetails:
      'Automated review campaigns generated from entitlement exports, requiring reviewer decision per item and archiving the export.',
    verificationResult: 'PARTIAL',
    outcome: 'PARTIAL',
    recurrence: false,
    lessonLearned:
      'Reviews happened on schedule but the archived evidence lacked retention guarantees, so audit samples still could not be reproduced after 12 months.',
    additionalInvestigation: 'Evidence was stored in a workspace that rotates after 180 days.',
    observedSideEffects: [],
    closedAt: '2025-11-27T09:00:00.000Z',
  },
  {
    caseId: '134',
    controlId: 'AC-2(j)',
    category: 'VENDOR_ACCESS',
    affectedSystem: 'Azure AD B2B',
    title: 'Vendor accounts persist without expiry',
    description:
      'Guest accounts for 22 vendors had no expiration configured and 9 belonged to vendors with no active contract.',
    severity: 'MEDIUM',
    rootCause:
      'Business-to-business guest accounts were invited without an expiry date, and invitations had no approval workflow.',
    contributingFactors: ['Any user could invite an external guest'],
    remediationAttempted:
      'Enforce expiry dates on external accounts and require approval for invitations',
    implementationDetails:
      'Restricted invitation rights to a service desk group, set 180-day expiry by default, and applied access packages with sponsor confirmation.',
    verificationResult: 'PASS',
    outcome: 'SUCCESS',
    recurrence: false,
    lessonLearned:
      'Default expiry on creation is effective because it needs no later action; relying on a periodic cleanup shifts the control onto human diligence.',
    observedSideEffects: ['17 stale guest accounts auto-expired within 60 days'],
    closedAt: '2026-06-16T09:00:00.000Z',
  },
  {
    caseId: '069',
    controlId: 'AU-2',
    category: 'AUDIT_CONTROLS',
    affectedSystem: 'AWS CloudTrail',
    title: 'Audit logging not enabled in a new region',
    description:
      'Audit preparation found one operating region had no central audit trail configured.',
    severity: 'HIGH',
    rootCause:
      'The infrastructure module that provisions regions did not enable logging; regions created outside it were unmonitored.',
    contributingFactors: ['Region provisioning was not gated by a golden-path module'],
    remediationAttempted:
      'Enable central audit logging for all regions and add drift detection',
    implementationDetails:
      'Enabled organization-level trail covering all regions and added a daily check alerting on regions missing logging.',
    verificationResult: 'PASS',
    outcome: 'FAILURE',
    recurrence: true,
    daysToRecurrence: 22,
    lessonLearned:
      'A new region was created after the fix and the drift alert fired but routed to an unmonitored queue, so detection existed without response.',
    additionalInvestigation: 'Alert destination had not been added to the on-call rotation.',
    observedSideEffects: [],
    closedAt: '2026-01-07T09:00:00.000Z',
  },
  {
    caseId: '107',
    controlId: 'AU-11',
    category: 'EVIDENCE_COLLECTION',
    affectedSystem: 'Access review platform',
    title: 'Access review evidence incomplete for audit sample',
    description:
      'Auditors requested 15 access review artifacts; 6 could not be produced in the required format.',
    severity: 'MEDIUM',
    rootCause:
      'Evidence was assembled by hand each quarter, so artifacts varied in format and some reviewer decisions were never exported.',
    contributingFactors: ['No standard evidence template'],
    remediationAttempted:
      'Automate evidence export from the access review platform with a fixed audit format',
    implementationDetails:
      'Scheduled export producing a signed, timestamped package per review cycle, archived to the audit repository.',
    verificationResult: 'PASS',
    outcome: 'SUCCESS',
    recurrence: false,
    lessonLearned:
      'Generating evidence at the moment of review, rather than reconstructing it later, removes the entire class of missing-artifact findings.',
    observedSideEffects: [],
    closedAt: '2025-10-16T09:00:00.000Z',
  },
  {
    caseId: '082',
    controlId: 'AU-11',
    category: 'EVIDENCE_COLLECTION',
    affectedSystem: 'Confluence audit space',
    title: 'Audit evidence unavailable after retention window',
    description:
      'Evidence for a completed control test could not be retrieved because the storing space had purged it.',
    severity: 'MEDIUM',
    rootCause:
      'Evidence was stored in a collaborative workspace whose retention policy expired content before the audit cycle.',
    contributingFactors: ['Retention configured by content type, not by evidence class'],
    remediationAttempted:
      'Automate evidence export to the audit repository with enforced retention',
    implementationDetails:
      'Exported evidence on capture into the records system with a seven-year retention lock.',
    verificationResult: 'PARTIAL',
    outcome: 'PARTIAL',
    recurrence: false,
    lessonLearned:
      'Storage location and retention were fixed for newly captured evidence, but historical artifacts from the prior three cycles were already unrecoverable.',
    additionalInvestigation: 'The prior cycles were never migrated and remain permanently unavailable.',
    observedSideEffects: [],
    closedAt: '2025-12-19T09:00:00.000Z',
  },
  {
    caseId: '111',
    controlId: 'AC-2(7)',
    category: 'POLICY_VIOLATION',
    affectedSystem: 'Production jump hosts',
    title: 'Shared privileged accounts in use',
    description:
      'Session logs showed 5 shared credentials used by multiple engineers, defeating accountability.',
    severity: 'HIGH',
    rootCause:
      'Emergency access procedures permitted a shared account and no individual privileged accounts had been issued.',
    contributingFactors: ['Individual accounts required a request that was never automated'],
    remediationAttempted:
      'Eliminate shared accounts and implement just-in-time privileged access',
    implementationDetails:
      'Issued individual privileged accounts, removed shared credentials, and required time-boxed elevation through a request workflow.',
    verificationResult: 'PASS',
    outcome: 'SUCCESS',
    recurrence: false,
    lessonLearned:
      'Removing the shared account only worked once individual accounts were effortless to obtain; making the compliant path the easy path is what held.',
    observedSideEffects: ['Shared credential rotation completed within one week'],
    closedAt: '2026-03-26T09:00:00.000Z',
  },
  {
    caseId: '096',
    controlId: 'AC-2(3)',
    category: 'EMPLOYEE_ACCESS',
    affectedSystem: 'Okta + internal admin console',
    title: 'Transferred employees retain previous role permissions',
    description:
      'Internal review found 8 transferred employees still holding entitlements from their prior role.',
    severity: 'MEDIUM',
    rootCause:
      'The deprovisioning process handled leavers only; internal transfers never triggered removal of previous entitlements.',
    contributingFactors: ['Joiner-mover-leaver process implemented joiner and leaver only'],
    remediationAttempted:
      'Add mover handling that strips previous role entitlements on transfer',
    implementationDetails:
      'Transfer events now trigger removal of role-scoped groups before the new role assignment is applied.',
    verificationResult: 'PASS',
    outcome: 'SUCCESS',
    recurrence: false,
    lessonLearned:
      'Access lifecycle processes are commonly built for joiners and leavers; the mover path is the routinely omitted third case.',
    observedSideEffects: [],
    closedAt: '2025-09-05T09:00:00.000Z',
  },
];
