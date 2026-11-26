import { describe, expect, it } from "vitest";
import { mapThinkingLevel, resolveSessionThinkingLevel } from "./utils.js";

describe("mapThinkingLevel", () => {
  it("passes levels through and maps adaptive to medium", () => {
    expect(mapThinkingLevel(undefined)).toBe("off");
    expect(mapThinkingLevel("adaptive")).toBe("medium");
    expect(mapThinkingLevel("low")).toBe("low");
    expect(mapThinkingLevel("xhigh")).toBe("xhigh");
  });
});

describe("resolveSessionThinkingLevel", () => {
  const glm53 = {
    thinkingLevelMap: { off: "low", minimal: "low", low: "low", medium: "high", xhigh: "max" },
  };

  it("resolves off to the model's declared off effort", () => {
    expect(resolveSessionThinkingLevel("off", glm53)).toBe("low");
    expect(resolveSessionThinkingLevel(undefined, glm53)).toBe("low");
  });

  it("keeps off when the model has no off effort declared", () => {
    expect(resolveSessionThinkingLevel("off", { thinkingLevelMap: { low: "low" } })).toBe("off");
    expect(resolveSessionThinkingLevel("off", undefined)).toBe("off");
    expect(resolveSessionThinkingLevel(undefined, undefined)).toBe("off");
  });

  it("ignores the effort map for non-off levels", () => {
    expect(resolveSessionThinkingLevel("high", glm53)).toBe("high");
    expect(resolveSessionThinkingLevel("low", glm53)).toBe("low");
    expect(resolveSessionThinkingLevel("medium", glm53)).toBe("medium");
    expect(resolveSessionThinkingLevel("xhigh", glm53)).toBe("xhigh");
    expect(resolveSessionThinkingLevel("adaptive", glm53)).toBe("medium");
  });

  it("accepts any declared effort name, not just low", () => {
    expect(resolveSessionThinkingLevel("off", { thinkingLevelMap: { off: "high" } })).toBe("high");
  });
});
