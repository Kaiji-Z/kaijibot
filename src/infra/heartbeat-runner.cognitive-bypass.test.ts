import { describe, it, expect } from "vitest";
import type { KaijiBotConfig } from "../config/config.js";
import { runHeartbeatOnce } from "./heartbeat-runner.js";

describe("heartbeat runner cognitive delivery bypass", () => {
  const cfg = {
    agents: {
      defaults: { heartbeat: { every: "30m" }, model: { primary: "test/model" } },
      list: [
        { id: "main", default: true, name: "Main" },
        { id: "bot2", name: "Bot2" },
      ],
    },
  } as unknown as KaijiBotConfig;

  it("skips non-default agent for normal heartbeat reason", async () => {
    const result = await runHeartbeatOnce({
      cfg,
      agentId: "bot2",
      deps: { getQueueSize: () => 0, nowMs: () => 0 } as never,
    });
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") {
      expect(result.reason).toBe("disabled");
    }
  });

  it("bypasses disabled check for cognitive-insight reason", async () => {
    const result = await runHeartbeatOnce({
      cfg,
      agentId: "bot2",
      reason: "cognitive-insight",
      deps: { getQueueSize: () => 0, nowMs: () => 0 } as never,
    });
    const isDisabled = result.status === "skipped" && result.reason === "disabled";
    expect(isDisabled).toBe(false);
  });

  it("bypasses disabled check for cognitive-evolution reason", async () => {
    const result = await runHeartbeatOnce({
      cfg,
      agentId: "bot2",
      reason: "cognitive-evolution",
      deps: { getQueueSize: () => 0, nowMs: () => 0 } as never,
    });
    const isDisabled = result.status === "skipped" && result.reason === "disabled";
    expect(isDisabled).toBe(false);
  });
});
