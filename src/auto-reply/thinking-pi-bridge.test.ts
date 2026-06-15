import { describe, it, expect } from "vitest";
import { supportsXHighThinking, getSupportedThinkingLevelsForModel } from "./thinking.js";

describe("getSupportedThinkingLevelsForModel", () => {
  it("returns default levels without xhigh when no model specified", () => {
    const levels = getSupportedThinkingLevelsForModel(undefined, undefined);
    expect(levels).not.toContain("xhigh");
    expect(levels).toContain("off");
    expect(levels).toContain("high");
  });

  it("returns levels including xhigh for known xhigh-capable model", () => {
    const levels = getSupportedThinkingLevelsForModel("openai", "gpt-5.2");
    expect(levels).toContain("xhigh");
  });

  it("returns default levels for unknown provider/model", () => {
    const levels = getSupportedThinkingLevelsForModel("unknown-provider", "unknown-model");
    expect(levels).not.toContain("xhigh");
    expect(levels).toContain("off");
  });
});

describe("supportsXHighThinking (backward compat wrapper)", () => {
  it("returns false when no model specified", () => {
    expect(supportsXHighThinking(undefined, undefined)).toBe(false);
  });

  it("returns true for known xhigh-capable model", () => {
    expect(supportsXHighThinking("openai", "gpt-5.2")).toBe(true);
  });

  it("returns false for unknown model", () => {
    expect(supportsXHighThinking("unknown", "unknown-model")).toBe(false);
  });
});
