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
    expect(existsSync(join(tempDir, "skills", "agent", "test-skill"))).toBe(false);
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

  it("written SKILL.md contains provenance: agent by default", async () => {
    const draft = makeDraft();
    const path = await writer.writeSkill(draft);
    const content = await readFile(path, "utf-8");

    expect(content).toMatch(/^provenance:\s*agent$/m);
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
    expect(meta!.provenance).toBe("agent");
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
    const skillsDir = join(tempDir, "skills", "agent");
    mkdirSync(join(skillsDir, "empty-dir"), { recursive: true });
    await writer.writeSkill(makeDraft({ name: "real-skill" }));

    const names = await writer.listSkillNames();
    expect(names).toEqual(["real-skill"]);
  });

  it("listSkillNames() excludes _archive directory", async () => {
    await writer.writeSkill(makeDraft({ name: "active-skill" }));
    const skillsDir = join(tempDir, "skills", "agent");
    mkdirSync(join(skillsDir, "_archive"), { recursive: true });
    mkdirSync(join(skillsDir, "_archive", "archived-skill"), { recursive: true });
    writeFileSync(join(skillsDir, "_archive", "archived-skill", "SKILL.md"), "---\nname: archived\n---\n", "utf-8");

    const names = await writer.listSkillNames();
    expect(names).toEqual(["active-skill"]);
  });

  it("readSkillMeta() marks skill as stale when lastUsedAt is old", async () => {
    const draft = makeDraft({ name: "stale-test" });
    await writer.writeSkill(draft);

    const skillPath = join(tempDir, "skills", "agent", "stale-test", "SKILL.md");
    let content = await readFile(skillPath, "utf-8");
    const oldTimestamp = Date.now() - 31 * 24 * 60 * 60 * 1000;
    content = content.replace(/^lastUsedAt:\s*\d+/m, `lastUsedAt: ${oldTimestamp}`);
    writeFileSync(skillPath, content, "utf-8");

    const meta = await writer.readSkillMeta("stale-test");
    expect(meta!.isStale).toBe(true);
  });

  it("writes to skills/agent/ subdirectory by default", async () => {
    await writer.writeSkill(makeDraft({ name: "agent-skill" }));
    expect(existsSync(join(tempDir, "skills", "agent", "agent-skill", "SKILL.md"))).toBe(true);
  });

  it("archiveSkill() moves skill to _archive directory", async () => {
    await writer.writeSkill(makeDraft({ name: "to-archive" }));
    expect(await writer.skillExists("to-archive")).toBe(true);

    const archivePath = await writer.archiveSkill("to-archive");
    expect(archivePath).toBe(join(tempDir, "skills", "agent", "_archive", "to-archive"));
    expect(await writer.skillExists("to-archive")).toBe(false);
    expect(existsSync(join(tempDir, "skills", "agent", "_archive", "to-archive", "SKILL.md"))).toBe(true);
  });

  it("archiveSkill() rejects path traversal", async () => {
    await expect(writer.archiveSkill("..")).rejects.toThrow("Invalid skill name");
  });

  it("findSkillDir() finds skills in agent directory", async () => {
    await writer.writeSkill(makeDraft({ name: "find-me" }));
    const dir = await writer.findSkillDir("find-me");
    expect(dir).toBe(join(tempDir, "skills", "agent", "find-me"));
  });

  it("findSkillDir() finds skills in user skills directory", async () => {
    const userDir = join(tempDir, "skills", "user-skill");
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, "SKILL.md"), "---\nname: user-skill\n---\nBody", "utf-8");

    const dir = await writer.findSkillDir("user-skill");
    expect(dir).toBe(userDir);
  });

  it("findSkillDir() returns null for missing skill", async () => {
    const dir = await writer.findSkillDir("nonexistent");
    expect(dir).toBeNull();
  });

  it("findSkillDir() prefers agent directory over user directory", async () => {
    await writer.writeSkill(makeDraft({ name: "dual-skill" }));
    const userDir = join(tempDir, "skills", "dual-skill");
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, "SKILL.md"), "---\nname: dual-skill\n---\nUser version", "utf-8");

    const dir = await writer.findSkillDir("dual-skill");
    expect(dir).toBe(join(tempDir, "skills", "agent", "dual-skill"));
  });

  it("updateSkill() works on skills found via findSkillDir", async () => {
    await writer.writeSkill(makeDraft({ name: "patchable" }));
    const raw = await writer.readRawSkill("patchable");
    expect(raw).not.toBeNull();

    const updated = raw!.replace("# Test Skill", "# Updated Skill");
    const updatedPath = await writer.updateSkill("patchable", updated);
    expect(updatedPath).toBe(join(tempDir, "skills", "agent", "patchable", "SKILL.md"));

    const content = await readFile(updatedPath, "utf-8");
    expect(content).toContain("# Updated Skill");
  });

  it("updateSkill() throws for missing skill", async () => {
    await expect(writer.updateSkill("nonexistent", "content")).rejects.toThrow("Skill not found");
  });

  it("writeSkill creates scripts/ dir + files when draft.scripts provided", async () => {
    const draft = makeDraft({
      name: "with-scripts",
      scripts: { "main.py": "print('hello')", "helper.sh": "#!/bin/bash\necho hi" },
    });
    await writer.writeSkill(draft);

    const scriptsDir = join(tempDir, "skills", "agent", "with-scripts", "scripts");
    expect(existsSync(scriptsDir)).toBe(true);
    const mainPy = await readFile(join(scriptsDir, "main.py"), "utf-8");
    expect(mainPy).toBe("print('hello')");
    const helperSh = await readFile(join(scriptsDir, "helper.sh"), "utf-8");
    expect(helperSh).toBe("#!/bin/bash\necho hi");
  });

  it("writeSkill creates references/ dir + files when draft.references provided", async () => {
    const draft = makeDraft({
      name: "with-refs",
      references: { "api.md": "# API Reference\n\n## GET /foo", "config.yaml": "key: value" },
    });
    await writer.writeSkill(draft);

    const refsDir = join(tempDir, "skills", "agent", "with-refs", "references");
    expect(existsSync(refsDir)).toBe(true);
    const apiMd = await readFile(join(refsDir, "api.md"), "utf-8");
    expect(apiMd).toContain("# API Reference");
    const configYaml = await readFile(join(refsDir, "config.yaml"), "utf-8");
    expect(configYaml).toBe("key: value");
  });

  it("writeSkill creates assets/ dir + files when draft.assets provided", async () => {
    const draft = makeDraft({
      name: "with-assets",
      assets: { "data.json": '{"key": "value"}' },
    });
    await writer.writeSkill(draft);

    const assetsDir = join(tempDir, "skills", "agent", "with-assets", "assets");
    expect(existsSync(assetsDir)).toBe(true);
    const dataJson = await readFile(join(assetsDir, "data.json"), "utf-8");
    expect(dataJson).toBe('{"key": "value"}');
  });

  it("writeSkill skips path traversal filenames in scripts", async () => {
    const draft = makeDraft({
      name: "traversal-test",
      scripts: {
        "good.py": "print('safe')",
        "../evil.py": "print('traversal')",
        "/abs/path.py": "print('absolute')",
      },
    });
    await writer.writeSkill(draft);

    const scriptsDir = join(tempDir, "skills", "agent", "traversal-test", "scripts");
    expect(existsSync(join(scriptsDir, "good.py"))).toBe(true);
    expect(existsSync(join(scriptsDir, "evil.py"))).toBe(false);
    expect(existsSync(join(scriptsDir, "path.py"))).toBe(false);
    const goodContent = await readFile(join(scriptsDir, "good.py"), "utf-8");
    expect(goodContent).toBe("print('safe')");
  });
});

