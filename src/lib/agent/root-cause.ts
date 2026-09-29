/**
 * Root Cause Agent.
 *
 * Hypothesises *why* the finding exists, with contributing factors and an
 * explicit confidence value. Confidence is passed forward deliberately: the
 * recommendation step lowers its own confidence when the root-cause hypothesis
 * is weak.
 *
 * Falls back to a clearly-labelled heuristic when the LLM is unavailable.
 */
import { chatJSON } from '../llm/client';
import { llmRootCauseSchema } from '../models/schemas';
import type { EvidenceAnalysis } from './evidence';
import type { Finding, RootCause } from '../models/schemas';

const SYSTEM = `You are a senior security/compliance engineer performing root-cause analysis.
Identify the single most likely root cause of the compliance finding.
Consider identity pipelines, provisioning/deprovisioning, integrations, policy gaps and process failures.
Return ONLY a JSON object:
  rootCause              string   — one sentence, specific and falsifiable
  contributingFactors    string[] — secondary conditions that allowed it
  confidence             number   — 0..1
  alternativeHypotheses  string[] — other credible explanations
No prose outside the JSON.`;

export interface RootCauseResult {
  rootCause: RootCause;
  /** Alternatives the model considered — surfaced as assumptions downstream. */
  alternatives: string[];
  usedModel: boolean;
  error?: string;
}

/**
 * Heuristic used when no model is available.
 *
 * Deliberately conservative: it asserts a low-confidence systemic hypothesis
 * rather than pretending to have analysed anything.
 */
function heuristicRootCause(finding: Finding): {
  rootCause: string;
  contributingFactors: string[];
  confidence: number;
  alternativeHypotheses: string[];
} {
  return {
    rootCause: `Undetermined — automated root-cause analysis was unavailable for ${finding.controlId}; review the identity/provisioning path for ${finding.affectedSystem} manually.`,
    contributingFactors: ['Automated analysis unavailable'],
    confidence: 0.2,
    alternativeHypotheses: ['Requires manual investigation'],
  };
}

export async function analyzeRootCause(
  finding: Finding,
  evidence: EvidenceAnalysis,
): Promise<RootCauseResult> {
  const result = await chatJSON({
    system: SYSTEM,
    user: [
      `Finding: ${finding.title}`,
      `Control: ${finding.controlId}`,
      `Category: ${finding.category}`,
      `Affected system: ${finding.affectedSystem}`,
      `Description: ${finding.description}`,
      '',
      `Evidence summary: ${evidence.summary}`,
      `Established: ${evidence.established.join('; ') || 'none'}`,
      `Gaps: ${evidence.gaps.join('; ') || 'none'}`,
    ].join('\n'),
    schema: llmRootCauseSchema,
  });

  const parsed = result.ok ? result.data : heuristicRootCause(finding);

  const rootCause: RootCause = {
    id: `rc-${finding.id}`,
    findingId: finding.id,
    rootCause: parsed.rootCause,
    contributingFactors: parsed.contributingFactors,
    // Clamp so a model returning 0..100 instead of 0..1 cannot poison maths.
    confidence: Math.min(1, Math.max(0, parsed.confidence)),
    identifiedAt: new Date().toISOString(),
    method: result.ok ? 'LLM_ANALYSIS' : 'HUMAN',
  };

  return {
    rootCause,
    alternatives: parsed.alternativeHypotheses,
    usedModel: result.ok,
    ...(result.ok ? {} : { error: result.error }),
  };
}
