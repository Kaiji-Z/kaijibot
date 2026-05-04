import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { SkillPersistenceWriter } from "./skill-writer.js";
import { SkillLifecycleManager } from "./skill-lifecycle.js";
import type { SkillDraft } from "./types.js";

let tempDir: string;
let writer: SkillPersistenceWriter;
let lifecycle: SkillLifecycleManager;

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
  tempDir = mkdtempSync(join(tmpdir(), "kaijibot-skill-lifecycle-test-"));
  writer = new SkillPersistenceWriter(tempDir);
  lifecycle = new SkillLifecycleManager(writer);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("SkillLifecycleManager", () => {
  describe("listSkills()", () => {
    it("returns empty when no skills exist", async () => {
      const skills = await lifecycle.listSkills();
      expect(skills).toEqual([]);
    });

    it("returns metadata for existing skills", async () => {
      await writer.writeSkill(
        makeDraft({
          name: "feishu-wiki",
          description: "Archive feishu wiki documents",
        }),
      );
      await writer.writeSkill(
        makeDraft({
          name: "feishu-calendar",
          description: "Manage feishu calendar events",
        }),
      );

      const skills = await lifecycle.listSkills();
      expect(skills).toHaveLength(2);
      const names = skills.map((s) => s.name).sort();
      expect(names).toEqual(["feishu-calendar", "feishu-wiki"]);

      for (const skill of skills) {
        expect(skill.createdAt).toBeGreaterThan(0);
        expect(skill.lastUsedAt).toBeGreaterThan(0);
        expect(skill.usageCount).toBe(0);
        expect(skill.isStale).toBe(false);
        expect(skill.provenance).toBe("agent");
      }
    });
  });

  describe("findSimilar()", () => {
    it("finds skills with similar names", async () => {
      await writer.writeSkill(
        makeDraft({
          name: "feishu-wiki-archive",
          description: "Archive wiki pages from feishu",
        }),
      );

      const similar = await lifecycle.findSimilar(
        "feishu-wiki-archiver",
        "Archive wiki pages from feishu automatically",
      );
      expect(similar).toContain("feishu-wiki-archive");
    });

    it("finds skills with overlapping description keywords", async () => {
      await writer.writeSkill(
        makeDraft({
          name: "doc-manager",
          description: "Archive feishu wiki documents automatically",
        }),
      );

      const similar = await lifecycle.findSimilar(
        "doc-archiver",
        "Archive feishu wiki documents with scheduling",
      );
      expect(similar).toContain("doc-manager");
    });

    it("returns empty for completely dissimilar skills", async () => {
      await writer.writeSkill(
        makeDraft({
          name: "weather-forecast",
          description: "Get weather forecasts for any city",
        }),
      );

      const similar = await lifecycle.findSimilar(
        "code-review",
        "Automated code review using static analysis",
      );
      expect(similar).toEqual([]);
    });
  });

  describe("checkDuplicate()", () => {
    it("returns duplicate:false for unique skill", async () => {
      await writer.writeSkill(
        makeDraft({
          name: "weather-forecast",
          description: "Get weather forecasts for any city",
        }),
      );

      const result = await lifecycle.checkDuplicate(
        "code-review",
        "Automated code review using static analysis",
      );
      expect(result.duplicate).toBe(false);
    });

    it("returns duplicate:true for similar skill", async () => {
      await writer.writeSkill(
        makeDraft({
          name: "feishu-wiki-archive",
          description: "Archive feishu wiki documents automatically",
        }),
      );

      const result = await lifecycle.checkDuplicate(
        "feishu-wiki-archiver",
        "Archive feishu wiki documents with scheduling",
      );
      expect(result.duplicate).toBe(true);
      if (result.duplicate) {
        expect(result.existingName).toBe("feishu-wiki-archive");
        expect(result.similarity).toBeGreaterThan(0.5);
      }
    });
  });

  describe("removeStale()", () => {
    it("archives old unused agent skills and returns count", async () => {
      await writer.writeSkill(
        makeDraft({ name: "old-unused-skill", description: "Old skill" }),
      );
      await writer.writeSkill(
        makeDraft({ name: "recent-unused-skill", description: "Recent skill" }),
      );

      const skillsDir = join(tempDir, "skills", "agent", "old-unused-skill", "SKILL.md");
      let content = await readFile(skillsDir, "utf-8");
      content = content.replace(
        /^lastUsedAt:\s*\d+/m,
        `lastUsedAt: ${Date.now() - 60 * 86400000}`,
      );
      await writeFile(skillsDir, content, "utf-8");

      const archived = await lifecycle.removeStale(30);
      expect(archived).toBe(1);
      expect(await writer.skillExists("old-unused-skill")).toBe(false);
      const archivePath = join(tempDir, "skills", "agent", "_archive", "old-unused-skill");
      expect(existsSync(archivePath)).toBe(true);
      expect(await writer.skillExists("recent-unused-skill")).toBe(true);
    });

    it("keeps recently-used skills", async () => {
      await writer.writeSkill(
        makeDraft({ name: "used-skill", description: "Used skill" }),
      );
      await writer.touchSkill("used-skill");

      const archived = await lifecycle.removeStale(30);
      expect(archived).toBe(0);
      expect(await writer.skillExists("used-skill")).toBe(true);
    });

    it("does not archive non-agent skills", async () => {
      const userWriter = new SkillPersistenceWriter(tempDir, { agentSkills: false });
      await userWriter.writeSkill(
        makeDraft({ name: "user-skill", description: "User skill" }),
      );

      const skillPath = join(tempDir, "skills", "user-skill", "SKILL.md");
      let content = await readFile(skillPath, "utf-8");
      content = content.replace(
        /^lastUsedAt:\s*\d+/m,
        `lastUsedAt: ${Date.now() - 60 * 86400000}`,
      );
      await writeFile(skillPath, content, "utf-8");

      const archived = await lifecycle.removeStale(30);
      expect(archived).toBe(0);
      expect(await userWriter.skillExists("user-skill")).toBe(true);
    });
  });

  describe("Levenshtein (via findSimilar)", () => {
    it("exact match is maximally similar", async () => {
      await writer.writeSkill(
        makeDraft({
          name: "exact-match",
          description: "Identical description text here",
        }),
      );

      const similar = await lifecycle.findSimilar(
        "exact-match",
        "Identical description text here",
      );
      expect(similar).toContain("exact-match");
    });

    it("completely different names and descriptions return empty", async () => {
      await writer.writeSkill(
        makeDraft({
          name: "aaa",
          description: "xxx yyy zzz",
        }),
      );

      const similar = await lifecycle.findSimilar("zzz", "aaa bbb ccc");
      expect(similar).toEqual([]);
    });
  });

  describe("checkSemanticDuplicate()", () => {
    it("returns duplicate when LLM says yes with high confidence", async () => {
      await writer.writeSkill(
        makeDraft({ name: "feishu-wiki-archive", description: "归档飞书知识库文档" }),
      );

      const generateText = vi.fn().mockResolvedValue(
        JSON.stringify({ duplicate: true, skillName: "feishu-wiki-archive", confidence: 0.9 }),
      );

      const result = await lifecycle.checkSemanticDuplicate(
        "归档会议纪要到知识库",
        "整理并归档飞书知识库中的会议文档",
        [{ name: "feishu-wiki-archive", description: "归档飞书知识库文档" }],
        { generateText },
      );

      expect(result.duplicate).toBe(true);
      if (result.duplicate) {
        expect(result.existingName).toBe("feishu-wiki-archive");
      }
    });

    it("returns no-duplicate when LLM says no", async () => {
      const generateText = vi.fn().mockResolvedValue(
        JSON.stringify({ duplicate: false, confidence: 0.8 }),
      );

      const result = await lifecycle.checkSemanticDuplicate(
        "查询天气",
        "获取城市天气预报",
        [{ name: "feishu-wiki-archive", description: "归档飞书知识库文档" }],
        { generateText },
      );

      expect(result.duplicate).toBe(false);
    });

    it("falls back to lexical when no generateText provided", async () => {
      await writer.writeSkill(
        makeDraft({ name: "weather-forecast", description: "Get weather forecasts for any city" }),
      );

      const result = await lifecycle.checkSemanticDuplicate(
        "weather-forecast",
        "Get weather forecasts for any city",
        [{ name: "weather-forecast", description: "Get weather forecasts for any city" }],
      );

      expect(result.duplicate).toBe(true);
    });

    it("falls back when LLM returns unparseable response", async () => {
      await writer.writeSkill(
        makeDraft({ name: "exact-match", description: "Identical description text here" }),
      );

      const generateText = vi.fn().mockResolvedValue("not valid json {{{");

      const result = await lifecycle.checkSemanticDuplicate(
        "exact-match",
        "Identical description text here",
        [{ name: "exact-match", description: "Identical description text here" }],
        { generateText },
      );

      expect(result.duplicate).toBe(true);
    });

    it("returns no duplicate when no existing skills", async () => {
      const result = await lifecycle.checkSemanticDuplicate(
        "some task",
        "some description",
        [],
        { generateText: vi.fn() },
      );

      expect(result.duplicate).toBe(false);
    });
  });
});
