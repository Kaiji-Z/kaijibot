import { describe, it, expect } from "vitest";
import type { KaijiBotConfig } from "../config/types.kaijibot.js";
import {
  resolveConsolidationConfig,
  resolveConsolidationWorkspaces,
  DEFAULT_MEMORY_CONSOLIDATION_ENABLED,
  DEFAULT_MEMORY_CONSOLIDATION_CRON,
  DEFAULT_MEMORY_CONSOLIDATION_CONCURRENCY,
  DEFAULT_MEMORY_CONSOLIDATION_BATCH_SIZE,
  DEFAULT_MEMORY_CONSOLIDATION_LOOKBACK_DAYS,
  DEFAULT_MEMORY_CONSOLIDATION_VERBOSE_LOGGING,
} from "./consolidation.js";

// ---------------------------------------------------------------------------
// resolveConsolidationConfig
// ---------------------------------------------------------------------------

describe("resolveConsolidationConfig", () => {
  it("returns defaults when no config provided", () => {
    const config = resolveConsolidationConfig({});
    expect(config.enabled).toBe(DEFAULT_MEMORY_CONSOLIDATION_ENABLED);
    expect(config.cron).toBe(DEFAULT_MEMORY_CONSOLIDATION_CRON);
    expect(config.concurrency).toBe(DEFAULT_MEMORY_CONSOLIDATION_CONCURRENCY);
    expect(config.batchSize).toBe(DEFAULT_MEMORY_CONSOLIDATION_BATCH_SIZE);
    expect(config.lookbackDays).toBe(DEFAULT_MEMORY_CONSOLIDATION_LOOKBACK_DAYS);
    expect(config.verboseLogging).toBe(DEFAULT_MEMORY_CONSOLIDATION_VERBOSE_LOGGING);
    expect(config.timezone).toBeUndefined();
  });

  it("merges partial config with defaults", () => {
    const config = resolveConsolidationConfig({
      pluginConfig: {
        consolidation: {
          enabled: true,
          cron: "0 4 * * *",
        },
      },
    });
    expect(config.enabled).toBe(true);
    expect(config.cron).toBe("0 4 * * *");
    expect(config.concurrency).toBe(DEFAULT_MEMORY_CONSOLIDATION_CONCURRENCY);
    expect(config.batchSize).toBe(DEFAULT_MEMORY_CONSOLIDATION_BATCH_SIZE);
  });

  it("uses full config values when all provided", () => {
    const config = resolveConsolidationConfig({
      pluginConfig: {
        consolidation: {
          enabled: true,
          cron: "0 5 * * *",
          timezone: "Asia/Shanghai",
          verboseLogging: true,
          concurrency: 4,
          batchSize: 8000,
          lookbackDays: 14,
        },
      },
    });
    expect(config.enabled).toBe(true);
    expect(config.cron).toBe("0 5 * * *");
    expect(config.timezone).toBe("Asia/Shanghai");
    expect(config.verboseLogging).toBe(true);
    expect(config.concurrency).toBe(4);
    expect(config.batchSize).toBe(8000);
    expect(config.lookbackDays).toBe(14);
  });

  it("falls back to defaults for invalid types", () => {
    const config = resolveConsolidationConfig({
      pluginConfig: {
        consolidation: {
          enabled: "not-a-bool",
          concurrency: "not-a-number",
          batchSize: -5,
          lookbackDays: NaN,
        },
      },
    });
    // "not-a-bool" is a string but not "true"/"false", so falls back to default
    expect(config.enabled).toBe(DEFAULT_MEMORY_CONSOLIDATION_ENABLED);
    // "not-a-number" → NaN → falls back
    expect(config.concurrency).toBe(DEFAULT_MEMORY_CONSOLIDATION_CONCURRENCY);
    // -5 floored is negative → falls back
    expect(config.batchSize).toBe(DEFAULT_MEMORY_CONSOLIDATION_BATCH_SIZE);
    // NaN → not finite → falls back
    expect(config.lookbackDays).toBe(DEFAULT_MEMORY_CONSOLIDATION_LOOKBACK_DAYS);
  });

  it("resolves timezone from pluginConfig over cfg.agents.defaults.userTimezone", () => {
    const config = resolveConsolidationConfig({
      pluginConfig: {
        consolidation: {
          timezone: "Europe/Berlin",
        },
      },
      cfg: {
        agents: {
          defaults: {
            userTimezone: "America/New_York",
          },
        },
      } as unknown as KaijiBotConfig,
    });
    expect(config.timezone).toBe("Europe/Berlin");
  });

  it("falls back to cfg.agents.defaults.userTimezone when pluginConfig timezone is missing", () => {
    const config = resolveConsolidationConfig({
      pluginConfig: {
        consolidation: {},
      },
      cfg: {
        agents: {
          defaults: {
            userTimezone: "America/New_York",
          },
        },
      } as unknown as KaijiBotConfig,
    });
    expect(config.timezone).toBe("America/New_York");
  });

  it("handles stringified number values for concurrency and batchSize", () => {
    const config = resolveConsolidationConfig({
      pluginConfig: {
        consolidation: {
          concurrency: "3",
          batchSize: "6000",
        },
      },
    });
    expect(config.concurrency).toBe(3);
    expect(config.batchSize).toBe(6000);
  });
});

