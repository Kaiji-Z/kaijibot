import { describe, expect, it } from "vitest";
import type { BrowserConfig, KaijiBotConfig } from "../config/config.js";
import {
  agentBrowserProfileName,
  ensureAgentBrowserProfile,
  findAgentBrowserProfile,
} from "./agent-profiles.js";
import type { ResolvedBrowserConfig } from "./config.js";

type TestProfile = { cdpPort?: number; cdpUrl?: string; color?: string };

function makeConfig(profiles: Record<string, TestProfile> = {}): KaijiBotConfig {
  return { browser: { profiles } } as unknown as KaijiBotConfig;
}

describe("agentBrowserProfileName", () => {
  it.each([
    ["main", "agent-main"],
    ["Research Agent", "agent-research-agent"],
    ["A/B__Bot!", "agent-a-b-bot"],
    ["", "agent-default"],
    ["!!!", "agent-default"],
    ["中文代理", "agent-default"],
    ["MiXeD", "agent-mixed"],
    ["--leading-dashes--", "agent-leading-dashes"],
  ])("maps %j to %j", (input, expected) => {
    expect(agentBrowserProfileName(input)).toBe(expected);
  });

  it("caps the slug so the profile name stays under the 64-char limit", () => {
    const name = agentBrowserProfileName("a".repeat(200));
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name).toBe(`agent-${"a".repeat(48)}`);
  });

  it("never collides with the reserved default profile names", () => {
    expect(agentBrowserProfileName("kaijibot")).not.toBe("kaijibot");
    expect(agentBrowserProfileName("user")).not.toBe("user");
  });
});

describe("findAgentBrowserProfile", () => {
  it("returns the profile name when present", () => {
    const cfg = makeConfig({ "agent-main": { cdpPort: 18801, color: "#0066CC" } });
    expect(findAgentBrowserProfile(cfg, "main")).toBe("agent-main");
  });

  it("returns null when missing", () => {
    expect(findAgentBrowserProfile(makeConfig(), "main")).toBeNull();
  });
});

describe("ensureAgentBrowserProfile", () => {
  // The extensions lane runs non-isolated locally: other test files may mock
  // ./config.js process-wide, so every dependency is injected here.
  const resolveWithRange = (
    browser: BrowserConfig | undefined,
    _root: KaijiBotConfig,
  ): ResolvedBrowserConfig =>
    ({
      profiles: browser?.profiles ?? {},
      cdpPortRangeStart: 18800,
      cdpPortRangeEnd: 18899,
    }) as unknown as ResolvedBrowserConfig;

  it("creates the profile with an allocated port and persists config", async () => {
    const written: KaijiBotConfig[] = [];
    const result = await ensureAgentBrowserProfile("main", {
      loadConfig: () => makeConfig({ kaijibot: { cdpPort: 18800, color: "#FF4500" } }),
      writeConfigFile: async (cfg) => {
        written.push(cfg);
      },
      resolveBrowserConfig: resolveWithRange,
    });
    expect(result).toEqual({ profile: "agent-main", created: true });
    expect(written).toHaveLength(1);
    const cfg = written[0]!;
    const profile = cfg.browser?.profiles?.["agent-main"];
    expect(profile?.cdpPort).toBe(18801);
    expect(typeof profile?.color).toBe("string");
    expect(profile?.color).not.toBe("#FF4500");
    expect(cfg.browser?.profiles?.kaijibot).toBeDefined();
  });

  it("is idempotent when the profile already exists", async () => {
    let writes = 0;
    const result = await ensureAgentBrowserProfile("main", {
      loadConfig: () => makeConfig({ "agent-main": { cdpPort: 18805, color: "#00AA00" } }),
      writeConfigFile: async () => {
        writes++;
      },
      resolveBrowserConfig: resolveWithRange,
    });
    expect(result).toEqual({ profile: "agent-main", created: false });
    expect(writes).toBe(0);
  });
});
