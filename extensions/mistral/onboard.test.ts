import {
  resolveAgentModelFallbackValues,
  resolveAgentModelPrimaryValue,
} from "kaijibot/plugin-sdk/provider-onboard";
import {
  createConfigWithFallbacks,
  createLegacyProviderConfig,
  EXPECTED_FALLBACKS,
} from "kaijibot/plugin-sdk/provider-test-contracts";
import { describe, expect, it } from "vitest";
import { buildMistralModelDefinition as buildBundledMistralModelDefinition } from "./model-definitions.js";
import {
  applyMistralConfig,
  applyMistralProviderConfig,
  MISTRAL_DEFAULT_MODEL_REF,
} from "./onboard.js";

describe("mistral onboard", () => {
  it("adds Mistral provider with correct settings", () => {
    const cfg = applyMistralConfig({});
    expect(cfg.models?.providers?.mistral?.baseUrl).toBe("https://api.mistral.ai/v1");
    expect(cfg.models?.providers?.mistral?.api).toBe("openai-completions");
    // Inline of expectProviderOnboardPrimaryAndFallbacks
    const cfgWithFallbacks = applyMistralConfig(createConfigWithFallbacks());
    expect(resolveAgentModelPrimaryValue(cfgWithFallbacks.agents?.defaults?.model)).toBe(
      MISTRAL_DEFAULT_MODEL_REF,
    );
    expect(resolveAgentModelFallbackValues(cfgWithFallbacks.agents?.defaults?.model)).toEqual([
      ...EXPECTED_FALLBACKS,
    ]);
  });

  it("merges Mistral models and keeps existing provider overrides", () => {
    // Inline of expectProviderOnboardMergedLegacyConfig
    const legacy = createLegacyProviderConfig({
      providerId: "mistral",
      api: "anthropic-messages",
      modelId: "custom-model",
      modelName: "Custom",
      baseUrl: "https://api.mistral.ai/v1",
    });
    const cfg = applyMistralProviderConfig(legacy);
    const provider = cfg.models?.providers?.mistral;
    expect(provider?.api).toBe("openai-completions");
    expect(provider?.models.map((m: { id: string }) => m.id)).toEqual([
      "custom-model",
      "mistral-large-latest",
    ]);
    const mistralDefault = provider?.models.find(
      (model: { id: string; contextWindow?: number; maxTokens?: number }) =>
        model.id === "mistral-large-latest",
    );
    expect(mistralDefault?.contextWindow).toBe(262144);
    expect(mistralDefault?.maxTokens).toBe(16384);
  });

  it("uses the bundled mistral default model definition", () => {
    const bundled = buildBundledMistralModelDefinition();
    const cfg = applyMistralProviderConfig({});
    const defaultModel = cfg.models?.providers?.mistral?.models.find(
      (model) => model.id === bundled.id,
    );

    expect(defaultModel).toEqual(bundled);
  });

  it("adds the expected alias for the default model", () => {
    const cfg = applyMistralProviderConfig({});
    expect(cfg.agents?.defaults?.models?.[MISTRAL_DEFAULT_MODEL_REF]?.alias).toBe("Mistral");
  });
});
