/**
 * Isolated integration test for the cognitive insight pipeline improvements.
 *
 * Tests the full pipeline flow with mock LLM and mock web search,
 * verifying the three recent improvements work end-to-end:
 *   1. EXTERNAL_FACTS anchor injection
 *   2. Semantic dedup via domain overlap
 *   3. Domain matching alias expansion
 *
 * Run: pnpm test src/cognitive/insight/insight-improvements.test.ts
 */

import { describe, it, expect } from "vitest";
import { buildInsightPrompt, generateInsightCandidatesLLM } from "./llm-engine.js";
import type { LlmInsightDeps, WebSearchResult } from "./llm-engine.js";
import { ProactiveScheduler } from "../scheduler/proactive-scheduler.js";
import type { PersonaTree } from "../types.js";
import type { InsightEngineInput } from "./types.js";
import type { InsightCandidate } from "./types.js";
import { createDefaultPersona } from "../persona/store.js";

// ─── Test Personas ─────────────────────────────────────────────────────

function makeTestPersona(): PersonaTree {
  const now = Date.now();
  return {
    identity: {
      displayName: "测试用户",
      coreTraits: {
        technical: { value: "高", confidence: 0.9, evidenceCount: 10, lastUpdated: now, source: "inferred" },
      },
      expertDomains: ["AI/机器学习", "TypeScript"],
      interestDomains: ["认知架构"],
      curiosityDomains: [],
    },
    domains: {
      "TypeScript": {
        depth: 5,
        recurrence: 20,
        lastMentioned: now - 1000 * 60 * 10,
        keyInsights: ["decorator pattern", "template literal types", "Zod schema validation"],
        activeQuestions: [],
        negationSignals: 0,
      },
      "MCP": {
        depth: 3,
        recurrence: 5,
        lastMentioned: now - 1000 * 60 * 60,
        keyInsights: ["Model Context Protocol", "tool schema design"],
        activeQuestions: [],
        negationSignals: 0,
      },
      "Rust": {
        depth: 4,
        recurrence: 8,
        lastMentioned: now - 1000 * 60 * 30,
        keyInsights: ["borrow checker", "zero-cost abstractions"],
        activeQuestions: [],
        negationSignals: 0,
      },
    },
    recentFocus: ["认知层改进", "洞察质量"],
    feedbackProfile: {
      topicBandits: {},
      optimalFrequencyHours: 2,
      lastProactiveAt: now - 8 * 3600_000,
      recentInsightIds: [],
      recentInsightContents: [],
      recentInsightDomains: [],
      recentInsightTypes: [],
    },
    rapport: { trustScore: 0.9, totalExchanges: 200, avgResponseLength: 200, selfDisclosureLevel: 1 },
    domainGraph: {
      nodes: ["TypeScript", "MCP", "Rust"],
      edges: [
        { source: "TypeScript", target: "MCP", weight: 0.5, lastObserved: now, observations: 4 },
      ],
      totalObservations: 4,
    },
    moodHistory: [],
    domainBlacklist: [],
    lifecycle: { stage: "active", lastActiveAt: now - 2 * 3600_000, lastStageTransitionAt: now, totalActiveDays: 30 },
    calibrationHistory: [],
  };
}

function makeInput(targetDomains: string[]): InsightEngineInput {
  return {
    targetDomains,
    recentFocus: ["认知层改进"],
    trustScore: 0.9,
    recentInsightIds: [],
    recentInsightContents: [],
  };
}

// ─── Mock Factories ────────────────────────────────────────────────────

function makeMockDeps(
  options?: {
    llmResponse?: string;
    webResults?: WebSearchResult[];
  },
): LlmInsightDeps {
  return {
    complete: async () =>
      ({
        role: "assistant" as const,
        content: [{
          type: "text" as const,
          text: options?.llmResponse ?? JSON.stringify([{
            content: "TypeScript的decorator pattern和MCP的tool schema design本质上在做同一件事——用声明式的方式定义行为边界。差别在于前者在编译时生效，后者在运行时由LLM解析。",
            rationale: "Connects TypeScript and MCP domains via shared design pattern",
            targetDomains: ["TypeScript", "MCP"],
            sourceDomains: ["Rust"],
            relevanceScore: 0.9,
            surpriseScore: 0.7,
          }]),
        }],
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, total: 0 } },
        model: "test",
        provider: "test",
        api: {},
        stopReason: "stop",
        timestamp: Date.now(),
      }) as any,
    prepareModel: async () =>
      ({ model: {}, auth: { apiKey: "test", providerId: "test", source: "test", mode: "api-key" as const } }) as any,
    webSearch: options?.webResults
      ? async () => options.webResults!
      : undefined,
  };
}

