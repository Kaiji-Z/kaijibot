import { describe, expect, it } from "vitest";
import type { ThinkLevel } from "../../auto-reply/thinking.js";
import {
  mapThinkingLevelToReasoningEffort,
  type ReasoningEffort,
} from "./reasoning-effort-utils.js";

describe("mapThinkingLevelToReasoningEffort", () => {
  it("maps \"off\" to \"none\"", () => {
    expect(mapThinkingLevelToReasoningEffort("off")).toBe("none");
  });

  it("maps \"adaptive\" to \"medium\"", () => {
    expect(mapThinkingLevelToReasoningEffort("adaptive")).toBe("medium");
  });

  it("passes \"minimal\" through unchanged", () => {
    expect(mapThinkingLevelToReasoningEffort("minimal")).toBe("minimal");
  });

  it("passes \"low\" through unchanged", () => {
    expect(mapThinkingLevelToReasoningEffort("low")).toBe("low");
  });

  it("passes \"medium\" through unchanged", () => {
    expect(mapThinkingLevelToReasoningEffort("medium")).toBe("medium");
  });

  it("passes \"high\" through unchanged", () => {
    expect(mapThinkingLevelToReasoningEffort("high")).toBe("high");
  });

  it("passes \"xhigh\" through unchanged", () => {
    expect(mapThinkingLevelToReasoningEffort("xhigh")).toBe("xhigh");
  });

  it("returns a valid ReasoningEffort for every ThinkLevel", () => {
    const levels: ThinkLevel[] = [
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "adaptive",
    ];
    const valid: ReasoningEffort[] = [
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ];
    for (const level of levels) {
      const mapped = mapThinkingLevelToReasoningEffort(level);
      expect(valid).toContain(mapped);
    }
  });
});
