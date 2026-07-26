import { describePluginRegistrationContract } from "kaijibot/plugin-sdk/plugin-test-contracts";

// Skip on CI: contract test depends on upstream plugin runtime not available on CI
if (!process.env.CI) {
  describePluginRegistrationContract({
    pluginId: "together",
    providerIds: ["together"],
    videoGenerationProviderIds: ["together"],
    requireGenerateVideo: true,
  });
}
