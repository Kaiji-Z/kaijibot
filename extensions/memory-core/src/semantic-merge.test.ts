import { describe, it, expect, vi } from "vitest";
import { semanticTopicMerge, computeTopicJaccard, type TopicForMerge } from "./semantic-merge.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTopic(overrides: Partial<TopicForMerge> & { name: string }): TopicForMerge {
  return {
    subject: overrides.subject ?? overrides.name,
    entryCount: overrides.entryCount ?? 5,
    sampleContent: overrides.sampleContent ?? `Sample content for ${overrides.name}`,
    ...overrides,
  };
}

const feishuApi = makeTopic({
  name: "feishu-api",
  subject: "Feishu API development",
  entryCount: 10,
  sampleContent:
    "Working with feishu open platform API for message sending and bot management. " +
    "Implemented webhook handlers for event subscriptions.",
});

const feishuBot = makeTopic({
  name: "feishu-bot",
  subject: "Feishu bot configuration and development",
  entryCount: 3,
  sampleContent:
    "Configuring feishu bot for message handling and event subscriptions. " +
    "Bot webhook setup and API integration.",
});

const philosophy = makeTopic({
  name: "philosophy",
  subject: "Philosophical discussions and ethics",
  entryCount: 7,
  sampleContent:
    "Explored Kant's categorical imperative and its implications for AI ethics. " +
    "Discussed utilitarianism vs deontology in autonomous systems.",
});

const cooking = makeTopic({
  name: "cooking",
  subject: "Cooking recipes and techniques",
  entryCount: 4,
  sampleContent:
    "Made sourdough bread with 72-hour fermentation. Perfected the crumb structure. " +
    "Also tried making pasta from scratch with semolina flour.",
});

// ---------------------------------------------------------------------------
// computeTopicJaccard
// ---------------------------------------------------------------------------

