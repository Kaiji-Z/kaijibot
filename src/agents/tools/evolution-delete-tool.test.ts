import { describe, it, expect, vi } from "vitest";

vi.mock("../../cognitive/evolution/skill-writer.js", () => ({
  SkillPersistenceWriter: vi.fn().mockImplementation(() => ({
    removeSkill: vi.fn().mockResolvedValue(true),
    listSkills: vi.fn().mockResolvedValue([]),
  })),
}));

describe("createEvolutionDeleteTool", () => {
  it("returns null when cognitive is disabled", async () => {
    const { createEvolutionDeleteTool } = await import("./evolution-delete-tool.js");
    const tool = createEvolutionDeleteTool({ config: { cognitive: { enabled: false } } as never });
    expect(tool).toBeNull();
  });

  it("returns null when evolution is disabled", async () => {
    const { createEvolutionDeleteTool } = await import("./evolution-delete-tool.js");
    const tool = createEvolutionDeleteTool({
      config: { cognitive: { enabled: true, evolution: { enabled: false } } } as never,
    });
    expect(tool).toBeNull();
  });

  it("returns a tool with name delete_skill when enabled", async () => {
    const { createEvolutionDeleteTool } = await import("./evolution-delete-tool.js");
    const tool = createEvolutionDeleteTool({ config: {} as never });
    expect(tool).not.toBeNull();
    expect(tool!.name).toBe("delete_skill");
  });

  it("deletes a skill and returns status", async () => {
    const { createEvolutionDeleteTool } = await import("./evolution-delete-tool.js");
    const tool = createEvolutionDeleteTool({ config: {} as never });
    const result = await tool!.execute("test-call", { name: "test-skill", confirm: true } as never);
    expect(result.content).toBeDefined();
  });

  it("refuses deletion when confirm is false", async () => {
    const { createEvolutionDeleteTool } = await import("./evolution-delete-tool.js");
    const tool = createEvolutionDeleteTool({ config: {} as never });
    const result = await tool!.execute("test-call", {
      name: "test-skill",
      confirm: false,
    } as never);
    const text = JSON.stringify(result);
    expect(text).toContain("confirm");
  });

  it("refuses deletion when confirm is missing", async () => {
    const { createEvolutionDeleteTool } = await import("./evolution-delete-tool.js");
    const tool = createEvolutionDeleteTool({ config: {} as never });
    const result = await tool!.execute("test-call", { name: "test-skill" } as never);
    const text = JSON.stringify(result);
    expect(text).toContain("confirm");
  });
});
