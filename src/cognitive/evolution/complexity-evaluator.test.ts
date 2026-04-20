import { describe, expect, it } from "vitest";
import { detectTrialAndError, evaluateComplexity } from "./complexity-evaluator.js";
import type { EvolutionCandidate } from "./types.js";

function makeCandidate(overrides: Partial<EvolutionCandidate> = {}): EvolutionCandidate {
  return {
    taskSummary: "test task",
    toolCalls: [],
    uniqueToolCount: 0,
    reasoningTurns: 0,
    durationMs: 0,
    domain: "test",
    ...overrides,
  };
}

describe("evaluateComplexity", () => {
  it("returns score near 0 for zero tool calls", () => {
    const result = evaluateComplexity(makeCandidate());
    expect(result.score).toBe(0);
    expect(result.factors).toHaveLength(4);
  });

  it("returns low complexity for single tool and short duration", () => {
    const result = evaluateComplexity(
      makeCandidate({
        toolCalls: ["web_search"],
        uniqueToolCount: 1,
        reasoningTurns: 1,
        durationMs: 5_000,
      }),
    );
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(0.3);
  });

  it("returns high complexity for many tools, long duration, many turns", () => {
    const toolCalls = Array.from({ length: 15 }, (_, i) => `tool_${i}`);
    const result = evaluateComplexity(
      makeCandidate({
        toolCalls,
        uniqueToolCount: 10,
        reasoningTurns: 12,
        durationMs: 400_000,
      }),
    );
    expect(result.score).toBeGreaterThan(0.7);
  });

  it("never exceeds 1.0 with extreme inputs", () => {
    const result = evaluateComplexity(
      makeCandidate({
        toolCalls: Array.from({ length: 100 }, (_, i) => `tool_${i}`),
        uniqueToolCount: 50,
        reasoningTurns: 200,
        durationMs: 3_600_000,
      }),
    );
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it("never goes below 0", () => {
    const result = evaluateComplexity(makeCandidate());
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("computes each factor correctly", () => {
    const result = evaluateComplexity(
      makeCandidate({
        toolCalls: Array.from({ length: 10 }, (_, i) => `tool_${i}`),
        uniqueToolCount: 4,
        reasoningTurns: 5,
        durationMs: 150_000,
      }),
    );

    const [toolCount, uniqueTools, reasoningTurns, duration] = result.factors;

    expect(toolCount.name).toBe("toolCount");
    expect(toolCount.raw).toBe(10);
    expect(toolCount.normalized).toBe(0.5);
    expect(toolCount.weight).toBe(0.3);

    expect(uniqueTools.name).toBe("uniqueTools");
    expect(uniqueTools.raw).toBe(4);
    expect(uniqueTools.normalized).toBe(0.5);
    expect(uniqueTools.weight).toBe(0.3);

    expect(reasoningTurns.name).toBe("reasoningTurns");
    expect(reasoningTurns.raw).toBe(5);
    expect(reasoningTurns.normalized).toBe(0.5);
    expect(reasoningTurns.weight).toBe(0.2);

    expect(duration.name).toBe("duration");
    expect(duration.raw).toBe(150_000);
    expect(duration.normalized).toBe(0.5);
    expect(duration.weight).toBe(0.2);

    // 0.5 * (0.3 + 0.3 + 0.2 + 0.2) = 0.5
    expect(result.score).toBeCloseTo(0.5);
  });

  it("produces different scores for equal-weight vs varied scenarios", () => {
    // All factors at 50% capacity
    const balanced = evaluateComplexity(
      makeCandidate({
        toolCalls: Array.from({ length: 10 }, (_, i) => `tool_${i}`),
        uniqueToolCount: 4,
        reasoningTurns: 5,
        durationMs: 150_000,
      }),
    );

    // Only toolCount maxed, rest zero
    const skewed = evaluateComplexity(
      makeCandidate({
        toolCalls: Array.from({ length: 20 }, (_, i) => `tool_${i}`),
        uniqueToolCount: 0,
        reasoningTurns: 0,
        durationMs: 0,
      }),
    );

    expect(balanced.score).not.toBe(skewed.score);
    // balanced: 0.5 across all = 0.5
    // skewed: toolCount=1.0*0.3 + rest=0 = 0.3
    expect(balanced.score).toBeGreaterThan(skewed.score);
  });

  it("never exceeds 1.0 even with trial-error boost", () => {
    const result = evaluateComplexity(
      makeCandidate({
        toolCalls: Array.from({ length: 100 }, (_, i) => `tool_${i}`),
        uniqueToolCount: 50,
        reasoningTurns: 200,
        durationMs: 3_600_000,
        transcript: "不对 换一个 错了 不好 不行 wrong try again sorry 抱歉 tool_call:search tool_call:search tool_call:search",
        userCorrections: 10,
      }),
    );
    expect(result.score).toBeLessThanOrEqual(1);
  });
});

describe("detectTrialAndError", () => {
  it("returns false for no transcript and no flags", () => {
    const result = detectTrialAndError(makeCandidate());
    expect(result.detected).toBe(false);
    expect(result.signals).toHaveLength(0);
    expect(result.userCorrections).toBe(0);
    expect(result.boost).toBe(0);
  });

  it("detects Chinese corrections", () => {
    const result = detectTrialAndError(
      makeCandidate({ transcript: "用户说：不对，换一个方案" }),
    );
    expect(result.detected).toBe(true);
    expect(result.signals.length).toBeGreaterThanOrEqual(2);
    expect(result.boost).toBeGreaterThan(0);
  });

  it("detects English corrections", () => {
    const result = detectTrialAndError(
      makeCandidate({ transcript: "User said: wrong, try again please" }),
    );
    expect(result.detected).toBe(true);
    expect(result.signals.length).toBeGreaterThanOrEqual(2);
    expect(result.boost).toBeGreaterThan(0);
  });

  it("detects agent apologies", () => {
    const result = detectTrialAndError(
      makeCandidate({ transcript: "Agent: 抱歉，我来重新做。Also sorry about that." }),
    );
    expect(result.detected).toBe(true);
    expect(result.boost).toBeGreaterThan(0);
  });

  it("caps boost at 0.25", () => {
    const result = detectTrialAndError(
      makeCandidate({
        transcript: "不对 不是这个 换一个 再试试 错了 不好 不行 重新来 重新做 不对吧 wrong try again incorrect sorry 抱歉 对不起 tool_call:web_search tool_call:web_search tool_call:web_search",
        userCorrections: 10,
      }),
    );
    expect(result.boost).toBeLessThanOrEqual(0.25);
  });

  it("returns correct signal strings", () => {
    const result = detectTrialAndError(
      makeCandidate({ transcript: "用户说不对" }),
    );
    expect(result.detected).toBe(true);
    for (const signal of result.signals) {
      expect(typeof signal).toBe("string");
      expect(signal.length).toBeGreaterThan(0);
    }
  });

  it("detects via hasTrialAndError flag even without transcript", () => {
    const result = detectTrialAndError(
      makeCandidate({ hasTrialAndError: true }),
    );
    expect(result.detected).toBe(true);
  });

  it("adds boost from explicit userCorrections", () => {
    const result = detectTrialAndError(
      makeCandidate({ userCorrections: 3 }),
    );
    expect(result.detected).toBe(true);
    expect(result.userCorrections).toBe(3);
    expect(result.boost).toBeCloseTo(0.15);
  });

  it("detects repeated tool calls", () => {
    const result = detectTrialAndError(
      makeCandidate({
        transcript: "tool_call:web_search tool_call:web_search tool_call:web_search",
      }),
    );
    expect(result.detected).toBe(true);
    expect(result.signals.some((s) => s.startsWith("repeated:"))).toBe(true);
  });
});

describe("evaluateComplexity with trial-error boost", () => {
  it("boosts score with trial-error candidate", () => {
    const base = evaluateComplexity(
      makeCandidate({
        toolCalls: Array.from({ length: 10 }, (_, i) => `tool_${i}`),
        uniqueToolCount: 4,
        reasoningTurns: 5,
        durationMs: 150_000,
      }),
    );
    const boosted = evaluateComplexity(
      makeCandidate({
        toolCalls: Array.from({ length: 10 }, (_, i) => `tool_${i}`),
        uniqueToolCount: 4,
        reasoningTurns: 5,
        durationMs: 150_000,
        transcript: "不对 换一个 wrong try again",
        userCorrections: 2,
      }),
    );
    expect(boosted.score).toBeGreaterThan(base.score);
  });

  it("adds trialErrorBoost factor when detected", () => {
    const result = evaluateComplexity(
      makeCandidate({
        toolCalls: ["tool_a"],
        uniqueToolCount: 1,
        reasoningTurns: 1,
        durationMs: 5_000,
        transcript: "不对",
      }),
    );
    const trialFactor = result.factors.find((f) => f.name === "trialErrorBoost");
    expect(trialFactor).toBeDefined();
    expect(trialFactor!.normalized).toBeGreaterThan(0);
  });
});
