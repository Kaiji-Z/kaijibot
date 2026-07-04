import { describe, expect, it, vi } from "vitest";
import {
  extractMajorVersionFamily,
  fetchAnthropicModelIds,
  fetchGoogleModelIds,
  fetchOpenAICompatibleModelIds,
  fetchProviderModelIds,
  findFamilyEntry,
  type FamilyCatalogEntry,
} from "./model-discovery-providers.js";

/** Creates a mock fetch returning the given body with the given status. */
function mockFetchJson(body: string, status = 200): typeof fetch {
  return vi.fn<typeof fetch>().mockResolvedValue(
    new Response(body, {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("R13 fetchOpenAICompatibleModelIds — happy path", () => {
  it("extracts ids and sends Bearer auth header to {baseUrl}/models", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "model-a" }, { id: "model-b" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const ids = await fetchOpenAICompatibleModelIds({
      baseUrl: "https://api.test.com/v1",
      apiKey: "secret-key",
      fetchFn: mockFetch,
    });

    expect(ids).toEqual(["model-a", "model-b"]);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.test.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer secret-key" }),
      }),
    );
  });

  it("trims ids and filters empty strings", async () => {
    const mockFetch = mockFetchJson(
      JSON.stringify({ data: [{ id: "  ok  " }, { id: "" }, { name: "no-id" }] }),
    );
    const ids = await fetchOpenAICompatibleModelIds({
      baseUrl: "https://api.test.com",
      apiKey: "k",
      fetchFn: mockFetch,
    });
    expect(ids).toEqual(["ok"]);
  });

  it("strips a trailing slash from baseUrl", async () => {
    const mockFetch = mockFetchJson(JSON.stringify({ data: [] }));
    await fetchOpenAICompatibleModelIds({
      baseUrl: "https://api.test.com/v1/",
      apiKey: "k",
      fetchFn: mockFetch,
    });
    expect(mockFetch).toHaveBeenCalledWith("https://api.test.com/v1/models", expect.anything());
  });
});

describe("R14 fetchOpenAICompatibleModelIds — non-200 returns []", () => {
  it("returns empty list on HTTP 403 without throwing", async () => {
    const mockFetch = mockFetchJson(JSON.stringify({ error: "forbidden" }), 403);
    const ids = await fetchOpenAICompatibleModelIds({
      baseUrl: "https://api.test.com/v1",
      apiKey: "k",
      fetchFn: mockFetch,
    });
    expect(ids).toEqual([]);
  });
});

describe("R15 fetchOpenAICompatibleModelIds — invalid JSON returns []", () => {
  it("returns empty list on JSON parse error without throwing", async () => {
    const mockFetch = mockFetchJson("not valid json at all", 200);
    const ids = await fetchOpenAICompatibleModelIds({
      baseUrl: "https://api.test.com/v1",
      apiKey: "k",
      fetchFn: mockFetch,
    });
    expect(ids).toEqual([]);
  });

  it("returns empty list when fetch rejects", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockRejectedValue(new Error("network down"));
    const ids = await fetchOpenAICompatibleModelIds({
      baseUrl: "https://api.test.com/v1",
      apiKey: "k",
      fetchFn: mockFetch,
    });
    expect(ids).toEqual([]);
  });
});

describe("R16 fetchGoogleModelIds", () => {
  it("filters to generateContent models and strips models/ prefix", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [
            { name: "models/gemini-2.5-pro", supportedGenerationMethods: ["generateContent"] },
            { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const ids = await fetchGoogleModelIds({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "g-key",
      fetchFn: mockFetch,
    });

    expect(ids).toEqual(["gemini-2.5-pro"]);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models?key=g-key",
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
  });
});

describe("R17 fetchAnthropicModelIds", () => {
  it("extracts ids and sends x-api-key + anthropic-version headers", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "claude-sonnet-4-20250514" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const ids = await fetchAnthropicModelIds({
      baseUrl: "https://api.anthropic.com",
      apiKey: "ant-key",
      fetchFn: mockFetch,
    });

    expect(ids).toEqual(["claude-sonnet-4-20250514"]);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-api-key": "ant-key",
          "anthropic-version": "2023-06-01",
        }),
      }),
    );
  });
});

