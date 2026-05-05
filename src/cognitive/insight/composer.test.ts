import type { Api, AssistantMessage, Model } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import type { KaijiBotConfig } from "../../config/config.js";
import type { PersonaTree } from "../types.js";
import type { BlindSpotCandidate } from "./fragment-types.js";
import { GENERIC_INSIGHT_PATTERNS, isSubstantiveContent } from "./llm-engine.js";
import { composeInsight, containsFactualClaims, type ComposerDeps } from "./composer.js";

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

function makeSuccessDeps(
  responseText: string,
  onCall?: (prompt: string) => void,
  onSystemPrompt?: (sp: string | undefined) => void,
): ComposerDeps {
  return {
    complete: async (_model, opts) => {
      const userMsg = opts.messages[0];
      if (userMsg && onCall) {
        const content = typeof userMsg.content === "string"
          ? userMsg.content
          : JSON.stringify(userMsg.content);
        onCall(content);
      }
      if (onSystemPrompt) {
        const sp = (opts as unknown as Record<string, unknown>).systemPrompt as string | undefined;
        onSystemPrompt(sp);
      }
      return assistantMessage(responseText);
    },
    prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
  };
}

function makeBlindSpot(overrides?: Partial<BlindSpotCandidate>): BlindSpotCandidate {
  return {
    id: "bs-1",
    blindSpot: "User conflates Rust ownership with C++ RAII",
    supportingFragmentIds: ["f-1", "f-2"],
    potentialImpact: "direction_change",
    domains: ["rust", "cpp"],
    unusedDomains: ["memory-safety"],
    crystallizationScore: 0.75,
    ...overrides,
  };
}

