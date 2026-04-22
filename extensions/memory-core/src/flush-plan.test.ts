import { describe, it, expect } from "vitest";
import { buildMemoryFlushPlan } from "./flush-plan.js";

describe("buildMemoryFlushPlan", () => {
  it("returns a non-null plan with default params", () => {
    const plan = buildMemoryFlushPlan();
    expect(plan).not.toBeNull();
    expect(plan!.softThresholdTokens).toBeGreaterThan(0);
    expect(plan!.forceFlushTranscriptBytes).toBeGreaterThan(0);
    expect(plan!.prompt).toBeTruthy();
    expect(plan!.systemPrompt).toBeTruthy();
    expect(plan!.relativePath).toMatch(/^memory\/\d{4}-\d{2}-\d{2}\.md$/);
  });

  it("prompt includes classification section header", () => {
    const plan = buildMemoryFlushPlan();
    expect(plan!.prompt).toContain("## Memory Classification");
  });

  it("prompt includes exclusion section header", () => {
    const plan = buildMemoryFlushPlan();
    expect(plan!.prompt).toContain("## What NOT to save in memory");
  });

  it("prompt includes quality rules section header", () => {
    const plan = buildMemoryFlushPlan();
    expect(plan!.prompt).toContain("## Memory Write Quality Rules");
  });

  it("systemPrompt includes classification section header", () => {
    const plan = buildMemoryFlushPlan();
    expect(plan!.systemPrompt).toContain("## Memory Classification");
  });

  it("systemPrompt includes exclusion section header", () => {
    const plan = buildMemoryFlushPlan();
    expect(plan!.systemPrompt).toContain("## What NOT to save in memory");
  });

  it("systemPrompt includes quality rules section header", () => {
    const plan = buildMemoryFlushPlan();
    expect(plan!.systemPrompt).toContain("## Memory Write Quality Rules");
  });

  it("classification hints are not duplicated when called twice", () => {
    const plan1 = buildMemoryFlushPlan();
    const plan2 = buildMemoryFlushPlan();

    const count1 = (plan1!.prompt.match(/## Memory Classification/g) ?? []).length;
    const count2 = (plan2!.prompt.match(/## Memory Classification/g) ?? []).length;
    expect(count1).toBe(1);
    expect(count2).toBe(1);
  });

  it("classification hints coexist with safety hints", () => {
    const plan = buildMemoryFlushPlan();
    const prompt = plan!.prompt;

    expect(prompt).toContain("Store durable memories only in memory/");
    expect(prompt).toContain("APPEND new content only");
    expect(prompt).toContain("read-only during this flush");
    expect(prompt).toContain("## Memory Classification");
    expect(prompt).toContain("## What NOT to save in memory");
  });

  it("custom prompt still gets classification hints appended", () => {
    const plan = buildMemoryFlushPlan({
      cfg: {
        agents: {
          defaults: {
            compaction: {
              memoryFlush: {
                enabled: true,
                prompt: "My custom flush prompt about saving important things.",
              },
            },
          },
        },
      },
    });

    expect(plan).not.toBeNull();
    expect(plan!.prompt).toContain("My custom flush prompt about saving important things.");
    expect(plan!.prompt).toContain("## Memory Classification");
    expect(plan!.prompt).toContain("## What NOT to save in memory");
    expect(plan!.prompt).toContain("## Memory Write Quality Rules");
  });

  it("returns null when memoryFlush is explicitly disabled", () => {
    const plan = buildMemoryFlushPlan({
      cfg: {
        agents: {
          defaults: {
            compaction: {
              memoryFlush: {
                enabled: false,
              },
            },
          },
        },
      },
    });

    expect(plan).toBeNull();
  });
});
