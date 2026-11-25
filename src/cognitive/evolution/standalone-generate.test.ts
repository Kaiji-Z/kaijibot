import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedProviderAuth } from "../../agents/model-auth.js";
import type { KaijiBotConfig } from "../../config/types.kaijibot.js";
import {
  createStandaloneGenerateTextBatchWithDeps,
  createStandaloneGenerateTextWithDeps,
  runBatchGenerate,
  type BackgroundGenerateDeps,
  type BatchHttpDeps,
  type StandaloneGenerateDeps,
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

// The request the synchronous path builds, as the batch path receives it.
const buildRequest = async (prompt: string): Promise<Record<string, unknown>> => ({
  model: "glm-5.1",
  messages: [{ role: "user", content: prompt }],
  max_completion_tokens: 10,
});

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
      if (u.endsWith("/batches") && method === "POST") {
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
      requestTimeoutMs: 1000,
      pollIntervalMs: 1,
      batchTimeoutMs: 5000,
      deps: { fetchFn: fetchFn as unknown as typeof fetch, buildRequest },
    });

    expect(text).toBe("Hello batch world");
    const postSubmit = calls.filter((c) => c.method === "POST" && c.url.endsWith("/batches"));
    expect(postSubmit.length).toBe(1);
    expect(calls.some((c) => c.method === "GET" && c.url.includes(`/batches/${batchId}`))).toBe(
      true,
    );
    expect(calls.some((c) => c.url.includes("/files/file_out/content"))).toBe(true);
  });

  it.each([
    ["https://open.bigmodel.cn/api/paas/v4", "/api/paas/v4/chat/completions"],
    ["https://api.openai.com/v1", "/v1/chat/completions"],
    ["https://api.openai.com/v1/", "/v1/chat/completions"],
  ])(
    "submits to %s the request the synchronous path builds, addressed as %s",
    async (baseUrl, requestUrl) => {
      let outputCustomId = "";
      let submitted: { endpoint?: string; url?: string; body?: unknown } | undefined;
      const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.endsWith("/batches") && init?.method === "POST") {
          const parsed = JSON.parse(String(init?.body));
          outputCustomId = parsed.input[0].custom_id;
          submitted = {
            endpoint: parsed.endpoint,
            url: parsed.input[0].url,
            body: parsed.input[0].body,
          };
          return makeResponse({ id: "b1", status: "completed", output_file_id: "f1" });
        }
        if (u.includes("/files/f1/content")) {
          return makeResponse(resultsJsonl(outputCustomId, "ok"));
        }
        return makeResponse({});
      });

      const out = await runBatchGenerate({
        model: makeModel({ baseUrl }),
        auth: makeAuth(),
        prompt: "x",
        requestTimeoutMs: 1000,
        pollIntervalMs: 1,
        batchTimeoutMs: 5000,
        deps: { fetchFn: fetchFn as unknown as typeof fetch, buildRequest },
      });

      expect(out).toBe("ok");
      expect(submitted).toEqual({
        endpoint: requestUrl,
        url: requestUrl,
        body: {
          model: "glm-5.1",
          messages: [{ role: "user", content: "x" }],
          max_completion_tokens: 10,
        },
      });
    },
  );

  it("creates the batch where the API lists them", async () => {
    const calls: string[] = [];
    let outputCustomId = "";
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${new URL(u).pathname}`);
      if (method === "POST") {
        outputCustomId = JSON.parse(String(init?.body)).input[0].custom_id;
        return makeResponse({ id: "b1", status: "completed", output_file_id: "f1" });
      }
      if (u.includes("/files/f1/content")) {
        return makeResponse(resultsJsonl(outputCustomId, "ok"));
      }
      return makeResponse({});
    });

    const out = await runBatchGenerate({
      model: makeModel({ baseUrl: "https://api.openai.com/v1" }),
      auth: makeAuth(),
      prompt: "x",
      requestTimeoutMs: 1000,
      pollIntervalMs: 1,
      batchTimeoutMs: 5000,
      deps: { fetchFn: fetchFn as unknown as typeof fetch, buildRequest },
    });

    expect(out).toBe("ok");
    expect(calls).toEqual(["POST /v1/batches", "GET /v1/files/f1/content"]);
  });

  it("refuses a model that is not served over chat completions", async () => {
    const fetchFn = vi.fn();

    await expect(
      runBatchGenerate({
        model: makeModel({ api: "anthropic-messages" as Api }),
        auth: makeAuth(),
        prompt: "x",
        requestTimeoutMs: 1000,
        pollIntervalMs: 1,
        batchTimeoutMs: 5000,
        deps: { fetchFn: fetchFn as unknown as typeof fetch, buildRequest },
      }),
    ).rejects.toThrow(/chat completions requests only, not anthropic-messages/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("reports the upstream error of a failed request", async () => {
    let customId = "";
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/batches") && init?.method === "POST") {
        customId = JSON.parse(String(init?.body)).input[0].custom_id;
        return makeResponse({ id: "b400", status: "completed", output_file_id: "f400" });
      }
      if (u.includes("/files/f400/content")) {
        return makeResponse(
          JSON.stringify({
            id: "batch_req_1",
            custom_id: customId,
            response: {
              status_code: 400,
              body: { error: { code: "1210", message: "thinking cannot be disabled" } },
            },
            error: null,
          }),
        );
      }
      return makeResponse({});
    });

    await expect(
      runBatchGenerate({
        model: makeModel(),
        auth: makeAuth(),
        prompt: "x",
        requestTimeoutMs: 1000,
        pollIntervalMs: 1,
        batchTimeoutMs: 5000,
        deps: { fetchFn: fetchFn as unknown as typeof fetch, buildRequest },
      }),
    ).rejects.toThrow(/failed upstream \(400\).*thinking cannot be disabled/);
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
      if (u.endsWith("/batches") && method === "POST") {
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
      requestTimeoutMs: 1000,
      pollIntervalMs: 1,
      batchTimeoutMs: 5000,
      deps: { fetchFn: fetchFn as unknown as typeof fetch, buildRequest },
    });

    expect(out).toBe("ok");
    expect(submittedHeaders?.get("Authorization")).toBe("Bearer secret-token-xyz");
  });

  it("throws when submit returns a non-ok response", async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/batches") && init?.method === "POST") {
        return makeResponse("invalid endpoint", { status: 400 });
      }
      return makeResponse({});
    });

    await expect(
      runBatchGenerate({
        model: makeModel(),
        auth: makeAuth(),
        prompt: "x",
        requestTimeoutMs: 1000,
        pollIntervalMs: 1,
        batchTimeoutMs: 5000,
        deps: { fetchFn: fetchFn as unknown as typeof fetch, buildRequest },
      }),
    ).rejects.toThrow(/Batch submit failed \(400\)/);
  });

  it("throws when batch ends in failed status", async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (u.endsWith("/batches") && method === "POST") {
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
        requestTimeoutMs: 1000,
        pollIntervalMs: 1,
        batchTimeoutMs: 5000,
        deps: { fetchFn: fetchFn as unknown as typeof fetch, buildRequest },
      }),
    ).rejects.toThrow(/failed: rate limited/);
  });

  it("throws when batch times out before reaching a terminal status", async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (u.endsWith("/batches") && method === "POST") {
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
        requestTimeoutMs: 1000,
        pollIntervalMs: 1,
        batchTimeoutMs: 5,
        deps: { fetchFn: fetchFn as unknown as typeof fetch, buildRequest },
      }),
    ).rejects.toThrow(/timed out/);
  });

  it("throws when results file is missing the custom_id entry", async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (u.endsWith("/batches") && method === "POST") {
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
        requestTimeoutMs: 1000,
        pollIntervalMs: 1,
        batchTimeoutMs: 5000,
        deps: { fetchFn: fetchFn as unknown as typeof fetch, buildRequest },
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
      makeBatchDeps({ run, http: { fetchFn: vi.fn() as unknown as typeof fetch, buildRequest } }),
      {},
    );
    const fn = await factory({} as KaijiBotConfig);
    const out = await fn("prompt");
    expect(out).toBe("batch result");
    expect(run).toHaveBeenCalledOnce();
  });
});

describe("createStandaloneGenerateTextWithDeps", () => {
  function assistantMessage(params: {
    stopReason: AssistantMessage["stopReason"];
    text?: string;
    errorMessage?: string;
  }): AssistantMessage {
    return {
      role: "assistant",
      content: params.text ? [{ type: "text", text: params.text }] : [],
      api: "openai-completions",
      provider: "zai",
      model: "glm-5.1",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: params.stopReason,
      ...(params.errorMessage ? { errorMessage: params.errorMessage } : {}),
      timestamp: 0,
    } as AssistantMessage;
  }

  async function generateText(result: AssistantMessage): Promise<string> {
    const deps: StandaloneGenerateDeps = {
      complete: vi.fn(async () => result) as unknown as StandaloneGenerateDeps["complete"],
      prepareModel: vi.fn(async () => ({ model: makeModel(), auth: makeAuth() })),
    };
    const generate = await createStandaloneGenerateTextWithDeps(deps, {})({} as KaijiBotConfig);
    return await generate("prompt");
  }

  it("returns the assistant text of a completed call", async () => {
    const out = await generateText(
      assistantMessage({ stopReason: "stop", text: "  hello world " }),
    );
    expect(out).toBe("hello world");
  });

  it("rejects with the provider error instead of answering an empty string", async () => {
    await expect(
      generateText(
        assistantMessage({
          stopReason: "error",
          errorMessage: "HTTP 400: thinking cannot be disabled",
        }),
      ),
    ).rejects.toThrow("thinking cannot be disabled");
  });

  it("rejects a call that was aborted before it finished", async () => {
    await expect(
      generateText(assistantMessage({ stopReason: "aborted", text: "partial" })),
    ).rejects.toThrow("aborted");
  });
});