function makePersona(overrides?: Partial<PersonaTree>): PersonaTree {
  return {
    identity: {
      coreTraits: {},
      expertDomains: ["typescript"],
      interestDomains: ["rust"],
      curiosityDomains: ["wasm"],
      ...overrides?.identity,
    },
    domains: {},
    recentFocus: [],
    activeProjects: [],
    feedbackProfile: {
      topicBandits: {},
      preferredStyle: "observation",
      optimalFrequencyHours: 4,
      lastProactiveAt: 0,
      recentInsightIds: [],
      recentInsightContents: [],
      ...overrides?.feedbackProfile,
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

function makeConfig(overrides?: Partial<KaijiBotConfig>): KaijiBotConfig {
  return {
    cognitive: {
      insight: {},
      ...overrides?.cognitive?.insight ? { insight: { ...overrides.cognitive.insight } } : {},
    },
  } as KaijiBotConfig;
}

// ─── Success path ───

describe("composeInsight", () => {
  it("returns InsightCandidate with content from LLM", async () => {
    const candidate = makeBlindSpot();
    const persona = makePersona();
    const config = makeConfig();
    const deps = makeSuccessDeps("Rust 的所有权模型在编译期就完成了借用检查，和 C++ 的 RAII 在运行时析构有本质区别。");

    const result = await composeInsight(candidate, persona, config, deps);

    expect(result).not.toBeNull();
    expect(result!.content).toContain("Rust");
  });

  it("maps BlindSpotCandidate fields to InsightCandidate fields correctly", async () => {
    const candidate = makeBlindSpot({
      crystallizationScore: 0.8,
      domains: ["rust", "cpp"],
      unusedDomains: ["memory-safety"],
    });
    const persona = makePersona();
    const config = makeConfig();
    const deps = makeSuccessDeps("Rust ownership is fundamentally different from C++ RAII in that borrow checking is fully compile-time.");

    const result = await composeInsight(candidate, persona, config, deps);

    expect(result).not.toBeNull();
    expect(result!.targetDomains).toEqual(["rust", "cpp"]);
    expect(result!.sourceDomains).toEqual(["memory-safety"]);
    expect(result!.relevanceScore).toBe(0.8);
    expect(result!.surpriseScore).toBeCloseTo(0.64);
    expect(result!.compositeScore).toBe(0.8);
    expect(result!.verificationStatus).toBe("unverified");
    expect(result!.sources).toEqual([]);
    expect(result!.id).toMatch(/^[\da-f-]+$/);
  });

  it("uses blindSpot in rationale", async () => {
    const candidate = makeBlindSpot({ blindSpot: "Missing async patterns in Node" });
    const deps = makeSuccessDeps("The event loop architecture of Node has some underexplored patterns for backpressure.");

    const result = await composeInsight(candidate, makePersona(), makeConfig(), deps);

    expect(result).not.toBeNull();
    expect(result!.rationale).toBe("Blind spot: Missing async patterns in Node");
  });
});

// ─── Content quality ───

describe("content quality filtering", () => {
  it("returns null for empty LLM response", async () => {
    const deps = makeSuccessDeps("");

    const result = await composeInsight(makeBlindSpot(), makePersona(), makeConfig(), deps);

    expect(result).toBeNull();
  });

  it("returns null for generic content filtered by isSubstantiveContent", async () => {
    const genericText = "值得关注的是，这个领域有很多新方向。";
    expect(isSubstantiveContent(genericText)).toBe(false);

    const deps = makeSuccessDeps(genericText);

    const result = await composeInsight(makeBlindSpot(), makePersona(), makeConfig(), deps);

    expect(result).toBeNull();
  });
});

// ─── LLM failure ───

describe("LLM failure handling", () => {
  it("returns null on LLM throw", async () => {
    const deps: ComposerDeps = {
      complete: async () => { throw new Error("LLM unavailable"); },
      prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
    };

    const result = await composeInsight(makeBlindSpot(), makePersona(), makeConfig(), deps);

    expect(result).toBeNull();
  });

  it("returns null on prepareModel error", async () => {
    const deps: ComposerDeps = {
      complete: async () => assistantMessage("some text"),
      prepareModel: async () => ({ error: "no API key" }),
    };

    const result = await composeInsight(makeBlindSpot(), makePersona(), makeConfig(), deps);

    expect(result).toBeNull();
  });
});

// ─── Web search ───

describe("web search grounding", () => {
  it("calls webSearch when blindSpot contains factual claims", async () => {
    let searchQuery = "";
    const deps: ComposerDeps = {
      complete: async () => assistantMessage("The ownership model is verified at compile time."),
      prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
      webSearch: async (query) => {
        searchQuery = query;
        return [{ title: "Rust Ownership", url: "https://example.com", snippet: "Compile-time borrow checking" }];
      },
    };
    const candidate = makeBlindSpot({ blindSpot: "User conflates Rust algorithm pattern with C++ RAII in 2024" });

    await composeInsight(candidate, makePersona(), makeConfig(), deps);

    expect(searchQuery).toBeTruthy();
  });

  it("skips webSearch when no factual claims", async () => {
    let searchCalled = false;
    const deps: ComposerDeps = {
      complete: async () => assistantMessage("Some insight text that is specific and concrete enough."),
      prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
      webSearch: async () => {
        searchCalled = true;
        return [];
      },
    };
    const candidate = makeBlindSpot({ blindSpot: "vague impression about something" });

    await composeInsight(candidate, makePersona(), makeConfig(), deps);

    expect(searchCalled).toBe(false);
  });

  it("proceeds without web context on webSearch error", async () => {
    const deps: ComposerDeps = {
      complete: async () => assistantMessage("A specific concrete insight about ownership models in systems programming."),
      prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
      webSearch: async () => { throw new Error("search down"); },
    };
    const candidate = makeBlindSpot({ blindSpot: "Rust framework uses 2 algorithms for protocol optimization" });

    const result = await composeInsight(candidate, makePersona(), makeConfig(), deps);

    expect(result).not.toBeNull();
  });

  it("passes web context to prompt", async () => {
    let capturedPrompt = "";
    const deps: ComposerDeps = {
      complete: async (_m, opts) => {
        const msg = opts.messages[0]!;
        capturedPrompt = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        return assistantMessage("Concrete insight incorporating web findings about the framework.");
      },
      prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
      webSearch: async () => [
        { title: "Rust Blog", url: "https://blog.rust-lang.org", snippet: "New borrow checker improvements" },
      ],
    };
    const candidate = makeBlindSpot({ blindSpot: "Rust framework uses 2 algorithms for protocol optimization" });

    await composeInsight(candidate, makePersona(), makeConfig(), deps);

    expect(capturedPrompt).toContain("Rust Blog");
    expect(capturedPrompt).toContain("New borrow checker improvements");
  });
});

// ─── Language ───

describe("language detection", () => {
  it("includes Chinese instruction by default", async () => {
    let capturedPrompt = "";
    const deps = makeSuccessDeps("一些中文洞察内容，具体且可操作。", (p) => { capturedPrompt = p; });

    await composeInsight(makeBlindSpot(), makePersona(), makeConfig(), deps);

    expect(capturedPrompt).toContain("用中文输出。");
  });

  it("includes English instruction when config.outputLanguage is en", async () => {
    let capturedPrompt = "";
    const deps = makeSuccessDeps("A specific concrete insight about systems programming.", (p) => { capturedPrompt = p; });
    const config = makeConfig();
    config.cognitive!.insight!.outputLanguage = "en";

    await composeInsight(makeBlindSpot(), makePersona(), config, deps);

    expect(capturedPrompt).toContain("Output in English.");
  });

  it("includes English instruction when persona.primaryLanguage is en", async () => {
    let capturedPrompt = "";
    const deps = makeSuccessDeps("A concrete insight about programming language design.", (p) => { capturedPrompt = p; });
    const persona = makePersona({ identity: { coreTraits: {}, expertDomains: [], interestDomains: [], curiosityDomains: [], primaryLanguage: "en" } });

    await composeInsight(makeBlindSpot(), persona, makeConfig(), deps);

    expect(capturedPrompt).toContain("Output in English.");
  });
});

// ─── Opening avoidance ───

describe("opening avoidance", () => {
  it("includes banned openings in prompt when recentInsightContents exist", async () => {
    let capturedPrompt = "";
    const deps = makeSuccessDeps("A different opening insight about Rust ownership and borrowing.", (p) => { capturedPrompt = p; });
    const persona = makePersona({
      feedbackProfile: {
        topicBandits: {},
        preferredStyle: "observation",
        optimalFrequencyHours: 4,
        lastProactiveAt: 0,
        recentInsightIds: [],
        recentInsightContents: ["值得关注的是这个方向", "另一个洞察内容"],
      },
    });

    await composeInsight(makeBlindSpot(), persona, makeConfig(), deps);

    expect(capturedPrompt).toContain("Do NOT start with");
    expect(capturedPrompt).toContain("值得关注的是这个");
  });

  it("does not include banned openings when no recent insights", async () => {
    let capturedPrompt = "";
    const deps = makeSuccessDeps("A specific insight about the user's technical blind spots.", (p) => { capturedPrompt = p; });

    await composeInsight(makeBlindSpot(), makePersona(), makeConfig(), deps);

    expect(capturedPrompt).not.toContain("Do NOT start with");
  });
});

// ─── Prompt verification ───

describe("prompt content", () => {
  it("includes blindSpot text in prompt", async () => {
    let capturedPrompt = "";
    const deps = makeSuccessDeps("A concrete insight about the specific blind spot.", (p) => { capturedPrompt = p; });
    const candidate = makeBlindSpot({ blindSpot: "Missing understanding of effect systems" });

    await composeInsight(candidate, makePersona(), makeConfig(), deps);

    expect(capturedPrompt).toContain("Missing understanding of effect systems");
  });

  it("includes domain names in prompt", async () => {
    let capturedPrompt = "";
    const deps = makeSuccessDeps("A concrete cross-domain insight.", (p) => { capturedPrompt = p; });
    const candidate = makeBlindSpot({ domains: ["rust", "wasm"] });

    await composeInsight(candidate, makePersona(), makeConfig(), deps);

    expect(capturedPrompt).toContain("rust");
    expect(capturedPrompt).toContain("wasm");
  });
});

// ─── containsFactualClaims ───

describe("containsFactualClaims", () => {
  it("returns true for text with 2+ numbers", () => {
    expect(containsFactualClaims("Node 18 has 3 new features")).toBe(true);
  });

  it("returns true for text with technical terms", () => {
    expect(containsFactualClaims("the algorithm uses a novel pattern")).toBe(true);
    expect(containsFactualClaims("a new framework for web development")).toBe(true);
    expect(containsFactualClaims("the protocol handles serialization")).toBe(true);
  });

  it("returns false for vague text", () => {
    expect(containsFactualClaims("something about the user")).toBe(false);
    expect(containsFactualClaims("a general impression")).toBe(false);
  });
});

describe("communicationStyle in prompt", () => {
  it("injects communicationStyle into prompt when available", async () => {
    let capturedPrompt = "";
    const deps = makeSuccessDeps("DPO 取代 RLHF 的代码量只有十分之一，对你之前试的 LoRA 微调路线是个很好的补充。", (p) => { capturedPrompt = p; });
    const persona = makePersona({
      identity: {
        ...makePersona().identity,
        communicationStyle: { formality: "casual", verbosity: "concise", technicalLevel: "expert", preferredLanguage: "zh" },
      },
    });

    await composeInsight(makeBlindSpot(), persona, makeConfig(), deps);

    expect(capturedPrompt).toContain("casual");
    expect(capturedPrompt).toContain("1-2 sentences maximum");
    expect(capturedPrompt).toContain("deep technical literacy");
  });

  it("includes few-shot examples in prompt", async () => {
    let capturedPrompt = "";
    const deps = makeSuccessDeps("Rust embassy 框架用 async/await 做嵌入式并发。", (p) => { capturedPrompt = p; });

    await composeInsight(makeBlindSpot(), makePersona(), makeConfig(), deps);

    expect(capturedPrompt).toContain("EXAMPLES of ideal insights");
    expect(capturedPrompt).toContain("DPO");
  });
});

describe("systemContext passed to LLM", () => {
  it("passes systemContext as systemPrompt when provided", async () => {
    let capturedSystemPrompt: string | undefined;
    const deps: ComposerDeps = {
      complete: async (_model, opts) => {
        capturedSystemPrompt = (opts as unknown as Record<string, unknown>).systemPrompt as string | undefined;
        return assistantMessage("Rust 的所有权模型在编译期就完成了借用检查。");
      },
      prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
      systemContext: "You are a helpful AI with a playful personality.",
    };

    await composeInsight(makeBlindSpot(), makePersona(), makeConfig(), deps);

    expect(capturedSystemPrompt).toBe("You are a helpful AI with a playful personality.");
  });

  it("passes undefined systemPrompt when no systemContext", async () => {
    let capturedSystemPrompt: string | undefined;
    const deps: ComposerDeps = {
      complete: async (_model, opts) => {
        capturedSystemPrompt = (opts as unknown as Record<string, unknown>).systemPrompt as string | undefined;
        return assistantMessage("Rust 的所有权模型在编译期就完成了借用检查。");
      },
      prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
    };

    await composeInsight(makeBlindSpot(), makePersona(), makeConfig(), deps);

    expect(capturedSystemPrompt).toBeUndefined();
  });
});
