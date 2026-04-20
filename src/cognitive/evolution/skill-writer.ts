import type { SkillDraft } from "./types.js";
import { mkdir, rm, writeFile, rename, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const SKILLS_DIR = "skills";
const SKILL_FILE = "SKILL.md";

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

  private formatSkillMarkdown(draft: SkillDraft): string {
    const frontmatter = [
      "---",
      `name: ${draft.name}`,
      `description: "${draft.description.replace(/"/g, '\\"')}"`,
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
