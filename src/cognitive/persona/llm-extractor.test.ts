import { describe, it, expect } from "vitest";
import type { LlmExtractorDeps } from "./llm-extractor.js";
import { extractFromMessageLLM } from "./llm-extractor.js";
import type { PersonaTree } from "../types.js";
import type { KaijiBotConfig } from "../../config/types.kaijibot.js";

type CompleteArgs = Parameters<LlmExtractorDeps["complete"]>;

const stubConfig = {} as KaijiBotConfig;

function makeSuccessDeps(
  responseText: string,
  onCall?: (args: CompleteArgs) => void,
): LlmExtractorDeps {
  return {
    complete: async (...args: CompleteArgs) => {
      onCall?.(args);
      return {
        role: "assistant",
        content: [{ type: "text", text: responseText }],
        api: "openai" as never,
        provider: "test" as never,
        model: "test-model",
        usage: { inputTokens: 0, outputTokens: 0 } as never,
        stopReason: "stop" as never,
        timestamp: Date.now(),
      };
    },
    prepareModel: async () => ({
      model: { id: "test", provider: "test", name: "test" } as never,
      auth: { apiKey: "test-key", mode: "api-key", source: "test" } as never,
    }),
  };
}

const errorDeps: LlmExtractorDeps = {
  complete: async () => {
    throw new Error("LLM unavailable");
  },
  prepareModel: async () => ({
    model: { id: "test", provider: "test", name: "test" } as never,
    auth: { apiKey: "test-key", mode: "api-key", source: "test" } as never,
  }),
};

const prepareErrorDeps: LlmExtractorDeps = {
  complete: async () => {
    throw new Error("should not reach");
  },
  prepareModel: async () => ({ error: "No API key configured" }),
};

