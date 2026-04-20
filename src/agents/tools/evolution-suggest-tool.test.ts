import { afterEach, describe, expect, it, vi } from "vitest";
import { createEvolutionSuggestTool } from "./evolution-suggest-tool.js";

const mockEvaluate = vi.fn();
const mockGenerate = vi.fn().mockReturnValue({
  name: "test-skill",
  description: "A test skill",
  triggerPhrases: ["test trigger"],
});
const mockSave = vi.fn().mockResolvedValue(undefined);

vi.mock("../../cognitive/evolution/engine.js", () => ({
  EvolutionEngine: class {
    evaluate = mockEvaluate;
    generate = mockGenerate;
  },
}));

vi.mock("../../cognitive/evolution/store.js", () => ({
  EvolutionStore: class {
    save = mockSave;
  },
}));

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    resolveConfigDir: vi.fn().mockReturnValue("/home/test/.kaijibot"),
  };
});

describe("createEvolutionSuggestTool", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockEvaluate.mockResolvedValue({ shouldSuggest: false, reasoning: "too simple", complexityScore: 0.2 });
  });

  it("returns null when cognitive.enabled is false", () => {
    const tool = createEvolutionSuggestTool({
      config: { cognitive: { enabled: false } } as never,
    });
    expect(tool).toBeNull();
  });

  it("returns null when cognitive.evolution.enabled is false", () => {
    const tool = createEvolutionSuggestTool({
      config: { cognitive: { enabled: true, evolution: { enabled: false } } } as never,
    });
    expect(tool).toBeNull();
  });

  it("returns tool when both enabled or config is absent", () => {
    const tool = createEvolutionSuggestTool({});
    expect(tool).not.toBeNull();
    expect(tool!.name).toBe("evaluate_skill_evolution");
  });

  it("returns tool when cognitive.enabled is true and evolution is absent", () => {
    const tool = createEvolutionSuggestTool({
      config: { cognitive: { enabled: true } } as never,
    });
    expect(tool).not.toBeNull();
    expect(tool!.name).toBe("evaluate_skill_evolution");
  });

  describe("execute", () => {
    it("returns no_session when sessionKey is missing", async () => {
      const tool = createEvolutionSuggestTool({})!;

      const result = await tool.execute("call-1", {
        taskSummary: "test",
        toolCalls: ["tool_a"],
        uniqueToolCount: 1,
        reasoningTurns: 2,
        durationMs: 1000,
        domain: "test",
      });

      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text).toContain("No user session");
      expect(mockEvaluate).not.toHaveBeenCalled();
    });

    it("returns skipped when engine decides not to suggest", async () => {
      const tool = createEvolutionSuggestTool({
        sessionKey: "agent:main:user-1",
      })!;

      const result = await tool.execute("call-2", {
        taskSummary: "simple task",
        toolCalls: ["tool_a"],
        uniqueToolCount: 1,
        reasoningTurns: 2,
        durationMs: 500,
        domain: "test",
      });

      const payload = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(payload.status).toBe("skipped");
      expect(mockEvaluate).toHaveBeenCalledTimes(1);
      expect(mockSave).not.toHaveBeenCalled();
    });

    it("returns suggested when engine decides to suggest", async () => {
      mockEvaluate.mockResolvedValueOnce({
        shouldSuggest: true,
        reasoning: "complex multi-step workflow",
        complexityScore: 0.85,
        confidence: 0.9,
      });

      const tool = createEvolutionSuggestTool({
        sessionKey: "agent:main:user-2",
      })!;

      const result = await tool.execute("call-3", {
        taskSummary: "complex workflow",
        toolCalls: ["tool_a", "tool_b", "tool_c"],
        uniqueToolCount: 3,
        reasoningTurns: 8,
        durationMs: 15000,
        domain: "code-review",
      });

      const payload = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(payload.status).toBe("suggested");
      expect(payload.skillName).toBe("test-skill");
      expect(payload.complexityScore).toBe(0.85);
      expect(mockSave).toHaveBeenCalledTimes(1);
    });

    it("returns error when engine throws", async () => {
      mockEvaluate.mockRejectedValueOnce(new Error("engine failure"));

      const tool = createEvolutionSuggestTool({
        sessionKey: "agent:main:user-3",
      })!;

      const result = await tool.execute("call-4", {
        taskSummary: "failing task",
        toolCalls: ["tool_a"],
        uniqueToolCount: 1,
        reasoningTurns: 2,
        durationMs: 1000,
        domain: "test",
      });

      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text).toContain("Evolution evaluation failed");
      expect(text).toContain("engine failure");
    });
  });
});
