import type { SkillMeta, DedupCheckResult } from "./types.js";
import type { SkillPersistenceWriter } from "./skill-writer.js";

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array<number>(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[m][n];
}

function jaccard(a: string, b: string): number {
  const setA = new Set(
    a
      .toLowerCase()
      .split(/[\s,，。.、]+/)
      .filter(Boolean),
  );
  const setB = new Set(
    b
      .toLowerCase()
      .split(/[\s,，。.、]+/)
      .filter(Boolean),
  );
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export class SkillLifecycleManager {
  constructor(private readonly writer: SkillPersistenceWriter) {}

  async listSkills(): Promise<SkillMeta[]> {
    const names = await this.writer.listSkillNames();
    const metas: SkillMeta[] = [];
    for (const name of names) {
      const meta = await this.writer.readSkillMeta(name);
      if (meta) metas.push(meta);
    }
    return metas;
  }

  async findSimilar(name: string, description: string): Promise<string[]> {
    const allMeta = await this.listSkills();
    const results: string[] = [];

    for (const existing of allMeta) {
      const maxLen = Math.max(name.length, existing.name.length);
      const nameSim =
        maxLen === 0 ? 1 : 1 - levenshtein(name, existing.name) / maxLen;
      const descSim = jaccard(description, existing.description);
      const combined = 0.4 * nameSim + 0.6 * descSim;
      if (combined > 0.5) {
        results.push(existing.name);
      }
    }

    return results;
  }

  async checkDuplicate(
    name: string,
    description: string,
  ): Promise<DedupCheckResult> {
    const similar = await this.findSimilar(name, description);
    if (similar.length > 0) {
      const allMeta = await this.listSkills();
      const match = allMeta.find((m) => m.name === similar[0]);
      const maxLen = Math.max(name.length, similar[0].length);
      const nameSim =
        maxLen === 0 ? 1 : 1 - levenshtein(name, similar[0]) / maxLen;
      const descSim = match
        ? jaccard(description, match.description)
        : 0;
      const similarity = 0.4 * nameSim + 0.6 * descSim;
      return {
        duplicate: true,
        existingName: similar[0],
        similarity,
      };
    }
    return { duplicate: false };
  }

  async checkSemanticDuplicate(
    taskSummary: string,
    candidateDescription: string,
    existingSkills: Array<{ name: string; description: string }>,
    deps?: { generateText: (prompt: string) => Promise<string> },
  ): Promise<DedupCheckResult> {
    // No LLM available — fall back to lexical dedup
    if (!deps?.generateText) {
      return this.checkDuplicate(taskSummary, candidateDescription);
    }

    if (existingSkills.length === 0) {
      return { duplicate: false };
    }

    const skillsList = existingSkills
      .map((s, i) => `${i + 1}. ${s.name}: ${s.description}`)
      .join("\n");

    const prompt = `You are a skill deduplication assistant. Determine if the following task pattern is semantically equivalent to any existing skill.

Task pattern: ${taskSummary}
Candidate skill description: ${candidateDescription}

Existing skills:
${skillsList}

Respond with ONLY a JSON object (no markdown fences):
- If semantically equivalent to an existing skill: {"duplicate": true, "skillName": "<exact name>", "confidence": 0.0-1.0}
- If not equivalent: {"duplicate": false, "confidence": 0.0-1.0}

Consider two skills duplicates if they solve the same class of problems, even if wording differs. Different tools or different domains = not duplicates.`;

    try {
      const response = await deps.generateText(prompt);
      const cleaned = response.trim().replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
      const parsed = JSON.parse(cleaned);

      if (parsed.duplicate === true && typeof parsed.skillName === "string" && (parsed.confidence ?? 0) > 0.7) {
        // Verify the skillName actually exists in the list
        const match = existingSkills.find((s) => s.name === parsed.skillName);
        if (match) {
          // Compute similarity score for the result
          const maxLen = Math.max(taskSummary.length, match.name.length);
          const nameSim = maxLen === 0 ? 1 : 1 - levenshtein(taskSummary, match.name) / maxLen;
          const descSim = jaccard(candidateDescription, match.description);
          const similarity = 0.4 * nameSim + 0.6 * descSim;
          return { duplicate: true, existingName: match.name, similarity };
        }
      }

      return { duplicate: false };
    } catch {
      // LLM parsing failed — fall back to lexical
      return this.checkDuplicate(taskSummary, candidateDescription);
    }
  }

  async markStale(name: string): Promise<void> {
    const raw = await this.writer.readRawSkill(name);
    if (!raw) return;

    let content = raw;
    if (/^lastUsedAt:\s*\d+/m.test(content)) {
      content = content.replace(/^lastUsedAt:\s*\d+/m, "lastUsedAt: 0");
    }
    await this.writer.updateSkill(name, content);
  }

  async removeStale(olderThanDays: number): Promise<number> {
    const allMeta = await this.listSkills();
    const threshold = Date.now() - olderThanDays * 86400000;
    let archived = 0;

    for (const meta of allMeta) {
      if (meta.provenance !== "agent") continue;
      if (meta.lastUsedAt < threshold && meta.usageCount === 0) {
        await this.writer.archiveSkill(meta.name);
        archived++;
      }
    }

    return archived;
  }
}
