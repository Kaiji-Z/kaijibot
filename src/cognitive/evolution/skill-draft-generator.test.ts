import { describe, expect, it } from "vitest";
import {
  generateSkillDraft,
  sanitizeSkillName,
  toKebabCase,
} from "./skill-draft-generator.js";
import type { EvolutionCandidate } from "./types.js";

function makeCandidate(overrides: Partial<EvolutionCandidate> = {}): EvolutionCandidate {
  return {
    taskSummary: "Archive wiki pages older than 90 days",
    toolCalls: ["wiki-list", "wiki-get", "wiki-archive"],
    uniqueToolCount: 3,
    reasoningTurns: 5,
    durationMs: 12000,
    domain: "feishu-wiki",
    ...overrides,
  };
}

describe("toKebabCase", () => {
  it("lowercases and hyphenates non-alnum runs", () => {
    expect(toKebabCase("Hello World")).toBe("hello-world");
  });

  it("handles Chinese characters (replaced with hyphens)", () => {
    expect(toKebabCase("知识库管理")).toBe("-");
  });

  it("handles mixed Chinese/English input", () => {
    expect(toKebabCase("wiki 整理")).toBe("wiki-");
  });

  it("collapses multiple hyphens", () => {
    expect(toKebabCase("a---b")).toBe("a-b");
  });
});

describe("sanitizeSkillName", () => {
  it("strips leading and trailing hyphens", () => {
    expect(sanitizeSkillName("知识库管理")).toBe("");
  });

  it("keeps clean names unchanged", () => {
    expect(sanitizeSkillName("feishu-wiki")).toBe("feishu-wiki");
  });

  it("normalizes mixed input", () => {
    expect(sanitizeSkillName("  Code Review (Auto) ")).toBe("code-review-auto");
  });
});

describe("generateSkillDraft", () => {
  it("generates a valid draft from a candidate with tools", () => {
    const candidate = makeCandidate();
    const draft = generateSkillDraft(candidate);

    expect(draft.name).toBe("feishu-wiki-wiki-list");
    expect(draft.description).toContain("Archive wiki pages older than 90 days");
    expect(draft.triggerPhrases.length).toBeGreaterThanOrEqual(3);
    expect(draft.bodyMarkdown).toContain("## When to use");
    expect(draft.bodyMarkdown).toContain("## Workflow");
    expect(draft.bodyMarkdown).toContain("## Notes");
  });

  it("uses workflow suffix when no tools", () => {
    const candidate = makeCandidate({ toolCalls: [] });
    const draft = generateSkillDraft(candidate);

    expect(draft.name).toBe("feishu-wiki-workflow");
  });

  it("truncates description to 200 characters", () => {
    const longSummary = "A".repeat(250);
    const candidate = makeCandidate({ taskSummary: longSummary });
    const draft = generateSkillDraft(candidate);

    expect(draft.description.length).toBeLessThanOrEqual(200);
  });

  it("includes Chinese and English trigger phrases", () => {
    const candidate = makeCandidate();
    const draft = generateSkillDraft(candidate);

    const hasChinese = draft.triggerPhrases.some((p) => /[\u4e00-\u9fff]/.test(p));
    const hasEnglish = draft.triggerPhrases.some((p) => /^[a-z]/.test(p));
    expect(hasChinese).toBe(true);
    expect(hasEnglish).toBe(true);
  });

  it("produces all required markdown sections", () => {
    const candidate = makeCandidate();
    const md = generateSkillDraft(candidate).bodyMarkdown;

    expect(md).toContain("## When to use");
    expect(md).toContain("## Workflow");
    expect(md).toContain("## Notes");
    expect(md).toContain("auto-generated");
  });

  it("deduplicates workflow steps", () => {
    const candidate = makeCandidate({
      toolCalls: ["wiki-list", "wiki-get", "wiki-list", "wiki-archive", "wiki-get"],
    });
    const md = generateSkillDraft(candidate).bodyMarkdown;

    const listMatches = md.match(/`wiki-list`/g);
    const getMatches = md.match(/`wiki-get`/g);

    expect(listMatches).toHaveLength(1);
    expect(getMatches).toHaveLength(1);
  });
});
