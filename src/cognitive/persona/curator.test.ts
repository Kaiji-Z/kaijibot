import { describe, it, expect } from "vitest";
import { createDefaultPersona } from "./store.js";
import { mergeExtraction, prunePersona } from "./curator.js";
import type { ExtractionResult } from "./types.js";

describe("mergeExtraction", () => {
  it("adds new core traits from extraction", () => {
    const persona = createDefaultPersona();
    const extraction: ExtractionResult = {
      attributes: [
        {
          field: "identity.coreTraits.技术决策者",
          value: "是",
          confidence: 0.8,
          source: "explicit",
          evidence: "我是技术负责人",
        },
      ],
      domains: [],
      recentFocus: ["AI架构"],
      pendingQuestions: [],
    };
    const result = mergeExtraction(persona, extraction);
    expect(result.identity.coreTraits["技术决策者"].value).toBe("是");
    expect(result.identity.coreTraits["技术决策者"].evidenceCount).toBe(1);
  });

  it("increments evidence count on repeated traits", () => {
    const persona = createDefaultPersona();
    const extraction: ExtractionResult = {
      attributes: [
        {
          field: "identity.coreTraits.技术决策者",
          value: "是",
          confidence: 0.7,
          source: "inferred",
          evidence: "讨论了技术选型",
        },
      ],
      domains: [],
      recentFocus: [],
      pendingQuestions: [],
    };
    const result1 = mergeExtraction(persona, extraction);
    const result2 = mergeExtraction(result1, extraction);
    expect(result2.identity.coreTraits["技术决策者"].evidenceCount).toBe(2);
  });

  it("merges domains and increments recurrence", () => {
    const persona = createDefaultPersona();
    const extraction: ExtractionResult = {
      attributes: [],
      domains: [
        {
          name: "AI/机器学习",
          depth: 5,
          insights: ["偏好 Python"],
          questions: ["如何优化?"],
        },
      ],
      recentFocus: [],
      pendingQuestions: [],
    };
    const result = mergeExtraction(persona, extraction);
    expect(result.domains["AI/机器学习"].recurrence).toBe(1);
    expect(result.domains["AI/机器学习"].keyInsights).toContain("偏好 Python");
  });

  it("increments totalExchanges in rapport", () => {
    const persona = createDefaultPersona();
    const extraction: ExtractionResult = {
      attributes: [],
      domains: [],
      recentFocus: [],
      pendingQuestions: [],
    };
    const result = mergeExtraction(persona, extraction);
    expect(result.rapport.totalExchanges).toBe(1);
  });
});

describe("prunePersona", () => {
  it("removes low-confidence traits after many observations", () => {
    const persona = createDefaultPersona();
    persona.identity.coreTraits = {
      不确定特征: {
        value: "x",
        confidence: 0.1,
        evidenceCount: 10,
        lastUpdated: Date.now(),
        source: "inferred",
      },
      确定特征: {
        value: "y",
        confidence: 0.9,
        evidenceCount: 5,
        lastUpdated: Date.now(),
        source: "explicit",
      },
    };
    const result = prunePersona(persona);
    expect(result.identity.coreTraits["不确定特征"]).toBeUndefined();
    expect(result.identity.coreTraits["确定特征"]).toBeDefined();
  });

  it("removes stale domains", () => {
    const persona = createDefaultPersona();
    const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
    persona.domains = {
      过时领域: {
        depth: 1,
        recurrence: 1,
        lastMentioned: thirtyOneDaysAgo,
        keyInsights: [],
        activeQuestions: [],
        connections: [],
      },
      活跃领域: {
        depth: 5,
        recurrence: 10,
        lastMentioned: Date.now(),
        keyInsights: [],
        activeQuestions: [],
        connections: [],
      },
    };
    const result = prunePersona(persona);
    expect(result.domains["过时领域"]).toBeUndefined();
    expect(result.domains["活跃领域"]).toBeDefined();
  });
});
