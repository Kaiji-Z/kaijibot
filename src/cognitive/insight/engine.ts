import type { PersonaTree } from "../types.js";
import type { InsightEngineInput, InsightCandidate } from "./types.js";
import { scoreSerendipity } from "./serendipity-scorer.js";
import { findCrossDomainConnections, semanticDistance } from "./cross-domain-mapper.js";
import { verifyInsight } from "./verification/pipeline.js";
import { randomUUID } from "node:crypto";

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
  const verificationLevel = options?.verificationLevel ?? "basic";
  const maxCandidates = options?.maxCandidates ?? 3;

  const candidates: InsightCandidate[] = [];

  // Strategy 1: Cross-domain connections
  const userDomains = Object.keys(persona.domains);
  const crossConnections = findCrossDomainConnections(userDomains, undefined, persona.domainGraph);

  for (const conn of crossConnections.slice(0, 2)) {
    const candidate = buildCrossDomainCandidate(conn, persona);
    if (candidate) candidates.push(candidate);
  }

  // Strategy 2: Domain depth insights (connect user's deep domains with current events)
  const deepDomains = Object.entries(persona.domains)
    .filter(([, d]) => d.depth >= 4)
    .sort(([, a], [, b]) => b.depth - a.depth);

  for (const [domainName] of deepDomains.slice(0, 1)) {
    const candidate = buildDomainDepthInsight(domainName);
    if (candidate) candidates.push(candidate);
  }

  // Strategy 4: Exploration — target domains outside user's known graph
  const unknownTargets = input.targetDomains.filter(
    (td) => !persona.domains[td],
  );
  if (userDomains.length > 0 && unknownTargets.length > 0) {
    for (const targetDomain of unknownTargets.slice(0, 1)) {
      const candidate = buildExplorationInsight(targetDomain);
      if (candidate) candidates.push(candidate);
    }
  }

  // Score and rank all candidates
  const scored = candidates.map((c) => {
    const userConnectingDomains = Object.keys(persona.domains)
      .filter((d) => semanticDistance(d, c.targetDomains[0] ?? "") < 1)
      .length;

    const primaryDomain = c.targetDomains[0] ?? "";
    const domainNode = primaryDomain ? persona.domains[primaryDomain] : undefined;
    const topicRecency = domainNode
      ? Math.min(1, (Date.now() - domainNode.lastMentioned) / (7 * 24 * 60 * 60 * 1000))
      : 0.5;

    const score = scoreSerendipity({
      domainRelevance: c.relevanceScore,
      userConnectingDomains,
      isRepeat: input.recentInsightIds.includes(c.id),
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

  // Verify and return top candidates
  return scored
    .filter((c) => !isCandidateBlacklisted(c, persona.domainBlacklist))
    .sort((a, b) => b.compositeScore - a.compositeScore)
    .slice(0, maxCandidates)
    .map((c) => {
      const verification = verifyInsight({
        content: c.content,
        sources: c.sources,
        verificationLevel,
      });
      return { ...c, verificationStatus: verification.status };
    });
}

function buildCrossDomainCandidate(
  conn: { from: string; to: string; bridge: string[] },
  persona: PersonaTree,
): InsightCandidate | undefined {
  const fromDomain = persona.domains[conn.from];
  if (!fromDomain) return undefined;

  const bridgeStr =
    conn.bridge.length > 0 ? ` (通过 ${conn.bridge.join("、")})` : "";
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

function buildDomainDepthInsight(_domainName: string): undefined {
  return undefined;
}

function buildExplorationInsight(_targetDomain: string): undefined {
  return undefined;
}

export function isCandidateBlacklisted(
  candidate: InsightCandidate,
  domainBlacklist: string[] | undefined,
): boolean {
  if (!domainBlacklist || domainBlacklist.length === 0) return false;
  const blacklistSet = new Set(domainBlacklist);
  return (
    candidate.targetDomains.some((d) => blacklistSet.has(d)) ||
    candidate.sourceDomains.some((d) => blacklistSet.has(d))
  );
}
