import { describe, expect, it } from "vitest";
import type { PersonaTree } from "../types.js";
import {
  CONTRASTIVE_INSTRUCTION,
  buildInsightPrompt,
  buildPatternInsightPrompt,
  buildSurpriseInsightPrompt,
} from "./llm-engine.js";
import type { InsightEngineInput, SearchStrategy } from "./types.js";

function makePersona(overrides?: Partial<PersonaTree>): PersonaTree {
  return {
    identity: {
      coreTraits: {},
      expertDomains: ["typescript"],
      interestDomains: ["rust"],
      curiosityDomains: ["wasm"],
    },
    domains: {
      typescript: {
        depth: 5,
        recurrence: 10,
        lastMentioned: Date.now(),
        keyInsights: ["type narrowing", "template literal types"],
        activeQuestions: [],
        connections: ["javascript"],
        negationSignals: 0,
      },
      rust: {
        depth: 3,
        recurrence: 4,
        lastMentioned: Date.now(),
        keyInsights: ["ownership model"],
        activeQuestions: [],
        connections: ["systems-programming"],
        negationSignals: 0,
      },
    },
    recentFocus: ["wasm", "type-systems"],
    activeProjects: ["kaijibot"],
    feedbackProfile: {
      topicBandits: {},
      preferredStyle: "observation",
      optimalFrequencyHours: 4,
      lastProactiveAt: 0,
      recentInsightIds: [],
      recentInsightContents: [],
    },
    rapport: {
      trustScore: 0.75,
      totalExchanges: 50,
      avgResponseLength: 120,
      selfDisclosureLevel: 0.4,
    },
    domainBlacklist: [],
    lifecycle: { stage: "new", lastActiveAt: 0, lastStageTransitionAt: 0, consecutiveSilentDays: 0, totalActiveDays: 0 },
    calibrationHistory: [],
    contradictionLog: [],
    moodHistory: [],
    ...overrides,
  };
}

function makeInput(overrides?: Partial<InsightEngineInput>): InsightEngineInput {
  return {
    targetDomains: ["typescript", "rust"],
    recentFocus: ["wasm"],
    trustScore: 0.75,
    recentInsightIds: ["id-1", "id-2"],
    recentInsightContents: [],
    ...overrides,
  };
}

function makeStrategy(): SearchStrategy {
  return {
    inferredInterest: "WebAssembly",
    searchQuery: "WebAssembly Rust TypeScript integration",
    bridgeReasoning: "User knows both TS and Rust, WASM is the natural bridge",
    avoidTopics: ["basic type system"],
    estimatedSurprise: 0.8,
  };
}

const fiveInsights = [
  "Rust的ownership模型让你重新思考数据流设计",
  "TypeScript 5.0的装饰器终于稳定了",
  "WASM在服务端的性能表现超出预期",
  "你的代码风格倾向于函数式而非面向对象",
  "最近三个月你最活跃的领域是分布式系统",
];

describe("CONTRASTIVE_INSTRUCTION", () => {
  it("is a non-empty string containing required framework keywords", () => {
    expect(typeof CONTRASTIVE_INSTRUCTION).toBe("string");
    expect(CONTRASTIVE_INSTRUCTION.length).toBeGreaterThan(0);
    expect(CONTRASTIVE_INSTRUCTION).toContain("COUNTER-EXAMPLE");
    expect(CONTRASTIVE_INSTRUCTION).toContain("INVERSE FRAMING");
    expect(CONTRASTIVE_INSTRUCTION).toContain("ORTHOGONAL");
    expect(CONTRASTIVE_INSTRUCTION).toContain("NOVELTY TEST");
  });
});

describe("buildSurpriseInsightPrompt contrastive framework", () => {
  it("includes CONTRASTIVE FRAMEWORK when recentInsightContents is non-empty", () => {
    const { prompt } = buildSurpriseInsightPrompt(
      makePersona(),
      makeInput(),
      [],
      ["some past insight"],
      makeStrategy(),
    );
    expect(prompt).toContain("CONTRASTIVE FRAMEWORK");
    expect(prompt).toContain("COUNTER-EXAMPLE");
  });

  it("does NOT include CONTRASTIVE FRAMEWORK when recentInsightContents is empty", () => {
    const { prompt } = buildSurpriseInsightPrompt(
      makePersona(),
      makeInput(),
      [],
      [],
      makeStrategy(),
    );
    expect(prompt).not.toContain("CONTRASTIVE FRAMEWORK");
  });
});

describe("buildPatternInsightPrompt contrastive framework", () => {
  it("includes CONTRASTIVE FRAMEWORK when recentInsightContents is non-empty", () => {
    const { prompt } = buildPatternInsightPrompt(
      makePersona(),
      makeInput(),
      ["some past insight"],
    );
    expect(prompt).toContain("CONTRASTIVE FRAMEWORK");
    expect(prompt).toContain("COUNTER-EXAMPLE");
  });

  it("does NOT include CONTRASTIVE FRAMEWORK when recentInsightContents is empty", () => {
    const { prompt } = buildPatternInsightPrompt(
      makePersona(),
      makeInput(),
      [],
    );
    expect(prompt).not.toContain("CONTRASTIVE FRAMEWORK");
  });
});

describe("buildInsightPrompt contrastive framework", () => {
  it("includes CONTRASTIVE FRAMEWORK when recentInsightContents is non-empty", () => {
    const { prompt } = buildInsightPrompt(
      makePersona(),
      makeInput(),
      [],
      ["some past insight"],
    );
    expect(prompt).toContain("CONTRASTIVE FRAMEWORK");
    expect(prompt).toContain("COUNTER-EXAMPLE");
  });

  it("does NOT include CONTRASTIVE FRAMEWORK when recentInsightContents is empty", () => {
    const { prompt } = buildInsightPrompt(
      makePersona(),
      makeInput(),
      [],
      [],
    );
    expect(prompt).not.toContain("CONTRASTIVE FRAMEWORK");
  });
});

describe("expanded past insight context (5 × 120 chars)", () => {
  it("includes all 5 past insights with up to 120 chars truncation in buildInsightPrompt", () => {
    const longInsights = fiveInsights.map(
      (base, i) => `${base}，这是一条超过80字符的扩展洞察内容，用于测试新的截断限制是否生效 part${i + 1}`,
    );

    const { prompt } = buildInsightPrompt(
      makePersona(),
      makeInput(),
      [],
      longInsights,
    );

    for (let i = 1; i <= 5; i++) {
      expect(prompt).toContain(`${i}.`);
    }

    expect(prompt).toContain("新的截断限制是否生效");
  });

  it("includes all 5 past insights in buildSurpriseInsightPrompt", () => {
    const { prompt } = buildSurpriseInsightPrompt(
      makePersona(),
      makeInput(),
      [],
      fiveInsights,
      makeStrategy(),
    );

    for (let i = 1; i <= 5; i++) {
      expect(prompt).toContain(`${i}.`);
    }
  });

  it("includes all 5 past insights in buildPatternInsightPrompt", () => {
    const { prompt } = buildPatternInsightPrompt(
      makePersona(),
      makeInput(),
      fiveInsights,
    );

    for (let i = 1; i <= 5; i++) {
      expect(prompt).toContain(`${i}.`);
    }
  });
});
