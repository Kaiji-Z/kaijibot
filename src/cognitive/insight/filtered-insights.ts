import type { DomainNode, InsightCategory } from "../types.js";

/**
 * Categories excluded from insight consumption by default. The legacy
 * 6-category model (tool_config, contextual_fact, ...) collapses into
 * "ephemeral" via migrateInsightCategory, so excluding ephemeral subsumes it.
 */
const EXCLUDED_INSIGHT_CATEGORIES: ReadonlySet<InsightCategory> = new Set(["ephemeral"]);

export function getFilteredInsights(
  domain: DomainNode,
  exclude: ReadonlySet<InsightCategory> = EXCLUDED_INSIGHT_CATEGORIES,
): string[] {
  if (domain.insights && domain.insights.length > 0) {
    return domain.insights
      .filter((i) => !exclude.has(i.category))
      .toSorted((a, b) => b.confidence * b.evidenceCount - a.confidence * a.evidenceCount)
      .map((i) => i.text);
  }
  return domain.keyInsights;
}
