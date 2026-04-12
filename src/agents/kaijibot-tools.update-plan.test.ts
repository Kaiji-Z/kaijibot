import { describe, expect, it } from "vitest";
import type { KaijiBotConfig } from "../config/config.js";
import { isUpdatePlanToolEnabledForKaijiBotTools } from "./kaijibot-tools.registration.js";
import { createUpdatePlanTool } from "./tools/update-plan-tool.js";

describe("kaijibot-tools update_plan gating", () => {
  it("keeps update_plan disabled by default", () => {
    expect(isUpdatePlanToolEnabledForKaijiBotTools({} as KaijiBotConfig)).toBe(false);
  });

  it("registers update_plan when explicitly enabled", () => {
    const config = {
      tools: {
        experimental: {
          planTool: true,
        },
      },
    } as KaijiBotConfig;

    expect(isUpdatePlanToolEnabledForKaijiBotTools(config)).toBe(true);
    expect(createUpdatePlanTool().displaySummary).toBe("Track a short structured work plan.");
  });

  it("auto-enables update_plan for OpenAI-family providers", () => {
    expect(isUpdatePlanToolEnabledForKaijiBotTools({} as KaijiBotConfig, "openai")).toBe(true);
    expect(isUpdatePlanToolEnabledForKaijiBotTools({} as KaijiBotConfig, "openai-codex")).toBe(
      true,
    );
    expect(isUpdatePlanToolEnabledForKaijiBotTools({} as KaijiBotConfig, "anthropic")).toBe(false);
  });

  it("lets config disable update_plan auto-enable", () => {
    const config = {
      tools: {
        experimental: {
          planTool: false,
        },
      },
    } as KaijiBotConfig;

    expect(isUpdatePlanToolEnabledForKaijiBotTools(config, "openai")).toBe(false);
  });
});
