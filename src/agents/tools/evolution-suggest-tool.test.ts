import { afterEach, describe, expect, it, vi } from "vitest";
import { createEvolutionSuggestTool } from "./evolution-suggest-tool.js";

const mockGenerate = vi.fn().mockResolvedValue({
  name: "test-skill",
  description: "A test skill",
  triggerPhrases: ["test trigger"],
  bodyMarkdown: "## When to use\n\nUse when testing.\n\n## Workflow\n\n1. Step one\n2. Step two",
});
const mockSave = vi.fn().mockResolvedValue(undefined);
const mockCheckBeforeGenerate = vi.fn().mockResolvedValue({ shouldCreate: true });

vi.mock("../../cognitive/evolution/engine.js", () => ({
  EvolutionEngine: class {
    generate = mockGenerate;
    checkBeforeGenerate = mockCheckBeforeGenerate;
  },
}));

vi.mock("../../cognitive/evolution/store.js", () => ({
  EvolutionStore: class {
    save = mockSave;
  },
}));

const mockWriteSkill = vi.fn().mockResolvedValue("/home/test/.kaijibot/skills/agent/test-skill/SKILL.md");
const mockListSkillNames = vi.fn().mockResolvedValue([]);
const mockReadSkillMeta = vi.fn().mockResolvedValue(null);

vi.mock("../../cognitive/evolution/skill-writer.js", () => ({
  SkillPersistenceWriter: class {
    writeSkill = mockWriteSkill;
    listSkillNames = mockListSkillNames;
    readSkillMeta = mockReadSkillMeta;
  },
}));

vi.mock("../../cognitive/evolution/skill-lifecycle.js", () => ({
  SkillLifecycleManager: class {},
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
    mockWriteSkill.mockResolvedValue("/home/test/.kaijibot/skills/agent/test-skill/SKILL.md");
    mockListSkillNames.mockResolvedValue([]);
    mockReadSkillMeta.mockResolvedValue(null);
    mockCheckBeforeGenerate.mockResolvedValue({ shouldCreate: true });
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
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it("generates, saves, and returns saved status", async () => {
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
      expect(payload.status).toBe("saved");
      expect(payload.skillName).toBe("feishu-wiki-archive");
      expect(payload.bodyMarkdown).toBeUndefined();
      expect(payload.savedPath).toBeDefined();
      expect(payload.suggestionText).toContain("自主进化");
      expect(payload.suggestionText).toContain("feishu-wiki-archive");
      expect(mockWriteSkill).toHaveBeenCalledTimes(1);
      expect(mockSave).toHaveBeenCalledTimes(1);
    });

    it("returns error when generate throws", async () => {
      mockGenerate.mockRejectedValueOnce(new Error("generation failure"));

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
      expect(text).toContain("Skill creation failed");
      expect(text).toContain("generation failure");
    });

    it("suggestionText includes skill name and description", async () => {
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
      expect(payload.status).toBe("saved");
      expect(payload.suggestionText).toContain("自主进化");
      expect(payload.suggestionText).toContain("multi-tool-skill");
    });

    it("passes transcript to generate via candidate", async () => {
      mockGenerate.mockResolvedValueOnce({
        name: "transcript-skill",
        description: "Transcript skill",
        triggerPhrases: ["test"],
        bodyMarkdown: "# Test",
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

      expect(mockGenerate).toHaveBeenCalledTimes(1);
      const candidate = mockGenerate.mock.calls[0][0] as { transcript?: string };
      expect(candidate.transcript).toBe("User asked about feishu wiki archiving, bot listed pages and moved them.");
    });

    it("passes hasTrialAndError to generate via candidate", async () => {
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

      const candidate = mockGenerate.mock.calls[0][0] as { hasTrialAndError?: boolean };
      expect(candidate.hasTrialAndError).toBe(true);
    });

    it("passes userCorrections to generate via candidate", async () => {
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

      const candidate = mockGenerate.mock.calls[0][0] as { userCorrections?: number };
      expect(candidate.userCorrections).toBe(4);
    });

    it("prefers deliveryTo over sessionKey for userId", async () => {
      const tool = createEvolutionSuggestTool({
        sessionKey: "agent:main:main",
        deliveryTo: "user:ou_abc123",
      })!;

      await tool.execute("call-9", {
        taskSummary: "test", toolCalls: ["a"], uniqueToolCount: 1, reasoningTurns: 1, durationMs: 100, domain: "t",
      });

      expect(mockGenerate).toHaveBeenCalledTimes(1);
    });

    it("returns no_session when both deliveryTo and sessionKey yield no userId", async () => {
      const tool = createEvolutionSuggestTool({
        sessionKey: "agent:main:main",
      })!;

      const result = await tool.execute("call-10", {
        taskSummary: "test", toolCalls: ["a"], uniqueToolCount: 1, reasoningTurns: 1, durationMs: 100, domain: "t",
      });

      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text).toContain("No user session");
    });

    it("strips feishu: prefix from deliveryTo", async () => {
      const tool = createEvolutionSuggestTool({
        sessionKey: "agent:main:main",
        deliveryTo: "feishu:ou_xyz789",
      })!;

      await tool.execute("call-11", {
        taskSummary: "test", toolCalls: ["a"], uniqueToolCount: 1, reasoningTurns: 1, durationMs: 100, domain: "t",
      });

      expect(mockGenerate).toHaveBeenCalledTimes(1);
    });

    it("returns duplicate when dedup finds existing", async () => {
      mockGenerate.mockResolvedValueOnce({
        name: "dupe",
        description: "dupe",
        triggerPhrases: ["t"],
        bodyMarkdown: "#",
      });
      mockCheckBeforeGenerate.mockResolvedValueOnce({ shouldCreate: false, existingSkill: "existing-one" });

      const tool = createEvolutionSuggestTool({
        sessionKey: "agent:main:user-dedup",
      })!;

      const result = await tool.execute("call-dedup", {
        taskSummary: "dedup task",
        toolCalls: ["tool_a", "tool_b", "tool_c"],
        uniqueToolCount: 3,
        reasoningTurns: 3,
        durationMs: 1000,
        domain: "test",
      });

      const payload = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(payload.status).toBe("duplicate");
      expect(payload.suggestionText).toContain("已有技能");
      expect(payload.suggestionText).toContain("existing-one");
      expect(mockWriteSkill).not.toHaveBeenCalled();
    });

    it("saves record with savedSkillPath", async () => {
      mockGenerate.mockResolvedValueOnce({
        name: "path-test",
        description: "Path test",
        triggerPhrases: ["test"],
        bodyMarkdown: "# Test",
      });
      mockWriteSkill.mockResolvedValueOnce("/home/test/.kaijibot/skills/agent/path-test/SKILL.md");

      const tool = createEvolutionSuggestTool({
        sessionKey: "agent:main:user-path",
      })!;

      await tool.execute("call-path", {
        taskSummary: "path test",
        toolCalls: ["a", "b", "c"],
        uniqueToolCount: 3,
        reasoningTurns: 3,
        durationMs: 1000,
        domain: "test",
      });

      expect(mockSave).toHaveBeenCalledTimes(1);
      const savedRecord = mockSave.mock.calls[0][1];
      expect(savedRecord.savedSkillPath).toBe("/home/test/.kaijibot/skills/agent/path-test/SKILL.md");
      expect(savedRecord.draft.name).toBe("path-test");
    });
  });
});
