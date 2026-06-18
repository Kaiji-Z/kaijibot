import { afterEach, describe, expect, it, vi } from "vitest";
import { probeLlmKey, type ProbeLlmKeyOptions, type ProbeResult } from "./llm-key-probe.js";

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

function makeFetchStub(handler: (req: Request) => Response | Promise<Response>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    return await handler(req);
  }) as unknown as typeof fetch;
}

function withOptions(fetchImpl: typeof fetch): ProbeLlmKeyOptions {
  return { fetchImpl, timeoutMs: 1000 };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("probeLlmKey", () => {
  describe("input normalization", () => {
    it("rejects an empty API key", async () => {
      const result = await probeLlmKey("zai", "", withOptions(vi.fn()));
      expect(result.ok).toBe(false);
      expect(result.skipped).toBeUndefined();
      expect(result.error).toMatch(/empty/i);
    });

    it("rejects a whitespace-only API key", async () => {
      const result = await probeLlmKey("zai", "   ", withOptions(vi.fn()));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/empty/i);
    });
  });

  describe("unknown providers", () => {
    it("returns ok+skipped for an unknown provider (graceful skip)", async () => {
      const fetchMock = vi.fn();
      const result = await probeLlmKey("some-unknown-provider", "key123", withOptions(fetchMock));
      expect(result).toEqual<ProbeResult>({ ok: true, skipped: true });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("skips even when key is non-empty", async () => {
      const result = await probeLlmKey("acme-llm", "abc", withOptions(vi.fn()));
      expect(result.ok).toBe(true);
      expect(result.skipped).toBe(true);
    });
  });

  describe("ZAI / GLM", () => {
    it("valid key returns ok (200 from /models)", async () => {
      globalThis.fetch = makeFetchStub(async (req) => {
        expect(req.method).toBe("GET");
        expect(req.url).toContain("open.bigmodel.cn/api/paas/v4/models");
        expect(req.headers.get("authorization")).toBe("Bearer valid-zai-key");
        return jsonResponse({ data: [{ id: "glm-5.1" }] });
      });

      const result = await probeLlmKey("zai", "valid-zai-key", withOptions(globalThis.fetch));
      expect(result.ok).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("invalid key returns not ok with error message (401)", async () => {
      globalThis.fetch = makeFetchStub(async () =>
        jsonResponse({ error: { message: "invalid api key" } }, { status: 401 }),
      );

      const result = await probeLlmKey("zai", "bad-key", withOptions(globalThis.fetch));
      expect(result.ok).toBe(false);
      expect(typeof result.error).toBe("string");
      expect(result.error!.length).toBeGreaterThan(0);
    });

    it("aliased provider id 'glm' routes to the ZAI prober", async () => {
      let calledUrl = "";
      globalThis.fetch = makeFetchStub(async (req) => {
        calledUrl = req.url;
        return jsonResponse({ data: [] });
      });

      const result = await probeLlmKey("glm", "key", withOptions(globalThis.fetch));
      expect(result.ok).toBe(true);
      expect(calledUrl).toContain("open.bigmodel.cn");
    });
  });

  describe("DeepSeek", () => {
    it("valid key returns ok (200 from /models)", async () => {
      globalThis.fetch = makeFetchStub(async (req) => {
        expect(req.url).toContain("api.deepseek.com");
        expect(req.headers.get("authorization")).toBe("Bearer ds-key");
        return jsonResponse({ data: [{ id: "deepseek-chat" }] });
      });

      const result = await probeLlmKey("deepseek", "ds-key", withOptions(globalThis.fetch));
      expect(result.ok).toBe(true);
    });

    it("invalid key returns not ok (401)", async () => {
      globalThis.fetch = makeFetchStub(async () =>
        jsonResponse({ error: "invalid" }, { status: 401 }),
      );

      const result = await probeLlmKey("deepseek", "bad", withOptions(globalThis.fetch));
      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  describe("Anthropic", () => {
    it("valid key returns ok (200 from /v1/messages)", async () => {
      globalThis.fetch = makeFetchStub(async (req) => {
        expect(req.method).toBe("POST");
        expect(req.url).toContain("api.anthropic.com/v1/messages");
        expect(req.headers.get("x-api-key")).toBe("ant-key");
        expect(req.headers.get("anthropic-version")).toBeTruthy();
        const body = (await req.json()) as { max_tokens: number };
        expect(body.max_tokens).toBeLessThanOrEqual(1);
        return jsonResponse({
          id: "msg_1",
          type: "message",
          role: "assistant",
          content: [],
          model: "claude-test",
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      });

      const result = await probeLlmKey("anthropic", "ant-key", withOptions(globalThis.fetch));
      expect(result.ok).toBe(true);
    });

    it("invalid key returns not ok (401)", async () => {
      globalThis.fetch = makeFetchStub(async () =>
        jsonResponse(
          { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
          { status: 401 },
        ),
      );

      const result = await probeLlmKey("anthropic", "bad", withOptions(globalThis.fetch));
      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  describe("Google / Gemini", () => {
    it("valid key returns ok (200 from /v1beta/models)", async () => {
      globalThis.fetch = makeFetchStub(async (req) => {
        expect(req.method).toBe("GET");
        expect(req.url).toContain("generativelanguage.googleapis.com/v1beta/models");
        expect(req.url).toContain("key=gemini-key");
        return jsonResponse({ models: [{ name: "models/gemini-pro" }] });
      });

      const result = await probeLlmKey("google", "gemini-key", withOptions(globalThis.fetch));
      expect(result.ok).toBe(true);
    });

    it("invalid key returns not ok (400/403)", async () => {
      globalThis.fetch = makeFetchStub(async () =>
        jsonResponse({ error: { message: "API key not valid" } }, { status: 400 }),
      );

      const result = await probeLlmKey("google", "bad", withOptions(globalThis.fetch));
      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("aliased provider id 'gemini' routes to the Google prober", async () => {
      let called = false;
      globalThis.fetch = makeFetchStub(async (req) => {
        called = true;
        expect(req.url).toContain("generativelanguage.googleapis.com");
        return jsonResponse({ models: [] });
      });

      const result = await probeLlmKey("gemini", "key", withOptions(globalThis.fetch));
      expect(called).toBe(true);
      expect(result.ok).toBe(true);
    });
  });

  describe("Qwen / DashScope", () => {
    it("valid key returns ok (200 from /v1/models)", async () => {
      globalThis.fetch = makeFetchStub(async (req) => {
        expect(req.url).toContain("dashscope.aliyuncs.com");
        expect(req.headers.get("authorization")).toBe("Bearer dq-key");
        return jsonResponse({ data: [{ id: "qwen-turbo" }] });
      });

      const result = await probeLlmKey("qwen", "dq-key", withOptions(globalThis.fetch));
      expect(result.ok).toBe(true);
    });

    it("invalid key returns not ok", async () => {
      globalThis.fetch = makeFetchStub(async () =>
        jsonResponse({ message: "Invalid api-key" }, { status: 401 }),
      );

      const result = await probeLlmKey("qwen", "bad", withOptions(globalThis.fetch));
      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  describe("error handling", () => {
    it("network failure returns ok=false with error", async () => {
      globalThis.fetch = makeFetchStub(async () => {
        throw new TypeError("failed to fetch: network error");
      });

      const result = await probeLlmKey("zai", "key", withOptions(globalThis.fetch));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/network|fetch/i);
    });

    it("5xx server error returns ok=false", async () => {
      globalThis.fetch = makeFetchStub(
        async () => new Response("Internal Server Error", { status: 500 }),
      );

      const result = await probeLlmKey("zai", "key", withOptions(globalThis.fetch));
      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("malformed JSON body does not crash; status still drives result", async () => {
      globalThis.fetch = makeFetchStub(
        async () =>
          new Response("<html>error</html>", {
            status: 401,
            headers: { "content-type": "text/html" },
          }),
      );

      const result = await probeLlmKey("zai", "key", withOptions(globalThis.fetch));
      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  describe("provider normalization", () => {
    it("case-insensitive provider id", async () => {
      let calledUrl = "";
      globalThis.fetch = makeFetchStub(async (req) => {
        calledUrl = req.url;
        return jsonResponse({ data: [] });
      });

      const result = await probeLlmKey("ZAI", "key", withOptions(globalThis.fetch));
      expect(result.ok).toBe(true);
      expect(calledUrl).toContain("open.bigmodel.cn");
    });

    it("provider id with surrounding whitespace is trimmed", async () => {
      globalThis.fetch = makeFetchStub(async () => jsonResponse({ data: [] }));

      const result = await probeLlmKey("  zai  ", "key", withOptions(globalThis.fetch));
      expect(result.ok).toBe(true);
    });
  });
});
