import type { ModelDefinitionConfig } from "kaijibot/plugin-sdk/provider-model-shared";
import manifest from "./kaijibot.plugin.json" with { type: "json" };

const CEREBRAS_MANIFEST_CATALOG = manifest.modelCatalog.providers.cerebras;

export const CEREBRAS_BASE_URL = CEREBRAS_MANIFEST_CATALOG.baseUrl;
export const CEREBRAS_MODEL_CATALOG = CEREBRAS_MANIFEST_CATALOG.models;

export function buildCerebrasCatalogModels(): ModelDefinitionConfig[] {
  return CEREBRAS_MANIFEST_CATALOG.models.map(
    (model) =>
      ({
        ...model,
        reasoning: model.reasoning ?? false,
        input: [...model.input] as ModelDefinitionConfig["input"],
      }) satisfies ModelDefinitionConfig,
  );
}

export function buildCerebrasModelDefinition(
  model: (typeof CEREBRAS_MODEL_CATALOG)[number],
): ModelDefinitionConfig {
  return {
    ...model,
    reasoning: model.reasoning ?? false,
    input: [...model.input] as ModelDefinitionConfig["input"],
  };
}
