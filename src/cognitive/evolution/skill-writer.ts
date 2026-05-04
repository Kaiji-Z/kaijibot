import type { SkillDraft, SkillMeta } from "./types.js";
import { mkdir, rm, writeFile, readFile, rename, access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const SKILLS_DIR = "skills";
const AGENT_SKILLS_DIR = "skills/agent";
const ARCHIVE_DIR = "_archive";
const SKILL_FILE = "SKILL.md";
const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

export class SkillPersistenceWriter {
  constructor(
    private readonly skillBaseDir: string,
    private readonly options: { agentSkills?: boolean } = {},
  ) {}

  private skillDir(name: string): string {
    const subdir = this.options.agentSkills !== false ? AGENT_SKILLS_DIR : SKILLS_DIR;
    return join(this.skillBaseDir, subdir, name);
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

    await this.writeBundledFiles(dir, draft);

    return targetPath;
  }

  private async writeBundledFiles(dir: string, draft: SkillDraft): Promise<void> {
    const bundles: Array<{ subdir: string; files?: Record<string, string> }> = [
      { subdir: "scripts", files: draft.scripts },
      { subdir: "references", files: draft.references },
      { subdir: "assets", files: draft.assets },
    ];
    for (const { subdir, files } of bundles) {
      if (!files || Object.keys(files).length === 0) continue;
      const subDir = join(dir, subdir);
      await mkdir(subDir, { recursive: true });
      for (const [filename, content] of Object.entries(files)) {
        if (filename.includes("..") || filename.startsWith("/")) continue;
        const filePath = join(subDir, filename);
        const tmpPath = join(tmpdir(), `kaijibot-skill-${randomUUID()}-${filename}`);
        await writeFile(tmpPath, content, "utf-8");
        await rename(tmpPath, filePath);
      }
    }
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

  async archiveSkill(name: string): Promise<string> {
    if (name.includes("..") || name.startsWith("/")) {
      throw new Error(`Invalid skill name: ${name}`);
    }
    const subdir = this.options.agentSkills !== false ? AGENT_SKILLS_DIR : SKILLS_DIR;
    const sourceDir = join(this.skillBaseDir, subdir, name);
    const archiveDir = join(this.skillBaseDir, subdir, ARCHIVE_DIR);
    await mkdir(archiveDir, { recursive: true });
    const destDir = join(archiveDir, name);
    await rename(sourceDir, destDir);
    return destDir;
  }

  async listArchivedSkillNames(): Promise<string[]> {
    const subdir = this.options.agentSkills !== false ? AGENT_SKILLS_DIR : SKILLS_DIR;
    const archiveDir = join(this.skillBaseDir, subdir, ARCHIVE_DIR);
    let entries: string[];
    try {
      entries = await readdir(archiveDir);
    } catch {
      return [];
    }
    const names: string[] = [];
    for (const entry of entries) {
      const skillPath = join(archiveDir, entry, SKILL_FILE);
      try {
        await access(skillPath);
        names.push(entry);
      } catch {}
    }
    return names;
  }

  async readArchivedSkillMeta(name: string): Promise<SkillMeta | null> {
    if (name.includes("..") || name.startsWith("/")) return null;
    const subdir = this.options.agentSkills !== false ? AGENT_SKILLS_DIR : SKILLS_DIR;
    const filePath = join(this.skillBaseDir, subdir, ARCHIVE_DIR, name, SKILL_FILE);
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      return null;
    }

    if (!content.startsWith("---")) return null;
    const secondDash = content.indexOf("---", 3);
    if (secondDash === -1) return null;
    const frontmatter = content.slice(3, secondDash).trim();

    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    const descMatch = frontmatter.match(/^description:\s*"(.*)"/m);
    if (!nameMatch || !descMatch) return null;

    const createdAt = Number(frontmatter.match(/^createdAt:\s*(\d+)/m)?.[1] ?? 0);
    const lastUsedAt = Number(frontmatter.match(/^lastUsedAt:\s*(\d+)/m)?.[1] ?? 0);
    const usageCount = Number(frontmatter.match(/^usageCount:\s*(\d+)/m)?.[1] ?? 0);
    const provenanceMatch = frontmatter.match(/^provenance:\s*(agent|user)/m);

    return {
      name: nameMatch[1].trim(),
      description: descMatch[1].replace(/\\"/g, '"'),
      createdAt,
      lastUsedAt,
      usageCount,
      isStale: lastUsedAt > 0 && Date.now() - lastUsedAt > STALE_THRESHOLD_MS,
      provenance: provenanceMatch ? (provenanceMatch[1] as "agent" | "user") : undefined,
    };
  }

  async recoverSkill(name: string): Promise<string> {
    if (name.includes("..") || name.startsWith("/")) {
      throw new Error(`Invalid skill name: ${name}`);
    }
    const subdir = this.options.agentSkills !== false ? AGENT_SKILLS_DIR : SKILLS_DIR;
    const archivePath = join(this.skillBaseDir, subdir, ARCHIVE_DIR, name);
    const activePath = join(this.skillBaseDir, subdir, name);

    // Verify archived skill exists
    try {
      await access(join(archivePath, SKILL_FILE));
    } catch {
      throw new Error(`Archived skill not found: ${name}`);
    }

    // Check if active skill with same name already exists
    try {
      await access(join(activePath, SKILL_FILE));
      throw new Error(`Active skill already exists: ${name}`);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Active skill already exists")) throw err;
    }

    await rename(archivePath, activePath);
    return activePath;
  }

  async findSkillDir(name: string): Promise<string | null> {
    const agentDir = join(this.skillBaseDir, AGENT_SKILLS_DIR, name);
    try {
      await access(join(agentDir, SKILL_FILE));
      return agentDir;
    } catch {}
    const userDir = join(this.skillBaseDir, SKILLS_DIR, name);
    try {
      await access(join(userDir, SKILL_FILE));
      return userDir;
    } catch {}
    return null;
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
    const dir = await this.findSkillDir(name);
    if (!dir) return null;
    const filePath = join(dir, SKILL_FILE);
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

    const dir = await this.findSkillDir(name);
    if (!dir) {
      throw new Error(`Skill not found: ${name}`);
    }
    const targetPath = join(dir, SKILL_FILE);

    // Atomic write: tmpfile → rename
    const tmpPath = join(tmpdir(), `kaijibot-skill-${randomUUID()}.md`);
    await writeFile(tmpPath, content, "utf-8");
    await rename(tmpPath, targetPath);

    return targetPath;
  }

  async listSkillNames(): Promise<string[]> {
    const subdir = this.options.agentSkills !== false ? AGENT_SKILLS_DIR : SKILLS_DIR;
    const skillsDir = join(this.skillBaseDir, subdir);
    let entries: string[];
    try {
      entries = await readdir(skillsDir);
    } catch {
      return [];
    }
    const names: string[] = [];
    for (const entry of entries) {
      if (entry === ARCHIVE_DIR) continue;
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
    const dir = await this.findSkillDir(name);
    if (!dir) return null;
    const filePath = join(dir, SKILL_FILE);
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
    const provenanceMatch = frontmatter.match(/^provenance:\s*(agent|user)/m);

    return {
      name: nameMatch[1].trim(),
      description: descMatch[1].replace(/\\"/g, '"'),
      createdAt,
      lastUsedAt,
      usageCount,
      isStale: lastUsedAt > 0 && Date.now() - lastUsedAt > STALE_THRESHOLD_MS,
      provenance: provenanceMatch ? (provenanceMatch[1] as "agent" | "user") : undefined,
    };
  }

  async touchSkill(name: string): Promise<void> {
    const dir = await this.findSkillDir(name);
    if (!dir) return;
    const filePath = join(dir, SKILL_FILE);
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
      ...(this.options.agentSkills !== false ? ["provenance: agent"] : []),
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
