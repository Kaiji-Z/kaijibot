import { completeSimple, type Api, type Model } from "@earendil-works/pi-ai";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  resolveModelMock: vi.fn(),
  getApiKeyForModelMock: vi.fn(),
  applyLocalNoAuthHeaderOverrideMock: vi.fn(),
  setRuntimeApiKeyMock: vi.fn(),
  resolveCopilotApiTokenMock: vi.fn(),
}));

vi.mock("./pi-embedded-runner/model.js", () => ({
  resolveModel: hoisted.resolveModelMock,
}));

vi.mock("./model-auth.js", () => ({
  getApiKeyForModel: hoisted.getApiKeyForModelMock,
  applyLocalNoAuthHeaderOverride: hoisted.applyLocalNoAuthHeaderOverrideMock,
}));

vi.mock("./github-copilot-token.js", () => ({
  resolveCopilotApiToken: hoisted.resolveCopilotApiTokenMock,
}));

let prepareSimpleCompletionModel: typeof import("./simple-completion-runtime.js").prepareSimpleCompletionModel;
let forBackgroundCompletion: typeof import("./simple-completion-runtime.js").forBackgroundCompletion;
let backgroundRequestBody: typeof import("./simple-completion-runtime.js").backgroundRequestBody;

beforeAll(async () => {
  ({ prepareSimpleCompletionModel, forBackgroundCompletion, backgroundRequestBody } =
    await import("./simple-completion-runtime.js"));
});

beforeEach(() => {
  hoisted.resolveModelMock.mockReset();
  hoisted.getApiKeyForModelMock.mockReset();
  hoisted.applyLocalNoAuthHeaderOverrideMock.mockReset();
  hoisted.setRuntimeApiKeyMock.mockReset();
  hoisted.resolveCopilotApiTokenMock.mockReset();

  hoisted.applyLocalNoAuthHeaderOverrideMock.mockImplementation((model: unknown) => model);

  hoisted.resolveModelMock.mockReturnValue({
    model: {
      provider: "anthropic",
      id: "claude-opus-4-6",
    },
    authStorage: {
      setRuntimeApiKey: hoisted.setRuntimeApiKeyMock,
    },
    modelRegistry: {},
  });
  hoisted.getApiKeyForModelMock.mockResolvedValue({
    apiKey: "sk-test",
    source: "env:TEST_API_KEY",
    mode: "api-key",
  });
  hoisted.resolveCopilotApiTokenMock.mockResolvedValue({
    token: "copilot-runtime-token",
    expiresAt: Date.now() + 60_000,
    source: "cache:/tmp/copilot-token.json",
    baseUrl: "https://api.individual.githubcopilot.com",
  });
});

