import { describe, it, expect } from "vitest";
import { buildPromptSection } from "./prompt-section.js";
import type { MemoryPromptSectionBuilder } from "kaijibot/plugin-sdk/memory-core-host-runtime-core";

const fullTools = new Set(["memory_search", "memory_get"]);
const searchOnly = new Set(["memory_search"]);
const getOnly = new Set(["memory_get"]);
const noTools = new Set<string>();

describe("buildPromptSection", () => {
  it("contains ## Memory Recall header", () => {
    const lines = buildPromptSection({
      availableTools: fullTools,
      citationsMode: "auto",
    });
    expect(lines).toContain("## Memory Recall");
  });

  it("contains ## Before Recommending from Memory section", () => {
    const lines = buildPromptSection({
      availableTools: fullTools,
      citationsMode: "auto",
    });
    const joined = lines.join("\n");
    expect(joined).toContain("## Before Recommending from Memory");
  });

  it("contains memory drift caveat", () => {
    const lines = buildPromptSection({
      availableTools: fullTools,
      citationsMode: "auto",
    });
    const joined = lines.join("\n");
    expect(joined).toContain(
      '"The memory says X exists" is not the same as "X exists now."',
    );
  });

  it("works with both memory_search and memory_get (full mode)", () => {
    const lines = buildPromptSection({
      availableTools: fullTools,
      citationsMode: "auto",
    });
    expect(lines.length).toBeGreaterThan(0);
    const joined = lines.join("\n");
    expect(joined).toContain("memory_search");
    expect(joined).toContain("memory_get");
  });

  it("works with only memory_search tool", () => {
    const lines = buildPromptSection({
      availableTools: searchOnly,
      citationsMode: "auto",
    });
    expect(lines.length).toBeGreaterThan(0);
    const joined = lines.join("\n");
    expect(joined).toContain("## Memory Recall");
  });

  it("works with only memory_get tool", () => {
    const lines = buildPromptSection({
      availableTools: getOnly,
      citationsMode: "auto",
    });
    expect(lines.length).toBeGreaterThan(0);
    const joined = lines.join("\n");
    expect(joined).toContain("## Memory Recall");
  });

  it("returns empty array when no memory tools available", () => {
    const lines = buildPromptSection({
      availableTools: noTools,
      citationsMode: "auto",
    });
    expect(lines).toEqual([]);
  });

  it('citations mode "off" includes disabled message', () => {
    const lines = buildPromptSection({
      availableTools: fullTools,
      citationsMode: "off",
    });
    const joined = lines.join("\n");
    expect(joined).toContain("Citations are disabled");
  });

  it('citations mode "on" includes citation instruction', () => {
    const lines = buildPromptSection({
      availableTools: fullTools,
      citationsMode: "on",
    });
    const joined = lines.join("\n");
    expect(joined).toContain("Source: <path#line>");
  });

  it('citations mode "auto" includes citation instruction', () => {
    const lines = buildPromptSection({
      availableTools: fullTools,
      citationsMode: "auto",
    });
    const joined = lines.join("\n");
    expect(joined).toContain("Source: <path#line>");
  });
});
