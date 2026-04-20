import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { SkillPersistenceWriter } from "./skill-writer.js";
import type { SkillDraft } from "./types.js";

let tempDir: string;
let writer: SkillPersistenceWriter;

function makeDraft(overrides: Partial<SkillDraft> = {}): SkillDraft {
  return {
    name: "test-skill",
    description: "A test skill for verification",
    triggerPhrases: ["test this", "run test"],
    bodyMarkdown: "# Test Skill\n\nThis is the body.",
    ...overrides,
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "kaijibot-skill-writer-test-"));
  writer = new SkillPersistenceWriter(tempDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("SkillPersistenceWriter", () => {
  it("writes SKILL.md with correct YAML frontmatter and body", async () => {
    const draft = makeDraft();
    const path = await writer.writeSkill(draft);

    expect(existsSync(path)).toBe(true);
    const content = await readFile(path, "utf-8");
    expect(content).toContain("name: test-skill");
    expect(content).toContain('description: "A test skill for verification"');
    expect(content).toContain("# Test Skill");
    expect(content).toContain("This is the body.");
  });

  it("creates parent directory if missing", async () => {
    const draft = makeDraft({ name: "deep/nested/skill" });
    const path = await writer.writeSkill(draft);

    expect(existsSync(path)).toBe(true);
    const content = await readFile(path, "utf-8");
    expect(content).toContain("name: deep/nested/skill");
  });

  it("skillExists returns true for existing and false for missing", async () => {
    expect(await writer.skillExists("test-skill")).toBe(false);

    await writer.writeSkill(makeDraft());
    expect(await writer.skillExists("test-skill")).toBe(true);
  });

  it("removeSkill deletes directory and file", async () => {
    await writer.writeSkill(makeDraft());
    expect(await writer.skillExists("test-skill")).toBe(true);

    await writer.removeSkill("test-skill");
    expect(await writer.skillExists("test-skill")).toBe(false);
    expect(existsSync(join(tempDir, "skills", "test-skill"))).toBe(false);
  });

  it("rejects names with path traversal", async () => {
    const draft = makeDraft({ name: "../etc/passwd" });
    await expect(writer.writeSkill(draft)).rejects.toThrow("Invalid skill name");
  });

  it("rejects absolute paths", async () => {
    const draft = makeDraft({ name: "/tmp/evil" });
    await expect(writer.writeSkill(draft)).rejects.toThrow("Invalid skill name");
  });

  it("written SKILL.md contains valid frontmatter with name and description", async () => {
    const draft = makeDraft({
      name: "my-cool-skill",
      description: 'Does "cool" things with quotes',
      triggerPhrases: ["do cool thing"],
      bodyMarkdown: "## Usage\n\nInvoke with `cool`.",
    });
    const path = await writer.writeSkill(draft);
    const content = await readFile(path, "utf-8");

    expect(content.startsWith("---\n")).toBe(true);
    expect(content).toContain("name: my-cool-skill");
    expect(content).toContain('description: "Does \\"cool\\" things with quotes"');
    expect(content).toContain("metadata:");
    expect(content).toContain("generated: true");
    expect(content).toContain("## Triggers");
    expect(content).toContain("- do cool thing");
    expect(content).toContain("## Usage");
  });

  it("written SKILL.md contains createdAt in frontmatter", async () => {
    const draft = makeDraft();
    const path = await writer.writeSkill(draft);
    const content = await readFile(path, "utf-8");

    expect(content).toMatch(/^createdAt:\s*\d+$/m);
    expect(content).toMatch(/^lastUsedAt:\s*\d+$/m);
    expect(content).toMatch(/^usageCount:\s*0$/m);
  });

  it("readSkillMeta() returns null for missing skill", async () => {
    const meta = await writer.readSkillMeta("nonexistent");
    expect(meta).toBeNull();
  });

  it("readSkillMeta() parses lifecycle fields", async () => {
    const draft = makeDraft({
      name: "meta-test",
      description: "Test metadata parsing",
    });
    await writer.writeSkill(draft);

    const meta = await writer.readSkillMeta("meta-test");
    expect(meta).not.toBeNull();
    expect(meta!.name).toBe("meta-test");
    expect(meta!.description).toBe("Test metadata parsing");
    expect(meta!.createdAt).toBeGreaterThan(0);
    expect(meta!.lastUsedAt).toBeGreaterThan(0);
    expect(meta!.usageCount).toBe(0);
    expect(meta!.isStale).toBe(false);
  });

  it("touchSkill() increments usageCount and updates lastUsedAt", async () => {
    const draft = makeDraft({ name: "touch-test" });
    await writer.writeSkill(draft);

    const before = await writer.readSkillMeta("touch-test");
    expect(before!.usageCount).toBe(0);

    await writer.touchSkill("touch-test");

    const after = await writer.readSkillMeta("touch-test");
    expect(after!.usageCount).toBe(1);
    expect(after!.lastUsedAt).toBeGreaterThanOrEqual(before!.lastUsedAt);

    await writer.touchSkill("touch-test");
    const afterSecond = await writer.readSkillMeta("touch-test");
    expect(afterSecond!.usageCount).toBe(2);
  });

  it("touchSkill() does nothing for missing skill", async () => {
    await expect(writer.touchSkill("nonexistent")).resolves.toBeUndefined();
  });

  it("listSkillNames() returns skill directory names", async () => {
    await writer.writeSkill(makeDraft({ name: "skill-a" }));
    await writer.writeSkill(makeDraft({ name: "skill-b" }));

    const names = await writer.listSkillNames();
    expect(names.sort()).toEqual(["skill-a", "skill-b"]);
  });

  it("listSkillNames() skips directories without SKILL.md", async () => {
    const skillsDir = join(tempDir, "skills");
    mkdirSync(join(skillsDir, "empty-dir"), { recursive: true });
    await writer.writeSkill(makeDraft({ name: "real-skill" }));

    const names = await writer.listSkillNames();
    expect(names).toEqual(["real-skill"]);
  });

  it("readSkillMeta() marks skill as stale when lastUsedAt is old", async () => {
    const draft = makeDraft({ name: "stale-test" });
    await writer.writeSkill(draft);

    const skillPath = join(tempDir, "skills", "stale-test", "SKILL.md");
    let content = await readFile(skillPath, "utf-8");
    const oldTimestamp = Date.now() - 31 * 24 * 60 * 60 * 1000;
    content = content.replace(/^lastUsedAt:\s*\d+/m, `lastUsedAt: ${oldTimestamp}`);
    writeFileSync(skillPath, content, "utf-8");

    const meta = await writer.readSkillMeta("stale-test");
    expect(meta!.isStale).toBe(true);
  });
});
