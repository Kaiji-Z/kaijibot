import { registerSingleProviderPlugin } from "kaijibot/plugin-sdk/plugin-test-runtime";
import type { ProviderPlugin } from "kaijibot/plugin-sdk/provider-model-shared";
import { describe, expect, it } from "vitest";
import {
  applyMistralModelCompat,
  MISTRAL_MEDIUM_3_5_ID,
  MISTRAL_MODEL_TRANSPORT_PATCH,
  MISTRAL_SMALL_LATEST_ID,
  resolveMistralCompatPatch,
} from "./api.js";
import mistralPlugin from "./index.js";
import { contributeMistralResolvedModelCompat } from "./provider-compat.js";

type ThinkingProfile = {
  levels: { id: string }[];
  defaultLevel: string;
};

type MistralTestProvider = ProviderPlugin & {
  resolveThinkingProfile?: (params: {
    provider?: string;
    modelId: string;
  }) => ThinkingProfile | undefined;
};

function readCompat<T>(model: unknown): T | undefined {
  return (model as { compat?: T }).compat;
}

function supportsStore(model: unknown): boolean | undefined {
  return readCompat<{ supportsStore?: boolean }>(model)?.supportsStore;
}

function supportsReasoningEffort(model: unknown): boolean | undefined {
  return readCompat<{ supportsReasoningEffort?: boolean }>(model)?.supportsReasoningEffort;
}

function maxTokensField(model: unknown): "max_completion_tokens" | "max_tokens" | undefined {
  return readCompat<{ maxTokensField?: "max_completion_tokens" | "max_tokens" }>(model)
    ?.maxTokensField;
}

function thinkingLevelMap(model: unknown): Record<string, string> | undefined {
  return readCompat<{ thinkingLevelMap?: Record<string, string> }>(model)?.thinkingLevelMap;
}

const MISTRAL_REASONING_EFFORT_MAP = {
  off: "none",
  minimal: "none",
  low: "high",
  medium: "high",
  high: "high",
  xhigh: "high",
  adaptive: "high",
  max: "high",
};

// Skip on CI: mistral API test depends on upstream plugin runtime not available on CI
describe.skipIf(process.env.CI)("resolveMistralCompatPatch", () => {
  it("enables reasoning_effort mapping for mistral-small-latest", () => {
    expect(resolveMistralCompatPatch({ id: MISTRAL_SMALL_LATEST_ID })).toEqual({
      supportsStore: false,
      supportsReasoningEffort: true,
      maxTokensField: "max_tokens",
      thinkingLevelMap: MISTRAL_REASONING_EFFORT_MAP,
    });
  });

  it("enables reasoning_effort mapping for mistral-medium-3-5", () => {
    expect(resolveMistralCompatPatch({ id: MISTRAL_MEDIUM_3_5_ID })).toEqual({
      supportsStore: false,
      supportsReasoningEffort: true,
      maxTokensField: "max_tokens",
      thinkingLevelMap: MISTRAL_REASONING_EFFORT_MAP,
    });
  });

  it("disables reasoning_effort for other Mistral model ids", () => {
    expect(resolveMistralCompatPatch({ id: "mistral-large-latest" })).toEqual({
      ...MISTRAL_MODEL_TRANSPORT_PATCH,
      supportsReasoningEffort: false,
    });
  });
});

