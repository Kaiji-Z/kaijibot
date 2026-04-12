import type { VerificationResult } from "../types.js";

/**
 * Multi-source verification pipeline for insight content.
 *
 * Phase 3: Basic verification — structural checks only (no web search yet).
 * Phase 4 will add actual multi-source cross-checking via web search.
 */

/**
 * Verify an insight candidate.
 * Phase 3: Basic structural checks.
 */
export function verifyInsight(params: {
  content: string;
  sources: Array<{ url: string; title: string; credibility: number }>;
  verificationLevel: "basic" | "strict" | "paranoid";
}): VerificationResult {
  const { sources, verificationLevel } = params;

  // Check: does the insight have any sources?
  if (sources.length === 0) {
    return {
      status: "unverified",
      sources: [],
      confidence: 0,
      notes: "No sources provided — cannot verify",
    };
  }

  // Check: are the sources minimally credible?
  const credibleSources = sources.filter((s) => s.credibility >= 0.3);
  if (credibleSources.length === 0) {
    return {
      status: "unverified",
      sources,
      confidence: 0.1,
      notes: "All sources have low credibility",
    };
  }

  // Basic: 1 credible source is enough
  if (verificationLevel === "basic") {
    return {
      status: credibleSources.length >= 1 ? "partial" : "unverified",
      sources: credibleSources,
      confidence: credibleSources[0].credibility,
      notes:
        credibleSources.length >= 2 ? "Multiple sources agree" : "Single source",
    };
  }

  // Strict: need 2+ credible sources
  if (verificationLevel === "strict") {
    if (credibleSources.length >= 2) {
      return {
        status: "verified",
        sources: credibleSources,
        confidence: Math.min(
          1,
          credibleSources.reduce((sum, s) => sum + s.credibility, 0) /
            credibleSources.length,
        ),
        notes: `${credibleSources.length} credible sources`,
      };
    }
    return {
      status: "partial",
      sources: credibleSources,
      confidence: credibleSources[0].credibility * 0.5,
      notes: "Need 2+ sources for verification",
    };
  }

  // Paranoid: need 3+ sources, all with credibility > 0.5
  const highCredSources = sources.filter((s) => s.credibility >= 0.5);
  if (highCredSources.length >= 3) {
    return {
      status: "verified",
      sources: highCredSources,
      confidence: Math.min(
        1,
        highCredSources.reduce((sum, s) => sum + s.credibility, 0) /
          highCredSources.length,
      ),
      notes: `${highCredSources.length} high-credibility sources`,
    };
  }

  return {
    status: "partial",
    sources: highCredSources.length > 0 ? highCredSources : credibleSources,
    confidence: 0.3,
    notes: "Need 3+ high-credibility sources for paranoid verification",
  };
}
