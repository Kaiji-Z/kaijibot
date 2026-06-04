import { describe, expect, it } from "vitest";
import { resolveSoulPreset } from "./bootstrap-files.js";
import type { KaijiBotConfig } from "../config/types.js";

describe("resolveSoulPreset", () => {
  it("returns per-agent soul preset when agent has one in list", () => {
    const config = {
      agents: {
        list: [{ id: "main", soul: { preset: "intj" } }],
      },
    } as unknown as KaijiBotConfig;

    const result = resolveSoulPreset(config, "main");
    expect(result).toBe("intj");
  });

  it("returns defaults soul when agent has no own preset", () => {
    const config = {
      agents: {
        defaults: { soul: { preset: "entp" } },
        list: [{ id: "main" }],
      },
    } as unknown as KaijiBotConfig;

    const result = resolveSoulPreset(config, "main");
    expect(result).toBe("entp");
  });

  it("falls back to global soul.preset when no per-agent and no defaults", () => {
    const config = {
      soul: { preset: "infj" },
    } as unknown as KaijiBotConfig;

    const result = resolveSoulPreset(config, "main");
    expect(result).toBe("infj");
  });

  it("per-agent takes priority over defaults and global", () => {
    const config = {
      soul: { preset: "infj" },
      agents: {
        defaults: { soul: { preset: "entp" } },
        list: [{ id: "main", soul: { preset: "intj" } }],
      },
    } as unknown as KaijiBotConfig;

    const result = resolveSoulPreset(config, "main");
    expect(result).toBe("intj");
  });

  it("defaults takes priority over global", () => {
    const config = {
      soul: { preset: "infj" },
      agents: {
        defaults: { soul: { preset: "entp" } },
      },
    } as unknown as KaijiBotConfig;

    const result = resolveSoulPreset(config, "main");
    expect(result).toBe("entp");
  });

  it("returns undefined when no soul preset anywhere", () => {
    const config = {} as KaijiBotConfig;

    const result = resolveSoulPreset(config, "main");
    expect(result).toBeUndefined();
  });

  it("returns undefined when config is undefined", () => {
    const result = resolveSoulPreset(undefined, "main");
    expect(result).toBeUndefined();
  });

  it("resolves agentId from sessionKey when agentId is not provided", () => {
    const config = {
      agents: {
        list: [{ id: "main", soul: { preset: "intj" } }],
      },
    } as unknown as KaijiBotConfig;

    // sessionKey format: feishu:ou_xxx:main  or similar
    const result = resolveSoulPreset(config, undefined, "feishu:ou_test:main");
    expect(result).toBe("intj");
  });

  it("falls back to global when agentId not in list and no defaults", () => {
    const config = {
      soul: { preset: "infj" },
      agents: {
        list: [{ id: "other" }],
      },
    } as unknown as KaijiBotConfig;

    const result = resolveSoulPreset(config, "main");
    expect(result).toBe("infj");
  });
});
