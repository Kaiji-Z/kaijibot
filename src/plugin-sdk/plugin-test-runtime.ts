export { setDefaultChannelPluginRegistryForTests } from "../commands/channel-test-registry.js";
export {
  createEmptyPluginRegistry,
  createPluginRegistry,
  type PluginRecord,
} from "../plugins/registry.js";
export {
  providerContractLoadError,
  resolveProviderContractProvidersForPluginIds,
  resolveWebFetchProviderContractEntriesForPluginId,
  resolveWebSearchProviderContractEntriesForPluginId,
} from "../plugins/contracts/registry.js";
export { loadPluginManifestRegistry } from "../plugins/manifest-registry.js";
export {
  initializeGlobalHookRunner,
  resetGlobalHookRunner,
} from "../plugins/hook-runner-global.js";
export { addTestHook, createMockPluginRegistry } from "../plugins/hooks.test-helpers.js";
export { createPluginRecord } from "../plugins/status.test-helpers.js";
export {
  getActivePluginRegistry,
  releasePinnedPluginChannelRegistry,
  resetPluginRuntimeStateForTest,
  setActivePluginRegistry,
} from "../plugins/runtime.js";
export {
  listImportedBundledPluginFacadeIds,
  resetFacadeRuntimeStateForTest,
} from "./facade-runtime.js";
export { capturePluginRegistration } from "../plugins/captured-registration.js";
export { runProviderCatalog } from "../plugins/provider-discovery.js";
export {
  buildProviderPluginMethodChoice,
  resolveProviderModelPickerEntries,
  resolveProviderWizardOptions,
} from "../plugins/provider-wizard.js";
export { resolveProviderPluginChoice } from "../plugins/provider-auth-choice.runtime.js";
export type { PluginRuntime } from "../plugins/runtime/types.js";
export type { RuntimeEnv } from "../runtime.js";
export type { MockFn } from "../test-utils/vitest-mock-fn.js";
export { createOutboundTestPlugin, createTestRegistry } from "../test-utils/channel-plugins.js";
export {
  registerProviderPlugins,
  registerSingleProviderPlugin,
  requireRegisteredProvider,
} from "../test-utils/plugin-registration.js";
export {
  createCapturedPluginRegistration,
  type CapturedPluginRegistration,
} from "../plugins/captured-registration.js";
export { buildPluginApi } from "../plugins/api-builder.js";
export { createRuntimeTaskFlow } from "../plugins/runtime/runtime-taskflow.js";

export { registerProviderPlugin } from "../../test/helpers/plugins/provider-registration.js";
