/**
 * Evidence Agent.
 *
 * Reads the raw evidence attached to a finding and produces a structured
 * analysis: what the evidence establishes, what it only suggests, and what is
 * still missing. The gaps matter — they are what the memory step later
 * cross-checks against historical cases.
 *
 * Degrades to a deterministic summary when the LLM is unavailable, so the
 * pipeline still completes (and is explicitly labelled as such).
 */
import { chatJSON } from '../llm/client';
import type { Evidence, Finding } from '../models/schemas';
import { z } from 'zod';

const evidenceAnalysisSchema = z.object({
  summary: z.string().min(1),
  established: z.array(z.string()).default([]),
  suggested: z.array(z.string()).default([]),
  gaps: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
});

export type EvidenceAnalysis = z.output<typeof evidenceAnalysisSchema>;

const SYSTEM = `You are an evidence analyst supporting a security/compliance engineer.
You are given raw evidence collected for a compliance finding.
Return ONLY a JSON object with these keys:
  summary      string   — one or two sentences on what the evidence shows
  established  string[] — conclusions the evidence directly supports
  suggested    string[] — plausible but unproven interpretations
  gaps         string[] — what is missing or unverified
  confidence   number   — 0..1 confidence in the established conclusions
No prose outside the JSON.`;

function deterministicFallback(finding: Finding): EvidenceAnalysis {
  const established = finding.evidence.map((e) => e.observation);
  return {
    summary: `${finding.evidence.length} evidence item(s) recorded for ${finding.controlId} on ${finding.affectedSystem}.`,
    established,
    suggested: [],
    gaps: finding.evidence.length === 0
      ? ['No evidence attached — collection required before root-cause analysis.']
      : [],
    confidence: finding.evidence.length > 0 ? 0.5 : 0.1,
  };
}

function renderEvidence(evidence: Evidence[]): string {
  if (evidence.length === 0) return '(no evidence attached)';
  return evidence
    .map(
      (e, i) =>
        `${i + 1}. [${e.source}] ${e.observation}${
          e.supportsHypothesis ? ` (supports: ${e.supportsHypothesis})` : ''
        }`,
    )
    .join('\n');
}

export interface EvidenceResult {
  analysis: EvidenceAnalysis;
  /** False when the LLM could not be used and the fallback was applied. */
  usedModel: boolean;
  error?: string;
}

export async function analyzeEvidence(finding: Finding): Promise<EvidenceResult> {
  const result = await chatJSON({
    system: SYSTEM,
    user: [
      `Finding: ${finding.title}`,
      `Control: ${finding.controlId}`,
      `Category: ${finding.category}`,
      `Severity: ${finding.severity}`,
      `Affected system: ${finding.affectedSystem}`,
      `Description: ${finding.description}`,
      '',
      'Evidence:',
      renderEvidence(finding.evidence),
    ].join('\n'),
    schema: evidenceAnalysisSchema,
  });

  if (result.ok) return { analysis: result.data, usedModel: true };
  return {
    analysis: deterministicFallback(finding),
    usedModel: false,
    error: result.error,
  };
}
