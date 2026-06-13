import type { ModelDefinitionConfig } from "kaijibot/plugin-sdk/provider-model-shared";
import manifest from "./kaijibot.plugin.json" with { type: "json" };

const DEEPSEEK_MANIFEST_CATALOG = manifest.modelCatalog.providers.deepseek;

export const DEEPSEEK_BASE_URL = DEEPSEEK_MANIFEST_CATALOG.baseUrl;

export const DEEPSEEK_MODEL_CATALOG = DEEPSEEK_MANIFEST_CATALOG.models.map(
  (m) =>
    ({
      ...m,
      reasoning: m.reasoning ?? false,
      input: [...m.input] as ModelDefinitionConfig["input"],
    }) as ModelDefinitionConfig,
) as ModelDefinitionConfig[];

export function buildDeepSeekModelDefinition(
  model: (typeof DEEPSEEK_MODEL_CATALOG)[number],
): ModelDefinitionConfig {
  return {
    ...model,
    api: "openai-completions",
  };
}

const DEEPSEEK_V4_MODEL_IDS = new Set(["deepseek-v4-flash", "deepseek-v4-pro"]);

export function isDeepSeekV4ModelId(modelId: string): boolean {
  return DEEPSEEK_V4_MODEL_IDS.has(modelId.toLowerCase());
}

export function isDeepSeekV4ModelRef(model: { provider?: string; id?: unknown }): boolean {
  return (
    model.provider === "deepseek" && typeof model.id === "string" && isDeepSeekV4ModelId(model.id)
  );
}
