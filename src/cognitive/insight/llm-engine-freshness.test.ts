import type { Api, AssistantMessage, Model } from "@mariozechner/pi-ai";
import { describe, expect, it, vi } from "vitest";
import type { KaijiBotConfig } from "../../config/config.js";
import type { InsightCandidate } from "./types.js";
import {
  checkSemanticNoveltyWithLLM,
  type LlmInsightDeps,
} from "./llm-engine.js";

const TEST_MODEL: Model<Api> = {
  id: "test-model",
  name: "Test Model",
  api: "openai-completions",
  provider: "test",
  baseUrl: "http://localhost:11434/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 4096,
};

const TEST_AUTH = {
  apiKey: "test-key",
  source: "test",
  mode: "api-key" as const,
};

function assistantMessage(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "test",
    model: "test-model",
    usage: {
      input: 10,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 30,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function makeCandidate(overrides?: Partial<InsightCandidate>): InsightCandidate {
  return {
    id: "test-candidate-id",
    content: "Rust的async运行时embassy用async/await做嵌入式并发，跟你写TypeScript的思维模型一致。",
    rationale: "Cross-domain bridge between Rust and TypeScript",
    targetDomains: ["rust", "typescript"],
    sourceDomains: ["embedded"],
    relevanceScore: 0.85,
    surpriseScore: 0.7,
    compositeScore: 0.775,
    sources: [],
    verificationStatus: "unverified",
    ...overrides,
  };
}

function makeConfig(): KaijiBotConfig {
  return {
    cognitive: { insight: { sources: { webSearchProvider: "zai" } } },
  } as KaijiBotConfig;
}

function successDeps(responseText: string): LlmInsightDeps {
  return {
    complete: async () => assistantMessage(responseText),
    prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
  };
}

const errorDeps: LlmInsightDeps = {
  complete: async () => { throw new Error("LLM error"); },
  prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
};

const threePastInsights = [
  "Rust的ownership模型让你重新思考数据流设计",
  "TypeScript 5.0的装饰器终于稳定了",
  "你的代码风格倾向于函数式而非面向对象",
];

const fivePastInsights = [
  ...threePastInsights,
  "WASM在服务端的性能表现超出预期",
  "最近三个月你最活跃的领域是分布式系统",
];

// ---------------------------------------------------------------------------
// buildFreshnessPrompt (indirectly tested via prompt content)
// ---------------------------------------------------------------------------

describe("checkSemanticNoveltyWithLLM prompt construction", () => {
  it("sends candidate content and past insights to LLM", async () => {
    const completeSpy = vi.fn().mockResolvedValue(assistantMessage(
      JSON.stringify({ isNovel: true, similarityToClosest: 0.3, reason: "Different topic" }),
    ));

    const deps: LlmInsightDeps = {
      complete: completeSpy,
      prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
    };

    await checkSemanticNoveltyWithLLM(
      makeCandidate({ content: "embassy框架的async/await模型" }),
      threePastInsights,
      makeConfig(),
      deps,
    );

    expect(completeSpy).toHaveBeenCalledTimes(1);
    const callArgs = completeSpy.mock.calls[0];
    const messages = callArgs[1].messages;
    const promptText = messages[0].content as string;

    expect(promptText).toContain("embassy框架的async/await模型");
    expect(promptText).toContain("ownership模型");
    expect(promptText).toContain("装饰器终于稳定");
    expect(promptText).toContain("函数式而非面向对象");
    expect(promptText).toContain("isNovel");
  });

  it("shows all 5 past insights truncated to 120 chars", async () => {
    const longInsights = fivePastInsights.map(
      (base, i) => `${base}，这是一条超过80字符的扩展洞察内容，用于测试截断限制是否生效。追加更多填充文字以确保长度超过一百二十字符。part${i + 1}`,
    );
    const longContent = "A".repeat(200);

    const completeSpy = vi.fn().mockResolvedValue(assistantMessage(
      JSON.stringify({ isNovel: true, similarityToClosest: 0.1, reason: "Novel" }),
    ));

    const deps: LlmInsightDeps = {
      complete: completeSpy,
      prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
    };

    await checkSemanticNoveltyWithLLM(
      makeCandidate({ content: longContent }),
      longInsights,
      makeConfig(),
      deps,
    );

    const promptText = (completeSpy.mock.calls[0][1].messages[0].content as string);

    for (let i = 1; i <= 5; i++) {
      expect(promptText).toContain(`${i}.`);
    }

    expect(promptText).toContain("截断限制是否生效");
  });
});

// ---------------------------------------------------------------------------
// checkSemanticNoveltyWithLLM — LLM returns "not novel"
// ---------------------------------------------------------------------------

describe("checkSemanticNoveltyWithLLM not-novel response", () => {
  it("returns isNovel: false with reason when LLM says not novel", async () => {
    const result = await checkSemanticNoveltyWithLLM(
      makeCandidate(),
      threePastInsights,
      makeConfig(),
      successDeps(JSON.stringify({
        isNovel: false,
        similarityToClosest: 0.92,
        reason: "Paraphrases past insight about ownership model",
      })),
    );

    expect(result.isNovel).toBe(false);
    expect(result.reason).toContain("Paraphrases");
  });
});

// ---------------------------------------------------------------------------
// checkSemanticNoveltyWithLLM — LLM returns "novel"
// ---------------------------------------------------------------------------

describe("checkSemanticNoveltyWithLLM novel response", () => {
  it("returns isNovel: true with reason when LLM says novel", async () => {
    const result = await checkSemanticNoveltyWithLLM(
      makeCandidate(),
      threePastInsights,
      makeConfig(),
      successDeps(JSON.stringify({
        isNovel: true,
        similarityToClosest: 0.2,
        reason: "Covers embedded systems, a new domain",
      })),
    );

    expect(result.isNovel).toBe(true);
    expect(result.reason).toContain("embedded");
  });
});

// ---------------------------------------------------------------------------
// checkSemanticNoveltyWithLLM — malformed JSON → conservative fallback
// ---------------------------------------------------------------------------

describe("checkSemanticNoveltyWithLLM malformed response", () => {
  it("returns isNovel: true on malformed JSON", async () => {
    const result = await checkSemanticNoveltyWithLLM(
      makeCandidate(),
      threePastInsights,
      makeConfig(),
      successDeps("this is not valid json {{{"),
    );

    expect(result.isNovel).toBe(true);
    expect(result.reason).toContain("unavailable");
  });

  it("returns isNovel: true when isNovel is not boolean", async () => {
    const result = await checkSemanticNoveltyWithLLM(
      makeCandidate(),
      threePastInsights,
      makeConfig(),
      successDeps(JSON.stringify({ isNovel: "yes", reason: "not a bool" })),
    );

    expect(result.isNovel).toBe(true);
    expect(result.reason).toContain("unavailable");
  });

  it("returns isNovel: true when reason is not a string", async () => {
    const result = await checkSemanticNoveltyWithLLM(
      makeCandidate(),
      threePastInsights,
      makeConfig(),
      successDeps(JSON.stringify({ isNovel: true, reason: 42 })),
    );

    expect(result.isNovel).toBe(true);
    expect(result.reason).toContain("unavailable");
  });

  it("returns isNovel: true on empty LLM response", async () => {
    const result = await checkSemanticNoveltyWithLLM(
      makeCandidate(),
      threePastInsights,
      makeConfig(),
      successDeps(""),
    );

    expect(result.isNovel).toBe(true);
    expect(result.reason).toContain("unavailable");
  });
});

// ---------------------------------------------------------------------------
// checkSemanticNoveltyWithLLM — LLM throws → conservative fallback
// ---------------------------------------------------------------------------

describe("checkSemanticNoveltyWithLLM error handling", () => {
  it("returns isNovel: true when LLM throws", async () => {
    const result = await checkSemanticNoveltyWithLLM(
      makeCandidate(),
      threePastInsights,
      makeConfig(),
      errorDeps,
    );

    expect(result.isNovel).toBe(true);
    expect(result.reason).toContain("unavailable");
  });

  it("returns isNovel: true when everything throws", async () => {
    const bombDeps: LlmInsightDeps = {
      complete: async () => { throw new Error("catastrophic"); },
      prepareModel: async () => { throw new Error("also broke"); },
    };
    const result = await checkSemanticNoveltyWithLLM(
      makeCandidate(),
      threePastInsights,
      makeConfig(),
      bombDeps,
    );

    expect(result.isNovel).toBe(true);
    expect(result.reason).toContain("unavailable");
  });

  it("returns isNovel: true when prepareModel returns error", async () => {
    const deps: LlmInsightDeps = {
      complete: async () => assistantMessage("unused"),
      prepareModel: async () => ({ error: "no model available" }),
    };
    const result = await checkSemanticNoveltyWithLLM(
      makeCandidate(),
      threePastInsights,
      makeConfig(),
      deps,
    );

    expect(result.isNovel).toBe(true);
    expect(result.reason).toContain("unavailable");
  });
});

// ---------------------------------------------------------------------------
// checkSemanticNoveltyWithLLM — skip conditions
// ---------------------------------------------------------------------------

describe("checkSemanticNoveltyWithLLM skip conditions", () => {
  it("skips LLM call with empty recentInsightContents", async () => {
    const completeSpy = vi.fn().mockResolvedValue(assistantMessage("unused"));

    const deps: LlmInsightDeps = {
      complete: completeSpy,
      prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
    };

    const result = await checkSemanticNoveltyWithLLM(
      makeCandidate(),
      [],
      makeConfig(),
      deps,
    );

    expect(result.isNovel).toBe(true);
    expect(result.reason).toContain("Insufficient history");
    expect(completeSpy).not.toHaveBeenCalled();
  });

  it("skips LLM call with 1 item in recentInsightContents", async () => {
    const completeSpy = vi.fn().mockResolvedValue(assistantMessage("unused"));

    const deps: LlmInsightDeps = {
      complete: completeSpy,
      prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
    };

    const result = await checkSemanticNoveltyWithLLM(
      makeCandidate(),
      ["only one insight"],
      makeConfig(),
      deps,
    );

    expect(result.isNovel).toBe(true);
    expect(result.reason).toContain("Insufficient history");
    expect(completeSpy).not.toHaveBeenCalled();
  });

  it("calls LLM with 2 items in recentInsightContents", async () => {
    const completeSpy = vi.fn().mockResolvedValue(assistantMessage(
      JSON.stringify({ isNovel: true, similarityToClosest: 0.4, reason: "New angle" }),
    ));

    const deps: LlmInsightDeps = {
      complete: completeSpy,
      prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
    };

    const result = await checkSemanticNoveltyWithLLM(
      makeCandidate(),
      ["insight one", "insight two"],
      makeConfig(),
      deps,
    );

    expect(result.isNovel).toBe(true);
    expect(result.reason).toContain("New angle");
    expect(completeSpy).toHaveBeenCalledTimes(1);
  });
});
