import type { Api, AssistantMessage, Model } from "@mariozechner/pi-ai";
import { describe, expect, it, vi } from "vitest";
import type { KaijiBotConfig } from "../../../config/config.js";
import type { VerificationDeps } from "./pipeline.js";
import { verifyInsight, verifyInsightLLM } from "./pipeline.js";

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

function makeAssistantResponse(text: string): AssistantMessage {
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

function makeConfig(): KaijiBotConfig {
  return {} as KaijiBotConfig;
}

const SAMPLE_SOURCES = [
  { url: "https://a.com", title: "Source A", snippet: "Rust is fast", credibility: 0.7 },
  { url: "https://b.com", title: "Source B", snippet: "Rust performance benchmarks", credibility: 0.8 },
];

describe("verifyInsight", () => {
  it("returns unverified with no sources", () => {
    const result = verifyInsight({
      content: "Some claim",
      sources: [],
      verificationLevel: "basic",
    });
    expect(result.status).toBe("unverified");
    expect(result.confidence).toBe(0);
  });

  it("returns unverified when all sources have low credibility", () => {
    const result = verifyInsight({
      content: "Some claim",
      sources: [{ url: "https://example.com", title: "Example", credibility: 0.1 }],
      verificationLevel: "basic",
    });
    expect(result.status).toBe("unverified");
  });

  it("returns partial with one credible source on basic level", () => {
    const result = verifyInsight({
      content: "Some claim",
      sources: [{ url: "https://example.com", title: "Example", credibility: 0.5 }],
      verificationLevel: "basic",
    });
    expect(result.status).toBe("partial");
  });

  it("returns partial with one credible source on strict level", () => {
    const result = verifyInsight({
      content: "Some claim",
      sources: [{ url: "https://example.com", title: "Example", credibility: 0.7 }],
      verificationLevel: "strict",
    });
    expect(result.status).toBe("partial");
  });

  it("returns verified with 2+ credible sources on strict level", () => {
    const result = verifyInsight({
      content: "Some claim",
      sources: [
        { url: "https://a.com", title: "A", credibility: 0.7 },
        { url: "https://b.com", title: "B", credibility: 0.8 },
      ],
      verificationLevel: "strict",
    });
    expect(result.status).toBe("verified");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("returns partial on paranoid level with fewer than 3 high-cred sources", () => {
    const result = verifyInsight({
      content: "Some claim",
      sources: [
        { url: "https://a.com", title: "A", credibility: 0.6 },
        { url: "https://b.com", title: "B", credibility: 0.7 },
      ],
      verificationLevel: "paranoid",
    });
    expect(result.status).toBe("partial");
  });

  it("returns verified on paranoid level with 3+ high-cred sources", () => {
    const result = verifyInsight({
      content: "Some claim",
      sources: [
        { url: "https://a.com", title: "A", credibility: 0.6 },
        { url: "https://b.com", title: "B", credibility: 0.7 },
        { url: "https://c.com", title: "C", credibility: 0.8 },
      ],
      verificationLevel: "paranoid",
    });
    expect(result.status).toBe("verified");
    expect(result.confidence).toBeGreaterThan(0);
  });
});

describe("verifyInsightLLM", () => {
  it("returns unverified with no sources", async () => {
    const deps: VerificationDeps = {
      complete: vi.fn(),
      prepareModel: vi.fn(),
    };
    const result = await verifyInsightLLM("Some claim", [], makeConfig(), deps);
    expect(result.status).toBe("unverified");
    expect(result.confidence).toBe(0);
    expect(deps.complete).not.toHaveBeenCalled();
  });

  it("returns verified when LLM says consistent", async () => {
    const deps: VerificationDeps = {
      complete: vi.fn(async () =>
        makeAssistantResponse("VERDICT: consistent\nCONFIDENCE: 0.9\nNOTES: All claims are supported."),
      ),
      prepareModel: vi.fn(async () => ({ model: TEST_MODEL, auth: TEST_AUTH })),
    };
    const result = await verifyInsightLLM("Rust is fast", SAMPLE_SOURCES, makeConfig(), deps);
    expect(result.status).toBe("verified");
    expect(result.confidence).toBeCloseTo(0.9);
    expect(result.notes).toBe("All claims are supported.");
    expect(result.sources).toHaveLength(2);
  });

  it("returns unverified when LLM says inconsistent", async () => {
    const deps: VerificationDeps = {
      complete: vi.fn(async () =>
        makeAssistantResponse("VERDICT: inconsistent\nCONFIDENCE: 0.8\nNOTES: Claims contradict sources."),
      ),
      prepareModel: vi.fn(async () => ({ model: TEST_MODEL, auth: TEST_AUTH })),
    };
    const result = await verifyInsightLLM("Rust is slow", SAMPLE_SOURCES, makeConfig(), deps);
    expect(result.status).toBe("unverified");
    expect(result.confidence).toBeLessThanOrEqual(0.3);
    expect(result.notes).toBe("Claims contradict sources.");
  });

  it("returns partial when LLM says partially_consistent", async () => {
    const deps: VerificationDeps = {
      complete: vi.fn(async () =>
        makeAssistantResponse("VERDICT: partially_consistent\nCONFIDENCE: 0.6\nNOTES: Some claims are unsupported."),
      ),
      prepareModel: vi.fn(async () => ({ model: TEST_MODEL, auth: TEST_AUTH })),
    };
    const result = await verifyInsightLLM("Rust is fast and easy", SAMPLE_SOURCES, makeConfig(), deps);
    expect(result.status).toBe("partial");
    expect(result.confidence).toBeCloseTo(0.6);
  });

  it("falls back when model preparation fails", async () => {
    const deps: VerificationDeps = {
      complete: vi.fn(),
      prepareModel: vi.fn(async () => ({ error: "no api key" })),
    };
    const result = await verifyInsightLLM("Rust is fast", SAMPLE_SOURCES, makeConfig(), deps);
    expect(result.status).toBe("verified");
    expect(result.confidence).toBe(0.5);
    expect(result.notes).toContain("Fallback");
    expect(deps.complete).not.toHaveBeenCalled();
  });

  it("falls back when LLM call throws", async () => {
    const deps: VerificationDeps = {
      complete: vi.fn(async () => {
        throw new Error("network error");
      }),
      prepareModel: vi.fn(async () => ({ model: TEST_MODEL, auth: TEST_AUTH })),
    };
    const result = await verifyInsightLLM("Rust is fast", SAMPLE_SOURCES, makeConfig(), deps);
    expect(result.notes).toContain("Fallback");
  });

  it("falls back when LLM returns unparseable response", async () => {
    const deps: VerificationDeps = {
      complete: vi.fn(async () =>
        makeAssistantResponse("I cannot verify this."),
      ),
      prepareModel: vi.fn(async () => ({ model: TEST_MODEL, auth: TEST_AUTH })),
    };
    const result = await verifyInsightLLM("Rust is fast", SAMPLE_SOURCES, makeConfig(), deps);
    expect(result.status).toBe("partial");
    expect(result.confidence).toBe(0.5);
  });

  it("filters sources by credibility threshold", async () => {
    const sources = [
      { url: "https://a.com", title: "Good", credibility: 0.7 },
      { url: "https://b.com", title: "Low", credibility: 0.1 },
    ];
    const deps: VerificationDeps = {
      complete: vi.fn(async () =>
        makeAssistantResponse("VERDICT: consistent\nCONFIDENCE: 0.85\nNOTES: Looks good."),
      ),
      prepareModel: vi.fn(async () => ({ model: TEST_MODEL, auth: TEST_AUTH })),
    };
    const result = await verifyInsightLLM("A claim", sources, makeConfig(), deps);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].title).toBe("Good");
  });

  it("clamps confidence to [0, 1] range", async () => {
    const deps: VerificationDeps = {
      complete: vi.fn(async () =>
        makeAssistantResponse("VERDICT: consistent\nCONFIDENCE: 2.5\nNOTES: High confidence."),
      ),
      prepareModel: vi.fn(async () => ({ model: TEST_MODEL, auth: TEST_AUTH })),
    };
    const result = await verifyInsightLLM("A claim", SAMPLE_SOURCES, makeConfig(), deps);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });

  it("falls back with single credible source", async () => {
    const singleSource = [{ url: "https://a.com", title: "A", credibility: 0.5 }];
    const deps: VerificationDeps = {
      complete: vi.fn(),
      prepareModel: vi.fn(async () => ({ error: "fail" })),
    };
    const result = await verifyInsightLLM("Claim", singleSource, makeConfig(), deps);
    expect(result.status).toBe("partial");
    expect(result.confidence).toBe(0.3);
  });

  it("falls back with no credible sources", async () => {
    const lowCredSources = [{ url: "https://a.com", title: "A", credibility: 0.1 }];
    const deps: VerificationDeps = {
      complete: vi.fn(),
      prepareModel: vi.fn(async () => ({ error: "fail" })),
    };
    const result = await verifyInsightLLM("Claim", lowCredSources, makeConfig(), deps);
    expect(result.status).toBe("unverified");
    expect(result.confidence).toBe(0);
  });
});