describe("prepareSimpleCompletionModel", () => {
  it("resolves model auth and sets runtime api key", async () => {
    hoisted.getApiKeyForModelMock.mockResolvedValueOnce({
      apiKey: " sk-test ",
      source: "env:TEST_API_KEY",
      mode: "api-key",
    });

    const result = await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "anthropic",
      modelId: "claude-opus-4-6",
      agentDir: "/tmp/kaijibot-agent",
    });

    expect(result).toEqual(
      expect.objectContaining({
        model: expect.objectContaining({
          provider: "anthropic",
          id: "claude-opus-4-6",
        }),
        auth: expect.objectContaining({
          mode: "api-key",
          source: "env:TEST_API_KEY",
        }),
      }),
    );
    expect(hoisted.setRuntimeApiKeyMock).toHaveBeenCalledWith("anthropic", "sk-test");
  });

  it("returns error when model resolution fails", async () => {
    hoisted.resolveModelMock.mockReturnValueOnce({
      error: "Unknown model: anthropic/missing-model",
      authStorage: {
        setRuntimeApiKey: hoisted.setRuntimeApiKeyMock,
      },
      modelRegistry: {},
    });

    const result = await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "anthropic",
      modelId: "missing-model",
    });

    expect(result).toEqual({
      error: "Unknown model: anthropic/missing-model",
    });
    expect(hoisted.getApiKeyForModelMock).not.toHaveBeenCalled();
  });

  it("returns error when api key is missing and mode is not allowlisted", async () => {
    hoisted.getApiKeyForModelMock.mockResolvedValueOnce({
      source: "models.providers.anthropic",
      mode: "api-key",
    });

    const result = await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "anthropic",
      modelId: "claude-opus-4-6",
    });

    expect(result).toEqual({
      error: 'No API key resolved for provider "anthropic" (auth mode: api-key).',
      auth: {
        source: "models.providers.anthropic",
        mode: "api-key",
      },
    });
    expect(hoisted.setRuntimeApiKeyMock).not.toHaveBeenCalled();
  });

  it("continues without api key when auth mode is allowlisted", async () => {
    hoisted.resolveModelMock.mockReturnValueOnce({
      model: {
        provider: "amazon-bedrock",
        id: "anthropic.claude-sonnet-4-6",
      },
      authStorage: {
        setRuntimeApiKey: hoisted.setRuntimeApiKeyMock,
      },
      modelRegistry: {},
    });
    hoisted.getApiKeyForModelMock.mockResolvedValueOnce({
      source: "aws-sdk default chain",
      mode: "aws-sdk",
    });

    const result = await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "amazon-bedrock",
      modelId: "anthropic.claude-sonnet-4-6",
      allowMissingApiKeyModes: ["aws-sdk"],
    });

    expect(result).toEqual(
      expect.objectContaining({
        model: expect.objectContaining({
          provider: "amazon-bedrock",
          id: "anthropic.claude-sonnet-4-6",
        }),
        auth: {
          source: "aws-sdk default chain",
          mode: "aws-sdk",
        },
      }),
    );
    expect(hoisted.setRuntimeApiKeyMock).not.toHaveBeenCalled();
  });

  it("exchanges github token when provider is github-copilot", async () => {
    hoisted.resolveModelMock.mockReturnValueOnce({
      model: {
        provider: "github-copilot",
        id: "gpt-4.1",
      },
      authStorage: {
        setRuntimeApiKey: hoisted.setRuntimeApiKeyMock,
      },
      modelRegistry: {},
    });
    hoisted.getApiKeyForModelMock.mockResolvedValueOnce({
      apiKey: "ghu_test",
      source: "profile:github-copilot:default",
      mode: "token",
    });

    await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "github-copilot",
      modelId: "gpt-4.1",
    });

    expect(hoisted.resolveCopilotApiTokenMock).toHaveBeenCalledWith({
      githubToken: "ghu_test",
    });
    expect(hoisted.setRuntimeApiKeyMock).toHaveBeenCalledWith(
      "github-copilot",
      "copilot-runtime-token",
    );
  });

  it("returns exchanged copilot token in auth.apiKey for github-copilot provider", async () => {
    hoisted.resolveModelMock.mockReturnValueOnce({
      model: {
        provider: "github-copilot",
        id: "gpt-4.1",
      },
      authStorage: {
        setRuntimeApiKey: hoisted.setRuntimeApiKeyMock,
      },
      modelRegistry: {},
    });
    hoisted.getApiKeyForModelMock.mockResolvedValueOnce({
      apiKey: "ghu_original_github_token",
      source: "profile:github-copilot:default",
      mode: "token",
    });

    const result = await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "github-copilot",
      modelId: "gpt-4.1",
    });

    expect(result).not.toHaveProperty("error");
    if ("error" in result) {
      return;
    }

    // The returned auth.apiKey should be the exchanged runtime token,
    // not the original GitHub token
    expect(result.auth.apiKey).toBe("copilot-runtime-token");
    expect(result.auth.apiKey).not.toBe("ghu_original_github_token");
  });

  it("applies exchanged copilot baseUrl to returned model", async () => {
    hoisted.resolveModelMock.mockReturnValueOnce({
      model: {
        provider: "github-copilot",
        id: "gpt-4.1",
      },
      authStorage: {
        setRuntimeApiKey: hoisted.setRuntimeApiKeyMock,
      },
      modelRegistry: {},
    });
    hoisted.getApiKeyForModelMock.mockResolvedValueOnce({
      apiKey: "ghu_test",
      source: "profile:github-copilot:default",
      mode: "token",
    });
    hoisted.resolveCopilotApiTokenMock.mockResolvedValueOnce({
      token: "copilot-runtime-token",
      expiresAt: Date.now() + 60_000,
      source: "cache:/tmp/copilot-token.json",
      baseUrl: "https://api.copilot.enterprise.example",
    });

    const result = await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "github-copilot",
      modelId: "gpt-4.1",
    });

    expect(result).not.toHaveProperty("error");
    if ("error" in result) {
      return;
    }
    expect(result.model).toEqual(
      expect.objectContaining({
        baseUrl: "https://api.copilot.enterprise.example",
      }),
    );
  });

  it("returns error when getApiKeyForModel throws", async () => {
    hoisted.getApiKeyForModelMock.mockRejectedValueOnce(new Error("Profile not found: copilot"));

    const result = await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "anthropic",
      modelId: "claude-opus-4-6",
    });

    expect(result).toEqual({
      error: 'Auth lookup failed for provider "anthropic": Profile not found: copilot',
    });
    expect(hoisted.setRuntimeApiKeyMock).not.toHaveBeenCalled();
  });

  it("applies local no-auth header override before returning model", async () => {
    hoisted.resolveModelMock.mockReturnValueOnce({
      model: {
        provider: "local-openai",
        id: "chat-local",
        api: "openai-completions",
      },
      authStorage: {
        setRuntimeApiKey: hoisted.setRuntimeApiKeyMock,
      },
      modelRegistry: {},
    });
    hoisted.getApiKeyForModelMock.mockResolvedValueOnce({
      apiKey: "custom-local",
      source: "models.providers.local-openai (synthetic local key)",
      mode: "api-key",
    });
    hoisted.applyLocalNoAuthHeaderOverrideMock.mockReturnValueOnce({
      provider: "local-openai",
      id: "chat-local",
      api: "openai-completions",
      headers: { Authorization: null },
    });

    const result = await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "local-openai",
      modelId: "chat-local",
    });

    expect(hoisted.applyLocalNoAuthHeaderOverrideMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "local-openai",
        id: "chat-local",
      }),
      expect.objectContaining({
        apiKey: "custom-local",
        source: "models.providers.local-openai (synthetic local key)",
        mode: "api-key",
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        model: expect.objectContaining({
          headers: expect.objectContaining({ Authorization: null }),
        }),
      }),
    );
  });
});

