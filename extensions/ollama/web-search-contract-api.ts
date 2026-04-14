import {
  createWebSearchProviderContractFields,
  type WebSearchProviderPlugin,
} from "kaijibot/plugin-sdk/provider-web-search-contract";

export function createOllamaWebSearchProvider(): WebSearchProviderPlugin {
  return {
    id: "ollama",
    label: "Ollama Web Search",
    hint: "Local Ollama host · requires ollama signin",
    onboardingScopes: ["text-inference"],
    requiresCredential: false,
    envVars: [],
    placeholder: "(run ollama signin)",
    signupUrl: "https://ollama.com/",
    docsUrl: "https://docs.kaijibot.ai/tools/web",
    autoDetectOrder: 110,
    credentialPath: "",
    ...createWebSearchProviderContractFields({
      credentialPath: "",
      searchCredential: { type: "none" },
      selectionPluginId: "ollama",
    }),
    createTool: () => null,
  };
}
