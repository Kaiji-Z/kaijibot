import { describe, it, expect } from "vitest";
import { extractFromMessage } from "./extractor.js";
import { createDefaultPersona } from "./store.js";

describe("extractFromMessage", () => {
  it("detects domain keywords in messages", () => {
    const result = extractFromMessage(
      "我想用typescript写一个机器学习项目",
      "好的，我们可以用Python或者TypeScript来实现",
    );
    const domainNames = result.domains.map((d) => d.name);
    expect(domainNames).toContain("编程语言");
    expect(domainNames).toContain("AI/机器学习");
  });

  it("extracts explicit self-disclosure as attributes", () => {
    const result = extractFromMessage("我是技术负责人，负责架构设计", "了解了");
    expect(result.attributes.length).toBeGreaterThanOrEqual(1);
    const selfDesc = result.attributes.find((a) => a.field === "identity.coreTraits.自我描述");
    expect(selfDesc).toBeDefined();
    expect(selfDesc?.source).toBe("explicit");
    expect(selfDesc?.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("detects pending questions from user message", () => {
    const result = extractFromMessage("这个方案怎么优化？", "我来帮你分析");
    expect(result.pendingQuestions.length).toBeGreaterThanOrEqual(1);
  });

  it("extracts recent focus phrases", () => {
    const result = extractFromMessage(
      "我想了解微服务架构的最佳实践",
      "微服务架构有几个关键模式",
    );
    expect(result.recentFocus.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty result for empty messages", () => {
    const result = extractFromMessage("", "");
    expect(result.attributes).toEqual([]);
    expect(result.domains).toEqual([]);
  });

  it("assigns higher depth for more keyword matches", () => {
    const result = extractFromMessage(
      "我在做AI人工智能相关的机器学习深度学习项目",
      "好的",
    );
    const aiDomain = result.domains.find((d) => d.name === "AI/机器学习");
    expect(aiDomain).toBeDefined();
    expect(aiDomain?.depth).toBeGreaterThanOrEqual(3);
  });

  it("does not mutate existing persona", () => {
    const persona = createDefaultPersona();
    const originalTraits = { ...persona.identity.coreTraits };
    extractFromMessage("我是工程师", "好的", persona);
    expect(persona.identity.coreTraits).toEqual(originalTraits);
  });
});
