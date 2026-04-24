import { describe, it, expect } from "vitest";
import { generateInsightCandidates, isCandidateBlacklisted } from "./engine.js";
import { createDefaultPersona } from "../persona/store.js";
import type { PersonaTree } from "../types.js";
import type { InsightEngineInput, InsightCandidate } from "./types.js";

function personaWithDomains(): PersonaTree {
  const persona = createDefaultPersona();
  persona.rapport.trustScore = 0.5;
  persona.rapport.totalExchanges = 10;
  persona.domains = {
    "AI/机器学习": {
      depth: 5,
      recurrence: 10,
      lastMentioned: Date.now(),
      keyInsights: ["Transformer架构", "注意力机制"],
      activeQuestions: ["如何优化推理速度？"],
      connections: [],
      negationSignals: 0,
    },
    "软件架构": {
      depth: 3,
      recurrence: 5,
      lastMentioned: Date.now(),
      keyInsights: ["微服务", "事件驱动"],
      activeQuestions: [],
      connections: [],
      negationSignals: 0,
    },
  };
  persona.pendingQuestions = ["如何将AI模型部署到边缘设备？"];
  return persona;
}

function baseInput(): InsightEngineInput {
  return {
    targetDomains: ["AI/机器学习", "软件架构"],
    recentFocus: [],
    trustScore: 0.5,
    recentInsightIds: [],
    recentInsightContents: [],
  };
}

describe("generateInsightCandidates", () => {
  it("returns empty for empty persona", () => {
    const persona = createDefaultPersona();
    const candidates = generateInsightCandidates(persona, baseInput());
    expect(candidates).toEqual([]);
  });

  it("generates candidates for persona with domains", () => {
    const persona = personaWithDomains();
    const candidates = generateInsightCandidates(persona, baseInput());
    expect(candidates.length).toBeGreaterThan(0);
  });

  it("respects maxCandidates option", () => {
    const persona = personaWithDomains();
    const candidates = generateInsightCandidates(persona, baseInput(), {
      maxCandidates: 1,
    });
    expect(candidates.length).toBeLessThanOrEqual(1);
  });

  it("produces candidates with composite scores", () => {
    const persona = personaWithDomains();
    const candidates = generateInsightCandidates(persona, baseInput());
    for (const c of candidates) {
      expect(c.compositeScore).toBeGreaterThanOrEqual(0);
    }
  });

  it("produces candidates with verification status", () => {
    const persona = personaWithDomains();
    const candidates = generateInsightCandidates(persona, baseInput());
    const validStatuses = new Set(["unverified", "partial", "verified", "contradicted"]);
    for (const c of candidates) {
      expect(validStatuses.has(c.verificationStatus)).toBe(true);
    }
  });

  it("returns candidates sorted by composite score descending", () => {
    const persona = personaWithDomains();
    const candidates = generateInsightCandidates(persona, baseInput(), {
      maxCandidates: 5,
    });
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i].compositeScore).toBeLessThanOrEqual(
        candidates[i - 1].compositeScore,
      );
    }
  });

  it("filters out candidates targeting blacklisted domains", () => {
    const persona = personaWithDomains();
    persona.domainBlacklist = ["AI/机器学习"];
    const candidates = generateInsightCandidates(persona, baseInput(), { maxCandidates: 10 });
    for (const c of candidates) {
      expect(c.targetDomains).not.toContain("AI/机器学习");
      expect(c.sourceDomains).not.toContain("AI/机器学习");
    }
  });

  it("uses persona.domainGraph for cross-domain connections", () => {
    const persona = personaWithDomains();
    // Add a custom domain connected via domainGraph that is NOT in default adjacencies
    persona.domainGraph = {
      nodes: ["AI/机器学习", "软件架构", "CustomDomain"],
      edges: [
        { source: "AI/机器学习", target: "CustomDomain", weight: 0.8, lastObserved: Date.now(), observations: 5 },
        { source: "软件架构", target: "CustomDomain", weight: 0.8, lastObserved: Date.now(), observations: 5 },
      ],
      totalObservations: 10,
    };
    const candidates = generateInsightCandidates(persona, baseInput(), { maxCandidates: 10 });
    const hasCustomDomain = candidates.some(
      (c) => c.sourceDomains.includes("CustomDomain") || c.targetDomains.includes("CustomDomain"),
    );
    expect(hasCustomDomain).toBe(true);
  });

  it("never returns candidates referencing blacklisted domains", () => {
    const persona = personaWithDomains();
    persona.domains["软件架构"].depth = 5;
    persona.domainBlacklist = ["AI/机器学习"];
    const candidates = generateInsightCandidates(persona, baseInput(), { maxCandidates: 10 });
    for (const c of candidates) {
      expect(c.targetDomains).not.toContain("AI/机器学习");
      expect(c.sourceDomains).not.toContain("AI/机器学习");
    }
  });

  it("candidates similar to recentInsightContents get lower serendipity scores", () => {
    const persona = personaWithDomains();
    const similarContent = "你在AI/机器学习领域的洞见（Transformer架构；注意力机制）与软件架构有深层联系";
    const inputWithHistory: InsightEngineInput = {
      ...baseInput(),
      recentInsightContents: [similarContent],
    };
    const inputWithoutHistory = baseInput();

    const candidatesWithHistory = generateInsightCandidates(persona, inputWithHistory, { maxCandidates: 10 });
    const candidatesWithoutHistory = generateInsightCandidates(persona, inputWithoutHistory, { maxCandidates: 10 });

    const withHistAvg = candidatesWithHistory.length > 0
      ? candidatesWithHistory.reduce((s, c) => s + c.compositeScore, 0) / candidatesWithHistory.length
      : 0;
    const withoutHistAvg = candidatesWithoutHistory.length > 0
      ? candidatesWithoutHistory.reduce((s, c) => s + c.compositeScore, 0) / candidatesWithoutHistory.length
      : 0;

    expect(withHistAvg).toBeLessThanOrEqual(withoutHistAvg);
  });
});

describe("isCandidateBlacklisted", () => {
  function makeCandidate(targetDomains: string[], sourceDomains: string[] = []): InsightCandidate {
    return {
      id: "test",
      content: "test",
      rationale: "test",
      targetDomains,
      sourceDomains,
      relevanceScore: 0.5,
      surpriseScore: 0.5,
      compositeScore: 0.5,
      sources: [],
      verificationStatus: "unverified",
    };
  }

  it("returns false when blacklist is empty", () => {
    const candidate = makeCandidate(["AI"]);
    expect(isCandidateBlacklisted(candidate, [])).toBe(false);
  });

  it("returns true when target domain is blacklisted", () => {
    const candidate = makeCandidate(["AI/机器学习"]);
    expect(isCandidateBlacklisted(candidate, ["AI/机器学习"])).toBe(true);
  });

  it("returns true when source domain is blacklisted", () => {
    const candidate = makeCandidate(["软件架构"], ["AI/机器学习"]);
    expect(isCandidateBlacklisted(candidate, ["AI/机器学习"])).toBe(true);
  });

  it("returns false when no domains match blacklist", () => {
    const candidate = makeCandidate(["软件架构"], ["编程语言"]);
    expect(isCandidateBlacklisted(candidate, ["AI/机器学习"])).toBe(false);
  });
});
