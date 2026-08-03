import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadPluginManifestRegistryMock } = vi.hoisted(() => ({
  loadPluginManifestRegistryMock: vi.fn(() => {
    throw new Error("manifest registry should stay off the explicit bundled fast path");
  }),
}));

vi.mock("./manifest-registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./manifest-registry.js")>();
  return {
    ...actual,
    loadPluginManifestRegistry: loadPluginManifestRegistryMock,
  };
});

import { resolveBundledExplicitWebSearchProvidersFromPublicArtifacts } from "./web-provider-public-artifacts.explicit.js";

// CI: explicit fast-path artifacts are missing on CI runners (no bundled plugin source).
describe.skipIf(process.env.CI)("web provider public artifacts explicit fast path", () => {
  beforeEach(() => {
    loadPluginManifestRegistryMock.mockClear();
  });

  it("resolves bundled web search providers by explicit plugin id without manifest scans", () => {
    const provider = resolveBundledExplicitWebSearchProvidersFromPublicArtifacts({
      onlyPluginIds: ["exa"],
    })?.[0];

    expect(provider?.pluginId).toBe("exa");
    expect(provider?.createTool({ config: {} as never })).toBeNull();
    expect(loadPluginManifestRegistryMock).not.toHaveBeenCalled();
  });
});