// ═════════════════════════════════════════════════════════════════════════
// TEST SUITE 1: EXTERNAL_FACTS Anchor Injection
// ═════════════════════════════════════════════════════════════════════════

describe("Improvement #1: EXTERNAL_FACTS anchor injection", () => {
  it("web search snippets appear in EXTERNAL_FACTS block, not inline", () => {
    const persona = makeTestPersona();
    const input = makeInput(["TypeScript"]);
    const webResults: WebSearchResult[] = [
      { title: "TypeScript 5.5 decorators are stable", url: "https://example.com/ts", snippet: "Stage 3 decorator proposal is now stable" },
    ];

    const { prompt } = buildInsightPrompt(persona, input, webResults, []);

    // Should have EXTERNAL_FACTS block
    expect(prompt).toContain("EXTERNAL_FACTS");
    expect(prompt).toContain("Stage 3 decorator proposal is now stable");
    // Should have prioritization instruction
    expect(prompt).toContain("Use external facts as supporting evidence");
    // Should NOT have inline news:
    expect(prompt).not.toMatch(/news:.*decorator/);
  });

  it("no EXTERNAL_FACTS block when no web results", () => {
    const persona = makeTestPersona();
    const input = makeInput(["TypeScript"]);

    const { prompt } = buildInsightPrompt(persona, input, [], []);

    expect(prompt).not.toContain("EXTERNAL_FACTS");
    // SPECIFIC FACTS should still be present
    expect(prompt).toContain("SPECIFIC FACTS");
  });

  it("full pipeline with mock LLM: web results flow through to insight", async () => {
    const persona = makeTestPersona();
    const input = makeInput(["TypeScript", "MCP"]);

    const deps = makeMockDeps({
      webResults: [
        { title: "TypeScript decorator metadata", url: "https://example.com/1", snippet: "New decorator metadata API in TS 5.5" },
        { title: "Model Context Protocol tools", url: "https://example.com/2", snippet: "MCP tool schema v2 released" },
      ],
    });

    const candidates = await generateInsightCandidatesLLM(persona, input, {} as any, deps);

    expect(candidates.length).toBeGreaterThan(0);
    // The insight should have web sources attached
    expect(candidates[0]!.sources.length).toBe(2);
    // The LLM response is a valid insight
    expect(candidates[0]!.content.length).toBeGreaterThan(10);
  });

  it("web results across multiple domains all appear in EXTERNAL_FACTS", () => {
    const persona = makeTestPersona();
    const input = makeInput(["TypeScript", "Rust"]);

    const webResults: WebSearchResult[] = [
      { title: "TypeScript 5.5 types", url: "https://a.com", snippet: "TS type predicates" },
      { title: "Rust borrow checker", url: "https://b.com", snippet: "New borrow checker rules" },
    ];

    const { prompt } = buildInsightPrompt(persona, input, webResults, []);

    expect(prompt).toContain("EXTERNAL_FACTS");
    expect(prompt).toContain("TS type predicates");
    expect(prompt).toContain("New borrow checker rules");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// TEST SUITE 2: Semantic Dedup via Domain Overlap
// ═════════════════════════════════════════════════════════════════════════

describe("Improvement #2: Semantic dedup via domain overlap", () => {
  const config = {
    minIntervalHours: 4,
    minTrustScore: 0.3,
  };

  it("isTopicStale blocks opportunity that duplicates recent domain", async () => {
    const { isTopicStale } = await import("../scheduler/proactive-scheduler.js");

    const opportunity = {
      type: "domain_depth" as const,
      targetDomains: ["TypeScript"],
      sourceDomains: [],
      pNeed: 0.5,
      pAccept: 0.7,
      pAct: 0.35,
    };

    expect(isTopicStale(opportunity, [], [["TypeScript"]])).toBe(true);
    expect(isTopicStale(opportunity, [], [["Rust"]])).toBe(false);
  });

  it("full pipeline: allows insight targeting different domain", async () => {
    const persona = makeTestPersona();
    persona.feedbackProfile.recentInsightDomains = [["Rust"]];

    const fakeInsight: InsightCandidate = {
      id: "new-1",
      content: "MCP的tool schema设计借鉴了TypeScript的decorator pattern思路...",
      rationale: "cross-domain",
      targetDomains: ["MCP", "TypeScript"],
      sourceDomains: ["Rust"],
      relevanceScore: 0.8,
      surpriseScore: 0.5,
      compositeScore: 0.65,
      sources: [{ url: "https://example.com", title: "Test", credibility: 0.8 }],
      verificationStatus: "verified",
    };

    const scheduler = new ProactiveScheduler(config, {
      loadPersona: async () => persona,
      onInsightReady: async () => {},
      savePersona: async () => {},
    }, { insightGenerator: async () => [fakeInsight] });

    const result = await scheduler.processEvent("user1", {
      type: "timer",
      timestamp: Date.now(),
    });

    expect(result).toBeDefined();
    expect(result!.content).toContain("MCP");
  });

  it("full pipeline: stores domains and types after successful delivery", async () => {
    const persona = makeTestPersona();
    let savedPersona: PersonaTree | undefined;

    const fakeInsight: InsightCandidate = {
      id: "deliver-1",
      content: "Rust的零成本抽象和TypeScript的Zod验证做的是同一件事...",
      rationale: "cross-domain",
      targetDomains: ["Rust", "TypeScript"],
      sourceDomains: [],
      relevanceScore: 0.9,
      surpriseScore: 0.7,
      compositeScore: 0.8,
      sources: [{ url: "https://example.com", title: "Test", credibility: 0.8 }],
      verificationStatus: "verified",
    };

    const scheduler = new ProactiveScheduler(config, {
      loadPersona: async () => persona,
      onInsightReady: async () => {},
      savePersona: async (_userId, p) => { savedPersona = p; },
    }, { insightGenerator: async () => [fakeInsight] });

    const result = await scheduler.processEvent("user1", {
      type: "info_scan",
      timestamp: Date.now(),
    });

    expect(result).toBeDefined();
    expect(savedPersona).toBeDefined();
    expect(savedPersona!.feedbackProfile.recentInsightDomains).toContainEqual(["Rust", "TypeScript"]);
    expect(savedPersona!.feedbackProfile.recentInsightTypes).toBeDefined();
    expect(savedPersona!.feedbackProfile.recentInsightTypes!.length).toBeGreaterThan(0);
    expect(savedPersona!.feedbackProfile.recentInsightContents).toContain(fakeInsight.content);
  });

  it("full pipeline: prevents two insights on same domain in sequence", async () => {
    const persona = makeTestPersona();
    const savedPersonas: PersonaTree[] = [];

    const insight1: InsightCandidate = {
      id: "seq-1",
      content: "TypeScript decorator 在编译时的类型推断很强大...",
      rationale: "test",
      targetDomains: ["TypeScript"],
      sourceDomains: [],
      relevanceScore: 0.8,
      surpriseScore: 0.5,
      compositeScore: 0.65,
      sources: [{ url: "https://example.com", title: "Test", credibility: 0.8 }],
      verificationStatus: "verified",
    };

    const insight2: InsightCandidate = {
      id: "seq-2",
      content: "TypeScript的template literal types其实可以做parser combinator...",
      rationale: "test",
      targetDomains: ["TypeScript"],
      sourceDomains: [],
      relevanceScore: 0.8,
      surpriseScore: 0.5,
      compositeScore: 0.65,
      sources: [{ url: "https://example.com", title: "Test", credibility: 0.8 }],
      verificationStatus: "verified",
    };

    const scheduler = new ProactiveScheduler(config, {
      loadPersona: async () => {
        // Return latest saved persona (simulates reload from disk)
        return savedPersonas.length > 0 ? savedPersonas[savedPersonas.length - 1]! : persona;
      },
      onInsightReady: async () => {},
      savePersona: async (_userId, p) => { savedPersonas.push(p); },
    }, {
      insightGenerator: async () => {
        // First call returns insight1, second returns insight2
        if (savedPersonas.length === 0) return [insight1];
        return [insight2];
      },
    });

    // First delivery should succeed
    const result1 = await scheduler.processEvent("user1", { type: "timer", timestamp: Date.now() });
    expect(result1).toBeDefined();

    // Second delivery to same domain should be blocked
    const result2 = await scheduler.processEvent("user1", { type: "timer", timestamp: Date.now() });
    expect(result2).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════
// TEST SUITE 3: Domain Matching Alias Expansion
// ═════════════════════════════════════════════════════════════════════════

describe("Improvement #3: Domain matching alias expansion", () => {
  it("matches web result by full keyInsight phrase", () => {
    const persona = makeTestPersona();
    const input = makeInput(["MCP"]);

    // Domain "MCP" has keyInsight "Model Context Protocol"
    // Web result doesn't mention "MCP" but mentions the full phrase
    const webResults: WebSearchResult[] = [
      { title: "Model Context Protocol specification v2.0", url: "https://example.com", snippet: "The MCP spec has been updated with new tool schemas" },
    ];

    const { prompt } = buildInsightPrompt(persona, input, webResults, []);

    // Should match via "model context protocol" alias from keyInsight
    expect(prompt).toContain("EXTERNAL_FACTS");
    expect(prompt).toContain("MCP spec has been updated");
  });

  it("matches web result by single word extracted from keyInsight", () => {
    const persona = makeTestPersona();
    const input = makeInput(["TypeScript"]);

    // Domain "TypeScript" has keyInsight "decorator pattern"
    // Web result mentions "decorator" (extracted as ≥3 char word)
    const webResults: WebSearchResult[] = [
      { title: "New TC39 decorator stage 3 update", url: "https://example.com", snippet: "Decorator metadata reflection API progresses" },
    ];

    const { prompt } = buildInsightPrompt(persona, input, webResults, []);

    expect(prompt).toContain("EXTERNAL_FACTS");
    expect(prompt).toContain("Decorator metadata reflection");
  });

  it("does NOT match unrelated web results", () => {
    const persona = makeTestPersona();
    const input = makeInput(["Rust"]);

    // Web result about cooking (no overlap with Rust/borrow checker/zero-cost)
    const webResults: WebSearchResult[] = [
      { title: "Best restaurants in San Francisco", url: "https://example.com", snippet: "Top 10 places to eat in the bay area" },
    ];

    const { prompt } = buildInsightPrompt(persona, input, webResults, []);

    // Should NOT match (no keyword overlap)
    expect(prompt).not.toContain("EXTERNAL_FACTS");
    // But the prompt itself should still be valid
    expect(prompt).toContain("SPECIFIC FACTS");
  });

  it("still matches by domain name as baseline (regression)", () => {
    const persona = makeTestPersona();
    const input = makeInput(["Rust"]);

    // No keyInsight overlap, but domain name "Rust" is in the title
    const webResults: WebSearchResult[] = [
      { title: "Rust 2026 edition roadmap", url: "https://example.com", snippet: "What's coming in the next Rust edition" },
    ];

    const { prompt } = buildInsightPrompt(persona, input, webResults, []);

    expect(prompt).toContain("EXTERNAL_FACTS");
    expect(prompt).toContain("next Rust edition");
  });

  it("alias matching works end-to-end through generateInsightCandidatesLLM", async () => {
    const persona = makeTestPersona();
    const input = makeInput(["MCP"]);

    const deps = makeMockDeps({
      webResults: [
        { title: "Model Context Protocol tools design", url: "https://example.com", snippet: "MCP v2 tool schema allows nested objects" },
      ],
    });

    // This should NOT throw and should produce candidates with sources
    const candidates = await generateInsightCandidatesLLM(persona, input, {} as any, deps);

    expect(candidates.length).toBeGreaterThan(0);
    // Sources should be attached from web results
    expect(candidates[0]!.sources.length).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// TEST SUITE 4: Combined End-to-End Pipeline
// ═════════════════════════════════════════════════════════════════════════

describe("Combined: full pipeline with all 3 improvements", () => {
  const config = {
    minIntervalHours: 4,
    minTrustScore: 0.3,
  };

  it("generates insight with EXTERNAL_FACTS, dedup blocks repeat, alias expands matching", async () => {
    const persona = makeTestPersona();
    const savedPersonas: PersonaTree[] = [];

    const deps = makeMockDeps({
      webResults: [
        { title: "Model Context Protocol v2 tools", url: "https://example.com/1", snippet: "MCP tool schema supports async validation" },
        { title: "Rust borrow checker update", url: "https://example.com/2", snippet: "New NLL rules in Rust 2026" },
        { title: "TypeScript decorator metadata", url: "https://example.com/3", snippet: "Decorator reflection API stable" },
      ],
      llmResponse: JSON.stringify([
        {
          content: "MCP的tool schema设计跟Rust的borrow checker其实在做同一件事——在边界上做静态验证。只不过MCP验证的是LLM输入的schema，Rust验证的是内存的ownership。",
          rationale: "Cross-domain connection between MCP and Rust",
          targetDomains: ["MCP", "Rust"],
          sourceDomains: ["TypeScript"],
          relevanceScore: 0.9,
          surpriseScore: 0.8,
        },
      ]),
    });

    // Step 1: Generate prompt and verify alias matching + EXTERNAL_FACTS
    const input = makeInput(["MCP", "Rust"]);
    const { prompt } = buildInsightPrompt(persona, input, [
      { title: "Model Context Protocol v2 tools", url: "https://example.com/1", snippet: "MCP tool schema supports async validation" },
      { title: "Rust borrow checker update", url: "https://example.com/2", snippet: "New NLL rules in Rust 2026" },
    ], persona.feedbackProfile.recentInsightContents);

    // Alias: "Model Context Protocol" from keyInsight should match the first result
    expect(prompt).toContain("EXTERNAL_FACTS");
    // Domain name "Rust" should match the second result
    expect(prompt).toContain("New NLL rules");
    // Prioritization instruction present
    expect(prompt).toContain("Use external facts as supporting evidence");

    // Step 2: Run full pipeline
    const insight1: InsightCandidate = {
      id: "e2e-1",
      content: "MCP的tool schema设计跟Rust的borrow checker其实在做同一件事——在边界上做静态验证。",
      rationale: "cross-domain",
      targetDomains: ["MCP", "Rust"],
      sourceDomains: ["TypeScript"],
      relevanceScore: 0.9,
      surpriseScore: 0.8,
      compositeScore: 0.85,
      sources: [
        { url: "https://example.com/1", title: "Model Context Protocol v2 tools", credibility: 0.5 },
        { url: "https://example.com/2", title: "Rust borrow checker update", credibility: 0.5 },
      ],
      verificationStatus: "verified",
    };

    const scheduler = new ProactiveScheduler(config, {
      loadPersona: async () => {
        return savedPersonas.length > 0 ? savedPersonas[savedPersonas.length - 1]! : persona;
      },
      onInsightReady: async () => {},
      savePersona: async (_userId, p) => { savedPersonas.push(p); },
    }, {
      insightGenerator: async () => [insight1],
    });

    // First delivery: should succeed (no recent insights)
    const result1 = await scheduler.processEvent("user1", { type: "timer", timestamp: Date.now() });
    expect(result1).toBeDefined();
    expect(result1!.targetDomains).toContain("MCP");
    expect(result1!.sources.length).toBe(2);

    // Verify persona saved with dedup metadata
    const saved = savedPersonas[0]!;
    expect(saved.feedbackProfile.recentInsightDomains).toContainEqual(["MCP", "Rust"]);

    // Step 3: Try same domains again — dedup should block
    const insight2: InsightCandidate = {
      id: "e2e-2",
      content: "Rust的NLL规则和MCP的schema验证都是声明式的边界检查...",
      rationale: "duplicate",
      targetDomains: ["Rust", "MCP"], // Same domains, different order
      sourceDomains: [],
      relevanceScore: 0.8,
      surpriseScore: 0.5,
      compositeScore: 0.65,
      sources: [{ url: "https://example.com", title: "Test", credibility: 0.8 }],
      verificationStatus: "verified",
    };

    const scheduler2 = new ProactiveScheduler(config, {
      loadPersona: async () => savedPersonas[savedPersonas.length - 1]!,
      onInsightReady: async () => {},
      savePersona: async () => {},
    }, {
      insightGenerator: async () => [insight2],
    });

    const result2 = await scheduler2.processEvent("user1", { type: "timer", timestamp: Date.now() });
    expect(result2).toBeUndefined(); // Dedup blocks

    // Step 4: Different domain should pass dedup
    const insight3: InsightCandidate = {
      id: "e2e-3",
      content: "TypeScript的Zod验证其实是从Rust的serde思路迁移过来的...",
      rationale: "cross-domain",
      targetDomains: ["TypeScript"],
      sourceDomains: ["Rust"],
      relevanceScore: 0.9,
      surpriseScore: 0.7,
      compositeScore: 0.8,
      sources: [{ url: "https://example.com", title: "Test", credibility: 0.8 }],
      verificationStatus: "verified",
    };

    const latestPersona = savedPersonas[savedPersonas.length - 1]!;
    latestPersona.feedbackProfile.lastProactiveAt = Date.now() - 8 * 3600_000;

    const scheduler3 = new ProactiveScheduler(config, {
      loadPersona: async () => latestPersona,
      onInsightReady: async () => {},
      savePersona: async () => {},
    }, {
      insightGenerator: async () => [insight3],
    });

    const result3 = await scheduler3.processEvent("user1", { type: "timer", timestamp: Date.now() });
    expect(result3).toBeDefined(); // Different domain → passes
    expect(result3!.content).toContain("TypeScript");
  });
});
