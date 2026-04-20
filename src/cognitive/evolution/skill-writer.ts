import type { SkillDraft, SkillMeta } from "./types.js";
import { mkdir, rm, writeFile, readFile, rename, access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const SKILLS_DIR = "skills";
const SKILL_FILE = "SKILL.md";
const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

export class SkillPersistenceWriter {
  constructor(private readonly configDir: string) {}

  private skillDir(name: string): string {
    return join(this.configDir, SKILLS_DIR, name);
  }

  async writeSkill(draft: SkillDraft): Promise<string> {
    if (draft.name.includes("..") || draft.name.startsWith("/") || draft.name.includes("\\")) {
      throw new Error(`Invalid skill name: ${draft.name}`);
    }

    const dir = this.skillDir(draft.name);
    await mkdir(dir, { recursive: true });

    const content = this.formatSkillMarkdown(draft);
    const targetPath = join(dir, SKILL_FILE);

    // Atomic write: tmpfile → rename (same pattern as EvolutionStore)
    const tmpPath = join(tmpdir(), `kaijibot-skill-${randomUUID()}.md`);
    await writeFile(tmpPath, content, "utf-8");
    await rename(tmpPath, targetPath);

    return targetPath;
  }

  async skillExists(name: string): Promise<boolean> {
    try {
      await access(join(this.skillDir(name), SKILL_FILE));
      return true;
    } catch {
      return false;
    }
  }

  async removeSkill(name: string): Promise<void> {
    if (name.includes("..") || name.startsWith("/")) {
      throw new Error(`Invalid skill name: ${name}`);
    }
    const dir = this.skillDir(name);
    await rm(dir, { recursive: true, force: true });
  }

  async readSkill(name: string): Promise<SkillDraft | null> {
    const raw = await this.readRawSkill(name);
    if (raw === null) return null;

    // Parse YAML frontmatter
    if (!raw.startsWith("---")) {
      return null;
    }
    const secondDash = raw.indexOf("---", 3);
    if (secondDash === -1) {
      return null;
    }
    const frontmatter = raw.slice(3, secondDash).trim();
    const bodyAndTriggers = raw.slice(secondDash + 3).trim();

    // Extract name and description from frontmatter
    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    const descMatch = frontmatter.match(/^description:\s*"(.*)"/m);
    if (!nameMatch || !descMatch) {
      return null;
    }
    const skillName = nameMatch[1].trim();
    const description = descMatch[1].replace(/\\"/g, '"');

    // Extract trigger phrases from ## Triggers section
    const triggerPhrases: string[] = [];
    const triggersMatch = bodyAndTriggers.match(/^## Triggers\s*\n([\s\S]*?)(?=\n## |\s*$)/);
    if (triggersMatch) {
      const triggerLines = triggersMatch[1];
      for (const line of triggerLines.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("- ")) {
          triggerPhrases.push(trimmed.slice(2));
        }
      }
    }

    // Body = everything after frontmatter with ## Triggers section removed
    let bodyMarkdown = bodyAndTriggers;
    if (triggersMatch?.index !== undefined) {
      bodyMarkdown = bodyAndTriggers.slice(0, triggersMatch.index) + bodyAndTriggers.slice(triggersMatch.index + triggersMatch[0].length);
      bodyMarkdown = bodyMarkdown.trim();
    }

    return {
      name: skillName,
      description,
      triggerPhrases,
      bodyMarkdown,
    };
  }

  async readRawSkill(name: string): Promise<string | null> {
    const filePath = join(this.skillDir(name), SKILL_FILE);
    try {
      return await readFile(filePath, "utf-8");
    } catch {
      return null;
    }
  }

  async updateSkill(name: string, content: string): Promise<string> {
    if (name.includes("..") || name.startsWith("/") || name.includes("\\")) {
      throw new Error(`Invalid skill name: ${name}`);
    }

    const dir = this.skillDir(name);
    const targetPath = join(dir, SKILL_FILE);

    // Verify existing
    try {
      await access(targetPath);
    } catch {
      throw new Error(`Skill not found: ${name}`);
    }

    // Atomic write: tmpfile → rename
    const tmpPath = join(tmpdir(), `kaijibot-skill-${randomUUID()}.md`);
    await writeFile(tmpPath, content, "utf-8");
    await rename(tmpPath, targetPath);

    return targetPath;
  }

  async listSkillNames(): Promise<string[]> {
    const skillsDir = join(this.configDir, SKILLS_DIR);
    let entries: string[];
    try {
      entries = await readdir(skillsDir);
    } catch {
      return [];
    }
    const names: string[] = [];
    for (const entry of entries) {
      const skillPath = join(skillsDir, entry, SKILL_FILE);
      try {
        await access(skillPath);
        names.push(entry);
      } catch {
      }
    }
    return names;
  }

  async readSkillMeta(name: string): Promise<SkillMeta | null> {
    const filePath = join(this.skillDir(name), SKILL_FILE);
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      return null;
    }

    if (!content.startsWith("---")) {
      return null;
    }
    const secondDash = content.indexOf("---", 3);
    if (secondDash === -1) {
      return null;
    }
    const frontmatter = content.slice(3, secondDash).trim();

    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    const descMatch = frontmatter.match(/^description:\s*"(.*)"/m);
    if (!nameMatch || !descMatch) {
      return null;
    }

    const createdAt = Number(frontmatter.match(/^createdAt:\s*(\d+)/m)?.[1] ?? 0);
    const lastUsedAt = Number(frontmatter.match(/^lastUsedAt:\s*(\d+)/m)?.[1] ?? 0);
    const usageCount = Number(frontmatter.match(/^usageCount:\s*(\d+)/m)?.[1] ?? 0);

    return {
      name: nameMatch[1].trim(),
      description: descMatch[1].replace(/\\"/g, '"'),
      createdAt,
      lastUsedAt,
      usageCount,
      isStale: lastUsedAt > 0 && Date.now() - lastUsedAt > STALE_THRESHOLD_MS,
    };
  }

  async touchSkill(name: string): Promise<void> {
    const filePath = join(this.skillDir(name), SKILL_FILE);
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      return;
    }

    if (!content.startsWith("---")) {
      return;
    }
    const secondDash = content.indexOf("---", 3);
    if (secondDash === -1) {
      return;
    }

    const frontmatter = content.slice(3, secondDash);
    const rest = content.slice(secondDash + 3);

    const usageCountMatch = frontmatter.match(/^usageCount:\s*(\d+)/m);
    const currentCount = usageCountMatch ? Number(usageCountMatch[1]) : 0;

    let updated = frontmatter;
    const now = Date.now();
    if (usageCountMatch) {
      updated = updated.replace(/^usageCount:\s*\d+/m, `usageCount: ${currentCount + 1}`);
    } else {
      updated = updated.trimEnd() + `\nusageCount: 1`;
    }
    if (/^lastUsedAt:\s*\d+/m.test(updated)) {
      updated = updated.replace(/^lastUsedAt:\s*\d+/m, `lastUsedAt: ${now}`);
    } else {
      updated = updated.trimEnd() + `\nlastUsedAt: ${now}`;
    }

    const newContent = `---${updated}---${rest}`;

    const tmpPath = join(tmpdir(), `kaijibot-skill-${randomUUID()}.md`);
    await writeFile(tmpPath, newContent, "utf-8");
    await rename(tmpPath, filePath);
  }

  private formatSkillMarkdown(draft: SkillDraft): string {
    const now = Date.now();
    const frontmatter = [
      "---",
      `name: ${draft.name}`,
      `description: "${draft.description.replace(/"/g, '\\"')}"`,
      `createdAt: ${now}`,
      `lastUsedAt: ${now}`,
      `usageCount: 0`,
      "metadata:",
      "  kaijibot:",
      "    generated: true",
      "    version: 1",
      "---",
      "",
    ];

    const triggers =
      draft.triggerPhrases.length > 0
        ? ["## Triggers", "", ...draft.triggerPhrases.map((p) => `- ${p}`), ""]
        : [];

    return [...frontmatter, ...triggers, draft.bodyMarkdown].join("\n");
  }
}
