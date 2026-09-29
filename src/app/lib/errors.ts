/**
 * Turns a raw failure into something a compliance engineer can act on.
 *
 * The original message is still available for the console, but what renders in
 * the panel explains what happened *and* what the consequence is for the
 * recommendation — because the interesting part of a failure here is never the
 * stack trace, it is whether the answer can still be trusted.
 */
export function friendlyError(raw: string): string {
  const text = raw.toLowerCase();

  if (text.includes("hindsight") || text.includes("memory layer") || text.includes("econnrefused")) {
    return "Historical memory is temporarily unavailable. REMEDY completed a stateless recommendation instead, and no prior case was used.";
  }
  if (text.includes("llm") || text.includes("model") || text.includes("ollama")) {
    return "The language model did not respond, so REMEDY fell back to its deterministic reasoning. The recommendation is still valid, but no model-authored polish was applied.";
  }
  if (text.includes("timed out") || text.includes("timeout")) {
    return "The request took longer than expected and was stopped so the interface stayed responsive. Try again — nothing was partially written.";
  }
  if (text.includes("validation")) {
    return "Some required information was missing or malformed. Check the highlighted fields and submit again.";
  }
  if (text.includes("no evidence")) {
    return "This finding has no evidence recorded. Add at least one observation before running the analysis.";
  }
  return raw;
}

/** Verification results that do not warrant a PASS. */
export function verificationNote(result: string): string | null {
  if (result === "FAIL") {
    return "The verification did not pass, so the finding stays open. Record the outcome so the failure becomes organisational memory.";
  }
  if (result === "PARTIAL") {
    return "The verification only partly passed. Record a PARTIAL outcome — partial fixes are exactly what future recommendations need to see.";
  }
  return null;
}