function makeZaiModel(
  overrides: Partial<Model<"openai-completions">> = {},
): Model<"openai-completions"> {
  return {
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
    ...overrides,
  };
}

// What pi-ai puts on the wire for a background call, which passes no reasoning
// option. The request is aborted before it leaves, so nothing reaches the network.
async function captureRequestPayload(
  model: Model<Api>,
  maxTokens = 2000,
): Promise<Record<string, unknown>> {
  let payload: Record<string, unknown> | undefined;
  await completeSimple(
    model,
    { messages: [{ role: "user", content: "hello", timestamp: 0 }] },
    {
      apiKey: "test-key",
      maxTokens,
      signal: AbortSignal.abort(),
      onPayload: (next) => {
        payload = next as Record<string, unknown>;
      },
    },
  ).catch(() => undefined);
  if (!payload) {
    throw new Error("no request payload captured");
  }
  return payload;
}

function withoutStreaming(payload: Record<string, unknown>): Record<string, unknown> {
  const body = { ...payload };
  delete body.stream;
  delete body.stream_options;
  return body;
}

describe("forBackgroundCompletion", () => {
  it("asks for the effort an always-thinking model names instead of disabling thinking", async () => {
    const alwaysThinking = makeZaiModel({ thinkingLevelMap: { off: "low" } });

    // As resolved, the request asks to disable thinking, which the glm-5.3 API rejects.
    expect(await captureRequestPayload(alwaysThinking)).toEqual(
      expect.objectContaining({ thinking: { type: "disabled" } }),
    );

    const prepared = forBackgroundCompletion(alwaysThinking);
    const payload = await captureRequestPayload(prepared);
    expect(payload.reasoning_effort).toBe("low");
    expect(payload).not.toHaveProperty("thinking");
    expect(alwaysThinking.compat).toBeUndefined();
  });

  it("leaves a model that can turn thinking off as resolved", () => {
    const canDisable = makeZaiModel();
    expect(forBackgroundCompletion(canDisable)).toBe(canDisable);

    const offIsNull = makeZaiModel({ thinkingLevelMap: { off: null } });
    expect(forBackgroundCompletion(offIsNull)).toBe(offIsNull);
  });

  it("leaves an always-thinking model on another thinking format as resolved", () => {
    const openrouter = makeZaiModel({
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      thinkingLevelMap: { off: "none" },
    });
    expect(forBackgroundCompletion(openrouter)).toBe(openrouter);
  });

  it("prepares the model of a background call on the always-thinking model with the effort", async () => {
    hoisted.resolveModelMock.mockReturnValueOnce({
      model: makeZaiModel({ thinkingLevelMap: { off: "low" } }),
      authStorage: { setRuntimeApiKey: hoisted.setRuntimeApiKeyMock },
      modelRegistry: {},
    });

    const result = await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "zai",
      modelId: "glm-5.3-flash",
    });

    expect(result).toEqual(
      expect.objectContaining({
        model: expect.objectContaining({
          id: "glm-5.3-flash",
          compat: expect.objectContaining({
            thinkingFormat: "openai",
            supportsReasoningEffort: true,
          }),
        }),
      }),
    );
  });
});

