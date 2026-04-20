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
  });
});
