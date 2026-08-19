import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { KaijiBotConfig } from "../../config/config.js";

const mocks = vi.hoisted(() => ({
  readConfigFileSnapshot: vi.fn(),
  replaceConfigFile: vi.fn(),
}));

vi.mock("../../config/config.js", () => ({
  readConfigFileSnapshot: (...args: unknown[]) => mocks.readConfigFileSnapshot(...args),
  replaceConfigFile: (...args: unknown[]) => mocks.replaceConfigFile(...args),
}));

// Non-isolated workers share the module registry across files. If an earlier
// file already imported config.js, this file's vi.mock would not rebind the
// functions shared.js captured at import time, so reset and import lazily.
let shared: typeof import("./shared.js");

beforeAll(async () => {
  vi.resetModules();
  shared = await import("./shared.js");
});

describe("models/shared", () => {
  beforeEach(() => {
    mocks.readConfigFileSnapshot.mockClear();
    mocks.replaceConfigFile.mockClear();
  });

  it("returns config when snapshot is valid", async () => {
    const cfg = { providers: {} } as unknown as KaijiBotConfig;
    mocks.readConfigFileSnapshot.mockResolvedValue({
      valid: true,
      runtimeConfig: cfg,
      config: cfg,
    });

    await expect(shared.loadValidConfigOrThrow()).resolves.toBe(cfg);
  });

  it("throws formatted issues when snapshot is invalid", async () => {
    mocks.readConfigFileSnapshot.mockResolvedValue({
      valid: false,
      path: "/tmp/kaijibot.json",
      issues: [{ path: "providers.openai.apiKey", message: "Required" }],
    });

    await expect(shared.loadValidConfigOrThrow()).rejects.toThrowError(
      "Invalid config at /tmp/kaijibot.json\n- providers.openai.apiKey: Required",
    );
  });

  it("updateConfig writes mutated config", async () => {
    const cfg = { update: { channel: "stable" } } as unknown as KaijiBotConfig;
    mocks.readConfigFileSnapshot.mockResolvedValue({
      valid: true,
      hash: "config-1",
      sourceConfig: cfg,
      config: cfg,
    });
    mocks.replaceConfigFile.mockResolvedValue(undefined);

    await shared.updateConfig((current) => ({
      ...current,
      update: { channel: "beta" },
    }));

    expect(mocks.replaceConfigFile).toHaveBeenCalledWith({
      nextConfig: expect.objectContaining({
        update: { channel: "beta" },
      }),
      baseHash: "config-1",
    });
  });
});
