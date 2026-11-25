import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The consolidation bootstrap runs inside the gateway start-up IIFE, so its two lines of wiring
// are pinned on the source: both have silently regressed before (an empty plugin config made
// every documented setting a no-op; the lookback window was accepted and then dropped).
const source = fs.readFileSync(path.join(import.meta.dirname, "server.impl.ts"), "utf8");

describe("gateway memory consolidation wiring", () => {
  it("resolves the settings from the gateway config instead of an empty plugin config", () => {
    expect(source).toContain("resolveConsolidationConfigForConfig(cfgAtStart)");
    expect(source).not.toContain("pluginConfig: {}");
  });

  it("hands the configured lookback window to the session transcript scan", () => {
    expect(source).toContain("listSessionFilesForAgent(agentId, { lookbackDays })");
  });
});
