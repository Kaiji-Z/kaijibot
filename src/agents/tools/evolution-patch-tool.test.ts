import { afterEach, describe, expect, it, vi } from "vitest";
import { createEvolutionPatchTool } from "./evolution-patch-tool.js";

const mockPatchSkill = vi.fn();

vi.mock("../../cognitive/evolution/engine.js", () => ({
  EvolutionEngine: class {
    patchSkill = mockPatchSkill;
  },
}));

vi.mock("../../cognitive/evolution/store.js", () => ({
  EvolutionStore: class {},
}));

vi.mock("../../cognitive/evolution/skill-writer.js", () => ({
  SkillPersistenceWriter: class {},
}));

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    resolveConfigDir: vi.fn().mockReturnValue("/home/test/.kaijibot"),
  };
});

vi.mock("../../routing/session-key.js", () => ({
  resolveAgentIdFromSessionKey: vi.fn().mockReturnValue("main"),
}));

vi.mock("../../agents/agent-scope.js", () => ({
  resolveAgentWorkspaceDir: vi.fn().mockReturnValue("/home/test/.kaijibot/workspace"),
}));

describe("createEvolutionPatchTool", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when cognitive.enabled is false", () => {
    const tool = createEvolutionPatchTool({
      config: { cognitive: { enabled: false } } as never,
    });
    expect(tool).toBeNull();
  });

  it("returns null when cognitive.evolution.enabled is false", () => {
    const tool = createEvolutionPatchTool({
      config: { cognitive: { enabled: true, evolution: { enabled: false } } } as never,
    });
    expect(tool).toBeNull();
  });

  it("returns tool when enabled", () => {
    const tool = createEvolutionPatchTool({});
    expect(tool).not.toBeNull();
    expect(tool!.name).toBe("patch_skill");
  });

  it("returns tool when cognitive.enabled is true and evolution is absent", () => {
    const tool = createEvolutionPatchTool({
      config: { cognitive: { enabled: true } } as never,
    });
    expect(tool).not.toBeNull();
    expect(tool!.name).toBe("patch_skill");
  });

  describe("execute", () => {
    it("returns error when skill not found", async () => {
      mockPatchSkill.mockResolvedValueOnce({
        ok: false,
        error: "Skill not found: missing-skill",
      });

      const tool = createEvolutionPatchTool({})!;
      const result = await tool.execute("call-1", {
        name: "missing-skill",
        instructions: "update it",
      });

      const payload = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(payload.status).toBe("error");
      expect(payload.error).toContain("Skill not found");
    });

    it("returns success when patch applied", async () => {
      mockPatchSkill.mockResolvedValueOnce({
        ok: true,
        updatedPath: "/home/test/.kaijibot/skills/my-skill/SKILL.md",
      });

      const tool = createEvolutionPatchTool({})!;
      const result = await tool.execute("call-2", {
        name: "my-skill",
        instructions: "Add a new section about error handling",
      });

      const payload = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(payload.status).toBe("patched");
      expect(payload.skillName).toBe("my-skill");
      expect(payload.updatedPath).toContain("my-skill");
    });

    it("passes replacements through", async () => {
      mockPatchSkill.mockResolvedValueOnce({
        ok: true,
        updatedPath: "/home/test/.kaijibot/skills/rp-skill/SKILL.md",
      });

      const tool = createEvolutionPatchTool({})!;
      const result = await tool.execute("call-3", {
        name: "rp-skill",
        instructions: "Fix the description",
        replacements: [
          { oldText: "old description", newText: "new description" },
        ],
      });

      const payload = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(payload.status).toBe("patched");
      expect(mockPatchSkill).toHaveBeenCalledTimes(1);
      const patchArg = mockPatchSkill.mock.calls[0][0] as {
        name: string;
        instructions: string;
        replacements?: Array<{ oldText: string; newText: string }>;
      };
      expect(patchArg.replacements).toEqual([
        { oldText: "old description", newText: "new description" },
      ]);
    });

    it("resolves workspace dir from sessionKey for non-default agent", async () => {
      const { resolveAgentIdFromSessionKey } = await import("../../routing/session-key.js");
      const { resolveAgentWorkspaceDir } = await import("../../agents/agent-scope.js");
      (resolveAgentIdFromSessionKey as ReturnType<typeof vi.fn>).mockReturnValue("custom-agent");
      (resolveAgentWorkspaceDir as ReturnType<typeof vi.fn>).mockReturnValue("/custom/workspace");

      mockPatchSkill.mockResolvedValueOnce({
        ok: true,
        updatedPath: "/custom/workspace/skills/test-skill/SKILL.md",
      });

      const tool = createEvolutionPatchTool({
        config: { cognitive: { enabled: true } } as never,
        sessionKey: "agent:custom-agent:ou_123",
      })!;
      const result = await tool.execute("call-4", {
        name: "test-skill",
        instructions: "fix it",
      });

      const payload = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(payload.status).toBe("patched");
      expect(resolveAgentIdFromSessionKey).toHaveBeenCalledWith("agent:custom-agent:ou_123");
      expect(resolveAgentWorkspaceDir).toHaveBeenCalled();
    });

    it("falls back to configDir when config is undefined", async () => {
      const { resolveAgentWorkspaceDir } = await import("../../agents/agent-scope.js");

      mockPatchSkill.mockResolvedValueOnce({
        ok: true,
        updatedPath: "/home/test/.kaijibot/skills/fallback-skill/SKILL.md",
      });

      const tool = createEvolutionPatchTool({})!;
      await tool.execute("call-5", {
        name: "fallback-skill",
        instructions: "update",
      });

      expect(resolveAgentWorkspaceDir).not.toHaveBeenCalled();
    });
  });
});
