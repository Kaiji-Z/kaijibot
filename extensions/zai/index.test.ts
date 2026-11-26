import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import type { Context, Model } from "@earendil-works/pi-ai";
import type { ProviderWrapStreamFnContext } from "kaijibot/plugin-sdk/plugin-entry";
import { registerSingleProviderPlugin } from "kaijibot/plugin-sdk/plugin-test-runtime";
import { buildOpenAICompletionsParams } from "kaijibot/plugin-sdk/provider-transport-runtime";
import { describe, expect, it } from "vitest";
import plugin from "./index.js";

function createGlm47Template() {
  return {
    id: "glm-4.7",
    name: "GLM-4.7",
    provider: "zai",
    api: "openai-completions",
    baseUrl: "https://api.z.ai/api/paas/v4",
    reasoning: true,
    input: ["text"],
    cost: { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0 },
    contextWindow: 204800,
    maxTokens: 131072,
  };
}

function expectReplayPolicyFields(
  policy: Record<string, unknown> | undefined,
  fields: Record<string, unknown>,
): void {
  if (!policy) {
    throw new Error("Expected replay policy");
  }
  for (const [key, value] of Object.entries(fields)) {
    expect(policy[key]).toEqual(value);
  }
}

function expectModelFields(
  model: Record<string, unknown> | undefined,
  fields: Record<string, unknown>,
): void {
  if (!model) {
    throw new Error("Expected provider model");
  }
  for (const [key, value] of Object.entries(fields)) {
    expect(model[key]).toEqual(value);
  }
}

