import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillPersistenceWriter } from "../../cognitive/evolution/skill-writer.js";
import type { SkillDraft } from "../../cognitive/evolution/types.js";
import { createEvolutionArchiveTool } from "./evolution-archive-tool.js";

let tempDir: string;

function makeDraft(overrides: Partial<SkillDraft> = {}): SkillDraft {
  return {
    name: "test-skill",
    description: "A test skill",
    triggerPhrases: ["test"],
    bodyMarkdown: "# Test",
    ...overrides,
  };
}

describe("createEvolutionArchiveTool", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kaijibot-archive-tool-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns null when cognitive is disabled", () => {
    const tool = createEvolutionArchiveTool({
      config: { cognitive: { enabled: false } } as any,
    });
    expect(tool).toBeNull();
  });

  it("returns null when evolution is disabled", () => {
    const tool = createEvolutionArchiveTool({
      config: { cognitive: { enabled: true, evolution: { enabled: false } } } as any,
    });
    expect(tool).toBeNull();
  });

  it("returns tool when enabled", () => {
    const tool = createEvolutionArchiveTool({});
    expect(tool).not.toBeNull();
    expect(tool!.name).toBe("manage_archived_skills");
  });
});

describe("SkillPersistenceWriter archive recovery", () => {
  let writer: SkillPersistenceWriter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kaijibot-archive-recovery-test-"));
    writer = new SkillPersistenceWriter(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("listArchivedSkillNames returns archived skills", async () => {
    await writer.writeSkill(makeDraft({ name: "old-skill" }));
    await writer.archiveSkill("old-skill");

    const names = await writer.listArchivedSkillNames();
    expect(names).toContain("old-skill");
  });

  it("listArchivedSkillNames returns empty when no archives", async () => {
    const names = await writer.listArchivedSkillNames();
    expect(names).toEqual([]);
  });

  it("readArchivedSkillMeta parses frontmatter", async () => {
    await writer.writeSkill(makeDraft({ name: "meta-skill", description: "Archived skill meta" }));
    await writer.archiveSkill("meta-skill");

    const meta = await writer.readArchivedSkillMeta("meta-skill");
    expect(meta).not.toBeNull();
    expect(meta!.name).toBe("meta-skill");
    expect(meta!.description).toBe("Archived skill meta");
    expect(meta!.provenance).toBe("agent");
  });

  it("recoverSkill moves skill back to active", async () => {
    await writer.writeSkill(makeDraft({ name: "recover-me" }));
    await writer.archiveSkill("recover-me");

    expect(await writer.skillExists("recover-me")).toBe(false);

    const path = await writer.recoverSkill("recover-me");
    expect(await writer.skillExists("recover-me")).toBe(true);
    expect(await writer.listArchivedSkillNames()).not.toContain("recover-me");
  });

  it("recoverSkill throws for non-existent skill", async () => {
    await expect(writer.recoverSkill("nonexistent")).rejects.toThrow("Archived skill not found");
  });

  it("recoverSkill throws when active skill already exists", async () => {
    await writer.writeSkill(makeDraft({ name: "conflict" }));
    await writer.archiveSkill("conflict");
    await writer.writeSkill(makeDraft({ name: "conflict" }));

    await expect(writer.recoverSkill("conflict")).rejects.toThrow("Active skill already exists");
  });

  it("recoverSkill rejects path traversal", async () => {
    await expect(writer.recoverSkill("../etc/passwd")).rejects.toThrow("Invalid skill name");
  });
});