describe("computeTopicJaccard", () => {
  it("returns high similarity for topics with overlapping content", () => {
    const sim = computeTopicJaccard(feishuApi, feishuBot);
    expect(sim).toBeGreaterThan(0.3);
  });

  it("returns low similarity for unrelated topics", () => {
    const sim = computeTopicJaccard(philosophy, cooking);
    expect(sim).toBeLessThan(0.3);
  });

  it("returns 1 for identical topics", () => {
    const sim = computeTopicJaccard(feishuApi, feishuApi);
    expect(sim).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// semanticTopicMerge
// ---------------------------------------------------------------------------

describe("semanticTopicMerge", () => {
  // Helper: build LLM response in new format (array of merge decisions)
  function mergeResponse(decisions: Array<{ from: string[]; into: string; reason: string }>) {
    return JSON.stringify(decisions);
  }

  // 1. Two semantically similar topics merge via LLM
  it("merges two semantically similar topics via LLM", async () => {
    // feishu-api and feishu-bot share "feishu" token → grouped together → LLM decides merge
    const generateText = vi.fn().mockResolvedValue(
      mergeResponse([
        {
          from: ["feishu-api", "feishu-bot"],
          into: "feishu-api",
          reason: "Both topics cover feishu platform development",
        },
      ]),
    );

    const result = await semanticTopicMerge({
      topics: [feishuApi, feishuBot],
      generateText,
    });

    expect(result.merges).toHaveLength(1);
    expect(result.merges[0]!.from).toBe("feishu-bot");
    expect(result.merges[0]!.into).toBe("feishu-api");
    expect(result.llmCalls).toBe(1);
    expect(result.groupsAnalyzed).toBe(1);
  });

  // 2. LLM says no merge — empty array response
  it("does not merge when LLM returns empty array", async () => {
    const topicA = makeTopic({
      name: "philosophy",
      subject: "philosophy and cooking combined",
      sampleContent: "We discussed philosophy and cooking and baking techniques together.",
      entryCount: 5,
    });
    const topicB = makeTopic({
      name: "cooking",
      subject: "philosophy and cooking combined",
      sampleContent: "We discussed philosophy and cooking and baking techniques together.",
      entryCount: 3,
    });

    const generateText = vi.fn().mockResolvedValue("[]");

    const result = await semanticTopicMerge({
      topics: [topicA, topicB],
      generateText,
    });

    expect(result.merges).toHaveLength(0);
    expect(result.llmCalls).toBe(1);
  });

  // 3. Disconnected topics — no shared tokens → no LLM call
  it("skips topics with no shared tokens without calling LLM", async () => {
    const generateText = vi.fn();

    const result = await semanticTopicMerge({
      topics: [philosophy, cooking],
      generateText,
    });

    expect(result.merges).toHaveLength(0);
    expect(result.groupsAnalyzed).toBe(0);
    expect(result.llmCalls).toBe(0);
    expect(generateText).not.toHaveBeenCalled();
  });

  // 4. LLM failure falls back gracefully
  it("skips component when LLM throws and continues processing", async () => {
    const generateText = vi.fn().mockRejectedValue(new Error("LLM timeout"));

    const topicA = makeTopic({
      name: "feishu-api",
      subject: "feishu api bot development",
      sampleContent: "feishu api bot webhook event subscription message handling",
      entryCount: 10,
    });
    const topicB = makeTopic({
      name: "feishu-bot",
      subject: "feishu api bot development",
      sampleContent: "feishu api bot webhook event subscription message handling",
      entryCount: 3,
    });

    const result = await semanticTopicMerge({
      topics: [topicA, topicB],
      generateText,
    });

    expect(result.llmCalls).toBeGreaterThanOrEqual(1);
    expect(result.merges).toHaveLength(0);
  });

  // 5. LLM returns malformed JSON
  it("skips component where LLM returns malformed JSON", async () => {
    const generateText = vi.fn().mockResolvedValue("this is not json {{{");

    const topicA = makeTopic({
      name: "topic-a",
      subject: "shared subject about testing",
      sampleContent: "content about testing and verification",
      entryCount: 5,
    });
    const topicB = makeTopic({
      name: "topic-b",
      subject: "shared subject about testing",
      sampleContent: "content about testing and verification",
      entryCount: 3,
    });

    const result = await semanticTopicMerge({
      topics: [topicA, topicB],
      generateText,
    });

    expect(result.merges).toHaveLength(0);
    expect(result.llmCalls).toBe(1);
  });

  // 6. Multiple merge decisions in one component
  it("handles multiple merge decisions from one component", async () => {
    const topicA = makeTopic({
      name: "feishu-api",
      subject: "feishu api development",
      entryCount: 10,
      sampleContent: "feishu api webhook event",
    });
    const topicB = makeTopic({
      name: "feishu-bot",
      subject: "feishu bot development",
      entryCount: 3,
      sampleContent: "feishu bot message handling",
    });
    const topicC = makeTopic({
      name: "feishu-sdk",
      subject: "feishu sdk development",
      entryCount: 5,
      sampleContent: "feishu sdk integration",
    });

    const generateText = vi.fn().mockResolvedValue(
      mergeResponse([
        {
          from: ["feishu-api", "feishu-bot"],
          into: "feishu-api",
          reason: "Both feishu platform topics",
        },
        {
          from: ["feishu-api", "feishu-sdk"],
          into: "feishu-api",
          reason: "SDK is part of API ecosystem",
        },
      ]),
    );

    const result = await semanticTopicMerge({
      topics: [topicA, topicB, topicC],
      generateText,
    });

    // feishu-bot → feishu-api, feishu-sdk → feishu-api
    expect(result.merges).toHaveLength(2);
    expect(result.merges.every((m) => m.into === "feishu-api")).toBe(true);
    expect(result.llmCalls).toBe(1);
    expect(result.groupsAnalyzed).toBe(1);
  });

  // 7. Merge direction: smaller into larger
  it("merges smaller topic into larger topic", async () => {
    const large = makeTopic({
      name: "large-topic",
      subject: "shared subject about testing",
      sampleContent: "content about testing and verification",
      entryCount: 10,
    });
    const small = makeTopic({
      name: "small-topic",
      subject: "shared subject about testing",
      sampleContent: "content about testing and verification",
      entryCount: 3,
    });

    const generateText = vi
      .fn()
      .mockResolvedValue(
        mergeResponse([
          { from: ["large-topic", "small-topic"], into: "large-topic", reason: "Same domain" },
        ]),
      );

    const result = await semanticTopicMerge({
      topics: [large, small],
      generateText,
    });

    expect(result.merges).toHaveLength(1);
    expect(result.merges[0]!.from).toBe("small-topic");
    expect(result.merges[0]!.into).toBe("large-topic");
  });

  // 8. Empty topics list
  it("returns empty result for empty topics list", async () => {
    const generateText = vi.fn();
    const result = await semanticTopicMerge({ topics: [], generateText });

    expect(result.merges).toEqual([]);
    expect(result.groupsAnalyzed).toBe(0);
    expect(result.llmCalls).toBe(0);
    expect(generateText).not.toHaveBeenCalled();
  });

  // 9. Single topic
  it("returns empty result for single topic", async () => {
    const generateText = vi.fn();
    const result = await semanticTopicMerge({
      topics: [feishuApi],
      generateText,
    });

    expect(result.merges).toEqual([]);
    expect(result.groupsAnalyzed).toBe(0);
    expect(result.llmCalls).toBe(0);
    expect(generateText).not.toHaveBeenCalled();
  });

  // 10. Two separate components — two LLM calls
  it("makes separate LLM calls for disconnected groups", async () => {
    const topicA = makeTopic({
      name: "feishu-api",
      subject: "feishu api development",
      entryCount: 10,
      sampleContent: "feishu api webhook event",
    });
    const topicB = makeTopic({
      name: "feishu-bot",
      subject: "feishu bot development",
      entryCount: 5,
      sampleContent: "feishu bot message handling",
    });
    const topicC = makeTopic({
      name: "cooking",
      subject: "cooking recipes and food",
      entryCount: 3,
      sampleContent: "sourdough bread pasta fermentation techniques",
    });
    const topicD = makeTopic({
      name: "baking",
      subject: "baking recipes and food",
      entryCount: 7,
      sampleContent: "sourdough bread pasta fermentation techniques baking oven",
    });

    const generateText = vi.fn().mockImplementation((_prompt: string) => {
      return Promise.resolve("[]");
    });

    const result = await semanticTopicMerge({
      topics: [topicA, topicB, topicC, topicD],
      generateText,
    });

    // feishu-api + feishu-bot share "feishu" → one component
    // cooking + baking share "recipes", "food", "sourdough", "bread", "pasta", "fermentation", "techniques" → one component
    expect(result.groupsAnalyzed).toBe(2);
    expect(result.llmCalls).toBe(2);
  });

  // 11. LLM returns markdown-wrapped JSON
  it("parses LLM response with markdown fences", async () => {
    const generateText = vi
      .fn()
      .mockResolvedValue(
        '```json\n[{"from": ["topic-a", "topic-b"], "into": "topic-a", "reason": "Same topic"}]\n```',
      );

    const topicA = makeTopic({
      name: "topic-a",
      subject: "shared subject about testing",
      sampleContent: "content about testing and verification",
      entryCount: 5,
    });
    const topicB = makeTopic({
      name: "topic-b",
      subject: "shared subject about testing",
      sampleContent: "content about testing and verification",
      entryCount: 3,
    });

    const result = await semanticTopicMerge({
      topics: [topicA, topicB],
      generateText,
    });

    expect(result.merges).toHaveLength(1);
    expect(result.merges[0]!.into).toBe("topic-a");
  });

  // 12. LLM returns JSON with missing fields
  it("skips decisions with missing fields", async () => {
    const generateText = vi
      .fn()
      .mockResolvedValue(JSON.stringify([{ from: ["topic-a", "topic-b"] }]));

    const topicA = makeTopic({
      name: "topic-a",
      subject: "shared subject about testing",
      sampleContent: "content about testing and verification",
      entryCount: 5,
    });
    const topicB = makeTopic({
      name: "topic-b",
      subject: "shared subject about testing",
      sampleContent: "content about testing and verification",
      entryCount: 3,
    });

    const result = await semanticTopicMerge({
      topics: [topicA, topicB],
      generateText,
    });

    expect(result.merges).toHaveLength(0);
    expect(result.llmCalls).toBe(1);
  });

  // 13. No LLM provided → Jaccard fallback
  it("falls back to Jaccard when no generateText provided", async () => {
    const topicA = makeTopic({
      name: "topic-a",
      subject: "feishu api development and bot configuration",
      sampleContent: "feishu api bot webhook event subscription message handling",
      entryCount: 10,
    });
    const topicB = makeTopic({
      name: "topic-b",
      subject: "feishu api development and bot configuration",
      sampleContent: "feishu api bot webhook event subscription message handling",
      entryCount: 3,
    });

    const result = await semanticTopicMerge({
      topics: [topicA, topicB],
    });

    // Identical content → Jaccard = 1.0 → merges
    expect(result.merges).toHaveLength(1);
    expect(result.merges[0]!.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.llmCalls).toBe(0);
  });

  // 14. into topic not in from array → skipped
  it("skips decision where into topic is not in from array", async () => {
    const generateText = vi
      .fn()
      .mockResolvedValue(
        mergeResponse([
          { from: ["topic-a", "topic-b"], into: "topic-c", reason: "Merge into non-member" },
        ]),
      );

    const topicA = makeTopic({
      name: "topic-a",
      subject: "shared subject about testing",
      sampleContent: "content about testing and verification",
      entryCount: 5,
    });
    const topicB = makeTopic({
      name: "topic-b",
      subject: "shared subject about testing",
      sampleContent: "content about testing and verification",
      entryCount: 3,
    });

    const result = await semanticTopicMerge({
      topics: [topicA, topicB],
      generateText,
    });

    expect(result.merges).toHaveLength(0);
  });

  // 15. Unknown topic name in from array → partial merge
  it("handles unknown topic names in from array gracefully", async () => {
    const generateText = vi
      .fn()
      .mockResolvedValue(
        mergeResponse([
          { from: ["topic-a", "nonexistent", "topic-b"], into: "topic-a", reason: "Group merge" },
        ]),
      );

    const topicA = makeTopic({
      name: "topic-a",
      subject: "shared subject about testing",
      sampleContent: "content about testing and verification",
      entryCount: 5,
    });
    const topicB = makeTopic({
      name: "topic-b",
      subject: "shared subject about testing",
      sampleContent: "content about testing and verification",
      entryCount: 3,
    });

    const result = await semanticTopicMerge({
      topics: [topicA, topicB],
      generateText,
    });

    // topic-b → topic-a (nonexistent ignored)
    expect(result.merges).toHaveLength(1);
    expect(result.merges[0]!.from).toBe("topic-b");
    expect(result.merges[0]!.into).toBe("topic-a");
  });
});
