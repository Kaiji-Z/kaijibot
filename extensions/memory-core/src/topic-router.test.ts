import { describe, it, expect, vi } from "vitest";
import { routeToTopic, kebabMatch } from "./topic-router.js";
import type { TopicCandidate } from "./topic-router.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTopics(overrides: Array<{ name: string; description: string }> = []): TopicCandidate[] {
  return overrides;
}

// ---------------------------------------------------------------------------
// kebabMatch
// ---------------------------------------------------------------------------

describe("kebabMatch", () => {
  it("matches identical strings", () => {
    expect(kebabMatch("philosophy", "philosophy")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(kebabMatch("Philosophy", "philosophy")).toBe(true);
  });

  it("normalizes spaces and underscores to dashes", () => {
    expect(kebabMatch("my topic", "my-topic")).toBe(true);
    expect(kebabMatch("my_topic", "my-topic")).toBe(true);
  });

  it("returns false for different strings", () => {
    expect(kebabMatch("philosophy", "cooking")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// routeToTopic
// ---------------------------------------------------------------------------

describe("routeToTopic", () => {
  // 1. Routes to existing topic when LLM returns match
  it("routes to existing topic when LLM returns match", async () => {
    const generateText = vi.fn().mockResolvedValue(
      JSON.stringify({ action: "existing", topicName: "philosophy" }),
    );
    const result = await routeToTopic({
      summary: "We discussed existentialism and free will.",
      existingTopics: makeTopics([
        { name: "philosophy", description: "Philosophical discussions" },
        { name: "cooking", description: "Food and recipes" },
      ]),
      generateText,
    });
    expect(result).toEqual({ topicName: "philosophy", isNew: false });
  });

  // 2. Creates new topic when LLM says new
  it("creates new topic when LLM says new", async () => {
    const generateText = vi.fn().mockResolvedValue(
      JSON.stringify({ action: "new", topicName: "cooking", description: "Food and recipes" }),
    );
    const result = await routeToTopic({
      summary: "We talked about baking bread.",
      existingTopics: makeTopics([
        { name: "philosophy", description: "Philosophical discussions" },
      ]),
      generateText,
    });
    expect(result).toEqual({
      topicName: "cooking",
      isNew: true,
      description: "Food and recipes",
    });
  });

  // 3. LLM failure falls back to keyword match
  it("falls back to keyword match when LLM throws", async () => {
    const generateText = vi.fn().mockRejectedValue(new Error("LLM unavailable"));
    const result = await routeToTopic({
      summary: "We had a deep conversation about philosophy and ethics.",
      existingTopics: makeTopics([
        { name: "philosophy", description: "Philosophical discussions" },
      ]),
      generateText,
    });
    expect(result).toEqual({ topicName: "philosophy", isNew: false });
  });

  // 4. LLM failure, no keyword match → session fallback
  it("falls back to session when LLM fails and no keyword match", async () => {
    const generateText = vi.fn().mockRejectedValue(new Error("LLM unavailable"));
    const result = await routeToTopic({
      summary: "Something completely unrelated to any topic.",
      existingTopics: makeTopics([
        { name: "philosophy", description: "Philosophical discussions" },
      ]),
      generateText,
    });
    expect(result).toEqual({ topicName: "session", isNew: false });
  });

  // 5. Empty existing topics list — LLM still called, returns new topic
  it("calls LLM and returns new topic when existingTopics is empty", async () => {
    const generateText = vi.fn().mockResolvedValue(
      JSON.stringify({ action: "new", topicName: "general-chat", description: "General conversation" }),
    );
    const result = await routeToTopic({
      summary: "A casual chat about nothing in particular.",
      existingTopics: [],
      generateText,
    });
    expect(result).toEqual({
      topicName: "general-chat",
      isNew: true,
      description: "General conversation",
    });
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  // 6. Kebab case normalization — LLM returns different casing
  it("matches existing topic via kebab case normalization", async () => {
    const generateText = vi.fn().mockResolvedValue(
      JSON.stringify({ action: "existing", topicName: "Philosophy" }),
    );
    const result = await routeToTopic({
      summary: "Deep thoughts about existence.",
      existingTopics: makeTopics([
        { name: "philosophy", description: "Philosophical discussions" },
      ]),
      generateText,
    });
    expect(result).toEqual({ topicName: "philosophy", isNew: false });
  });

  // 7. Stricter prompt for 30+ topics
  it("includes many-topics note when existingTopics >= 30", async () => {
    const generateText = vi.fn().mockResolvedValue(
      JSON.stringify({ action: "existing", topicName: "t-0" }),
    );
    const topics = Array.from({ length: 30 }, (_, i) => ({
      name: `t-${i}`,
      description: `Topic ${i}`,
    }));
    await routeToTopic({
      summary: "Some summary",
      existingTopics: topics,
      generateText,
    });
    const prompt = generateText.mock.calls[0]![0] as string;
    expect(prompt).toContain("There are many existing topics");
  });

  it("does not include many-topics note when existingTopics < 30", async () => {
    const generateText = vi.fn().mockResolvedValue(
      JSON.stringify({ action: "existing", topicName: "philosophy" }),
    );
    await routeToTopic({
      summary: "Some summary",
      existingTopics: makeTopics([
        { name: "philosophy", description: "Philosophical discussions" },
      ]),
      generateText,
    });
    const prompt = generateText.mock.calls[0]![0] as string;
    expect(prompt).not.toContain("There are many existing topics");
  });

  // 8. LLM returns malformed JSON → keyword fallback
  it("falls back to keyword match when LLM returns malformed JSON", async () => {
    const generateText = vi.fn().mockResolvedValue("this is not json {{{");
    const result = await routeToTopic({
      summary: "Discussion about philosophy topics.",
      existingTopics: makeTopics([
        { name: "philosophy", description: "Philosophical discussions" },
      ]),
      generateText,
    });
    expect(result).toEqual({ topicName: "philosophy", isNew: false });
  });

  // 9. LLM returns existing but name not in list → treated as new
  it("treats unmatched existing action as new topic", async () => {
    const generateText = vi.fn().mockResolvedValue(
      JSON.stringify({ action: "existing", topicName: "quantum-physics" }),
    );
    const result = await routeToTopic({
      summary: "We talked about quantum mechanics.",
      existingTopics: makeTopics([
        { name: "philosophy", description: "Philosophical discussions" },
      ]),
      generateText,
    });
    expect(result).toEqual({
      topicName: "quantum-physics",
      isNew: true,
      description: "Topic about quantum-physics",
    });
  });

  // Extra: LLM returns markdown-fenced JSON
  it("strips markdown fences from LLM response", async () => {
    const generateText = vi.fn().mockResolvedValue(
      '```json\n{"action":"existing","topicName":"philosophy"}\n```',
    );
    const result = await routeToTopic({
      summary: "Deep thoughts.",
      existingTopics: makeTopics([
        { name: "philosophy", description: "Philosophical discussions" },
      ]),
      generateText,
    });
    expect(result).toEqual({ topicName: "philosophy", isNew: false });
  });
});