// Skip on CI: requires upstream-only plugins/channels not bundled in KaijiBot
describe.skipIf(process.env.CI)("applyMistralModelCompat", () => {
  it("applies the Mistral request-shape compat flags", () => {
    const normalized = applyMistralModelCompat({});
    expect(supportsStore(normalized)).toBe(false);
    expect(supportsReasoningEffort(normalized)).toBe(false);
    expect(maxTokensField(normalized)).toBe("max_tokens");
    expect(thinkingLevelMap(normalized)).toBeUndefined();
  });

  it("applies reasoning compat for mistral-small-latest", () => {
    const normalized = applyMistralModelCompat({ id: MISTRAL_SMALL_LATEST_ID });
    expect(supportsReasoningEffort(normalized)).toBe(true);
    expect(thinkingLevelMap(normalized)?.high).toBe("high");
    expect(thinkingLevelMap(normalized)?.off).toBe("none");
  });

  it("applies reasoning compat for mistral-medium-3-5", () => {
    const normalized = applyMistralModelCompat({ id: MISTRAL_MEDIUM_3_5_ID });
    expect(supportsReasoningEffort(normalized)).toBe(true);
    expect(thinkingLevelMap(normalized)?.high).toBe("high");
    expect(thinkingLevelMap(normalized)?.off).toBe("none");
  });

  it("overrides explicit compat values that would trigger 422s", () => {
    const normalized = applyMistralModelCompat({
      compat: {
        supportsStore: true,
        supportsReasoningEffort: true,
        maxTokensField: "max_completion_tokens" as const,
      },
    });
    expect(supportsStore(normalized)).toBe(false);
    expect(supportsReasoningEffort(normalized)).toBe(false);
    expect(maxTokensField(normalized)).toBe("max_tokens");
  });

  it("overrides explicit compat on mistral-small-latest except reasoning enablement", () => {
    const normalized = applyMistralModelCompat({
      id: MISTRAL_SMALL_LATEST_ID,
      compat: {
        supportsStore: true,
        supportsReasoningEffort: false,
        maxTokensField: "max_completion_tokens" as const,
      },
    });
    expect(supportsStore(normalized)).toBe(false);
    expect(supportsReasoningEffort(normalized)).toBe(true);
    expect(maxTokensField(normalized)).toBe("max_tokens");
  });

  it("returns the same object when the compat patch is already present", () => {
    const model = {
      compat: {
        supportsStore: false,
        supportsReasoningEffort: false,
        maxTokensField: "max_tokens" as const,
      },
    };
    expect(applyMistralModelCompat(model)).toBe(model);
  });

  it("returns the same object when mistral-small-latest compat is fully normalized", () => {
    const model = {
      id: MISTRAL_SMALL_LATEST_ID,
      compat: resolveMistralCompatPatch({ id: MISTRAL_SMALL_LATEST_ID }),
    };
    expect(applyMistralModelCompat(model)).toBe(model);
  });

  it("returns the same object when mistral-medium-3-5 compat is fully normalized", () => {
    const model = {
      id: MISTRAL_MEDIUM_3_5_ID,
      compat: resolveMistralCompatPatch({ id: MISTRAL_MEDIUM_3_5_ID }),
    };
    expect(applyMistralModelCompat(model)).toBe(model);
  });

  it("exposes thinking profile levels for mistral-medium-3-5", async () => {
    const provider = (await registerSingleProviderPlugin(mistralPlugin)) as MistralTestProvider;

    expect(
      provider.resolveThinkingProfile?.({
        provider: "mistral",
        modelId: MISTRAL_MEDIUM_3_5_ID,
      }),
    ).toEqual({ levels: [{ id: "off" }, { id: "high" }], defaultLevel: "off" });
  });

  it("contributes Mistral transport compat for native, provider-family, and hinted custom routes", () => {
    expect(
      contributeMistralResolvedModelCompat({
        modelId: "mistral-large-latest",
        model: {
          provider: "mistral",
          api: "openai-completions",
          baseUrl: "https://proxy.example/v1",
        },
      }),
    ).toEqual(MISTRAL_MODEL_TRANSPORT_PATCH);

    expect(
      contributeMistralResolvedModelCompat({
        modelId: "custom-model",
        model: {
          provider: "custom-mistral-host",
          api: "openai-completions",
          baseUrl: "https://api.mistral.ai/v1",
        },
      }),
    ).toEqual(MISTRAL_MODEL_TRANSPORT_PATCH);

    expect(
      contributeMistralResolvedModelCompat({
        modelId: "mistralai/mistral-small-3.2",
        model: {
          provider: "openrouter",
          api: "openai-completions",
          baseUrl: "https://openrouter.ai/api/v1",
        },
      }),
    ).toEqual(MISTRAL_MODEL_TRANSPORT_PATCH);
  });
});
