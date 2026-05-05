/**
 * @deprecated Unused in production. Only referenced by the deprecated template engine
 * (`engine.ts`). The LLM-based pipeline (`llm-engine.ts`) handles scoring inline.
 *
 * Scores insights based on relevance × surprise × novelty.
 *
 * Serendipity = finding valuable things you weren't looking for.
 * An ideal insight is highly relevant to the user BUT connects to something unexpected.
 */

export type SerendipityScore = {
  /** How relevant is this to the user's current interests */
  relevance: number;
  /** How surprising/unexpected is this connection */
  surprise: number;
  /** How new is this (not repeated) */
  novelty: number;
  /** Weighted composite score */
  composite: number;
};

/**
 * Calculate serendipity score for a potential insight.
 */
export function scoreSerendipity(params: {
  /** How well this matches user's active domains (0-1) */
  domainRelevance: number;
  /** How many domains the user already has that connect to this (0 = surprise) */
  userConnectingDomains: number;
  /** Whether this exact insight was delivered before */
  isRepeat: boolean;
  /** How recently a similar topic was discussed (0 = just now, 1 = long ago) */
  topicRecency: number;
  /** User's trust level (higher trust = more tolerance for surprise) */
  trustScore: number;
}): SerendipityScore {
  const { domainRelevance, userConnectingDomains, isRepeat, topicRecency, trustScore } = params;

  // Relevance: direct match with user interests
  const relevance = domainRelevance;

  // Surprise: inversely proportional to existing connections
  const maxConnections = 5;
  const surprise = Math.max(0, 1 - userConnectingDomains / maxConnections);

  // Novelty: penalize repeats, boost fresh topics
  const novelty = isRepeat ? 0 : 0.5 + topicRecency * 0.5;

  // Composite: weighted blend
  // At low trust, weight relevance higher (don't surprise too much)
  // At high trust, weight surprise higher (the user trusts the suggestions)
  const relevanceWeight = 0.4 + (1 - trustScore) * 0.2;
  const surpriseWeight = 0.3 + trustScore * 0.2;
  const noveltyWeight = 0.3;

  const composite =
    relevance * relevanceWeight + surprise * surpriseWeight + novelty * noveltyWeight;

  return { relevance, surprise, novelty, composite };
}
