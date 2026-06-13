import type { ProviderPlugin } from "kaijibot/plugin-sdk/provider-model-shared";
import { buildDeepSeekProvider } from "./provider-catalog.js";

const deepSeekProviderDiscovery: ProviderPlugin = {
  id: "deepseek",
  label: "DeepSeek",
  docsPath: "/providers/deepseek",
  auth: [],
  catalog: {
    order: "simple",
    run: async () => ({
      provider: buildDeepSeekProvider(),
    }),
  },
};

export default deepSeekProviderDiscovery;