describe("R18 fetchProviderModelIds — dispatch", () => {
  it("routes openai-completions to the OpenAI fetcher (/models url)", async () => {
    const mockFetch = mockFetchJson(JSON.stringify({ data: [{ id: "gpt-x" }] }));
    const ids = await fetchProviderModelIds({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      api: "openai-completions",
      apiKey: "k",
      fetchFn: mockFetch,
    });
    expect(ids).toEqual(["gpt-x"]);
    expect(mockFetch).toHaveBeenCalledWith("https://api.openai.com/v1/models", expect.anything());
  });

  it("routes google-generative-ai to the Google fetcher", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [{ name: "models/gemini-pro", supportedGenerationMethods: ["generateContent"] }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const ids = await fetchProviderModelIds({
      provider: "google",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      api: "google-generative-ai",
      apiKey: "gkey",
      fetchFn: mockFetch,
    });
    expect(ids).toEqual(["gemini-pro"]);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/models?key=gkey"),
      expect.anything(),
    );
  });

  it("routes anthropic-messages to the Anthropic fetcher (/v1/models url)", async () => {
    const mockFetch = mockFetchJson(JSON.stringify({ data: [{ id: "claude-x" }] }));
    const ids = await fetchProviderModelIds({
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      api: "anthropic-messages",
      apiKey: "akey",
      fetchFn: mockFetch,
    });
    expect(ids).toEqual(["claude-x"]);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models",
      expect.anything(),
    );
  });

  it("routes mistral-conversations to the OpenAI-compatible fetcher", async () => {
    const mockFetch = mockFetchJson(JSON.stringify({ data: [{ id: "mistral-large" }] }));
    const ids = await fetchProviderModelIds({
      provider: "mistral",
      baseUrl: "https://api.mistral.ai/v1",
      api: "mistral-conversations",
      apiKey: "mkey",
      fetchFn: mockFetch,
    });
    expect(ids).toEqual(["mistral-large"]);
    expect(mockFetch).toHaveBeenCalledWith("https://api.mistral.ai/v1/models", expect.anything());
  });

  it("returns [] for skip-set api bedrock-converse-stream", async () => {
    const mockFetch = mockFetchJson(JSON.stringify({ data: [{ id: "should-not-reach" }] }));
    const ids = await fetchProviderModelIds({
      provider: "bedrock",
      baseUrl: "https://bedrock.aws",
      api: "bedrock-converse-stream",
      apiKey: "k",
      fetchFn: mockFetch,
    });
    expect(ids).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns [] for unknown api", async () => {
    const mockFetch = mockFetchJson(JSON.stringify({ data: [{ id: "x" }] }));
    const ids = await fetchProviderModelIds({
      provider: "weird",
      baseUrl: "https://weird.example.com",
      api: "unknown-api",
      apiKey: "k",
      fetchFn: mockFetch,
    });
    expect(ids).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("R19 extractMajorVersionFamily", () => {
  it.each([
    ["glm-5.2", "glm-5"],
    ["deepseek-v3.2", "deepseek-v3"],
    ["claude-sonnet-4-6", "claude-sonnet-4"],
    ["gpt-5", "gpt-5"],
    ["o3", "o3"],
    ["llama3.2", "llama3"],
    ["deepseek-chat", "deepseek-chat"],
    ["qwen3.5-plus", "qwen3"],
  ])("extracts %s -> %s", (input, expected) => {
    expect(extractMajorVersionFamily(input)).toBe(expected);
  });

  it("lowercases the result", () => {
    expect(extractMajorVersionFamily("GLM-5.2")).toBe("glm-5");
  });
});

describe("R20 findFamilyEntry", () => {
  const catalog: FamilyCatalogEntry[] = [
    { id: "glm-5.2", provider: "zai", contextWindow: 200000, reasoning: true, input: ["text"] },
  ];

  it("matches same major family + same provider", () => {
    const entry = findFamilyEntry(catalog, "glm-5.3", "zai");
    expect(entry).toEqual({ contextWindow: 200000, reasoning: true, input: ["text"] });
  });

  it("returns null when provider differs even if family matches", () => {
    const entry = findFamilyEntry(catalog, "glm-5.3", "openai");
    expect(entry).toBeNull();
  });

  it("returns null for an unknown model", () => {
    const entry = findFamilyEntry(catalog, "unknown-model", "zai");
    expect(entry).toBeNull();
  });

  it("falls back to brand-level match when no major family matches", () => {
    const brandCatalog: FamilyCatalogEntry[] = [
      { id: "glm-4.7", provider: "zai", contextWindow: 131072 },
    ];
    const entry = findFamilyEntry(brandCatalog, "glm-99", "zai");
    expect(entry).toEqual({ contextWindow: 131072 });
  });

  it("brand fallback still requires matching provider", () => {
    const brandCatalog: FamilyCatalogEntry[] = [
      { id: "glm-4.7", provider: "openai", contextWindow: 131072 },
    ];
    const entry = findFamilyEntry(brandCatalog, "glm-99", "zai");
    expect(entry).toBeNull();
  });
});