describe("extractFromMessageLLM", () => {
  it("parses valid JSON from LLM into ExtractionResult", async () => {
    const json = JSON.stringify({
      attributes: [
        {
          field: "identity.coreTraits.职业",
          value: "数据工程师",
          confidence: 0.9,
          source: "explicit",
          evidence: "我是做数据工程的",
        },
      ],
      domains: [{ name: "数据科学", depth: 3, insights: ["knows SQL"], questions: [] }],
      recentFocus: ["ETL pipeline"],
    });

    const deps = makeSuccessDeps(json);
    const result = await extractFromMessageLLM(
      "我是做数据工程的",
      "好的，数据工程很有趣",
      undefined,
      stubConfig,
      deps,
    );

    expect(result.attributes).toHaveLength(1);
    expect(result.attributes[0]!.field).toBe("identity.coreTraits.职业");
    expect(result.attributes[0]!.value).toBe("数据工程师");
    expect(result.attributes[0]!.confidence).toBe(0.9);
    expect(result.attributes[0]!.source).toBe("explicit");
    expect(result.domains).toHaveLength(1);
    expect(result.domains[0]!.name).toBe("数据科学");
    expect(result.domains[0]!.depth).toBe(3);
    expect(result.recentFocus).toEqual(["ETL pipeline"]);
  });

  it("strips markdown code fences before parsing", async () => {
    const json = JSON.stringify({
      attributes: [
        { field: "test", value: "v", confidence: 0.5, source: "inferred", evidence: "evidence" },
      ],
      domains: [],
      recentFocus: ["topic"],
    });

    const wrapped = "```json\n" + json + "\n```";
    const deps = makeSuccessDeps(wrapped);
    const result = await extractFromMessageLLM(
      "hello",
      "hi",
      undefined,
      stubConfig,
      deps,
    );

    expect(result.attributes).toHaveLength(1);
    expect(result.recentFocus).toEqual(["topic"]);
  });

  it("falls back to rule-based on LLM error", async () => {
    const result = await extractFromMessageLLM(
      "我在学习人工智能和深度学习",
      "AI是个很好的领域",
      undefined,
      stubConfig,
      errorDeps,
    );

    expect(result.domains.length).toBeGreaterThanOrEqual(1);
    const aiDomain = result.domains.find((d) => d.name === "AI/机器学习");
    expect(aiDomain).toBeDefined();
  });

  it("falls back to rule-based when prepareModel returns error", async () => {
    const result = await extractFromMessageLLM(
      "我在学习人工智能",
      "AI很好",
      undefined,
      stubConfig,
      prepareErrorDeps,
    );

    expect(result.domains.length).toBeGreaterThanOrEqual(1);
  });

  it("falls back when LLM returns empty text", async () => {
    const deps = makeSuccessDeps("   ");
    const result = await extractFromMessageLLM(
      "我在学习人工智能",
      "AI很好",
      undefined,
      stubConfig,
      deps,
    );

    expect(result.domains.length).toBeGreaterThanOrEqual(1);
  });

  it("falls back when LLM returns all-empty extraction arrays", async () => {
    const json = JSON.stringify({
      attributes: [],
      domains: [],
      recentFocus: [],
    });

    const deps = makeSuccessDeps(json);
    const result = await extractFromMessageLLM(
      "我在学习人工智能",
      "AI很好",
      undefined,
      stubConfig,
      deps,
    );

    expect(result.domains.length).toBeGreaterThanOrEqual(1);
  });

  it("handles malformed JSON from LLM without crashing", async () => {
    const deps = makeSuccessDeps("this is not json at all { broken");
    const result = await extractFromMessageLLM(
      "我在学习人工智能",
      "AI很好",
      undefined,
      stubConfig,
      deps,
    );

    expect(result.domains.length).toBeGreaterThanOrEqual(1);
  });

  it("includes persona context in prompt when persona is provided", async () => {
    let capturedPrompt = "";

    const deps = makeSuccessDeps(
      JSON.stringify({
        attributes: [
          { field: "f", value: "v", confidence: 0.5, source: "inferred", evidence: "e" },
        ],
        domains: [],
        recentFocus: ["x"],
      }),
      (args) => {
        const messages = args[1].messages;
        capturedPrompt = messages[0]!.content as string;
      },
    );

    const persona: PersonaTree = {
      identity: {
        coreTraits: {},
        expertDomains: ["AI/机器学习"],
        interestDomains: [],
        curiosityDomains: [],
      },
      domains: {
        "AI/机器学习": {
          depth: 3,
          recurrence: 5,
          lastMentioned: Date.now(),
          keyInsights: ["uses PyTorch"],
          activeQuestions: ["how to scale?"],
          negationSignals: 0,
        },
      },
      recentFocus: ["transformer architecture"],
      feedbackProfile: {
        topicBandits: {},
        optimalFrequencyHours: 4,
        lastProactiveAt: 0,
        recentInsightIds: [],
        recentInsightContents: [],
      },
      rapport: {
        trustScore: 0.7,
        totalExchanges: 10,
        avgResponseLength: 50,
        selfDisclosureLevel: 0.3,
      },
      domainBlacklist: [],
      lifecycle: { stage: "new", lastActiveAt: 0, lastStageTransitionAt: 0, totalActiveDays: 0 },
      calibrationHistory: [],
      moodHistory: [],
    };

    await extractFromMessageLLM("hello", "hi", persona, stubConfig, deps);

    expect(capturedPrompt).toContain("Known persona:");
    expect(capturedPrompt).toContain("AI/机器学习");
    expect(capturedPrompt).toContain("transformer architecture");
  });

  it("clamps confidence to 0-1 range", async () => {
    const json = JSON.stringify({
      attributes: [
        { field: "f", value: "v", confidence: 5, source: "explicit", evidence: "e" },
      ],
      domains: [],
      recentFocus: [],
    });
  });

  it("clamps domain depth to 1-5 range", async () => {
    const json = JSON.stringify({
      attributes: [],
      domains: [{ name: "test", depth: 10, insights: [], questions: [] }],
      recentFocus: [],
    });

    const deps = makeSuccessDeps(json);
    const result = await extractFromMessageLLM(
      "hello",
      "hi",
      undefined,
      stubConfig,
      deps,
    );

    expect(result.domains[0]!.depth).toBe(5);
  });

  it("defaults invalid source to 'inferred'", async () => {
    const json = JSON.stringify({
      attributes: [
        { field: "f", value: "v", confidence: 0.5, source: "invalid_source", evidence: "e" },
      ],
      domains: [],
      recentFocus: [],
    });

    const deps = makeSuccessDeps(json);
    const result = await extractFromMessageLLM(
      "hello",
      "hi",
      undefined,
      stubConfig,
      deps,
    );

    expect(result.attributes[0]!.source).toBe("inferred");
  });

  it("never throws even with completely broken deps", async () => {
    const brokenDeps: LlmExtractorDeps = {
      complete: () => {
        throw new Error("sync explosion");
      },
      prepareModel: () => {
        throw new Error("sync explosion");
      },
    };

    const result = await extractFromMessageLLM(
      "我在学习人工智能",
      "AI很好",
      undefined,
      stubConfig,
      brokenDeps,
    );

    expect(result).toBeDefined();
    expect(result.domains.length).toBeGreaterThanOrEqual(1);
  });
});
