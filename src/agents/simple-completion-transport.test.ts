import type { Model } from "@earendil-works/pi-ai";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { KaijiBotConfig } from "../config/config.js";

const createAnthropicVertexStreamFnForModel = vi.fn();
const ensureCustomApiRegistered = vi.fn();
const resolveProviderStreamFn = vi.fn();
const buildTransportAwareSimpleStreamFn = vi.fn();
const prepareTransportAwareSimpleModel = vi.fn();

vi.mock("./anthropic-vertex-stream.js", () => ({
  createAnthropicVertexStreamFnForModel,
}));

vi.mock("./custom-api-registry.js", () => ({
  ensureCustomApiRegistered,
}));

vi.mock("./provider-transport-stream.js", () => ({
  buildTransportAwareSimpleStreamFn,
  prepareTransportAwareSimpleModel,
}));

vi.mock("../plugins/provider-runtime.js", async () => {
  const actual = await vi.importActual<typeof import("../plugins/provider-runtime.js")>(
    "../plugins/provider-runtime.js",
  );
  return {
    ...actual,
    resolveProviderStreamFn,
  };
});

let prepareModelForSimpleCompletion: typeof import("./simple-completion-transport.js").prepareModelForSimpleCompletion;

describe("prepareModelForSimpleCompletion", () => {
  beforeAll(async () => {
    ({ prepareModelForSimpleCompletion } = await import("./simple-completion-transport.js"));
  });

  beforeEach(() => {
    createAnthropicVertexStreamFnForModel.mockReset();
    ensureCustomApiRegistered.mockReset();
    resolveProviderStreamFn.mockReset();
    buildTransportAwareSimpleStreamFn.mockReset();
    prepareTransportAwareSimpleModel.mockReset();
    createAnthropicVertexStreamFnForModel.mockReturnValue("vertex-stream");
    resolveProviderStreamFn.mockReturnValue("ollama-stream");
    buildTransportAwareSimpleStreamFn.mockReturnValue(undefined);
    prepareTransportAwareSimpleModel.mockImplementation((model) => model);
  });

  it("registers the configured Ollama transport and keeps the original api", () => {
    const model: Model<"ollama"> = {
      id: "llama3",
      name: "Llama 3",
      api: "ollama",
      provider: "ollama",
      baseUrl: "http://localhost:11434",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 8192,
      maxTokens: 4096,
      headers: {},
    };
    const cfg: KaijiBotConfig = {
      models: {
        providers: {
          ollama: {
            baseUrl: "http://remote-ollama:11434",
            models: [],
          },
        },
      },
    };

    const result = prepareModelForSimpleCompletion({
      model,
      cfg,
    });

    expect(resolveProviderStreamFn).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "ollama",
        config: cfg,
        context: expect.objectContaining({
          provider: "ollama",
          modelId: "llama3",
          model,
        }),
      }),
    );
    expect(ensureCustomApiRegistered).toHaveBeenCalledWith("ollama", "ollama-stream");
    expect(result).toBe(model);
  });

  it("uses a custom api alias for Anthropic Vertex simple completions", () => {
    const model: Model<"anthropic-messages"> = {
      id: "claude-sonnet",
      name: "Claude Sonnet",
      api: "anthropic-messages",
      provider: "anthropic-vertex",
      baseUrl: "https://us-central1-aiplatform.googleapis.com",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 8192,
    };

    resolveProviderStreamFn.mockReturnValueOnce(undefined);

    const result = prepareModelForSimpleCompletion({ model });

    expect(createAnthropicVertexStreamFnForModel).toHaveBeenCalledWith(model);
    expect(ensureCustomApiRegistered).toHaveBeenCalledWith(
      "kaijibot-anthropic-vertex-simple:https%3A%2F%2Fus-central1-aiplatform.googleapis.com",
      "vertex-stream",
    );
    expect(result).toEqual({
      ...model,
      api: "kaijibot-anthropic-vertex-simple:https%3A%2F%2Fus-central1-aiplatform.googleapis.com",
    });
  });

  it("uses a transport-aware custom api alias when llm request transport overrides are present", () => {
    const model: Model<"openai-responses"> = {
      id: "gpt-5",
      name: "GPT-5",
      api: "openai-responses",
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 8192,
    };

    resolveProviderStreamFn.mockReturnValueOnce(undefined);
    buildTransportAwareSimpleStreamFn.mockReturnValueOnce("transport-stream");
    prepareTransportAwareSimpleModel.mockReturnValueOnce({
      ...model,
      api: "kaijibot-openai-responses-transport",
    });

    const result = prepareModelForSimpleCompletion({ model });

    expect(prepareTransportAwareSimpleModel).toHaveBeenCalledWith(model);
    expect(buildTransportAwareSimpleStreamFn).toHaveBeenCalledWith(model);
    expect(ensureCustomApiRegistered).toHaveBeenCalledWith(
      "kaijibot-openai-responses-transport",
      "transport-stream",
    );
    expect(result).toEqual({
      ...model,
      api: "kaijibot-openai-responses-transport",
    });
  });

  // glm-5.3 cannot turn thinking off: the registry fills "off" with null and names
  // low, high and max. It takes an effort instead of a disabled-thinking switch.
  const alwaysThinkingZaiModel = (): Model<"openai-completions"> => ({
    id: "glm-5.3-flash",
    name: "GLM-5.3-Flash",
    api: "openai-completions",
    provider: "zai",
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 131100,
    compat: { thinkingFormat: "zai", supportsReasoningEffort: true, maxTokensField: "max_tokens" },
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: "low",
      medium: null,
      high: "high",
      xhigh: null,
      max: "max",
    },
  });

  it("prepares an always-thinking model for the background request", () => {
    const model = alwaysThinkingZaiModel();
    resolveProviderStreamFn.mockReturnValueOnce(undefined);

    const result = prepareModelForSimpleCompletion({ model });

    expect(result).toEqual({
      ...model,
      thinkingLevelMap: { ...model.thinkingLevelMap, off: "low" },
      compat: {
        thinkingFormat: "openai",
        supportsReasoningEffort: true,
        maxTokensField: "max_completion_tokens",
      },
    });
  });

  it("sends an effort instead of a disabled-thinking switch for an always-thinking model", async () => {
    let payload: Record<string, unknown> | undefined;

    const prepared = prepareModelForSimpleCompletion({ model: alwaysThinkingZaiModel() });
    await completeSimple(
      prepared,
      { messages: [{ role: "user", content: "hello", timestamp: 0 }] },
      {
        apiKey: "test-key",
        maxTokens: 100,
        // The request is aborted before it leaves, so nothing reaches the network.
        signal: AbortSignal.abort(),
        onPayload: (next) => {
          payload = next as Record<string, unknown>;
        },
      },
    ).catch(() => undefined);
    if (!payload) {
      throw new Error("no request payload captured");
    }

    expect(payload).toMatchObject({ model: "glm-5.3-flash", reasoning_effort: "low" });
    expect(payload).not.toHaveProperty("thinking");
  });
});
