import { describe, expect, it } from "vitest";
import {
  resolveOpenAIReasoningEffortForModel,
  resolveOpenAISupportedReasoningEfforts,
  supportsOpenAIReasoningEffort,
} from "./openai-reasoning-effort.js";

describe("resolveOpenAISupportedReasoningEfforts", () => {
  it("returns the GPT-5 effort set for gpt-5", () => {
    const efforts = resolveOpenAISupportedReasoningEfforts({
      provider: "openai",
      id: "gpt-5",
    });
    expect([...efforts]).toEqual(["minimal", "low", "medium", "high"]);
  });

  it("returns the GPT-5 effort set for gpt-5 variants", () => {
    const efforts = resolveOpenAISupportedReasoningEfforts({
      provider: "openai",
      id: "gpt-5-2025-08-07",
    });
    expect([...efforts]).toEqual(["minimal", "low", "medium", "high"]);
  });

  it("returns a medium-only set for gpt-5.1-codex-mini", () => {
    const efforts = resolveOpenAISupportedReasoningEfforts({
      provider: "openai",
      id: "gpt-5.1-codex-mini",
    });
    expect([...efforts]).toEqual(["medium"]);
  });

  it("returns the GPT-5.1 effort set for gpt-5.1 family", () => {
    const efforts = resolveOpenAISupportedReasoningEfforts({
      provider: "openai",
      id: "gpt-5.1",
    });
    expect([...efforts]).toEqual(["none", "low", "medium", "high"]);
  });

  it("returns the GPT-5.2 effort set for gpt-5.2 family", () => {
    const efforts = resolveOpenAISupportedReasoningEfforts({
      provider: "openai",
      id: "gpt-5.2",
    });
    expect([...efforts]).toEqual(["none", "low", "medium", "high", "xhigh"]);
  });

  it("returns the generic effort set for unknown models", () => {
    const efforts = resolveOpenAISupportedReasoningEfforts({
      provider: "openai",
      id: "gpt-4o",
    });
    expect([...efforts]).toEqual(["low", "medium", "high"]);
  });

  it("prefers compat.supportedReasoningEfforts when present", () => {
    const efforts = resolveOpenAISupportedReasoningEfforts({
      provider: "openai",
      id: "gpt-5",
      compat: { supportedReasoningEfforts: ["low", "high"] },
    });
    expect([...efforts]).toEqual(["low", "high"]);
  });
});

describe("supportsOpenAIReasoningEffort", () => {
  it("returns true for an effort in the supported set", () => {
    expect(supportsOpenAIReasoningEffort({ provider: "openai", id: "gpt-5" }, "high")).toBe(true);
  });

  it("returns false for an effort outside the supported set", () => {
    expect(supportsOpenAIReasoningEffort({ provider: "openai", id: "gpt-5" }, "xhigh")).toBe(false);
  });
});

describe("resolveOpenAIReasoningEffortForModel", () => {
  it("returns the requested effort when supported", () => {
    expect(
      resolveOpenAIReasoningEffortForModel({
        model: { provider: "openai", id: "gpt-5" },
        effort: "high",
      }),
    ).toBe("high");
  });

  it("falls back from xhigh to high when xhigh is unsupported", () => {
    expect(
      resolveOpenAIReasoningEffortForModel({
        model: { provider: "openai", id: "gpt-5" },
        effort: "xhigh",
      }),
    ).toBe("high");
  });

  it("falls back from minimal to low then medium when both unsupported", () => {
    // gpt-5.1-codex-mini only supports "medium"
    expect(
      resolveOpenAIReasoningEffortForModel({
        model: { provider: "openai", id: "gpt-5.1-codex-mini" },
        effort: "minimal",
      }),
    ).toBe("medium");
  });

  it("falls back from minimal to low when low is supported", () => {
    // gpt-5.1 supports none/low/medium/high — minimal should map to low
    expect(
      resolveOpenAIReasoningEffortForModel({
        model: { provider: "openai", id: "gpt-5.1" },
        effort: "minimal",
      }),
    ).toBe("low");
  });

  it("returns undefined when requested effort is none", () => {
    expect(
      resolveOpenAIReasoningEffortForModel({
        model: { provider: "openai", id: "gpt-5" },
        effort: "none",
      }),
    ).toBeUndefined();
  });

  it("applies the fallbackMap before resolving support", () => {
    expect(
      resolveOpenAIReasoningEffortForModel({
        model: { provider: "openai", id: "gpt-5" },
        effort: "minimal",
        fallbackMap: { minimal: "high" },
      }),
    ).toBe("high");
  });
});
