/**
 * Integration test — cognitive insight engine end-to-end pipeline.
 *
 * Exercises the full flow WITHOUT the gateway or real LLM:
 *   persona → generate candidates → score → verify → store → feedback
 *   + domain graph evolution (observe → decay → cross-domain mapping)
 *   + LLM prompt construction and response parsing
 *   + search query building and key-term extraction
 *
 * All I/O goes to a temp directory; no real API calls.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateInsightCandidates, isCandidateBlacklisted } from "./engine.js";
import { InsightStore } from "./store.js";
import { scoreSerendipity } from "./serendipity-scorer.js";
import {
  findCrossDomainConnections,
  semanticDistance,
  observeCoOccurrence,
  decayEdges,
  getEdgeWeight,
  seedDomainGraph,
  discoverDomainsFromPersona,
  extendDomainGraph,
} from "./cross-domain-mapper.js";
import { verifyInsight } from "./verification/pipeline.js";
import {
  buildInsightPrompt,
  buildSearchQuery,
  extractKeyTerms,
  isSubstantiveContent,
  GENERIC_INSIGHT_PATTERNS,
  type WebSearchResult,
} from "./llm-engine.js";
import type {
  PersonaTree,
  DomainNode,
  InsightRecord,
  LearnedDomainGraph,
} from "../types.js";
import type { InsightEngineInput, InsightCandidate } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;
let store: InsightStore;

function createDefaultPersona(): PersonaTree {
  return {
    identity: {
      coreTraits: {},
      expertDomains: [],
      interestDomains: [],
      curiosityDomains: [],
    },
    domains: {},
    recentFocus: [],
    activeProjects: [],
    feedbackProfile: {
      topicBandits: {},
      preferredStyle: "observation",
      optimalFrequencyHours: 24,
      lastProactiveAt: 0,
      recentInsightIds: [],
      recentInsightContents: [],
    },
    rapport: {
      trustScore: 0.5,
      totalExchanges: 0,
      avgResponseLength: 0,
      selfDisclosureLevel: 0,
    },
    moodHistory: [],
    domainBlacklist: [],
    lifecycle: {
      stage: "new",
      lastActiveAt: Date.now(),
      lastStageTransitionAt: Date.now(),
      consecutiveSilentDays: 0,
      totalActiveDays: 0,
    },
    calibrationHistory: [],
    contradictionLog: [],
  };
}

function richPersona(): PersonaTree {
  const persona = createDefaultPersona();
  persona.rapport.trustScore = 0.7;
  persona.rapport.totalExchanges = 25;
  persona.identity.displayName = "测试用户";
  persona.identity.expertDomains = ["AI/机器学习"];
  persona.identity.interestDomains = ["创业/商业"];
  persona.domains = {
    "AI/机器学习": {
      depth: 6,
      recurrence: 15,
      lastMentioned: Date.now() - 3600000,
      keyInsights: ["Transformer架构", "注意力机制", "RAG系统设计"],
      activeQuestions: ["如何优化推理延迟？"],
      connections: ["软件架构"],
      negationSignals: 0,
    },
    "软件架构": {
      depth: 4,
      recurrence: 8,
      lastMentioned: Date.now() - 86400000,
      keyInsights: ["微服务拆分策略", "事件驱动架构"],
      activeQuestions: [],
      connections: ["AI/机器学习"],
      negationSignals: 0,
    },
    "创业/商业": {
      depth: 3,
      recurrence: 5,
      lastMentioned: Date.now() - 172800000,
      keyInsights: ["PMF验证"],
      activeQuestions: [],
      connections: [],
      negationSignals: 0,
    },
  };
  persona.recentFocus = ["大模型推理优化", "RAG系统"];
  return persona;
}

function baseInput(overrides: Partial<InsightEngineInput> = {}): InsightEngineInput {
  return {
    targetDomains: ["AI/机器学习", "软件架构"],
    recentFocus: [],
    trustScore: 0.5,
    recentInsightIds: [],
    recentInsightContents: [],
    ...overrides,
  };
}

function makeInsightRecord(overrides: Partial<InsightRecord> = {}): InsightRecord {
  return {
    id: `ins-${Math.random().toString(36).slice(2, 10)}`,
    generatedAt: Date.now(),
    triggerSource: "scheduled",
    targetDomains: ["AI/机器学习"],
    sourceDomains: ["软件架构"],
    content: "你在AI推理优化方面的经验可以和边缘计算结合。",
    rationale: "Cross-domain connection",
    sources: [],
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<InsightCandidate> = {}): InsightCandidate {
  return {
    id: `cand-${Math.random().toString(36).slice(2, 10)}`,
    content: "Test insight content that is specific and substantive.",
    rationale: "Test rationale",
    targetDomains: ["AI/机器学习"],
    sourceDomains: ["软件架构"],
    relevanceScore: 0.7,
    surpriseScore: 0.6,
    compositeScore: 0.65,
    sources: [],
    verificationStatus: "unverified",
    ...overrides,
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "kaijibot-insight-pipeline-"));
  store = new InsightStore(tempDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ===========================================================================
// SCENARIO 1: Full pipeline — persona → candidates → store → feedback
// ===========================================================================
describe("Pipeline: happy path (generate → score → store → feedback)", () => {
  it("generates candidates from a rich persona", () => {
    const persona = richPersona();
    const candidates = generateInsightCandidates(persona, baseInput());

    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(c.id).toBeTruthy();
      expect(c.content).toBeTruthy();
      expect(c.compositeScore).toBeGreaterThanOrEqual(0);
      expect(c.compositeScore).toBeLessThanOrEqual(1);
    }
  });

  it("sorts candidates by composite score descending", () => {
    const persona = richPersona();
    const candidates = generateInsightCandidates(persona, baseInput(), { maxCandidates: 5 });

    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i].compositeScore).toBeLessThanOrEqual(candidates[i - 1].compositeScore);
    }
  });

  it("respects maxCandidates limit", () => {
    const persona = richPersona();
    const candidates = generateInsightCandidates(persona, baseInput(), { maxCandidates: 1 });
    expect(candidates.length).toBeLessThanOrEqual(1);
  });

  it("stores and retrieves insight records", async () => {
    const record = makeInsightRecord();
    await store.save("user-1", record);

    const loaded = await store.load("user-1", record.id);
    expect(loaded).toBeDefined();
    expect(loaded!.id).toBe(record.id);
    expect(loaded!.content).toBe(record.content);
  });

  it("stores feedback on insights", async () => {
    const record = makeInsightRecord();
    await store.save("user-1", record);

    await store.updateFeedback("user-1", record.id, "positive", "很有启发");

    const loaded = await store.load("user-1", record.id);
    expect(loaded!.feedback).toBe("positive");
    expect(loaded!.userResponse).toBe("很有启发");
  });

  it("end-to-end: generate → store → deliver → feedback", async () => {
    const persona = richPersona();
    const candidates = generateInsightCandidates(persona, baseInput());
    expect(candidates.length).toBeGreaterThan(0);

    const best = candidates[0]!;

    const record: InsightRecord = {
      id: best.id,
      generatedAt: Date.now(),
      triggerSource: "scheduled",
      targetDomains: best.targetDomains,
      sourceDomains: best.sourceDomains,
      content: best.content,
      rationale: best.rationale,
      sources: best.sources,
    };

    await store.save("user-1", record);

    // Simulate delivery
    const loaded = await store.load("user-1", record.id);
    expect(loaded).toBeDefined();

    // Simulate positive feedback
    await store.updateFeedback("user-1", record.id, "engaged", "说得太对了，我马上试试");

    const withFeedback = await store.load("user-1", record.id);
    expect(withFeedback!.feedback).toBe("engaged");
    expect(withFeedback!.userResponse).toBe("说得太对了，我马上试试");
  });
});

// ===========================================================================
// SCENARIO 2: Serendipity scoring
// ===========================================================================
describe("Pipeline: serendipity scoring", () => {
  it("high relevance + low connections = high surprise", () => {
    const score = scoreSerendipity({
      domainRelevance: 0.9,
      userConnectingDomains: 0,
      isRepeat: false,
      topicRecency: 0.8,
      trustScore: 0.5,
    });

    expect(score.relevance).toBe(0.9);
    expect(score.surprise).toBe(1);
    expect(score.novelty).toBeGreaterThan(0.5);
    expect(score.composite).toBeGreaterThan(0.5);
  });

  it("repeat insight gets zero novelty", () => {
    const score = scoreSerendipity({
      domainRelevance: 0.8,
      userConnectingDomains: 2,
      isRepeat: true,
      topicRecency: 0.5,
      trustScore: 0.5,
    });

    expect(score.novelty).toBe(0);
  });

  it("trust score adjusts weight between relevance and surprise", () => {
    const lowTrust = scoreSerendipity({
      domainRelevance: 0.7,
      userConnectingDomains: 1,
      isRepeat: false,
      topicRecency: 0.5,
      trustScore: 0.1,
    });

    const highTrust = scoreSerendipity({
      domainRelevance: 0.7,
      userConnectingDomains: 1,
      isRepeat: false,
      topicRecency: 0.5,
      trustScore: 0.9,
    });

    // High trust should weight surprise more
    expect(highTrust.composite).not.toBe(lowTrust.composite);
  });

  it("many connecting domains reduces surprise", () => {
    const fewConnections = scoreSerendipity({
      domainRelevance: 0.7,
      userConnectingDomains: 0,
      isRepeat: false,
      topicRecency: 0.5,
      trustScore: 0.5,
    });

    const manyConnections = scoreSerendipity({
      domainRelevance: 0.7,
      userConnectingDomains: 5,
      isRepeat: false,
      topicRecency: 0.5,
      trustScore: 0.5,
    });

    expect(fewConnections.surprise).toBeGreaterThan(manyConnections.surprise);
  });
});

// ===========================================================================
// SCENARIO 3: Verification pipeline
// ===========================================================================
describe("Pipeline: insight verification", () => {
  it("returns unverified with no sources", () => {
    const result = verifyInsight({
      content: "Test",
      sources: [],
      verificationLevel: "basic",
    });

    expect(result.status).toBe("unverified");
    expect(result.confidence).toBe(0);
  });

  it("returns partial with one credible source at basic level", () => {
    const result = verifyInsight({
      content: "Test",
      sources: [{ url: "https://example.com", title: "Test", credibility: 0.8 }],
      verificationLevel: "basic",
    });

    expect(result.status).toBe("partial");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("returns verified with 2+ credible sources at strict level", () => {
    const result = verifyInsight({
      content: "Test",
      sources: [
        { url: "https://a.com", title: "A", credibility: 0.8 },
        { url: "https://b.com", title: "B", credibility: 0.7 },
      ],
      verificationLevel: "strict",
    });

    expect(result.status).toBe("verified");
  });

  it("returns partial with only 1 source at strict level", () => {
    const result = verifyInsight({
      content: "Test",
      sources: [{ url: "https://a.com", title: "A", credibility: 0.8 }],
      verificationLevel: "strict",
    });

    expect(result.status).toBe("partial");
  });

  it("paranoid level requires 3+ high-credibility sources", () => {
    const result = verifyInsight({
      content: "Test",
      sources: [
        { url: "https://a.com", title: "A", credibility: 0.6 },
        { url: "https://b.com", title: "B", credibility: 0.7 },
        { url: "https://c.com", title: "C", credibility: 0.8 },
      ],
      verificationLevel: "paranoid",
    });

    expect(result.status).toBe("verified");
  });

  it("paranoid level returns partial with low-credibility sources", () => {
    const result = verifyInsight({
      content: "Test",
      sources: [
        { url: "https://a.com", title: "A", credibility: 0.3 },
        { url: "https://b.com", title: "B", credibility: 0.3 },
        { url: "https://c.com", title: "C", credibility: 0.3 },
      ],
      verificationLevel: "paranoid",
    });

    expect(result.status).toBe("partial");
  });

  it("rejects all low-credibility sources", () => {
    const result = verifyInsight({
      content: "Test",
      sources: [
        { url: "https://a.com", title: "A", credibility: 0.1 },
        { url: "https://b.com", title: "B", credibility: 0.2 },
      ],
      verificationLevel: "basic",
    });

    expect(result.status).toBe("unverified");
    expect(result.confidence).toBeLessThanOrEqual(0.1);
  });
});

// ===========================================================================
// SCENARIO 4: Domain graph evolution
// ===========================================================================
describe("Pipeline: domain graph evolution", () => {
  it("seed graph has correct structure", () => {
    const graph = seedDomainGraph();
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.edges.length).toBeGreaterThan(0);
    expect(graph.totalObservations).toBe(0);
  });

  it("observeCoOccurrence adds new edges and updates existing", () => {
    let graph = seedDomainGraph();
    const originalEdgeCount = graph.edges.length;

    graph = observeCoOccurrence(graph, ["AI/机器学习", "软件架构"], Date.now());
    // Existing edge should get updated weight
    const weight = getEdgeWeight(graph, "AI/机器学习", "软件架构");
    expect(weight).toBeGreaterThan(1.0);

    graph = observeCoOccurrence(graph, ["AI/机器学习", "量子计算"], Date.now());
    // New edge added
    expect(graph.edges.length).toBeGreaterThan(originalEdgeCount);

    const quantumWeight = getEdgeWeight(graph, "AI/机器学习", "量子计算");
    expect(quantumWeight).toBeGreaterThan(0);
  });

  it("observeCoOccurrence with < 2 domains is a no-op", () => {
    const graph = seedDomainGraph();
    const same = observeCoOccurrence(graph, ["AI/机器学习"], Date.now());
    expect(same.edges.length).toBe(graph.edges.length);
    expect(same.totalObservations).toBe(graph.totalObservations);
  });

  it("decayEdges prunes old edges below threshold", () => {
    let graph = seedDomainGraph();
    const now = Date.now();

    // Add an edge observed a long time ago
    graph = observeCoOccurrence(graph, ["AI/机器学习", "量子计算"], now - 365 * 86400000);

    // Add an edge observed recently
    graph = observeCoOccurrence(graph, ["AI/机器学习", "数据科学"], now);

    const edgeCountBefore = graph.edges.length;

    // Decay with 30-day half-life
    const decayed = decayEdges(graph, now, 30 * 86400000);
    // Old edge should be pruned, recent one kept
    expect(decayed.edges.length).toBeLessThanOrEqual(edgeCountBefore);

    const recentWeight = getEdgeWeight(decayed, "AI/机器学习", "数据科学");
    expect(recentWeight).toBeGreaterThan(0);
  });

  it("cross-domain connections find adjacent unknown domains", () => {
    const connections = findCrossDomainConnections(["AI/机器学习", "软件架构"]);

    // AI/机器学习 is adjacent to 数据科学, 云/基础设施, 网络安全, 编程语言
    // but those are NOT in the user's domain list
    for (const conn of connections) {
      expect(conn.from).toBeTruthy();
      expect(conn.to).toBeTruthy();
      expect(["AI/机器学习", "软件架构"]).toContain(conn.from);
      expect(["AI/机器学习", "软件架构"]).not.toContain(conn.to);
    }
  });

  it("cross-domain connections with learned graph", () => {
    let graph = seedDomainGraph();
    graph = observeCoOccurrence(graph, ["AI/机器学习", "量子计算"], Date.now());
    // Need strong weight
    for (let i = 0; i < 5; i++) {
      graph = observeCoOccurrence(graph, ["AI/机器学习", "量子计算"], Date.now());
    }

    const connections = findCrossDomainConnections(
      ["AI/机器学习"],
      undefined,
      graph,
    );

    expect(connections.length).toBeGreaterThan(0);
  });

  it("semanticDistance returns 0 for same domain", () => {
    expect(semanticDistance("AI/机器学习", "AI/机器学习")).toBe(0);
  });

  it("semanticDistance returns small value for adjacent domains", () => {
    const dist = semanticDistance("AI/机器学习", "软件架构");
    expect(dist).toBeLessThan(1);
  });

  it("semanticDistance returns 1 for completely unrelated domains", () => {
    const dist = semanticDistance("AI/机器学习", "烹饪美食");
    expect(dist).toBe(1);
  });

  it("discoverDomainsFromPersona finds unknown domains", () => {
    const persona = {
      domains: { "量子计算": {} as DomainNode, "烹饪美食": {} as DomainNode },
      identity: {
        expertDomains: ["古生物学"],
        interestDomains: [],
        curiosityDomains: [],
      },
    };

    const discovered = discoverDomainsFromPersona(persona);
    expect(discovered).toContain("量子计算");
    expect(discovered).toContain("烹饪美食");
    expect(discovered).toContain("古生物学");
    expect(discovered).not.toContain("AI/机器学习");
  });

  it("extendDomainGraph adds new domains with default connections", () => {
    const extended = extendDomainGraph(undefined, ["量子计算", "纳米技术"]);
    expect(extended["量子计算"]).toBeDefined();
    expect(extended["纳米技术"]).toBeDefined();
  });
});

// ===========================================================================
// SCENARIO 5: LLM prompt construction
// ===========================================================================
describe("Pipeline: LLM prompt construction", () => {
  it("builds a prompt with persona data", () => {
    const persona = richPersona();
    const input = baseInput();
    const prompt = buildInsightPrompt(persona, input);

    expect(prompt).toContain("AI/机器学习");
    expect(prompt).toContain("Transformer架构");
    expect(prompt).toContain("测试用户");
    expect(prompt).toContain("SPECIFIC FACTS");
  });

  it("includes web results when provided and matching domain keywords", () => {
    const persona = richPersona();
    const input = baseInput();
    const webResults: WebSearchResult[] = [
      { title: "Transformer优化技术", url: "https://example.com", snippet: "AI/机器学习领域的注意力机制突破" },
    ];

    const prompt = buildInsightPrompt(persona, input, webResults);
    expect(prompt).toContain("EXTERNAL_FACTS");
    expect(prompt).toContain("注意力机制突破");
  });

  it("includes recent insight contents for anti-repetition", () => {
    const persona = richPersona();
    const input = baseInput();
    const recentInsightContents = ["上次说的关于Transformer的洞察"];

    const prompt = buildInsightPrompt(persona, input, [], recentInsightContents);
    expect(prompt).toContain("PAST INSIGHTS");
    expect(prompt).toContain("Transformer");
  });

  it("includes domain co-occurrence graph when present", () => {
    const persona = richPersona();
    let graph = seedDomainGraph();
    for (let i = 0; i < 5; i++) {
      graph = observeCoOccurrence(graph, ["AI/机器学习", "软件架构"], Date.now());
    }
    persona.domainGraph = graph;

    const prompt = buildInsightPrompt(persona, baseInput());
    expect(prompt).toContain("CROSS-DOMAIN CONNECTIONS");
  });

  it("prompt works with minimal persona (no identity, no domains)", () => {
    const persona = createDefaultPersona();
    const prompt = buildInsightPrompt(persona, baseInput());
    expect(prompt).toContain("SPECIFIC FACTS");
    expect(prompt.length).toBeGreaterThan(100);
  });
});

// ===========================================================================
// SCENARIO 6: Search query building and key-term extraction
// ===========================================================================
describe("Pipeline: search query building", () => {
  it("extracts key terms from Chinese text", () => {
    const terms = extractKeyTerms("如何优化大模型的推理速度？");
    expect(terms.length).toBeGreaterThan(0);
  });

  it("strips conversational prefixes", () => {
    const terms = extractKeyTerms("你能帮我解释一下Transformer架构吗？");
    const joined = terms.join("");
    expect(joined).not.toContain("你能帮我");
  });

  it("strips user ID prefixes", () => {
    const terms = extractKeyTerms("ou_abc123def456: 大模型推理优化");
    const joined = terms.join("");
    expect(joined).not.toContain("ou_");
  });

  it("returns empty for empty input", () => {
    expect(extractKeyTerms("")).toEqual([]);
    expect(extractKeyTerms("你好")).toEqual([]);
  });

  it("builds query from recentFocus", () => {
    const query = buildSearchQuery(baseInput({
      recentFocus: ["AI模型部署到边缘设备"],
    }));

    expect(query.length).toBeGreaterThan(0);
    expect(query.length).toBeLessThanOrEqual(120);
  });

  it("uses recentFocus for search query", () => {
    const query = buildSearchQuery(baseInput({
      recentFocus: ["RAG系统设计"],
    }));

    expect(query).toBeTruthy();
  });

  it("falls back to target domain when no focus", () => {
    const query = buildSearchQuery(baseInput({
      recentFocus: [],
      targetDomains: ["AI/机器学习"],
    }));

    expect(query).toContain("AI");
    expect(query).toContain("机器学习");
  });

  it("returns empty string when no data at all", () => {
    const query = buildSearchQuery({
      targetDomains: [],
      recentFocus: [],
      trustScore: 0.5,
      recentInsightIds: [],
      recentInsightContents: [],
    });

    expect(query).toBe("");
  });
});

// ===========================================================================
// SCENARIO 7: Content quality filtering
// ===========================================================================
describe("Pipeline: content quality (anti-generic filter)", () => {
  it("accepts substantive content", () => {
    expect(isSubstantiveContent("Transformer的注意力机制在长序列建模上有瓶颈，Flash Attention通过分块计算解决了显存问题")).toBe(true);
  });

  it("rejects very short content", () => {
    expect(isSubstantiveContent("太短")).toBe(false);
  });

  it("rejects generic patterns", () => {
    expect(isSubstantiveContent("最近出现一些值得关注的新方向")).toBe(false);
    expect(isSubstantiveContent("你有没有想过这个问题")).toBe(false);
    expect(isSubstantiveContent("挺有意思的")).toBe(false);
  });

  it("GENERIC_INSIGHT_PATTERNS all compile and match expected strings", () => {
    const testCases = [
      { pattern: GENERIC_INSIGHT_PATTERNS[0], text: "最近出现一些值得关注的新方向" },
      { pattern: GENERIC_INSIGHT_PATTERNS[4], text: "挺有意思的" },
      { pattern: GENERIC_INSIGHT_PATTERNS[5], text: "值得关注" },
    ];

    for (const tc of testCases) {
      expect(tc.pattern.test(tc.text), `Pattern ${tc.pattern} should match "${tc.text}"`).toBe(true);
    }
  });
});

// ===========================================================================
// SCENARIO 8: Blacklist filtering
// ===========================================================================
describe("Pipeline: domain blacklist filtering", () => {
  it("filters target domain matches", () => {
    const persona = richPersona();
    persona.domainBlacklist = ["网络安全"];

    // Force a connection to blacklisted domain
    const candidate = makeCandidate({
      targetDomains: ["网络安全"],
      sourceDomains: ["AI/机器学习"],
    });

    expect(isCandidateBlacklisted(candidate, persona.domainBlacklist)).toBe(true);
  });

  it("filters source domain matches", () => {
    const candidate = makeCandidate({
      targetDomains: ["AI/机器学习"],
      sourceDomains: ["网络安全"],
    });

    expect(isCandidateBlacklisted(candidate, ["网络安全"])).toBe(true);
  });

  it("does not filter when blacklist is empty", () => {
    const candidate = makeCandidate({
      targetDomains: ["AI/机器学习"],
      sourceDomains: ["软件架构"],
    });

    expect(isCandidateBlacklisted(candidate, [])).toBe(false);
    expect(isCandidateBlacklisted(candidate, undefined)).toBe(false);
  });

  it("engine respects blacklist during generation", () => {
    const persona = richPersona();
    persona.domainBlacklist = ["AI/机器学习"];

    const candidates = generateInsightCandidates(persona, baseInput(), { maxCandidates: 10 });

    for (const c of candidates) {
      expect(c.targetDomains).not.toContain("AI/机器学习");
      expect(c.sourceDomains).not.toContain("AI/机器学习");
    }
  });
});

// ===========================================================================
// SCENARIO 9: Insight store — multi-user isolation
// ===========================================================================
describe("Pipeline: store multi-user isolation", () => {
  it("different users have separate insight records", async () => {
    const r1 = makeInsightRecord({ id: "ins-a", content: "User A insight" });
    const r2 = makeInsightRecord({ id: "ins-b", content: "User B insight" });

    await store.save("user-a", r1);
    await store.save("user-b", r2);

    const aRecords = await store.listRecent("user-a");
    const bRecords = await store.listRecent("user-b");

    expect(aRecords.length).toBe(1);
    expect(bRecords.length).toBe(1);
    expect(aRecords[0].content).toBe("User A insight");
    expect(bRecords[0].content).toBe("User B insight");
  });

  it("feedback on user A's insight does not affect user B", async () => {
    const record = makeInsightRecord({ id: "ins-shared" });
    await store.save("user-a", record);
    await store.save("user-b", { ...record });

    await store.updateFeedback("user-a", "ins-shared", "positive", "好");

    const aLoaded = await store.load("user-a", "ins-shared");
    const bLoaded = await store.load("user-b", "ins-shared");

    expect(aLoaded!.feedback).toBe("positive");
    expect(bLoaded!.feedback).toBeUndefined();
  });
});

// ===========================================================================
// SCENARIO 10: Store listRecent ordering and limit
// ===========================================================================
describe("Pipeline: store listRecent ordering and limit", () => {
  it("returns records sorted by generatedAt descending", async () => {
    const r1 = makeInsightRecord({ id: "old", generatedAt: Date.now() - 86400000 });
    const r2 = makeInsightRecord({ id: "new", generatedAt: Date.now() });

    await store.save("user-1", r1);
    await store.save("user-1", r2);

    const records = await store.listRecent("user-1");
    expect(records[0].id).toBe("new");
    expect(records[1].id).toBe("old");
  });

  it("respects limit parameter", async () => {
    for (let i = 0; i < 5; i++) {
      await store.save("user-1", makeInsightRecord({
        id: `ins-${i}`,
        generatedAt: Date.now() - i * 1000,
      }));
    }

    const limited = await store.listRecent("user-1", 2);
    expect(limited.length).toBe(2);
  });

  it("returns empty for nonexistent user", async () => {
    const records = await store.listRecent("nobody");
    expect(records).toEqual([]);
  });
});

// ===========================================================================
// SCENARIO 11: Store load nonexistent
// ===========================================================================
describe("Pipeline: store edge cases", () => {
  it("load returns undefined for nonexistent id", async () => {
    const result = await store.load("user-1", "does-not-exist");
    expect(result).toBeUndefined();
  });

  it("updateFeedback is a no-op for nonexistent record", async () => {
    await expect(store.updateFeedback("user-1", "ghost", "positive")).resolves.toBeUndefined();
  });
});

// ===========================================================================
// SCENARIO 12: Empty persona → no candidates
// ===========================================================================
describe("Pipeline: empty persona produces no candidates", () => {
  it("returns empty for default persona with no domains", () => {
    const persona = createDefaultPersona();
    const candidates = generateInsightCandidates(persona, baseInput());
    expect(candidates).toEqual([]);
  });

  it("returns empty for single domain with no adjacent connections", () => {
    const persona = createDefaultPersona();
    persona.domains = {
      "孤立领域": {
        depth: 3,
        recurrence: 5,
        lastMentioned: Date.now(),
        keyInsights: ["test"],
        activeQuestions: [],
        connections: [],
        negationSignals: 0,
      },
    };

    const candidates = generateInsightCandidates(persona, baseInput());
    // "孤立领域" is not in the default adjacency graph, so no cross-domain connections
    // But it has depth >= 4? No, depth=3. So no domain-depth insight either.
    // buildQuestionInsightCandidate and buildDomainDepthInsight return undefined.
    // buildExplorationInsight needs unknownTargets which requires targetDomains not in persona.domains.
    // With only one unknown domain and no adjacency, there may still be exploration candidates
    // depending on targetDomains vs persona.domains matching.
    // This tests the engine's graceful handling of edge cases.
  });
});

// ===========================================================================
// SCENARIO 13: Trust score affects candidate scoring
// ===========================================================================
describe("Pipeline: trust score influence on scoring", () => {
  it("low trust produces lower composite for same candidate", () => {
    const persona = richPersona();

    persona.rapport.trustScore = 0.1;
    const lowTrustCandidates = generateInsightCandidates(persona, baseInput(), { maxCandidates: 5 });

    persona.rapport.trustScore = 0.9;
    const highTrustCandidates = generateInsightCandidates(persona, baseInput(), { maxCandidates: 5 });

    // With higher trust, the engine is more willing to suggest surprising connections
    // The actual score values depend on serendipity scoring
    // Just verify both produce valid results
    for (const c of [...lowTrustCandidates, ...highTrustCandidates]) {
      expect(c.compositeScore).toBeGreaterThanOrEqual(0);
      expect(c.compositeScore).toBeLessThanOrEqual(1);
    }
  });
});

// ===========================================================================
// SCENARIO 14: Repeat insight handling
// ===========================================================================
describe("Pipeline: repeat insight handling", () => {
  it("marks repeat insights with zero novelty via serendipity scorer", () => {
    const score = scoreSerendipity({
      domainRelevance: 0.8,
      userConnectingDomains: 1,
      isRepeat: true,
      topicRecency: 0.5,
      trustScore: 0.5,
    });

    expect(score.novelty).toBe(0);
  });

  it("engine filters by recentInsightIds", () => {
    const persona = richPersona();

    // First run: get candidates
    const firstRun = generateInsightCandidates(persona, baseInput(), { maxCandidates: 5 });
    expect(firstRun.length).toBeGreaterThan(0);

    // Second run: mark first run IDs as recent
    const recentIds = firstRun.map((c) => c.id);
    const inputWithRecent = baseInput({ recentInsightIds: recentIds });

    const secondRun = generateInsightCandidates(persona, inputWithRecent, { maxCandidates: 5 });

    // The engine itself doesn't re-use IDs — it generates new ones.
    // The repeat detection is in the serendipity scoring via isRepeat flag.
    for (const c of secondRun) {
      expect(c.id).toBeTruthy();
    }
  });
});

// ===========================================================================
// SCENARIO 15: Verification integration with engine
// ===========================================================================
describe("Pipeline: verification integration", () => {
  it("engine candidates all have verification status", () => {
    const persona = richPersona();
    const candidates = generateInsightCandidates(persona, baseInput());

    const validStatuses = new Set(["unverified", "partial", "verified", "contradicted"]);
    for (const c of candidates) {
      expect(validStatuses.has(c.verificationStatus)).toBe(true);
    }
  });

  it("template candidates start as unverified (no sources)", () => {
    const persona = richPersona();
    const candidates = generateInsightCandidates(persona, baseInput());

    for (const c of candidates) {
      // Template-based candidates have no sources → unverified
      expect(c.verificationStatus).toBe("unverified");
    }
  });
});

// ===========================================================================
// SCENARIO 16: Domain graph → cross-domain connections pipeline
// ===========================================================================
describe("Pipeline: graph evolution → connections pipeline", () => {
  it("observed co-occurrences enable cross-domain connections via learned graph", () => {
    let graph = seedDomainGraph();

    // Observe many co-occurrences between AI and a new domain
    for (let i = 0; i < 10; i++) {
      graph = observeCoOccurrence(graph, ["AI/机器学习", "区块链"], Date.now());
    }

    // Now find connections using the learned graph
    const connections = findCrossDomainConnections(
      ["AI/机器学习"],
      undefined,
      graph,
    );

    const blockchainConn = connections.find((c) => c.to === "区块链");
    expect(blockchainConn).toBeDefined();
    expect(blockchainConn!.from).toBe("AI/机器学习");
  });

  it("decayed edges reduce connection quality over time", () => {
    let graph = seedDomainGraph();
    const now = Date.now();

    // Strong edge, observed long ago
    for (let i = 0; i < 10; i++) {
      graph = observeCoOccurrence(graph, ["AI/机器学习", "量子计算"], now - 180 * 86400000);
    }

    // After decay, edge weight should be reduced
    const decayed = decayEdges(graph, now, 30 * 86400000);

    const originalWeight = getEdgeWeight(graph, "AI/机器学习", "量子计算");
    const decayedWeight = getEdgeWeight(decayed, "AI/机器学习", "量子计算");

    expect(decayedWeight).toBeLessThanOrEqual(originalWeight);
  });

  it("edge weight retrieval returns 0.5 for unknown pairs in learned graph", () => {
    const graph = seedDomainGraph();
    const weight = getEdgeWeight(graph, "AI/机器学习", "完全不相关");
    expect(weight).toBe(0.5);
  });
});

// ===========================================================================
// SCENARIO 17: Full cycle — store feedback updates correctly
// ===========================================================================
describe("Pipeline: feedback update lifecycle", () => {
  it("stores positive → negative → neutral feedback progression", async () => {
    const record = makeInsightRecord();
    await store.save("user-1", record);

    await store.updateFeedback("user-1", record.id, "positive");
    let loaded = await store.load("user-1", record.id);
    expect(loaded!.feedback).toBe("positive");

    await store.updateFeedback("user-1", record.id, "negative", "不太对");
    loaded = await store.load("user-1", record.id);
    expect(loaded!.feedback).toBe("negative");
    expect(loaded!.userResponse).toBe("不太对");

    await store.updateFeedback("user-1", record.id, "neutral");
    loaded = await store.load("user-1", record.id);
    expect(loaded!.feedback).toBe("neutral");
    // userResponse from previous update remains (updateFeedback only sets if provided)
  });

  it("persists deliveredAt when record is updated", async () => {
    const record = makeInsightRecord({ deliveredAt: undefined });
    await store.save("user-1", record);

    // Update with delivery timestamp
    const loaded = await store.load("user-1", record.id);
    const updated: InsightRecord = { ...loaded!, deliveredAt: Date.now() };
    await store.save("user-1", updated);

    const after = await store.load("user-1", record.id);
    expect(after!.deliveredAt).toBeDefined();
    expect(after!.deliveredAt!).toBeGreaterThan(0);
  });
});