describe("backgroundRequestBody", () => {
  const preparedAlwaysThinking = () =>
    forBackgroundCompletion(makeZaiModel({ thinkingLevelMap: { off: "low" } }));

  const models = [
    {
      name: "an always-thinking model, which runs at the effort named for off",
      model: preparedAlwaysThinking,
    },
    { name: "a model that turns thinking off", model: () => makeZaiModel() },
    { name: "a model that does not reason", model: () => makeZaiModel({ reasoning: false }) },
  ] as const;

  it.each(models)("is the request the synchronous path sends for $name", async ({ model }) => {
    const synchronous = await captureRequestPayload(model(), 4000);
    expect(synchronous.stream).toBe(true);

    const body = await backgroundRequestBody({
      model: model(),
      prompt: "hello",
      maxTokens: 4000,
      apiKey: "test-key",
    });

    expect(body).toEqual(withoutStreaming(synchronous));
  });

  it("carries the token cap and the effort, and no streaming", async () => {
    const body = await backgroundRequestBody({
      model: preparedAlwaysThinking(),
      prompt: "hello",
      maxTokens: 4000,
      apiKey: "test-key",
    });

    expect(body).toEqual({
      model: "glm-5.3-flash",
      messages: [{ role: "user", content: "hello" }],
      max_completion_tokens: 4000,
      reasoning_effort: "low",
    });
  });

  it("reads the body without sending the request", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response("unreachable", { status: 500 }));
    try {
      const body = await backgroundRequestBody({
        model: makeZaiModel(),
        prompt: "hello",
        maxTokens: 2000,
        apiKey: "test-key",
      });
      expect(body.model).toBe("glm-5.3-flash");
      expect(fetchSpy).not.toHaveBeenCalled();

      // Control: with a live signal the same transport does go through this fetch.
      await completeSimple(
        makeZaiModel(),
        { messages: [{ role: "user", content: "hello", timestamp: 0 }] },
        { apiKey: "test-key", maxTokens: 2000 },
      ).catch(() => undefined);
      expect(fetchSpy).toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
