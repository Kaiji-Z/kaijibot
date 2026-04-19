import { describe, expect, it } from "vitest";
import { evaluateComplexity } from "./complexity-evaluator.js";
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
});