// ---------------------------------------------------------------------------
// resolveConsolidationWorkspaces
// ---------------------------------------------------------------------------

describe("resolveConsolidationWorkspaces", () => {
  it("uses default agent when no agents.list configured", () => {
    const cfg = { agents: {} } as unknown as KaijiBotConfig;
    const workspaces = resolveConsolidationWorkspaces(cfg);
    expect(workspaces.length).toBeGreaterThanOrEqual(1);
    expect(workspaces[0]!.agentIds).toContain("main");
  });

  it("returns single workspace for single agent", () => {
    const cfg = {
      agents: {
        list: [{ id: "my-agent" }],
      },
    } as unknown as KaijiBotConfig;
    const workspaces = resolveConsolidationWorkspaces(cfg);
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]!.agentIds).toEqual(["my-agent"]);
  });

  it("groups agents with same workspace dir into one workspace", () => {
    const cfg = {
      agents: {
        list: [
          { id: "agent-a", workspace: "/shared/workspace" },
          { id: "agent-b", workspace: "/shared/workspace" },
        ],
      },
    } as unknown as KaijiBotConfig;
    const workspaces = resolveConsolidationWorkspaces(cfg);
    // Both agents share the same explicit workspace dir
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]!.agentIds).toEqual(["agent-a", "agent-b"]);
  });

  it("returns separate workspaces for agents with different workspace dirs", () => {
    const cfg = {
      agents: {
        list: [
          { id: "agent-a", workspace: "/workspace/a" },
          { id: "agent-b", workspace: "/workspace/b" },
        ],
      },
    } as unknown as KaijiBotConfig;
    const workspaces = resolveConsolidationWorkspaces(cfg);
    expect(workspaces).toHaveLength(2);
    const dirs = workspaces.map((ws) => ws.workspaceDir);
    expect(dirs).toContain("/workspace/a");
    expect(dirs).toContain("/workspace/b");
  });

  it("filters out invalid agent entries", () => {
    const cfg = {
      agents: {
        list: [
          { id: "valid-agent" },
          { id: "" },
          { notId: "missing-id" },
          null,
          "string-entry",
          42,
        ],
      },
    } as unknown as KaijiBotConfig;
    const workspaces = resolveConsolidationWorkspaces(cfg);
    // Only "valid-agent" should survive
    const allAgentIds = workspaces.flatMap((ws) => ws.agentIds);
    expect(allAgentIds).toEqual(["valid-agent"]);
  });

  it("deduplicates agent IDs", () => {
    const cfg = {
      agents: {
        list: [{ id: "dup-agent" }, { id: "dup-agent" }],
      },
    } as unknown as KaijiBotConfig;
    const workspaces = resolveConsolidationWorkspaces(cfg);
    const allAgentIds = workspaces.flatMap((ws) => ws.agentIds);
    expect(allAgentIds).toEqual(["dup-agent"]);
  });
});
