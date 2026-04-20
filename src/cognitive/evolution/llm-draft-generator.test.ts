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

describe("generateSkillDraftLLM", () => {
  it("generates valid SkillDraft from well-formed LLM JSON response", async () => {
    const candidate = makeCandidate();
    const llmResponse = JSON.stringify({
      name: "feishu-wiki-archive",
      description: "Archive inactive wiki pages to reduce clutter",
      triggerPhrases: ["归档wiki", "archive wiki", "清理旧页面", "old pages cleanup", "wiki 归档"],
      bodyMarkdown: "## When to use\n\nUse when archiving old wiki pages.\n\n## Workflow\n\n1. List nodes\n2. Move to archive\n\n## Notes\n\nReview before archiving.",
    });

    const draft = await generateSkillDraftLLM(candidate, mockDeps(llmResponse));

    expect(draft.name).toBe("feishu-wiki-archive");
    expect(draft.description).toBe("Archive inactive wiki pages to reduce clutter");
    expect(draft.triggerPhrases).toHaveLength(5);
    expect(draft.bodyMarkdown).toContain("## When to use");
    expect(draft.bodyMarkdown).toContain("## Workflow");
  });

  it("falls back to rule-based when LLM throws error", async () => {
    const candidate = makeCandidate();
    const failingDeps: LlmDraftDeps = {
      generateText: async () => { throw new Error("LLM unavailable"); },
    };

    const draft = await generateSkillDraftLLM(candidate, failingDeps);
    const expected = generateSkillDraft(candidate);

    expect(draft).toEqual(expected);
  });

  it("falls back to rule-based when LLM returns malformed JSON", async () => {
    const candidate = makeCandidate();
    const draft = await generateSkillDraftLLM(candidate, mockDeps("not valid json {{{"));
    const expected = generateSkillDraft(candidate);

    expect(draft).toEqual(expected);
  });

  it("validates and repairs partial LLM output", async () => {
    const candidate = makeCandidate();
    const partial = JSON.stringify({
      name: "My Cool Skill!",
      description: "A".repeat(250),
    });

    const draft = await generateSkillDraftLLM(candidate, mockDeps(partial));
    const expected = generateSkillDraft(candidate);

    expect(draft).toEqual(expected);
  });

  it("handles markdown fences in LLM response", async () => {
    const candidate = makeCandidate();
    const fenced = "```json\n" + JSON.stringify({
      name: "feishu-wiki-archive",
      description: "Archive wiki pages",
      triggerPhrases: ["归档", "archive"],
      bodyMarkdown: "## When to use\n\nArchiving.\n\n## Workflow\n\n1. Do it.\n\n## Notes\n\nNone.",
    }) + "\n```";

    const draft = await generateSkillDraftLLM(candidate, mockDeps(fenced));

    expect(draft.name).toBe("feishu-wiki-archive");
    expect(draft.description).toBe("Archive wiki pages");
    expect(draft.triggerPhrases).toHaveLength(2);
    expect(draft.bodyMarkdown).toContain("## When to use");
  });
});

describe("buildPrompt", () => {
  it("includes task summary, domain, tools, and reasoning turns", () => {
    const candidate = makeCandidate();
    const prompt = buildPrompt(candidate);

    expect(prompt).toContain(candidate.taskSummary);
    expect(prompt).toContain(candidate.domain);
    expect(prompt).toContain("wiki.listNodes");
    expect(prompt).toContain(String(candidate.reasoningTurns));
  });
});

describe("validateAndRepair", () => {
  it("sanitizes name with special characters and preserves valid fields", () => {
    const candidate = makeCandidate();
    const result = validateAndRepair(
      { name: "My Cool Skill!!!", description: "A skill", triggerPhrases: ["do it"], bodyMarkdown: "## When to use\n\nWhen needed." },
      candidate,
    );

    expect(result.name).toBe("my-cool-skill");
    expect(result.triggerPhrases).toEqual(["do it"]);
    expect(result.bodyMarkdown).toContain("## When to use");
  });

  it("truncates description exceeding 200 chars", () => {
    const candidate = makeCandidate();
    const longDesc = "x".repeat(250);
    const result = validateAndRepair(
      { name: "test", description: longDesc, triggerPhrases: ["a"], bodyMarkdown: "## When" },
      candidate,
    );

    expect(result.description.length).toBeLessThanOrEqual(200);
    expect(result.description.endsWith("…")).toBe(true);
  });

  it("falls back to rule-based when triggerPhrases or bodyMarkdown missing", () => {
    const candidate = makeCandidate();
    const result = validateAndRepair({ name: "partial" }, candidate);
    const expected = generateSkillDraft(candidate);

    expect(result).toEqual(expected);
  });
});
