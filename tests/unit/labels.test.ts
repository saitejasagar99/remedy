/**
 * The wording layer between the stored schema and the screen.
 *
 * Statuses, categories and decisions are SCREAMING_SNAKE_CASE because that is
 * what the API validates. Rendering them verbatim is the classic "the demo
 * works but it looks like a database viewer" failure, so the conversion is
 * pinned here rather than left to whatever each panel happens to do.
 */
import { describe, expect, it } from 'vitest';

import {
  categoryLabel,
  findingStatusLabel,
  humanize,
  outcomeLabel,
  severityTone,
} from '@/app/lib/labels';

describe('humanize', () => {
  it('turns an internal enum into words', () => {
    expect(humanize('AWAITING_APPROVAL')).toBe('Awaiting approval');
    expect(humanize('ROOT_CAUSE_IDENTIFIED')).toBe('Root cause identified');
    expect(humanize('REMEDIATION_PROPOSED')).toBe('Remediation proposed');
    expect(humanize('AUDIT_CONTROLS')).toBe('Audit controls');
    expect(humanize('EVIDENCE_COLLECTION')).toBe('Evidence collection');
  });

  it('collapses repeated separators without leaving stray spaces', () => {
    expect(humanize('SERVICE__ACCOUNTS')).toBe('Service accounts');
    expect(humanize('VENDOR-ACCESS')).toBe('Vendor access');
    expect(humanize('  EMPLOYEE_ACCESS  ')).toBe('Employee access');
  });

  it('passes already-readable values through unchanged', () => {
    expect(humanize('Open')).toBe('Open');
    expect(humanize('IAM entitlement export')).toBe('IAM entitlement export');
    expect(humanize('Cloud posture scan')).toBe('Cloud posture scan');
    expect(humanize('CRITICAL')).toBe('Critical');
  });

  it('keeps domain acronyms in capitals', () => {
    expect(humanize('MFA')).toBe('MFA');
    expect(humanize('IAM')).toBe('IAM');
    expect(humanize('SSO_POLICY')).toBe('SSO policy');
  });

  it('renders a dash rather than "undefined" when the field is missing', () => {
    expect(humanize(undefined)).toBe('—');
    expect(humanize(null)).toBe('—');
    expect(humanize('')).toBe('—');
  });
});

describe('findingStatusLabel', () => {
  it('never leaks the stored enum', () => {
    for (const status of [
      'OPEN',
      'INVESTIGATING',
      'AWAITING_APPROVAL',
      'REMEDIATING',
      'VERIFYING',
      'RESOLVED',
      'RECURRED',
    ]) {
      const label = findingStatusLabel(status);
      expect(label).toBe(humanize(status));
      expect(label).not.toContain('_');
      expect(label).not.toMatch(/^[A-Z_]+$/);
    }
  });

  it('keeps every tone mapping addressable by its label source', () => {
    // A status that gets a tone must still render as words, so the badge
    // colour and the badge text can never disagree about which status it is.
    expect(findingStatusLabel('AWAITING_APPROVAL')).toBe('Awaiting approval');
    expect(severityTone('HIGH')).toBe('danger');
  });
});

describe('categoryLabel', () => {
  it('reads as a phrase rather than an identifier', () => {
    expect(categoryLabel('PRIVILEGED_ACCESS')).toBe('Privileged access');
    expect(categoryLabel('SERVICE_ACCOUNTS')).toBe('Service accounts');
    expect(categoryLabel('TERMINATED_USERS')).toBe('Terminated users');
  });

  it('does not turn an acronym category into a word', () => {
    // `MFA` rendered as "Mfa" would read as a typo in the findings table.
    expect(categoryLabel('MFA')).toBe('MFA');
    expect(categoryLabel('IAM')).toBe('IAM');
  });
});

describe('outcomeLabel', () => {
  it('reads FAILURE as FAILED on screen', () => {
    expect(outcomeLabel('FAILURE')).toBe('FAILED');
    expect(outcomeLabel('SUCCESS')).toBe('SUCCESS');
    expect(outcomeLabel('PARTIAL')).toBe('PARTIAL');
    expect(outcomeLabel(undefined)).toBe('UNKNOWN');
  });
});
