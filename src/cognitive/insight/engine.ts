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
  const crossConnections = findCrossDomainConnections(userDomains);

  for (const conn of crossConnections.slice(0, 2)) {
    const candidate = buildCrossDomainCandidate(conn, persona);
    if (candidate) candidates.push(candidate);
  }

  // Strategy 2: Pending questions → insight prompts
  for (const question of persona.pendingQuestions.slice(0, 2)) {
    const candidate = buildQuestionInsightCandidate(question, persona);
    if (candidate) candidates.push(candidate);
  }

  // Strategy 3: Domain depth insights (connect user's deep domains with current events)
  const deepDomains = Object.entries(persona.domains)
    .filter(([, d]) => d.depth >= 4)
    .sort(([, a], [, b]) => b.depth - a.depth);

  for (const [domainName] of deepDomains.slice(0, 1)) {
    const candidate = buildDomainDepthInsight(domainName);
    if (candidate) candidates.push(candidate);
  }

  // Score and rank all candidates
  const scored = candidates.map((c) => {
    const userConnectingDomains = Object.keys(persona.domains)
      .filter((d) => semanticDistance(d, c.targetDomains[0] ?? "") < 1)
      .length;

    const score = scoreSerendipity({
      domainRelevance: c.relevanceScore,
      userConnectingDomains,
      isRepeat: input.recentInsightIds.includes(c.id),
      topicRecency: 0.5,
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

function buildQuestionInsightCandidate(
  question: string,
  persona: PersonaTree,
): InsightCandidate | undefined {
  const domains = Object.entries(persona.domains);
  if (domains.length === 0) return undefined;

  // Find the most relevant domain for this question
  const relevantDomain = domains.find(
    ([name]) => question.includes(name.split("/")[0]) || question.includes(name),
  );
  const domainName = relevantDomain?.[0] ?? domains[0][0];

  return {
    id: randomUUID(),
    content: `关于你的问题"${question.slice(0, 30)}..."——这个问题可以从${domainName}的延伸角度来看。`,
    rationale: `用户有未解答的问题，可能适合从不同角度启发思考。`,
    targetDomains: [domainName],
    sourceDomains: [],
    relevanceScore: 0.9,
    surpriseScore: 0.3,
    compositeScore: 0,
    sources: [],
    verificationStatus: "unverified",
  };
}

function buildDomainDepthInsight(domainName: string): InsightCandidate {
  return {
    id: randomUUID(),
    content: `${domainName}领域最近出现了一些值得关注的新方向。结合你在这个领域的深度理解，这些变化可能会影响你的技术决策。`,
    rationale: `用户在某领域有深度，适合推送该领域的最新动态和趋势。`,
    targetDomains: [domainName],
    sourceDomains: [],
    relevanceScore: 0.8,
    surpriseScore: 0.4,
    compositeScore: 0,
    sources: [],
    verificationStatus: "unverified",
  };
}
