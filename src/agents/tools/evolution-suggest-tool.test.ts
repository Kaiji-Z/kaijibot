import { afterEach, describe, expect, it, vi } from "vitest";
import { createEvolutionSuggestTool } from "./evolution-suggest-tool.js";

const mockEvaluate = vi.fn();
const mockGenerate = vi.fn().mockReturnValue({
  name: "test-skill",
  description: "A test skill",
  triggerPhrases: ["test trigger"],
  bodyMarkdown: "## When to use\n\nUse when testing.\n\n## Workflow\n\n1. Step one\n2. Step two",
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
      mockGenerate.mockResolvedValueOnce({
        name: "feishu-wiki-archive",
        description: "Archive wiki pages",
        triggerPhrases: ["归档", "archive"],
        bodyMarkdown: "## When to use\n\nUse when archiving wiki.\n\n## Workflow\n\n1. Scan\n2. Move",
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
      expect(payload.skillName).toBe("feishu-wiki-archive");
      expect(payload.complexityScore).toBe(0.85);
      expect(payload.bodyMarkdown).toBe("## When to use\n\nUse when archiving wiki.\n\n## Workflow\n\n1. Scan\n2. Move");
      expect(payload.suggestionText).toContain("刚才帮你完成了");
      expect(payload.suggestionText).toContain("complex workflow");
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

    it("suggestionText includes tool count and reasoning turns", async () => {
      mockEvaluate.mockResolvedValueOnce({
        shouldSuggest: true,
        reasoning: "complex",
        complexityScore: 0.9,
        confidence: 0.95,
      });
      mockGenerate.mockResolvedValueOnce({
        name: "multi-tool-skill",
        description: "Multi-tool skill",
        triggerPhrases: ["multi"],
        bodyMarkdown: "## Workflow\n\n1. A\n2. B\n3. C\n4. D",
      });

      const tool = createEvolutionSuggestTool({
        sessionKey: "agent:main:user-4",
      })!;

      const result = await tool.execute("call-5", {
        taskSummary: "multi-step analysis",
        toolCalls: ["tool_a", "tool_b", "tool_c", "tool_d", "tool_e"],
        uniqueToolCount: 5,
        reasoningTurns: 12,
        durationMs: 30000,
        domain: "data-analysis",
      });

      const payload = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(payload.suggestionText).toContain("5 个工具");
      expect(payload.suggestionText).toContain("12 轮推理");
    });

    it("passes transcript to candidate in engine.evaluate", async () => {
      mockEvaluate.mockResolvedValueOnce({
        shouldSuggest: false,
        reasoning: "too simple",
        complexityScore: 0.2,
      });

      const tool = createEvolutionSuggestTool({
        sessionKey: "agent:main:user-5",
      })!;

      await tool.execute("call-6", {
        taskSummary: "task with transcript",
        toolCalls: ["tool_a"],
        uniqueToolCount: 1,
        reasoningTurns: 2,
        durationMs: 1000,
        domain: "test",
        transcript: "User asked about feishu wiki archiving, bot listed pages and moved them.",
      });

      expect(mockEvaluate).toHaveBeenCalledTimes(1);
      const candidate = mockEvaluate.mock.calls[0][0] as { transcript?: string };
      expect(candidate.transcript).toBe("User asked about feishu wiki archiving, bot listed pages and moved them.");
    });

    it("passes hasTrialAndError to candidate", async () => {
      mockEvaluate.mockResolvedValueOnce({
        shouldSuggest: false,
        reasoning: "too simple",
        complexityScore: 0.2,
      });

      const tool = createEvolutionSuggestTool({
        sessionKey: "agent:main:user-6",
      })!;

      await tool.execute("call-7", {
        taskSummary: "trial-error task",
        toolCalls: ["tool_a"],
        uniqueToolCount: 1,
        reasoningTurns: 2,
        durationMs: 1000,
        domain: "test",
        hasTrialAndError: true,
      });

      const candidate = mockEvaluate.mock.calls[0][0] as { hasTrialAndError?: boolean };
      expect(candidate.hasTrialAndError).toBe(true);
    });

    it("passes userCorrections to candidate", async () => {
      mockEvaluate.mockResolvedValueOnce({
        shouldSuggest: false,
        reasoning: "too simple",
        complexityScore: 0.2,
      });

      const tool = createEvolutionSuggestTool({
        sessionKey: "agent:main:user-7",
      })!;

      await tool.execute("call-8", {
        taskSummary: "corrected task",
        toolCalls: ["tool_a"],
        uniqueToolCount: 1,
        reasoningTurns: 2,
        durationMs: 1000,
        domain: "test",
        userCorrections: 4,
      });

      const candidate = mockEvaluate.mock.calls[0][0] as { userCorrections?: number };
      expect(candidate.userCorrections).toBe(4);
    });
  });
});