describe("SkillPersistenceWriter with agentSkills: false", () => {
  let userWriter: SkillPersistenceWriter;

  beforeEach(() => {
    userWriter = new SkillPersistenceWriter(tempDir, { agentSkills: false });
  });

  it("writes to skills/ directory (not skills/agent/)", async () => {
    await userWriter.writeSkill(makeDraft({ name: "user-skill" }));
    expect(existsSync(join(tempDir, "skills", "user-skill", "SKILL.md"))).toBe(true);
  });

  it("does not include provenance in frontmatter", async () => {
    const path = await userWriter.writeSkill(makeDraft({ name: "no-prov" }));
    const content = await readFile(path, "utf-8");
    expect(content).not.toMatch(/^provenance:/m);
  });

  it("readSkillMeta() returns undefined provenance for user skills", async () => {
    await userWriter.writeSkill(makeDraft({ name: "user-meta" }));
    const meta = await userWriter.readSkillMeta("user-meta");
    expect(meta).not.toBeNull();
    expect(meta!.provenance).toBeUndefined();
  });

  it("listSkillNames() lists user skills", async () => {
    await userWriter.writeSkill(makeDraft({ name: "user-a" }));
    const names = await userWriter.listSkillNames();
    expect(names).toEqual(["user-a"]);
  });

  it("archiveSkill() archives to skills/_archive/", async () => {
    await userWriter.writeSkill(makeDraft({ name: "to-archive" }));
    const archivePath = await userWriter.archiveSkill("to-archive");
    expect(archivePath).toBe(join(tempDir, "skills", "_archive", "to-archive"));
    expect(existsSync(join(tempDir, "skills", "_archive", "to-archive", "SKILL.md"))).toBe(true);
    expect(existsSync(join(tempDir, "skills", "to-archive"))).toBe(false);
  });
});
