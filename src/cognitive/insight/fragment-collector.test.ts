import type { Api, AssistantMessage, Model } from "@mariozechner/pi-ai";
import { describe, expect, it, vi } from "vitest";
import type { KaijiBotConfig } from "../../config/config.js";
import type { PersonaTree } from "../types.js";
import type { FragmentCollectorDeps } from "./fragment-collector.js";
import {
  collectFragments,
  shouldSkipTurn,
  buildFragmentPrompt,
  parseFragments,
} from "./fragment-collector.js";

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

function makePersona(overrides?: Partial<PersonaTree>): PersonaTree {
  return {
    identity: {
      coreTraits: {},
      expertDomains: ["typescript"],
      interestDomains: ["rust"],
      curiosityDomains: [],
    },
    domains: {
      typescript: {
        depth: 5,
        recurrence: 10,
        lastMentioned: Date.now(),
        keyInsights: ["type narrowing"],
        activeQuestions: [],
        connections: [],
        negationSignals: 0,
      },
      rust: {
        depth: 3,
        recurrence: 4,
        lastMentioned: Date.now(),
        keyInsights: ["ownership model"],
        activeQuestions: [],
        connections: [],
        negationSignals: 0,
      },
    },
    recentFocus: [],
    activeProjects: [],
    pendingQuestions: [],
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

function makeConfig(): KaijiBotConfig {
  return {} as KaijiBotConfig;
}

function validFragmentResponse(): string {
  return JSON.stringify([
    {
      kind: "assumption",
      evidence: "The user assumes that type narrowing always works with instanceof checks",
      domains: ["typescript"],
      structuralTag: "incomplete-model",
      strength: 0.8,
    },
    {
      kind: "knowledge_gap",
      evidence: "User doesn't know about template literal types for string validation",
      domains: ["typescript", "rust"],
      structuralTag: "meta-blindness",
      strength: 0.6,
    },
  ]);
}

function makeDeps(
  onCall?: (messages: Array<{ role: string; content: string }>) => void,
  response?: string,
): FragmentCollectorDeps {
  return {
    complete: vi.fn(async (_model, context, _options) => {
      if (onCall) onCall(context.messages as Array<{ role: string; content: string }>);
      return assistantMessage(response ?? validFragmentResponse());
    }),
    prepareModel: vi.fn(async () => ({ model: TEST_MODEL, auth: TEST_AUTH })),
  };
}

const SUBSTANTIVE_USER_TEXT = "我一直在想，为什么 Rust 的所有权模型和 TypeScript 的类型系统在内存安全方面有完全不同的设计哲学？是因为它们解决的问题本质不同吗？";
const ASSISTANT_TEXT = "Rust 的所有权模型解决的是运行时内存安全问题，而 TypeScript 的类型系统解决的是编译时类型安全问题。它们确实在不同层面工作。";

// ─── Success path ───

describe("collectFragments — success path", () => {
  it("returns 1-2 fragments from valid LLM response", async () => {
    const result = await collectFragments(
      SUBSTANTIVE_USER_TEXT, ASSISTANT_TEXT,
      makePersona(), makeConfig(), makeDeps(),
    );
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it("fills id, createdAt, expiresAt for each fragment", async () => {
    const before = Date.now();
    const result = await collectFragments(
      SUBSTANTIVE_USER_TEXT, ASSISTANT_TEXT,
      makePersona(), makeConfig(), makeDeps(),
    );
    const after = Date.now();
    expect(result.length).toBeGreaterThan(0);
    for (const frag of result) {
      expect(frag.id).toBeTruthy();
      expect(typeof frag.id).toBe("string");
      expect(frag.createdAt).toBeGreaterThanOrEqual(before);
      expect(frag.createdAt).toBeLessThanOrEqual(after);
      expect(frag.expiresAt).toBe(frag.createdAt + 14 * 24 * 60 * 60 * 1000);
    }
  });

  it("truncates evidence to 200 chars", async () => {
    const longEvidence = "A".repeat(300);
    const response = JSON.stringify([{
      kind: "assumption",
      evidence: longEvidence,
      structuralTag: "test",
      strength: 0.5,
    }]);
    const result = await collectFragments(
      SUBSTANTIVE_USER_TEXT, ASSISTANT_TEXT,
      makePersona(), makeConfig(), makeDeps(undefined, response),
    );
    expect(result.length).toBe(1);
    expect(result[0]!.evidence.length).toBe(200);
  });

  it("clamps strength to 0–1 range", async () => {
    const response = JSON.stringify([
      { kind: "assumption", evidence: "test evidence", structuralTag: "tag", strength: 1.5 },
      { kind: "knowledge_gap", evidence: "gap evidence", structuralTag: "gap", strength: -0.3 },
    ]);
    const result = await collectFragments(
      SUBSTANTIVE_USER_TEXT, ASSISTANT_TEXT,
      makePersona(), makeConfig(), makeDeps(undefined, response),
    );
    expect(result.length).toBe(2);
    expect(result[0]!.strength).toBe(1);
    expect(result[1]!.strength).toBe(0);
  });
});

// ─── Trivial turn filtering ───

describe("collectFragments — trivial turn filtering", () => {
  it("returns empty for empty user text", async () => {
    const result = await collectFragments(
      "", ASSISTANT_TEXT,
      makePersona(), makeConfig(), makeDeps(),
    );
    expect(result).toEqual([]);
  });

  it("returns empty for short user text (<20 chars)", async () => {
    const result = await collectFragments(
      "这是很短的消息", ASSISTANT_TEXT,
      makePersona(), makeConfig(), makeDeps(),
    );
    expect(result).toEqual([]);
  });

  it("returns empty for Chinese acknowledgment patterns", async () => {
    const acks = ["好的", "嗯", "收到", "了解", "谢谢", "感谢", "明白", "知道", "可以", "行", "对", "是", "不错", "没问题"];
    for (const ack of acks) {
      const result = await collectFragments(
        ack, ASSISTANT_TEXT,
        makePersona(), makeConfig(), makeDeps(),
      );
      expect(result).toEqual([]);
    }
  });

  it("returns empty for pure punctuation/emoji", async () => {
    const result = await collectFragments(
      "！？。，…", ASSISTANT_TEXT,
      makePersona(), makeConfig(), makeDeps(),
    );
    expect(result).toEqual([]);
  });

  it("processes substantive user text normally", async () => {
    const deps = makeDeps();
    const result = await collectFragments(
      SUBSTANTIVE_USER_TEXT, ASSISTANT_TEXT,
      makePersona(), makeConfig(), deps,
    );
    expect(result.length).toBeGreaterThan(0);
    expect(deps.complete).toHaveBeenCalledOnce();
  });
});

// ─── LLM failure modes ───

describe("collectFragments — LLM failure modes", () => {
  it("returns empty on LLM throw (general Error)", async () => {
    const deps: FragmentCollectorDeps = {
      complete: vi.fn(async () => { throw new Error("LLM unavailable"); }),
      prepareModel: vi.fn(async () => ({ model: TEST_MODEL, auth: TEST_AUTH })),
    };
    const result = await collectFragments(
      SUBSTANTIVE_USER_TEXT, ASSISTANT_TEXT,
      makePersona(), makeConfig(), deps,
    );
    expect(result).toEqual([]);
  });

  it("returns empty when prepareModel returns error", async () => {
    const deps: FragmentCollectorDeps = {
      complete: vi.fn(async () => assistantMessage("[]")),
      prepareModel: vi.fn(async () => ({ error: "No API key configured" })),
    };
    const result = await collectFragments(
      SUBSTANTIVE_USER_TEXT, ASSISTANT_TEXT,
      makePersona(), makeConfig(), deps,
    );
    expect(result).toEqual([]);
    expect(deps.complete).not.toHaveBeenCalled();
  });

  it("returns empty on empty LLM response", async () => {
    const deps = makeDeps(undefined, "");
    const result = await collectFragments(
      SUBSTANTIVE_USER_TEXT, ASSISTANT_TEXT,
      makePersona(), makeConfig(), deps,
    );
    expect(result).toEqual([]);
  });

  it("returns empty on malformed JSON", async () => {
    const deps = makeDeps(undefined, "this is not json at all");
    const result = await collectFragments(
      SUBSTANTIVE_USER_TEXT, ASSISTANT_TEXT,
      makePersona(), makeConfig(), deps,
    );
    expect(result).toEqual([]);
  });

  it("returns empty on JSON without array", async () => {
    const deps = makeDeps(undefined, JSON.stringify({ kind: "assumption" }));
    const result = await collectFragments(
      SUBSTANTIVE_USER_TEXT, ASSISTANT_TEXT,
      makePersona(), makeConfig(), deps,
    );
    expect(result).toEqual([]);
  });

  it("returns empty on items missing required fields", async () => {
    const deps = makeDeps(undefined, JSON.stringify([
      { kind: "assumption" },
      { evidence: "missing kind" },
      {},
    ]));
    const result = await collectFragments(
      SUBSTANTIVE_USER_TEXT, ASSISTANT_TEXT,
      makePersona(), makeConfig(), deps,
    );
    expect(result).toEqual([]);
  });
});

// ─── Parsing ───

describe("parseFragments", () => {
  it("strips markdown code fences from response", () => {
    const fenced = "```json\n" + validFragmentResponse() + "\n```";
    const result = parseFragments(fenced);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("filters items with invalid kind values", () => {
    const input = JSON.stringify([
      { kind: "assumption", evidence: "valid", structuralTag: "tag" },
      { kind: "invalid_kind", evidence: "invalid", structuralTag: "tag" },
      { kind: "knowledge_gap", evidence: "also valid", structuralTag: "gap" },
    ]);
    const result = parseFragments(input);
    expect(result).toHaveLength(2);
    expect(result[0]!.kind).toBe("assumption");
    expect(result[1]!.kind).toBe("knowledge_gap");
  });

  it("limits to 2 fragments max", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      kind: "assumption",
      evidence: `evidence ${i}`,
      structuralTag: `tag-${i}`,
    }));
    const result = parseFragments(JSON.stringify(items));
    expect(result).toHaveLength(2);
  });

  it("defaults strength to 0.5 when missing", () => {
    const input = JSON.stringify([{
      kind: "assumption",
      evidence: "test evidence",
      structuralTag: "tag",
    }]);
    const result = parseFragments(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.strength).toBe(0.5);
  });

  it("defaults domains to [] when missing or not array", () => {
    const input = JSON.stringify([
      { kind: "assumption", evidence: "e1", structuralTag: "t1", domains: "not-array" },
      { kind: "knowledge_gap", evidence: "e2", structuralTag: "t2" },
    ]);
    const result = parseFragments(input);
    expect(result).toHaveLength(2);
    expect(result[0]!.domains).toEqual([]);
    expect(result[1]!.domains).toEqual([]);
  });
});

// ─── Prompt verification ───

describe("buildFragmentPrompt", () => {
  it("includes user domains in prompt", () => {
    const persona = makePersona();
    const prompt = buildFragmentPrompt(SUBSTANTIVE_USER_TEXT, ASSISTANT_TEXT, persona);
    expect(prompt).toContain("typescript");
    expect(prompt).toContain("rust");
  });

  it("includes user and assistant text in prompt", () => {
    const prompt = buildFragmentPrompt("my user text here", "my assistant reply here", makePersona());
    expect(prompt).toContain("my user text here");
    expect(prompt).toContain("my assistant reply here");
  });

  it("captures prompt text via onCall callback", async () => {
    let capturedPrompt = "";
    const deps = makeDeps((messages) => {
      if (messages.length > 0) capturedPrompt = messages[0]!.content;
    });
    await collectFragments(
      SUBSTANTIVE_USER_TEXT, ASSISTANT_TEXT,
      makePersona(), makeConfig(), deps,
    );
    expect(capturedPrompt).toContain("typescript");
    expect(capturedPrompt).toContain(SUBSTANTIVE_USER_TEXT.slice(0, 30));
  });
});

// ─── shouldSkipTurn ───

describe("shouldSkipTurn", () => {
  it("skips Chinese acknowledgment patterns", () => {
    const acks = ["好的", "嗯", "收到", "谢谢", "明白", "是"];
    for (const ack of acks) {
      expect(shouldSkipTurn(ack)).toBe(true);
    }
  });

  it("skips text under 20 chars", () => {
    expect(shouldSkipTurn("短消息")).toBe(true);
    expect(shouldSkipTurn("short")).toBe(true);
    expect(shouldSkipTurn("")).toBe(true);
  });

  it("does not skip substantive text", () => {
    expect(shouldSkipTurn(SUBSTANTIVE_USER_TEXT)).toBe(false);
    expect(shouldSkipTurn("This is a substantive message about typescript patterns")).toBe(false);
  });
});
