import { describe, it, expect } from "vitest";
import { generateInsightCandidates } from "./engine.js";
import { createDefaultPersona } from "../persona/store.js";
import type { PersonaTree } from "../types.js";
import type { InsightEngineInput } from "./types.js";

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
    },
    "软件架构": {
      depth: 3,
      recurrence: 5,
      lastMentioned: Date.now(),
      keyInsights: ["微服务", "事件驱动"],
      activeQuestions: [],
      connections: [],
    },
  };
  persona.pendingQuestions = ["如何将AI模型部署到边缘设备？"];
  return persona;
}

function baseInput(): InsightEngineInput {
  return {
    targetDomains: ["AI/机器学习", "软件架构"],
    recentFocus: [],
    pendingQuestions: [],
    trustScore: 0.5,
    recentInsightIds: [],
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
});
