import type { ModelDefinitionConfig } from "kaijibot/plugin-sdk/provider-model-shared";
import manifest from "./kaijibot.plugin.json" with { type: "json" };

const TOGETHER_MANIFEST_CATALOG = manifest.modelCatalog.providers.together;

export const TOGETHER_BASE_URL = TOGETHER_MANIFEST_CATALOG.baseUrl;

export const TOGETHER_MODEL_CATALOG: ModelDefinitionConfig[] = TOGETHER_MANIFEST_CATALOG.models.map(
  (m) => ({
    ...m,
    reasoning: m.reasoning ?? false,
    input: [...m.input] as ModelDefinitionConfig["input"],
  }),
);

export function buildTogetherModelDefinition(
  model: ModelDefinitionConfig,
): ModelDefinitionConfig {
  return {
    ...model,
    api: "openai-completions",
    input: [...model.input],
    cost: { ...model.cost },
  };
}
