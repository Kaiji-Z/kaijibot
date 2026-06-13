import type { ModelProviderConfig } from "kaijibot/plugin-sdk/provider-model-shared";
import manifest from "./kaijibot.plugin.json" with { type: "json" };

export function buildMistralProvider(): ModelProviderConfig {
  const catalog = manifest.modelCatalog.providers.mistral;
  return {
    baseUrl: catalog.baseUrl,
    api: catalog.api as ModelProviderConfig["api"],
    models: catalog.models.map(
      (m) =>
        ({
          ...m,
          reasoning: m.reasoning ?? false,
          input: [...m.input] as ModelProviderConfig["models"][number]["input"],
        }) as ModelProviderConfig["models"][number],
    ),
  };
}
