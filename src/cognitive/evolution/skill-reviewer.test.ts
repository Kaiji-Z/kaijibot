import { describe, expect, it, vi } from "vitest";
import type { SkillDraft } from "./types.js";

function makeDraft(overrides: Partial<SkillDraft> = {}): SkillDraft {
  return {
    name: "test",
    description: "Good skill",
    triggerPhrases: ["t"],
    bodyMarkdown: "## Workflow\n1. Use `tool`",
    ...overrides,
  };
}

function asGenerate(fn: ReturnType<typeof vi.fn>) {
  return fn as unknown as (prompt: string) => Promise<string>;
}

describe("reviewSkill", () => {
  it("approves high-quality skill", async () => {
    const { reviewSkill } = await import("./skill-reviewer.js");
    const mockLLM = vi.fn().mockResolvedValue(
      JSON.stringify({
        approved: true,
        confidence: 0.85,
        notes: "Skill is correct and actionable",
      }),
    );
    const result = await reviewSkill(makeDraft(), "Archive meeting notes", {
      generateText: asGenerate(mockLLM),
    });
    expect(result.approved).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it("rejects skill with invalid workflow", async () => {
    const { reviewSkill } = await import("./skill-reviewer.js");
    const mockLLM = vi.fn().mockResolvedValue(
      JSON.stringify({
        approved: false,
        confidence: 0.3,
        notes: "References non-existent tool",
      }),
    );
    const result = await reviewSkill(
      makeDraft({ name: "bad", bodyMarkdown: "Use `fake_tool`" }),
      "Do something",
      { generateText: asGenerate(mockLLM) },
    );
    expect(result.approved).toBe(false);
  });

  it("clamps confidence to [0,1]", async () => {
    const { reviewSkill } = await import("./skill-reviewer.js");
    const mockLLM = vi
      .fn()
      .mockResolvedValue(JSON.stringify({ approved: true, confidence: 5, notes: "x" }));
    const result = await reviewSkill(makeDraft(), "x", { generateText: asGenerate(mockLLM) });
    expect(result.confidence).toBe(1);
  });

  it("handles malformed response safely", async () => {
    const { reviewSkill } = await import("./skill-reviewer.js");
    const mockLLM = vi.fn().mockResolvedValue("garbage");
    const result = await reviewSkill(makeDraft({ name: "x" }), "x", {
      generateText: asGenerate(mockLLM),
    });
    expect(result.approved).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.failure?.mode).toBe("reviewer_invalid_json");
    expect(mockLLM).toHaveBeenCalledTimes(2);
  });

  it("handles LLM throwing an error safely", async () => {
    const { reviewSkill } = await import("./skill-reviewer.js");
    const mockLLM = vi.fn().mockRejectedValue(new Error("boom"));
    const result = await reviewSkill(makeDraft(), "x", { generateText: asGenerate(mockLLM) });
    expect(result.approved).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.failure?.mode).toBe("reviewer_call_failed");
    expect(result.failure?.detail).toContain("boom");
  });

  it("accepts fence-wrapped JSON", async () => {
    const { reviewSkill } = await import("./skill-reviewer.js");
    const mockLLM = vi
      .fn()
      .mockResolvedValue(
        "```json\n" + JSON.stringify({ approved: true, confidence: 0.9, notes: "ok" }) + "\n```",
      );
    const result = await reviewSkill(makeDraft(), "x", { generateText: asGenerate(mockLLM) });
    expect(result.approved).toBe(true);
    expect(mockLLM).toHaveBeenCalledTimes(1);
  });

  it("retries once with a stricter JSON instruction, then succeeds", async () => {
    const { reviewSkill } = await import("./skill-reviewer.js");
    const mockLLM = vi
      .fn()
      .mockResolvedValueOnce("thinking out loud, no json")
      .mockResolvedValueOnce(JSON.stringify({ approved: true, confidence: 0.8, notes: "ok" }));
    const result = await reviewSkill(makeDraft(), "x", { generateText: asGenerate(mockLLM) });
    expect(result.approved).toBe(true);
    expect(result.failure).toBeUndefined();
    const retryPrompt = String(mockLLM.mock.calls[1]?.[0] ?? "");
    expect(retryPrompt).toContain("Respond with ONLY the JSON object");
  });

  it("truncates oversized bodies and never sets failure on genuine disapproval", async () => {
    const { reviewSkill } = await import("./skill-reviewer.js");
    const mockLLM = vi
      .fn()
      .mockResolvedValue(
        JSON.stringify({ approved: false, confidence: 0.2, notes: "will not work" }),
      );
    const result = await reviewSkill(makeDraft({ bodyMarkdown: "step\n".repeat(4000) }), "x", {
      generateText: asGenerate(mockLLM),
    });
    expect(result.approved).toBe(false);
    expect(result.failure).toBeUndefined();
    const prompt = String(mockLLM.mock.calls[0]?.[0] ?? "");
    expect(prompt).toContain("body truncated");
  });
});
