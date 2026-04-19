import type { EvolutionCandidate, ComplexityResult, ComplexityFactor } from "./types.js";

export function evaluateComplexity(candidate: EvolutionCandidate): ComplexityResult {
  const factors: ComplexityFactor[] = [
    {
      name: "toolCount",
      raw: candidate.toolCalls.length,
      normalized: Math.min(candidate.toolCalls.length / 20, 1),
      weight: 0.3,
    },
    {
      name: "uniqueTools",
      raw: candidate.uniqueToolCount,
      normalized: Math.min(candidate.uniqueToolCount / 8, 1),
      weight: 0.3,
    },
    {
      name: "reasoningTurns",
      raw: candidate.reasoningTurns,
      normalized: Math.min(candidate.reasoningTurns / 10, 1),
      weight: 0.2,
    },
    {
      name: "duration",
      raw: candidate.durationMs,
      normalized: Math.min(candidate.durationMs / 300_000, 1),
      weight: 0.2,
    },
  ];

  const score = Math.min(
    factors.reduce((sum, f) => sum + f.normalized * f.weight, 0),
    1,
  );

  return { score, factors };
}
