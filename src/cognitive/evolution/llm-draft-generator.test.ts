import { describe, expect, it } from "vitest";
import { generateSkillDraftLLM, buildPrompt, validateAndRepair } from "./llm-draft-generator.js";
import type { LlmDraftDeps } from "./llm-draft-generator.js";
import type { EvolutionCandidate } from "./types.js";
import { generateSkillDraft } from "./skill-draft-generator.js";

function makeCandidate(overrides: Partial<EvolutionCandidate> = {}): EvolutionCandidate {
  return {
    taskSummary: "Archive old wiki pages to cold storage",
    toolCalls: ["wiki.listNodes", "wiki.moveNode", "drive.updatePermissions"],
    uniqueToolCount: 3,
    reasoningTurns: 5,
    durationMs: 45_000,
    domain: "feishu-wiki",
    ...overrides,
  };
}

function mockDeps(response: string): LlmDraftDeps {
  return { generateText: async () => response };
}

const VALID_SKILL_MD = `---
name: feishu-wiki-archive
description: "Archive inactive wiki pages to a designated archive space. Use when user asks to clean up wiki, archive old docs, or move stale content."
---
## Triggers
- 归档知识库
- archive wiki
- 清理旧文档
- move stale docs

## When to use
Use when the user wants to archive or clean up wiki content.

## Workflow
1. Identify target space
2. Find stale nodes
3. Move to archive`;

describe("buildPrompt", () => {
  it("includes skill-creator spec key phrases", () => {
    const prompt = buildPrompt(makeCandidate());
    expect(prompt).toContain("progressive disclosure");
    expect(prompt).toContain("YAML frontmatter");
    expect(prompt).toContain("degrees of freedom");
    expect(prompt).toContain("imperative");
  });

  it("includes task context", () => {
    const candidate = makeCandidate();
    const prompt = buildPrompt(candidate);
    expect(prompt).toContain(candidate.taskSummary);
    expect(prompt).toContain(candidate.domain);
    expect(prompt).toContain("wiki.listNodes");
    expect(prompt).toContain("wiki.moveNode");
    expect(prompt).toContain(String(candidate.reasoningTurns));
    expect(prompt).toContain(String(candidate.durationMs));
  });

  it("includes transcript when available", () => {
    const candidate = makeCandidate({ transcript: "User asked to archive pages. Bot listed nodes and moved them." });
    const prompt = buildPrompt(candidate);
    expect(prompt).toContain("User asked to archive pages");
    expect(prompt).toContain("### Transcript");
  });

  it("omits transcript section when not available", () => {
    const prompt = buildPrompt(makeCandidate());
    expect(prompt).not.toContain("### Transcript");
  });

  it("includes output instructions with SKILL.md format requirements", () => {
    const prompt = buildPrompt(makeCandidate());
    expect(prompt).toContain("## Output Instructions");
    expect(prompt).toContain("## Triggers");
    expect(prompt).toContain("kebab-case");
    expect(prompt).toContain("200 lines");
  });
});

