import { randomUUID } from "node:crypto";
import type { PersonaTree } from "../types.js";
import { isDuplicateBySemanticOverlap } from "./content-similarity.js";
import { findCrossDomainConnections, semanticDistance } from "./cross-domain-mapper.js";
import { scoreSerendipity } from "./serendipity-scorer.js";
import type { InsightEngineInput, InsightCandidate } from "./types.js";

/**
 * Insight engine — generates personalized insight candidates.
 *
 * Phase 3: Template-based insight generation using persona + cross-domain mapping.
 * Phase 4 will add LLM-based generation.
 */
export function generateInsightCandidates(
  persona: PersonaTree,
  input: InsightEngineInput,
  options?: {
    verificationLevel?: "basic" | "strict" | "paranoid";
    maxCandidates?: number;
  },
): InsightCandidate[] {
  const maxCandidates = options?.maxCandidates ?? 3;

  const candidates: InsightCandidate[] = [];

  // Strategy 1: Cross-domain connections
  const userDomains = Object.keys(persona.domains);
  const crossConnections = findCrossDomainConnections(userDomains, undefined);

  for (const conn of crossConnections.slice(0, 2)) {
    const candidate = buildCrossDomainCandidate(conn, persona);
    if (candidate) {
      candidates.push(candidate);
    }
  }

  // NOTE: the template fallback engine previously also looped over deep
  // domains and unknown-target domains calling stub builders that always
  // returned undefined — dead branches removed. The LLM pipeline is the
  // production generator; this template path only produces cross-domain
  // candidates.

  // Score and rank all candidates
  const scored = candidates.map((c) => {
    const userConnectingDomains = Object.keys(persona.domains).filter(
      (d) => semanticDistance(d, c.targetDomains[0] ?? "") < 1,
    ).length;

    const primaryDomain = c.targetDomains[0] ?? "";
    const domainNode = primaryDomain ? persona.domains[primaryDomain] : undefined;
    const topicRecency = domainNode
      ? Math.min(1, (Date.now() - domainNode.lastMentioned) / (7 * 24 * 60 * 60 * 1000))
      : 0.5;

    const score = scoreSerendipity({
      domainRelevance: c.relevanceScore,
      userConnectingDomains,
      isRepeat: isDuplicateBySemanticOverlap(c.content, input.recentInsightContents),
      topicRecency,
      trustScore: persona.rapport.trustScore,
    });

    return {
      ...c,
      relevanceScore: score.relevance,
      surpriseScore: score.surprise,
      compositeScore: score.composite,
    };
  });

  return scored
    .filter((c) => !isCandidateBlacklisted(c, persona.domainBlacklist))
    .toSorted((a, b) => b.compositeScore - a.compositeScore)
    .slice(0, maxCandidates)
    .map((c) => ({ ...c, verificationStatus: "unverified" as const }));
}

function buildCrossDomainCandidate(
  conn: { from: string; to: string; bridge: string[] },
  persona: PersonaTree,
): InsightCandidate | undefined {
  const fromDomain = persona.domains[conn.from];
  if (!fromDomain) {
    return undefined;
  }

  const bridgeStr = conn.bridge.length > 0 ? ` (通过 ${conn.bridge.join("、")})` : "";
  const insights = fromDomain.keyInsights.slice(0, 2).join("；");

  return {
    id: randomUUID(),
    content: `你在${conn.from}领域的洞见（${insights}）与${conn.to}有深层联系${bridgeStr}。这两个领域的交叉正在产生新的可能性。`,
    rationale: `用户在 ${conn.from} 有深度 ${fromDomain.depth}，但尚未探索 ${conn.to}。跨领域连接可能带来启发性思考。`,
    targetDomains: [conn.from],
    sourceDomains: [conn.to],
    relevanceScore: 0.7,
    surpriseScore: 0.8,
    compositeScore: 0,
    sources: [],
    verificationStatus: "unverified",
  };
}

export function isCandidateBlacklisted(
  candidate: InsightCandidate,
  domainBlacklist: string[] | undefined,
): boolean {
  if (!domainBlacklist || domainBlacklist.length === 0) {
    return false;
  }
  const blacklistSet = new Set(domainBlacklist);
  return (
    candidate.targetDomains.some((d) => blacklistSet.has(d)) ||
    candidate.sourceDomains.some((d) => blacklistSet.has(d))
  );
}
