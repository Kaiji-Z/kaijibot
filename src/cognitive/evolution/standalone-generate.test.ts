import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedProviderAuth } from "../../agents/model-auth.js";
import type { KaijiBotConfig } from "../../config/types.kaijibot.js";
import {
  createStandaloneGenerateTextBatchWithDeps,
  runBatchGenerate,
  type BackgroundGenerateDeps,
  type BatchHttpDeps,
} from "./standalone-generate.js";

function makeModel(overrides: Partial<Model<Api>> = {}): Model<Api> {
  return {
    id: "glm-5.1",
    name: "GLM 5.1",
    api: "openai-completions" as Api,
    provider: "zai",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8000,
    ...overrides,
  };
}

function makeAuth(overrides: Partial<ResolvedProviderAuth> = {}): ResolvedProviderAuth {
  return { apiKey: "test-key", source: "env", mode: "api-key", ...overrides };
}

function makeResponse(body: unknown, init: { status?: number } = {}): Response {
  const status = init.status ?? 200;
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function resultsJsonl(customId: string, content: string): string {
  return JSON.stringify({
    id: "batch_req_1",
    object: "batch.request",
    custom_id: customId,
    response: {
      status_code: 200,
      body: {
        choices: [{ message: { role: "assistant", content } }],
      },
    },
    error: null,
  });
}

describe("runBatchGenerate", () => {
  it("submits, polls until completed, fetches results, and returns assistant text", async () => {
    const model = makeModel();
    const auth = makeAuth();
    const calls: Array<{ url: string; method: string }> = [];
    const batchId = "batch_abc";
    let outputCustomId = "";
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url: String(url), method });
      const u = String(url);
      if (u.endsWith("/batch") && method === "POST") {
        const parsed = JSON.parse(String(init?.body));
        outputCustomId = parsed.input[0].custom_id;
        return makeResponse({ id: batchId, status: "validating" });
      }
      if (u.includes(`/batches/${batchId}`)) {
        return makeResponse({
          id: batchId,
          status: "completed",
          output_file_id: "file_out",
        });
      }
      if (u.includes("/files/file_out/content")) {
        return makeResponse(resultsJsonl(outputCustomId, "Hello batch world"));
      }
      throw new Error(`unexpected fetch ${method} ${u}`);
    });

    const text = await runBatchGenerate({
      model,
      auth,
      prompt: "hi",
      maxTokens: 100,
      requestTimeoutMs: 1000,
      pollIntervalMs: 1,
      batchTimeoutMs: 5000,
      deps: { fetchFn: fetchFn as unknown as typeof fetch },
    });

    expect(text).toBe("Hello batch world");
    const postSubmit = calls.filter((c) => c.method === "POST" && c.url.endsWith("/batch"));
    expect(postSubmit.length).toBe(1);
    expect(calls.some((c) => c.method === "GET" && c.url.includes(`/batches/${batchId}`))).toBe(
      true,
    );
    expect(calls.some((c) => c.url.includes("/files/file_out/content"))).toBe(true);
  });

  it("sends Authorization Bearer header with the api key", async () => {
    const model = makeModel();
    const auth = makeAuth({ apiKey: "secret-token-xyz" });
    let submittedHeaders: Headers | undefined;
    let outputCustomId = "";
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      submittedHeaders = new Headers(init?.headers as HeadersInit);
      if (u.endsWith("/batch") && method === "POST") {
        const parsed = JSON.parse(String(init?.body));
        outputCustomId = parsed.input[0].custom_id;
        return makeResponse({
          id: "b1",
          status: "completed",
          output_file_id: "f1",
        });
      }
      if (u.includes("/files/f1/content")) {
        return makeResponse(resultsJsonl(outputCustomId, "ok"));
      }
      return makeResponse({});
    });

    const out = await runBatchGenerate({
      model,
      auth,
      prompt: "x",
      maxTokens: 10,
      requestTimeoutMs: 1000,
      pollIntervalMs: 1,
      batchTimeoutMs: 5000,
      deps: { fetchFn: fetchFn as unknown as typeof fetch },
    });

    expect(out).toBe("ok");
    expect(submittedHeaders?.get("Authorization")).toBe("Bearer secret-token-xyz");
  });

  it("throws when submit returns a non-ok response", async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/batch") && init?.method === "POST") {
        return makeResponse("invalid endpoint", { status: 400 });
      }
      return makeResponse({});
    });

    await expect(
      runBatchGenerate({
        model: makeModel(),
        auth: makeAuth(),
        prompt: "x",
        maxTokens: 10,
        requestTimeoutMs: 1000,
        pollIntervalMs: 1,
        batchTimeoutMs: 5000,
        deps: { fetchFn: fetchFn as unknown as typeof fetch },
      }),
    ).rejects.toThrow(/Batch submit failed \(400\)/);
  });

  it("throws when batch ends in failed status", async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (u.endsWith("/batch") && method === "POST") {
        return makeResponse({ id: "bfail", status: "in_progress" });
      }
      if (u.includes("/batches/bfail")) {
        return makeResponse({
          id: "bfail",
          status: "failed",
          errors: { data: [{ message: "rate limited" }] },
        });
      }
      return makeResponse({});
    });

    await expect(
      runBatchGenerate({
        model: makeModel(),
        auth: makeAuth(),
        prompt: "x",
        maxTokens: 10,
        requestTimeoutMs: 1000,
        pollIntervalMs: 1,
        batchTimeoutMs: 5000,
        deps: { fetchFn: fetchFn as unknown as typeof fetch },
      }),
    ).rejects.toThrow(/failed: rate limited/);
  });

  it("throws when batch times out before reaching a terminal status", async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (u.endsWith("/batch") && method === "POST") {
        return makeResponse({ id: "bstuck", status: "in_progress" });
      }
      // Always still in_progress
      return makeResponse({ id: "bstuck", status: "in_progress" });
    });

    await expect(
      runBatchGenerate({
        model: makeModel(),
        auth: makeAuth(),
        prompt: "x",
        maxTokens: 10,
        requestTimeoutMs: 1000,
        pollIntervalMs: 1,
        batchTimeoutMs: 5,
        deps: { fetchFn: fetchFn as unknown as typeof fetch },
      }),
    ).rejects.toThrow(/timed out/);
  });

  it("throws when results file is missing the custom_id entry", async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (u.endsWith("/batch") && method === "POST") {
        const parsed = JSON.parse(String(init?.body));
        return makeResponse({
          id: "bmiss",
          status: "completed",
          output_file_id: "fmiss",
          _customId: parsed.input[0].custom_id,
        });
      }
      if (u.includes("/files/fmiss/content")) {
        return makeResponse(resultsJsonl("some-other-id", "nope"));
      }
      return makeResponse({});
    });

    await expect(
      runBatchGenerate({
        model: makeModel(),
        auth: makeAuth(),
        prompt: "x",
        maxTokens: 10,
        requestTimeoutMs: 1000,
        pollIntervalMs: 1,
        batchTimeoutMs: 5000,
        deps: { fetchFn: fetchFn as unknown as typeof fetch },
      }),
    ).rejects.toThrow(/missing entry for custom_id/);
  });
});

describe("createStandaloneGenerateTextBatchWithDeps (config gate)", () => {
  function makeBatchDeps(opts: {
    run: typeof runBatchGenerate;
    http: BatchHttpDeps;
  }): BackgroundGenerateDeps {
    const noop = vi.fn(async () => "") as unknown;
    return {
      sync: {
        complete: noop as never,
        prepareModel: vi.fn(async () => ({
          model: makeModel(),
          auth: makeAuth(),
        })) as never,
      },
      batch: {
        complete: noop as never,
        prepareModel: vi.fn(async () => ({ model: makeModel(), auth: makeAuth() })) as never,
        run: opts.run,
        http: opts.http,
      },
    };
  }

  it("builds a function that delegates to the injected batch runner", async () => {
    const run = vi.fn(async () => "batch result");
    const factory = createStandaloneGenerateTextBatchWithDeps(
      makeBatchDeps({ run, http: { fetchFn: vi.fn() as unknown as typeof fetch } }),
      {},
    );
    const fn = await factory({} as KaijiBotConfig);
    const out = await fn("prompt");
    expect(out).toBe("batch result");
    expect(run).toHaveBeenCalledOnce();
  });
});