describe("validateAndRepair", () => {
  it("parses well-formed SKILL.md", () => {
    const result = validateAndRepair(VALID_SKILL_MD, makeCandidate());
    expect(result.name).toBe("feishu-wiki-archive");
    expect(result.description).toContain("Archive inactive");
    expect(result.description).toContain("clean up wiki");
    expect(result.triggerPhrases).toEqual(["归档知识库", "archive wiki", "清理旧文档", "move stale docs"]);
    expect(result.bodyMarkdown).toContain("## When to use");
    expect(result.bodyMarkdown).toContain("## Workflow");
  });

  it("handles markdown fences wrapping SKILL.md", () => {
    const fenced = "```markdown\n" + VALID_SKILL_MD + "\n```";
    const result = validateAndRepair(fenced, makeCandidate());
    expect(result.name).toBe("feishu-wiki-archive");
    expect(result.triggerPhrases).toHaveLength(4);
    expect(result.bodyMarkdown).toContain("## Workflow");
  });

  it("handles plain code fences wrapping SKILL.md", () => {
    const fenced = "```\n" + VALID_SKILL_MD + "\n```";
    const result = validateAndRepair(fenced, makeCandidate());
    expect(result.name).toBe("feishu-wiki-archive");
    expect(result.triggerPhrases).toHaveLength(4);
  });

  it("falls back on missing frontmatter", () => {
    const candidate = makeCandidate();
    const noFm = "## Triggers\n- something\n\n## Workflow\n1. Do it";
    const result = validateAndRepair(noFm, candidate);
    expect(result).toEqual(generateSkillDraft(candidate));
  });

  it("falls back on empty body after frontmatter", () => {
    const candidate = makeCandidate();
    const emptyBody = "---\nname: test\n\ndescription: \"A test\"\n---\n";
    const result = validateAndRepair(emptyBody, candidate);
    expect(result).toEqual(generateSkillDraft(candidate));
  });

  it("falls back on no trigger phrases in body", () => {
    const candidate = makeCandidate();
    const noTriggers = "---\nname: test\ndescription: \"A test\"\n---\n## Workflow\n1. Do it";
    const result = validateAndRepair(noTriggers, candidate);
    expect(result).toEqual(generateSkillDraft(candidate));
  });

  it("sanitizes name with special characters from frontmatter", () => {
    const skillMd = "---\nname: My Cool Skill!!!\ndescription: \"Does things\"\n---\n## Triggers\n- do stuff\n\n## Workflow\n1. Step one";
    const result = validateAndRepair(skillMd, makeCandidate());
    expect(result.name).toBe("my-cool-skill");
    expect(result.triggerPhrases).toEqual(["do stuff"]);
  });

  it("extracts triggers only until next heading", () => {
    const skillMd = `---
name: multi-section
description: "Multi section skill"
---
## Triggers
- trigger one
- trigger two

## When to use
- not a trigger
- also not a trigger

## Workflow
1. Do stuff`;
    const result = validateAndRepair(skillMd, makeCandidate());
    expect(result.triggerPhrases).toEqual(["trigger one", "trigger two"]);
    expect(result.bodyMarkdown).toContain("## When to use");
    expect(result.bodyMarkdown).toContain("## Workflow");
  });

  it("handles description without quotes in frontmatter", () => {
    const skillMd = "---\nname: test-skill\ndescription: A simple skill without quotes\n---\n## Triggers\n- test trigger\n\n## Workflow\n1. Step";
    const result = validateAndRepair(skillMd, makeCandidate());
    expect(result.description).toBe("A simple skill without quotes");
    expect(result.name).toBe("test-skill");
  });
});

describe("generateSkillDraftLLM", () => {
  it("returns valid SkillDraft from well-formed LLM SKILL.md response", async () => {
    const candidate = makeCandidate();
    const draft = await generateSkillDraftLLM(candidate, mockDeps(VALID_SKILL_MD));
    expect(draft.name).toBe("feishu-wiki-archive");
    expect(draft.description).toContain("Archive inactive");
    expect(draft.triggerPhrases).toHaveLength(4);
    expect(draft.bodyMarkdown).toContain("## Workflow");
  });

  it("falls back to rule-based when LLM throws error", async () => {
    const candidate = makeCandidate();
    const failingDeps: LlmDraftDeps = {
      generateText: async () => { throw new Error("LLM unavailable"); },
    };
    const draft = await generateSkillDraftLLM(candidate, failingDeps);
    expect(draft).toEqual(generateSkillDraft(candidate));
  });

  it("falls back to rule-based on unparseable LLM response", async () => {
    const candidate = makeCandidate();
    const draft = await generateSkillDraftLLM(candidate, mockDeps("not valid skill content at all {{{"));
    expect(draft).toEqual(generateSkillDraft(candidate));
  });

  it("handles markdown-fenced LLM response", async () => {
    const candidate = makeCandidate();
    const fenced = "```markdown\n" + VALID_SKILL_MD + "\n```";
    const draft = await generateSkillDraftLLM(candidate, mockDeps(fenced));
    expect(draft.name).toBe("feishu-wiki-archive");
    expect(draft.triggerPhrases).toHaveLength(4);
  });

  it("falls back when LLM returns valid markdown but no frontmatter", async () => {
    const candidate = makeCandidate();
    const noFm = "## Triggers\n- something\n\n## Workflow\n1. Do it";
    const draft = await generateSkillDraftLLM(candidate, mockDeps(noFm));
    expect(draft).toEqual(generateSkillDraft(candidate));
  });
});
