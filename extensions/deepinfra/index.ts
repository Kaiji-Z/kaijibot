import { readConfiguredProviderCatalogEntries } from "kaijibot/plugin-sdk/provider-catalog-shared";
import { defineSingleProviderPluginEntry } from "kaijibot/plugin-sdk/provider-entry";
import { buildProviderReplayFamilyHooks } from "kaijibot/plugin-sdk/provider-model-shared";
import {
  createOpenRouterSystemCacheWrapper,
  createOpenRouterWrapper,
  isProxyReasoningUnsupported,
} from "kaijibot/plugin-sdk/provider-stream";
import { deepinfraMediaUnderstandingProvider } from "./media-understanding-provider.js";
import { applyDeepInfraConfig } from "./onboard.js";
import { buildDeepInfraProvider } from "./provider-catalog.js";
import { DEEPINFRA_DEFAULT_MODEL_REF } from "./provider-models.js";

const PROVIDER_ID = "deepinfra";

export default defineSingleProviderPluginEntry({
  id: PROVIDER_ID,
  name: "DeepInfra Provider",
  description: "Bundled DeepInfra provider plugin",
  provider: {
    label: "DeepInfra",
    docsPath: "/providers/deepinfra",
    auth: [
      {
        methodId: "api-key",
        label: "DeepInfra API key",
        hint: "Unified API for open source models",
        optionKey: "deepinfraApiKey",
        flagName: "--deepinfra-api-key",
        envVar: "DEEPINFRA_API_KEY",
        promptMessage: "Enter DeepInfra API key",
        noteTitle: "DeepInfra",
        noteMessage: [
          "DeepInfra provides an OpenAI-compatible API for open source and frontier models.",
          "Get your API key at: https://deepinfra.com/dash/api_keys",
        ].join("\n"),
        defaultModel: DEEPINFRA_DEFAULT_MODEL_REF,
        applyConfig: (cfg) => applyDeepInfraConfig(cfg),
        wizard: {
          choiceId: "deepinfra-api-key",
          choiceLabel: "DeepInfra API key",
          choiceHint: "Unified API for open source models",
          groupId: PROVIDER_ID,
          groupLabel: "DeepInfra",
          groupHint: "Unified API for open source models",
        },
      },
    ],
    catalog: {
      buildProvider: buildDeepInfraProvider,
    },
    augmentModelCatalog: ({ config }) =>
      readConfiguredProviderCatalogEntries({
        config,
        providerId: PROVIDER_ID,
      }),
    normalizeConfig: ({ providerConfig }) => providerConfig,
    normalizeTransport: ({ api, baseUrl }) =>
      baseUrl === "https://api.deepinfra.com/v1/openai" ? { api, baseUrl } : undefined,
    ...buildProviderReplayFamilyHooks({ family: "passthrough-gemini" }),
    wrapStreamFn: (ctx) => {
      const thinkingLevel = isProxyReasoningUnsupported(ctx.modelId)
        ? undefined
        : ctx.thinkingLevel;
      return createOpenRouterSystemCacheWrapper(
        createOpenRouterWrapper(ctx.streamFn, thinkingLevel),
      );
    },
    isModernModelRef: () => true,
    isCacheTtlEligible: (ctx) => ctx.modelId.toLowerCase().startsWith("anthropic/"),
  },
  register(api) {
    api.registerMediaUnderstandingProvider(deepinfraMediaUnderstandingProvider);
  },
});
