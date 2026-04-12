import { vi } from "vitest";

const registryJitiMocks = vi.hoisted(() => ({
  createJiti: vi.fn(),
  discoverKaijiBotPlugins: vi.fn(),
  loadPluginManifestRegistry: vi.fn(),
}));

vi.mock("jiti", () => ({
  createJiti: (...args: Parameters<typeof registryJitiMocks.createJiti>) =>
    registryJitiMocks.createJiti(...args),
}));

vi.mock("../discovery.js", () => ({
  discoverKaijiBotPlugins: (
    ...args: Parameters<typeof registryJitiMocks.discoverKaijiBotPlugins>
  ) => registryJitiMocks.discoverKaijiBotPlugins(...args),
}));

vi.mock("../manifest-registry.js", () => ({
  loadPluginManifestRegistry: (
    ...args: Parameters<typeof registryJitiMocks.loadPluginManifestRegistry>
  ) => registryJitiMocks.loadPluginManifestRegistry(...args),
}));

export function resetRegistryJitiMocks(): void {
  registryJitiMocks.createJiti.mockReset();
  registryJitiMocks.discoverKaijiBotPlugins.mockReset();
  registryJitiMocks.loadPluginManifestRegistry.mockReset();
  registryJitiMocks.discoverKaijiBotPlugins.mockReturnValue({
    candidates: [],
    diagnostics: [],
  });
  registryJitiMocks.createJiti.mockImplementation(
    (_modulePath: string, _options?: Record<string, unknown>) => () => ({ default: {} }),
  );
}

export function getRegistryJitiMocks() {
  return registryJitiMocks;
}