// Skip on CI: zai provider test depends on upstream plugin runtime not available on CI
describe.skipIf(process.env.CI)("zai provider plugin", () => {
  it("owns replay policy for OpenAI-compatible Z.ai transports", async () => {
    const provider = await registerSingleProviderPlugin(plugin);

    expectReplayPolicyFields(
      provider.buildReplayPolicy?.({
        provider: "zai",
        modelApi: "openai-completions",
        modelId: "glm-5.1",
      } as never) as Record<string, unknown> | undefined,
      {
        sanitizeToolCallIds: true,
        toolCallIdMode: "strict",
        applyAssistantFirstOrderingFix: true,
        validateGeminiTurns: true,
        validateAnthropicTurns: true,
      },
    );

    expectReplayPolicyFields(
      provider.buildReplayPolicy?.({
        provider: "zai",
        modelApi: "openai-responses",
        modelId: "glm-5.1",
      } as never) as Record<string, unknown> | undefined,
      {
        sanitizeToolCallIds: true,
        toolCallIdMode: "strict",
        applyAssistantFirstOrderingFix: false,
        validateGeminiTurns: false,
        validateAnthropicTurns: false,
      },
    );
  });

  it("resolves persisted GLM-5 family models with provider-owned metadata", async () => {
    const provider = await registerSingleProviderPlugin(plugin);
    const template = createGlm47Template();

    const cases = [
      {
        modelId: "glm-5.1",
        expected: {
          input: ["text"],
          reasoning: true,
          contextWindow: 202800,
          maxTokens: 131100,
        },
      },
      {
        modelId: "glm-5v-turbo",
        expected: {
          input: ["text", "image"],
          reasoning: true,
          contextWindow: 202800,
          maxTokens: 131100,
        },
      },
    ] as const;

    for (const testCase of cases) {
      const resolved = provider.resolveDynamicModel?.({
        provider: "zai",
        modelId: testCase.modelId,
        modelRegistry: {
          find: (_provider: string, modelId: string) => (modelId === "glm-4.7" ? template : null),
        },
      } as never) as Record<string, unknown> | undefined;
      expectModelFields(resolved, {
        provider: "zai",
        api: "openai-completions",
        baseUrl: "https://api.z.ai/api/paas/v4",
        id: testCase.modelId,
        ...testCase.expected,
      });
    }
  });

  it("returns an already-registered GLM-5 variant as-is", async () => {
    const provider = await registerSingleProviderPlugin(plugin);
    const registered = {
      id: "glm-5-turbo",
      name: "GLM-5-Turbo",
      provider: "zai",
      api: "openai-completions",
      baseUrl: "https://api.z.ai/api/paas/v4",
      reasoning: false,
      input: ["text"],
      cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 123456,
      maxTokens: 54321,
    };
    const template = createGlm47Template();

    expect(
      provider.resolveDynamicModel?.({
        provider: "zai",
        modelId: "glm-5-turbo",
        modelRegistry: {
          find: (_provider: string, modelId: string) =>
            modelId === "glm-5-turbo" ? registered : modelId === "glm-4.7" ? template : null,
        },
      } as never),
    ).toEqual(registered);
  });

  it("still synthesizes unknown GLM-5 variants from the GLM-4.7 template", async () => {
    const provider = await registerSingleProviderPlugin(plugin);
    const template = createGlm47Template();

    const resolved = provider.resolveDynamicModel?.({
      provider: "zai",
      modelId: "glm-5-turbo",
      modelRegistry: {
        find: (_provider: string, modelId: string) => (modelId === "glm-4.7" ? template : null),
      },
    } as never) as Record<string, unknown> | undefined;
    expectModelFields(resolved, {
      id: "glm-5-turbo",
      name: "GLM-5 Turbo",
      provider: "zai",
      api: "openai-completions",
      baseUrl: "https://api.z.ai/api/paas/v4",
      reasoning: true,
      input: ["text"],
    });
  });

  it("wires tool-stream defaults through the shared stream family hook", async () => {
    const provider = await registerSingleProviderPlugin(plugin);
    let capturedPayload: Record<string, unknown> | undefined;
    const baseStreamFn: StreamFn = (model, _context, options) => {
      const payload: Record<string, unknown> = {};
      options?.onPayload?.(payload as never, model as never);
      capturedPayload = payload;
      return {} as ReturnType<StreamFn>;
    };

    const defaultWrapped = provider.wrapStreamFn?.({
      provider: "zai",
      modelId: "glm-5.1",
      extraParams: {},
      streamFn: baseStreamFn,
    } as never);

    void defaultWrapped?.(
      {
        api: "openai-completions",
        provider: "zai",
        id: "glm-5.1",
      } as Model<"openai-completions">,
      { messages: [] } as unknown as TranscriptContext,
      {},
    );

    expect(capturedPayload?.tool_stream).toBe(true);

    const disabledWrapped = provider.wrapStreamFn?.({
      provider: "zai",
      modelId: "glm-5.1",
      extraParams: { tool_stream: false },
      streamFn: baseStreamFn,
    } as never);

    void disabledWrapped?.(
      {
        api: "openai-completions",
        provider: "zai",
        id: "glm-5.1",
      } as Model<"openai-completions">,
      { messages: [] } as unknown as TranscriptContext,
      {},
    );

    expect(capturedPayload).not.toHaveProperty("tool_stream");
  });

  it("maps thinking off to Z.AI thinking disabled", async () => {
    const provider = await registerSingleProviderPlugin(plugin);
    let capturedPayload: Record<string, unknown> | undefined;
    const baseStreamFn: StreamFn = (model, _context, options) => {
      const payload: Record<string, unknown> = {};
      options?.onPayload?.(payload as never, model as never);
      capturedPayload = payload;
      return {} as ReturnType<StreamFn>;
    };

    const wrapped = provider.wrapStreamFn?.({
      provider: "zai",
      modelId: "glm-5.1",
      extraParams: {},
      thinkingLevel: "off",
      streamFn: baseStreamFn,
    } as never);

    void wrapped?.(
      {
        api: "openai-completions",
        provider: "zai",
        id: "glm-5.1",
      } as Model<"openai-completions">,
      { messages: [] } as unknown as TranscriptContext,
      {},
    );

    expect(capturedPayload?.tool_stream).toBe(true);
    expect(capturedPayload?.thinking).toEqual({ type: "disabled" });
  });

  it("enables Z.AI preserved thinking only when requested", async () => {
    const provider = await registerSingleProviderPlugin(plugin);
    let capturedPayload: Record<string, unknown> | undefined;
    const baseStreamFn: StreamFn = (model, _context, options) => {
      const payload: Record<string, unknown> = {};
      options?.onPayload?.(payload as never, model as never);
      capturedPayload = payload;
      return {} as ReturnType<StreamFn>;
    };

    const wrappedWithoutPreserve = provider.wrapStreamFn?.({
      provider: "zai",
      modelId: "glm-5.1",
      extraParams: {},
      thinkingLevel: "low",
      streamFn: baseStreamFn,
    } as never);

    void wrappedWithoutPreserve?.(
      {
        api: "openai-completions",
        provider: "zai",
        id: "glm-5.1",
      } as Model<"openai-completions">,
      { messages: [] } as unknown as TranscriptContext,
      {},
    );

    expect(capturedPayload?.tool_stream).toBe(true);
    expect(capturedPayload).not.toHaveProperty("thinking");

    const wrappedWithPreserve = provider.wrapStreamFn?.({
      provider: "zai",
      modelId: "glm-5.1",
      extraParams: { preserveThinking: true },
      thinkingLevel: "low",
      streamFn: baseStreamFn,
    } as never);

    void wrappedWithPreserve?.(
      {
        api: "openai-completions",
        provider: "zai",
        id: "glm-5.1",
      } as Model<"openai-completions">,
      { messages: [] } as unknown as TranscriptContext,
      {},
    );

    expect(capturedPayload?.tool_stream).toBe(true);
    expect(capturedPayload?.thinking).toEqual({ type: "enabled", clear_thinking: false });
  });

  it("preserves replayed reasoning_content for Z.AI preserved thinking", async () => {
    const provider = await registerSingleProviderPlugin(plugin);
    let capturedPayload: Record<string, unknown> | undefined;
    const model = {
      provider: "zai",
      id: "glm-5.1",
      name: "GLM 5.1",
      api: "openai-completions",
      baseUrl: "https://api.z.ai/api/paas/v4",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000,
      maxTokens: 131_072,
    } as Model<"openai-completions">;
    const context = {
      messages: [
        { role: "user", content: "hi", timestamp: 1 },
        {
          role: "assistant",
          api: "openai-completions",
          provider: "zai",
          model: "glm-5.1",
          content: [
            {
              type: "thinking",
              thinking: "prior reasoning",
              thinkingSignature: "reasoning_content",
            },
            { type: "text", text: "visible reply" },
          ],
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: 2,
        },
        { role: "user", content: "continue", timestamp: 3 },
      ],
    } as Context;
    const baseStreamFn: StreamFn = (streamModel, streamContext, options) => {
      const payload = buildOpenAICompletionsParams(streamModel as never, streamContext, {
        reasoning: "high",
      } as never);
      options?.onPayload?.(payload as never, streamModel as never);
      capturedPayload = payload;
      return {} as ReturnType<StreamFn>;
    };

    const wrapped = provider.wrapStreamFn?.({
      provider: "zai",
      modelId: "glm-5.1",
      extraParams: { preserve_thinking: true },
      thinkingLevel: "low",
      streamFn: baseStreamFn,
    } as never);

    void wrapped?.(model, context as unknown as TranscriptContext, {});

    expect(capturedPayload?.thinking).toEqual({ type: "enabled", clear_thinking: false });
    const assistantMessage = (capturedPayload?.messages as Array<Record<string, unknown>>)[1];
    expect(assistantMessage?.role).toBe("assistant");
    expect(assistantMessage?.content).toBe("visible reply");
    expect(assistantMessage?.reasoning_content).toBe("prior reasoning");
  });

  it("defaults tool_stream extra params but preserves explicit values", async () => {
    const provider = await registerSingleProviderPlugin(plugin);

    expect(
      provider.prepareExtraParams?.({
        provider: "zai",
        modelId: "glm-4.7",
        extraParams: { endpoint: "global" },
      } as never),
    ).toEqual({
      endpoint: "global",
      tool_stream: true,
    });

    const explicit = { endpoint: "global", tool_stream: false };
    expect(
      provider.prepareExtraParams?.({
        provider: "zai",
        modelId: "glm-4.7",
        extraParams: explicit,
      } as never),
    ).toEqual(explicit);
  });

  it("declares the effort of every level but high for GLM-5.3 models", async () => {
    const provider = await registerSingleProviderPlugin(plugin);

    for (const modelId of ["glm-5.3", "glm-5.3-flash", "glm-5.3-flashx"]) {
      const resolved = provider.normalizeResolvedModel?.({
        model: { ...createGlm47Template(), id: modelId },
      } as never) as Record<string, unknown> | undefined;
      expect(resolved?.thinkingLevelMap).toEqual({
        off: "low",
        minimal: "low",
        low: "low",
        medium: "high",
        xhigh: "max",
      });
      // Without this pi-ai's zai serialization drops `reasoning_effort` from the
      // request and the effort map never reaches the API.
      const compat = resolved?.compat as Record<string, unknown> | undefined;
      expect(compat?.supportsReasoningEffort).toBe(true);
    }

    const canDisableThinking = createGlm47Template();
    expect(provider.normalizeResolvedModel?.({ model: canDisableThinking } as never)).toBe(
      canDisableThinking,
    );
  });

  it("keeps an already-declared GLM-5.3 model untouched", async () => {
    const provider = await registerSingleProviderPlugin(plugin);
    const declared = {
      ...createGlm47Template(),
      id: "glm-5.3-flash",
      thinkingLevelMap: { off: "low", minimal: "low", low: "low", medium: "high", xhigh: "max" },
      compat: { supportsReasoningEffort: true },
    } as Record<string, unknown>;

    expect(provider.normalizeResolvedModel?.({ model: declared } as never)).toBe(declared);
  });

  it("defaults a GLM-5.3 model to the level that leaves the effort to the provider", async () => {
    const provider = await registerSingleProviderPlugin(plugin);
    const context = (modelId: string) => ({ provider: "zai", modelId, reasoning: true }) as never;

    expect(provider.resolveDefaultThinkingLevel?.(context("glm-5.3-flash"))).toBe("high");
    expect(provider.resolveDefaultThinkingLevel?.(context("glm-5.1"))).toBeUndefined();

    expect(provider.supportsXHighThinking?.(context("glm-5.3"))).toBe(true);
    expect(provider.supportsXHighThinking?.(context("glm-5.3-flashx"))).toBe(true);
    expect(provider.supportsXHighThinking?.(context("glm-5.1"))).toBeUndefined();
  });

  // The request the agent loop builds for a zai model, with the provider wrapper applied.
  async function captureRequest(params: {
    model: Model<"openai-completions">;
    thinkingLevel?: ProviderWrapStreamFnContext["thinkingLevel"];
    extraParams?: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const provider = await registerSingleProviderPlugin(plugin);
    let payload: Record<string, unknown> | undefined;
    const baseStreamFn: StreamFn = (model, context, options) => {
      const built = buildOpenAICompletionsParams(model as never, context, {
        reasoning: params.thinkingLevel,
      } as never);
      options?.onPayload?.(built as never, model as never);
      payload = built as Record<string, unknown>;
      return {} as ReturnType<StreamFn>;
    };

    const wrapped = provider.wrapStreamFn?.({
      provider: "zai",
      modelId: params.model.id,
      extraParams: params.extraParams ?? {},
      thinkingLevel: params.thinkingLevel,
      streamFn: baseStreamFn,
    } as never);

    await wrapped?.(
      params.model,
      { messages: [{ role: "user", content: "hi", timestamp: 1 }] } as unknown as TranscriptContext,
      {},
    );
    if (!payload) {
      throw new Error("no request captured");
    }
    return payload;
  }

  function alwaysThinkingModel(): Model<"openai-completions"> {
    return {
      ...createGlm47Template(),
      id: "glm-5.3-flash",
      thinkingLevelMap: {
        off: "low",
        minimal: "low",
        low: "low",
        medium: "high",
        xhigh: "max",
      },
    } as Model<"openai-completions">;
  }

  it.each([
    ["minimal", "low"],
    ["low", "low"],
    ["medium", "high"],
    ["xhigh", "max"],
  ] as const)(
    "runs an always-thinking model at the effort of the %s level",
    async (thinkingLevel, effort) => {
      const payload = await captureRequest({
        model: alwaysThinkingModel(),
        thinkingLevel,
      });

      expect(payload.reasoning_effort).toBe(effort);
      expect(payload).not.toHaveProperty("thinking");
    },
  );

  it.each([undefined, "high", "adaptive"] as const)(
    "sends a request at the %s level exactly as the transport built it",
    async (thinkingLevel) => {
      const asBuilt = await captureRequest({ model: alwaysThinkingModel() });
      const payload = await captureRequest({
        model: alwaysThinkingModel(),
        thinkingLevel,
      });

      expect(payload).toEqual(asBuilt);
      expect(payload).not.toHaveProperty("reasoning_effort");
      expect(payload).not.toHaveProperty("thinking");
    },
  );

  it("keeps preserved thinking on and adds the effort of the level", async () => {
    const payload = await captureRequest({
      model: alwaysThinkingModel(),
      thinkingLevel: "low",
      extraParams: { preserveThinking: true },
    });

    expect(payload.thinking).toEqual({ type: "enabled", clear_thinking: false });
    expect(payload.reasoning_effort).toBe("low");
  });

  it("leaves a model that can turn thinking off as built at a level only GLM-5.3 names", async () => {
    const model = {
      ...createGlm47Template(),
      thinkingLevelMap: { minimal: "low" },
    } as Model<"openai-completions">;

    const payload = await captureRequest({ model, thinkingLevel: "minimal" });

    expect(payload).not.toHaveProperty("reasoning_effort");
  });

  it("runs an always-thinking model at its lowest effort when thinking is off", async () => {
    const provider = await registerSingleProviderPlugin(plugin);
    let capturedPayload: Record<string, unknown> | undefined;
    const baseStreamFn: StreamFn = (model, _context, options) => {
      const payload: Record<string, unknown> = { thinking: { type: "disabled" } };
      options?.onPayload?.(payload as never, model as never);
      capturedPayload = payload;
      return {} as ReturnType<StreamFn>;
    };

    const wrapped = provider.wrapStreamFn?.({
      provider: "zai",
      modelId: "glm-5.3-flash",
      extraParams: {},
      thinkingLevel: "off",
      streamFn: baseStreamFn,
    } as never);

    void wrapped?.(
      {
        ...createGlm47Template(),
        id: "glm-5.3-flash",
        thinkingLevelMap: { off: "low" },
      } as Model<"openai-completions">,
      { messages: [] } as unknown as TranscriptContext,
      {},
    );

    expect(capturedPayload).not.toHaveProperty("thinking");
    expect(capturedPayload?.reasoning_effort).toBe("low");
  });
});
