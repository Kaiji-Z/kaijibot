import type { PersonaTree } from "../types.js";

/**
 * Compact persona summary (~0.5-1KB) for system prompt injection.
 *
 * Alternative to buildPersonaContext (which produces ~1-3KB). Trades detail
 * for token budget. Opt-in via `cognitive.persona.useSummaryLayer` config.
 *
 * Design (first principles):
 * - Identity: only top-3 high-confidence traits (one line)
 * - Active domains: top-3 by recency, one insight each (was: 5 domains × 3 insights)
 * - Recent focus: top-3 (was: 5)
 * - Skip: mood/blacklist/lifecycle/communication-style (low signal-density per token)
 */
export function buildPersonaSummary(persona: PersonaTree | undefined): string {
  if (!persona) {
    return "";
  }

  const lines: string[] = ["## User Cognitive Profile"];

  const traits = Object.entries(persona.identity.coreTraits)
    .filter(([, v]) => v.confidence >= 0.7)
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${v.value}`);
  if (traits.length > 0) {
    lines.push(`Traits: ${traits.join(", ")}`);
  }

  if (persona.identity.expertDomains.length > 0) {
    lines.push(`Expert: ${persona.identity.expertDomains.slice(0, 3).join(", ")}`);
  }

  const activeDomains = Object.entries(persona.domains)
    .filter(([, d]) => d.depth >= 3)
    .toSorted(([, a], [, b]) => b.lastMentioned - a.lastMentioned)
    .slice(0, 3);

  if (activeDomains.length > 0) {
    lines.push("Active:");
    for (const [name, d] of activeDomains) {
      const topInsight = d.insights?.toSorted((a, b) => b.confidence - a.confidence).at(0);
      lines.push(`- ${name} (depth ${d.depth})${topInsight ? `: ${topInsight.text}` : ""}`);
    }
  }

  if (persona.recentFocus.length > 0) {
    lines.push(`Focus: ${persona.recentFocus.slice(0, 3).join(", ")}`);
  }

  const trust = persona.rapport.trustScore;
  if (trust >= 0.7) {
    lines.push("Trust: high (proactive welcome)");
  } else if (trust >= 0.4) {
    lines.push("Trust: building");
  }

  return lines.join("\n");
}
