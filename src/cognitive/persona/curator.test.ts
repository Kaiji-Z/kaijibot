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
        negationSignals: 0,
      },
      活跃领域: {
        depth: 5,
        recurrence: 10,
        lastMentioned: Date.now(),
        keyInsights: [],
        activeQuestions: [],
        connections: [],
        negationSignals: 0,
      },
    };
    const result = prunePersona(persona);
    expect(result.domains["过时领域"]).toBeUndefined();
    expect(result.domains["活跃领域"]).toBeDefined();
  });
});

describe("mergeExtraction — domainBlacklist", () => {
  it("adds explicit blacklist requests to domainBlacklist", () => {
    const persona = createDefaultPersona();
    const extraction: ExtractionResult = {
      attributes: [],
      domains: [],
      recentFocus: [],
      blacklistRequests: ["数据科学", "区块链"],
    };
    const result = mergeExtraction(persona, extraction);
    expect(result.domainBlacklist).toContain("数据科学");
    expect(result.domainBlacklist).toContain("区块链");
  });

  it("deduplicates blacklist entries", () => {
    const persona = createDefaultPersona();
    persona.domainBlacklist = ["数据科学"];
    const extraction: ExtractionResult = {
      attributes: [],
      domains: [],
      recentFocus: [],
      blacklistRequests: ["数据科学", "区块链"],
    };
    const result = mergeExtraction(persona, extraction);
    expect(result.domainBlacklist.filter((d) => d === "数据科学")).toHaveLength(1);
    expect(result.domainBlacklist).toContain("区块链");
  });

  it("auto-blacklists domains with 3+ negation signals within 30 days", () => {
    const now = Date.now();
    const persona = createDefaultPersona();
    persona.domains = {
      "数据科学": {
        depth: 3,
        recurrence: 5,
        lastMentioned: now,
        keyInsights: [],
        activeQuestions: [],
        connections: [],
        negationSignals: 3,
        lastNegatedAt: now,
      },
    };
    const extraction: ExtractionResult = {
      attributes: [],
      domains: [],
      recentFocus: [],

    };
    const result = mergeExtraction(persona, extraction, now);
    expect(result.domainBlacklist).toContain("数据科学");
    expect(result.domains["数据科学"]).toBeUndefined();
  });

  it("does not auto-blacklist domains with < 3 negation signals", () => {
    const now = Date.now();
    const persona = createDefaultPersona();
    persona.domains = {
      "数据科学": {
        depth: 3,
        recurrence: 5,
        lastMentioned: now,
        keyInsights: [],
        activeQuestions: [],
        connections: [],
        negationSignals: 2,
        lastNegatedAt: now,
      },
    };
    const extraction: ExtractionResult = {
      attributes: [],
      domains: [],
      recentFocus: [],

    };
    const result = mergeExtraction(persona, extraction, now);
    expect(result.domainBlacklist).not.toContain("数据科学");
    expect(result.domains["数据科学"]).toBeDefined();
  });

  it("does not auto-blacklist domains with old negation signals (> 30 days)", () => {
    const now = Date.now();
    const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000;
    const persona = createDefaultPersona();
    persona.domains = {
      "数据科学": {
        depth: 3,
        recurrence: 5,
        lastMentioned: now,
        keyInsights: [],
        activeQuestions: [],
        connections: [],
        negationSignals: 5,
        lastNegatedAt: thirtyOneDaysAgo,
      },
    };
    const extraction: ExtractionResult = {
      attributes: [],
      domains: [],
      recentFocus: [],

    };
    const result = mergeExtraction(persona, extraction, now);
    expect(result.domainBlacklist).not.toContain("数据科学");
  });

  it("removes blacklisted domains from the result", () => {
    const now = Date.now();
    const persona = createDefaultPersona();
    persona.domainBlacklist = ["AI/机器学习"];
    persona.domains = {
      "AI/机器学习": {
        depth: 5,
        recurrence: 10,
        lastMentioned: now,
        keyInsights: [],
        activeQuestions: [],
        connections: [],
        negationSignals: 0,
      },
      "软件架构": {
        depth: 3,
        recurrence: 5,
        lastMentioned: now,
        keyInsights: [],
        activeQuestions: [],
        connections: [],
        negationSignals: 0,
      },
    };
    const extraction: ExtractionResult = {
      attributes: [],
      domains: [],
      recentFocus: [],

    };
    const result = mergeExtraction(persona, extraction, now);
    expect(result.domains["AI/机器学习"]).toBeUndefined();
    expect(result.domains["软件架构"]).toBeDefined();
  });

  it("does not merge extraction domains that match blacklist", () => {
    const now = Date.now();
    const persona = createDefaultPersona();
    persona.domainBlacklist = ["AI/机器学习"];
    const extraction: ExtractionResult = {
      attributes: [],
      domains: [
        { name: "AI/机器学习", depth: 5, insights: [], questions: [] },
        { name: "软件架构", depth: 3, insights: [], questions: [] },
      ],
      recentFocus: [],

    };
    const result = mergeExtraction(persona, extraction, now);
    expect(result.domains["AI/机器学习"]).toBeUndefined();
    expect(result.domains["软件架构"]).toBeDefined();
  });

  it("preserves existing domainBlacklist when no new requests", () => {
    const persona = createDefaultPersona();
    persona.domainBlacklist = ["数据科学"];
    const extraction: ExtractionResult = {
      attributes: [],
      domains: [],
      recentFocus: [],

    };
    const result = mergeExtraction(persona, extraction);
    expect(result.domainBlacklist).toContain("数据科学");
  });

  it("preserves pure-Chinese recentFocus entries through merge", () => {
    const persona = createDefaultPersona();
    const extraction: ExtractionResult = {
      attributes: [],
      domains: [],
      recentFocus: ["机器学习", "深度学习", "人工智能"],

    };
    const result = mergeExtraction(persona, extraction);
    expect(result.recentFocus).toContain("机器学习");
    expect(result.recentFocus).toContain("深度学习");
    expect(result.recentFocus).toContain("人工智能");
  });

  it("filters garbage from recentFocus during merge", () => {
    const persona = createDefaultPersona();
    persona.recentFocus = ["```json", "```", "机器学习", "if one is provided", "mannerisms"];
    const extraction: ExtractionResult = {
      attributes: [],
      domains: [],
      recentFocus: ["数据科学"],

    };
    const result = mergeExtraction(persona, extraction);
    expect(result.recentFocus).not.toContain("```json");
    expect(result.recentFocus).not.toContain("```");
    expect(result.recentFocus).not.toContain("if one is provided");
    expect(result.recentFocus).not.toContain("mannerisms");
    expect(result.recentFocus).toContain("机器学习");
    expect(result.recentFocus).toContain("数据科学");
  });

  it("keeps valid English tech terms in recentFocus but rejects noise", () => {
    const persona = createDefaultPersona();
    persona.recentFocus = ["kubernetes", "machine learning", "the", "is not"];
    const extraction: ExtractionResult = {
      attributes: [],
      domains: [],
      recentFocus: ["docker", "if available", "typescript"],

    };
    const result = mergeExtraction(persona, extraction);
    expect(result.recentFocus).toContain("kubernetes");
    expect(result.recentFocus).toContain("machine learning");
    expect(result.recentFocus).toContain("docker");
    expect(result.recentFocus).toContain("typescript");
    expect(result.recentFocus).not.toContain("the");
    expect(result.recentFocus).not.toContain("is not");
    expect(result.recentFocus).not.toContain("if available");
  });
});
