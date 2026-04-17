import type { KaijiBotConfig } from "kaijibot/plugin-sdk/provider-onboard";
import { describe, expect, it } from "vitest";
import { applyGoogleGeminiModelDefault, GOOGLE_GEMINI_DEFAULT_MODEL } from "./api.js";

describe("google default model", () => {
  it("sets defaults when model is unset", () => {
    const cfg: KaijiBotConfig = { agents: { defaults: {} } };
    const applied = applyGoogleGeminiModelDefault(cfg);
    expect(applied.changed).toBe(true);
    expect(applied.next.agents?.defaults?.model).toEqual({ primary: GOOGLE_GEMINI_DEFAULT_MODEL });
  });

  it("overrides existing models", () => {
    const applied = applyGoogleGeminiModelDefault({
      agents: { defaults: { model: { primary: "anthropic/claude-opus-4-6" } } },
    } as KaijiBotConfig);
    expect(applied.changed).toBe(true);
    expect(applied.next.agents?.defaults?.model).toEqual({ primary: GOOGLE_GEMINI_DEFAULT_MODEL });
  });

  it("no-ops when already on the target default", () => {
    const cfg = {
      agents: { defaults: { model: { primary: GOOGLE_GEMINI_DEFAULT_MODEL } } },
    } as KaijiBotConfig;
    const applied = applyGoogleGeminiModelDefault(cfg);
    expect(applied.changed).toBe(false);
    expect(applied.next).toEqual(cfg);
  });
});
