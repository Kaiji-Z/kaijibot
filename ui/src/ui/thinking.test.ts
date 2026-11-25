import { describe, expect, it } from "vitest";
import {
  formatThinkingLevels,
  isBinaryThinkingProvider,
  listThinkingLevelLabels,
  resolveThinkingDefaultForModel,
} from "./thinking.ts";

describe("thinking level helpers", () => {
  it.each(["glm-5.3", "glm-5.3-flash", "glm-5.3-flashx", "GLM-5.3-Flash"])(
    "offers every level up to xhigh on the Z.AI model %s",
    (model) => {
      // Z.AI takes the level as a reasoning effort on these models; "on" would land on the lowest.
      expect(isBinaryThinkingProvider("zai", model)).toBe(false);
      expect(listThinkingLevelLabels("zai", model)).toEqual([
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
      ]);
      expect(formatThinkingLevels("zai", model)).toBe("off, minimal, low, medium, high, xhigh");
      expect(resolveThinkingDefaultForModel({ provider: "zai", model })).toBe("high");
      expect(resolveThinkingDefaultForModel({ provider: "z.ai", model })).toBe("high");
    },
  );

  it("keeps the other Z.AI models on the on/off switch", () => {
    expect(isBinaryThinkingProvider("zai", "glm-5.1")).toBe(true);
    expect(listThinkingLevelLabels("zai", "glm-5.1")).toEqual(["off", "on"]);
    // Without the model id the provider alone decides, as before.
    expect(listThinkingLevelLabels("zai")).toEqual(["off", "on"]);
    expect(
      resolveThinkingDefaultForModel({
        provider: "zai",
        model: "glm-5.1",
        catalog: [{ provider: "zai", id: "glm-5.1", reasoning: true }],
      }),
    ).toBe("low");
  });

  it("leaves the other providers as they were", () => {
    expect(isBinaryThinkingProvider("anthropic", "claude-opus-4-6")).toBe(false);
    expect(listThinkingLevelLabels("openai", "gpt-5")).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "adaptive",
    ]);
  });
});
