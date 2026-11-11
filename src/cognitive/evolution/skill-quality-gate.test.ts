import { describe, expect, it, vi } from "vitest";
import type { SkillDraft } from "./types.js";

const goodDraft: SkillDraft = {
  name: "feishu-meeting-archive",
  description: "Archive meeting notes to feishu wiki with task extraction",
  triggerPhrases: ["帮我把会议纪要归档", "archive meeting notes"],
  bodyMarkdown:
    "## Workflow\n1. Use `feishu_vc_notes` to get meeting notes\n2. Use `feishu_wiki_create` to create wiki doc\n3. Extract action items and use `feishu_task_create`",
};

function asGenerate(fn: ReturnType<typeof vi.fn>) {
  return fn as unknown as (prompt: string) => Promise<string>;
}

describe("evaluateSkillQuality", () => {
  it("passes high-quality draft", async () => {
    const { evaluateSkillQuality } = await import("./skill-quality-gate.js");
    const mockLLM = vi.fn().mockResolvedValue(
      JSON.stringify({
        actionable: 0.9,
        validTools: 0.95,
        meaningfulTriggers: 0.85,
        solvesProblem: 0.9,
        critique: "Well-structured skill with clear workflow",
        issues: [],
      }),
    );
    const result = await evaluateSkillQuality(goodDraft, { generateText: asGenerate(mockLLM) });
    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThan(0.7);
  });

  it("fails draft with vague steps", async () => {
    const { evaluateSkillQuality } = await import("./skill-quality-gate.js");
    const mockLLM = vi.fn().mockResolvedValue(
      JSON.stringify({
        actionable: 0.2,
        validTools: 0.8,
        meaningfulTriggers: 0.7,
        solvesProblem: 0.6,
        critique: "Workflow steps are too vague",
        issues: ["Steps lack concrete tool references"],
      }),
    );
    const result = await evaluateSkillQuality(goodDraft, { generateText: asGenerate(mockLLM) });
    expect(result.passed).toBe(false);
    expect(result.issues).toContain("Steps lack concrete tool references");
  });

  it("clamps scores outside [0,1] before averaging", async () => {
    const { evaluateSkillQuality } = await import("./skill-quality-gate.js");
    const mockLLM = vi.fn().mockResolvedValue(
      JSON.stringify({
        actionable: 5,
        validTools: 5,
        meaningfulTriggers: 5,
        solvesProblem: 5,
        critique: "great",
        issues: [],
      }),
    );
    const result = await evaluateSkillQuality(goodDraft, { generateText: asGenerate(mockLLM) });
    expect(result.score).toBe(1);
    expect(result.passed).toBe(true);
  });

  it("passes available tool names into the prompt", async () => {
    const { evaluateSkillQuality } = await import("./skill-quality-gate.js");
    const mockLLM = vi.fn().mockResolvedValue(
      JSON.stringify({
        actionable: 0.9,
        validTools: 0.9,
        meaningfulTriggers: 0.9,
        solvesProblem: 0.9,
        critique: "ok",
        issues: [],
      }),
    );
    await evaluateSkillQuality(goodDraft, {
      generateText: asGenerate(mockLLM),
      validToolNames: ["feishu_vc_notes", "feishu_wiki_create"],
    });
    const prompt = String(mockLLM.mock.calls[0]?.[0] ?? "");
    expect(prompt).toContain("Known valid tools");
    expect(prompt).toContain("feishu_vc_notes");
  });

  it("handles malformed LLM response safely", async () => {
    const { evaluateSkillQuality } = await import("./skill-quality-gate.js");
    const mockLLM = vi.fn().mockResolvedValue("not json at all");
    const result = await evaluateSkillQuality(goodDraft, { generateText: asGenerate(mockLLM) });
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.failure?.mode).toBe("evaluator_invalid_json");
    expect(result.issues).toContain("evaluator_invalid_json");
    expect(mockLLM).toHaveBeenCalledTimes(2);
  });

  it("handles LLM throwing an error safely", async () => {
    const { evaluateSkillQuality } = await import("./skill-quality-gate.js");
    const mockLLM = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await evaluateSkillQuality(goodDraft, { generateText: asGenerate(mockLLM) });
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.failure?.mode).toBe("evaluator_call_failed");
    expect(result.failure?.detail).toContain("network down");
    expect(result.issues).toContain("evaluator_call_failed");
    expect(mockLLM).toHaveBeenCalledTimes(2);
  });

  it("accepts fence-wrapped JSON on the first attempt", async () => {
    const { evaluateSkillQuality } = await import("./skill-quality-gate.js");
    const mockLLM = vi.fn().mockResolvedValue(
      "```json\n" +
        JSON.stringify({
          actionable: 0.9,
          validTools: 0.9,
          meaningfulTriggers: 0.9,
          solvesProblem: 0.9,
          critique: "fine",
          issues: [],
        }) +
        "\n```",
    );
    const result = await evaluateSkillQuality(goodDraft, { generateText: asGenerate(mockLLM) });
    expect(result.passed).toBe(true);
    expect(result.failure).toBeUndefined();
    expect(mockLLM).toHaveBeenCalledTimes(1);
  });

  it("retries once with a stricter JSON instruction, then succeeds", async () => {
    const { evaluateSkillQuality } = await import("./skill-quality-gate.js");
    const valid = JSON.stringify({
      actionable: 0.85,
      validTools: 0.85,
      meaningfulTriggers: 0.85,
      solvesProblem: 0.85,
      critique: "ok",
      issues: [],
    });
    const mockLLM = vi
      .fn()
      .mockResolvedValueOnce("Sure! My evaluation follows below.\n{invalid")
      .mockResolvedValueOnce(valid);
    const result = await evaluateSkillQuality(goodDraft, { generateText: asGenerate(mockLLM) });
    expect(result.passed).toBe(true);
    expect(result.failure).toBeUndefined();
    expect(mockLLM).toHaveBeenCalledTimes(2);
    const retryPrompt = String(mockLLM.mock.calls[1]?.[0] ?? "");
    expect(retryPrompt).toContain("Respond with ONLY the JSON object");
  });

  it("truncates oversized draft bodies before sending to the judge", async () => {
    const { evaluateSkillQuality } = await import("./skill-quality-gate.js");
    const longDraft = { ...goodDraft, bodyMarkdown: "step\n".repeat(4000) };
    const mockLLM = vi.fn().mockResolvedValue(
      JSON.stringify({
        actionable: 0.9,
        validTools: 0.9,
        meaningfulTriggers: 0.9,
        solvesProblem: 0.9,
        critique: "ok",
        issues: [],
      }),
    );
    await evaluateSkillQuality(longDraft, { generateText: asGenerate(mockLLM) });
    const prompt = String(mockLLM.mock.calls[0]?.[0] ?? "");
    expect(prompt).toContain("body truncated");
    expect(prompt.length).toBeLessThan(longDraft.bodyMarkdown.length);
  });

  it("does not set failure for a genuine low score", async () => {
    const { evaluateSkillQuality } = await import("./skill-quality-gate.js");
    const mockLLM = vi.fn().mockResolvedValue(
      JSON.stringify({
        actionable: 0.1,
        validTools: 0.2,
        meaningfulTriggers: 0.1,
        solvesProblem: 0.2,
        critique: "too vague",
        issues: ["no concrete tools"],
      }),
    );
    const result = await evaluateSkillQuality(goodDraft, { generateText: asGenerate(mockLLM) });
    expect(result.passed).toBe(false);
    expect(result.failure).toBeUndefined();
    expect(result.critique).toBe("too vague");
  });

  it("logs evaluator failures to the provided sink", async () => {
    const { evaluateSkillQuality } = await import("./skill-quality-gate.js");
    const mockLLM = vi.fn().mockRejectedValue(new Error("boom"));
    const logged: string[] = [];
    await evaluateSkillQuality(goodDraft, {
      generateText: asGenerate(mockLLM),
      log: (message) => logged.push(message),
    });
    expect(logged.length).toBe(2);
    expect(logged[0]).toContain("evaluator call failed");
    expect(logged[0]).toContain("attempt 1/2");
  });
});

describe("refineSkillDraft", () => {
  it("produces improved draft from critique", async () => {
    const { refineSkillDraft } = await import("./skill-quality-gate.js");
    const mockLLM = vi
      .fn()
      .mockResolvedValue(
        "---\nname: improved-skill\ndescription: Better version\n---\n## Triggers\n- do the thing\n\n## Workflow\n1. Use `specific_tool` for action",
      );
    const result = await refineSkillDraft(goodDraft, "Too vague", ["Add tool refs"], {
      generateText: asGenerate(mockLLM),
    });
    expect(result.name).toBe("improved-skill");
    expect(result.bodyMarkdown).toContain("specific_tool");
  });

  it("falls back to original draft when refine output is unparseable", async () => {
    const { refineSkillDraft } = await import("./skill-quality-gate.js");
    const mockLLM = vi.fn().mockResolvedValue("totally not a skill markdown at all");
    const result = await refineSkillDraft(goodDraft, "Too vague", ["Add tool refs"], {
      generateText: asGenerate(mockLLM),
    });
    expect(result.name).toBe(goodDraft.name);
    expect(result.bodyMarkdown).toBe(goodDraft.bodyMarkdown);
  });
});
