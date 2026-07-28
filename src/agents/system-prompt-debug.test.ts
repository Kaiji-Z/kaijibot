import { describe, expect, it, vi } from "vitest";
import {
  analyzeSystemPromptSections,
  approxTokensForText,
  emitContextDebugBreakdown,
  summarizeByLayer,
  type SectionBreakdown,
} from "./system-prompt-debug.js";

describe("approxTokensForText", () => {
  it("estimates ASCII at ~0.25 token per char", () => {
    const text = "hello world"; // 11 chars ASCII
    const tokens = approxTokensForText(text);
    expect(tokens).toBe(Math.ceil(11 * 0.25));
  });

  it("estimates CJK ideographs at ~1.5 tokens each", () => {
    const text = "你好世界"; // 4 CJK chars
    const tokens = approxTokensForText(text);
    expect(tokens).toBe(Math.ceil(4 * 1.5));
  });

  it("estimates mixed CJK + ASCII content", () => {
    const text = "Hello 你好 World 世界"; // 14 ASCII (incl spaces) + 4 CJK
    const tokens = approxTokensForText(text);
    expect(tokens).toBe(Math.ceil(4 * 1.5 + 14 * 0.25));
  });

  it("handles fullwidth punctuation as CJK", () => {
    const text = "：；！？"; // U+FF1A U+FF1B U+FF01 U+FF1F (4 fullwidth chars)
    const tokens = approxTokensForText(text);
    expect(tokens).toBe(Math.ceil(4 * 1.5));
  });

  it("returns 0 for empty string", () => {
    expect(approxTokensForText("")).toBe(0);
  });
});

describe("analyzeSystemPromptSections", () => {
  it("returns single (preamble) section when no headings", () => {
    const result = analyzeSystemPromptSections("just plain text");
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("(preamble)");
    expect(result[0]!.layer).toBe("unknown");
  });

  it("splits by top-level `## ` headings", () => {
    const prompt = [
      "You are a personal assistant.",
      "",
      "## Safety",
      "Be safe.",
      "",
      "## Tooling",
      "Use tools well.",
    ].join("\n");
    const result = analyzeSystemPromptSections(prompt);
    expect(result).toHaveLength(3);
    expect(result[0]!.name).toBe("(preamble)");
    expect(result[1]!.name).toBe("Safety");
    expect(result[1]!.layer).toBe("L1");
    expect(result[2]!.name).toBe("Tooling");
    expect(result[2]!.layer).toBe("L1");
  });

  it("does not split on `### ` subheadings", () => {
    const prompt = [
      "## Capabilities",
      "Top-level section",
      "",
      "### Core Abilities",
      "Subsection content",
      "",
      "### Proactive Intelligence",
      "Another subsection",
    ].join("\n");
    const result = analyzeSystemPromptSections(prompt);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("Capabilities");
    expect(result[0]!.chars).toBe(prompt.length);
  });

  it("classifies L1/L2/L3 sections by name", () => {
    const prompt = [
      "## Capabilities",
      "hardcoded",
      "",
      "## Project Context",
      "user-authored",
      "",
      "## User Cognitive Profile",
      "auto-extracted",
    ].join("\n");
    const result = analyzeSystemPromptSections(prompt);
    expect(result.map((s) => `${s.name}:${s.layer}`)).toEqual([
      "Capabilities:L1",
      "Project Context:L2",
      "User Cognitive Profile:L3",
    ]);
  });

  it("marks unknown sections explicitly (not silently bucketed)", () => {
    const prompt = "## Some Brand New Section\ncontent";
    const result = analyzeSystemPromptSections(prompt);
    expect(result[0]!.layer).toBe("unknown");
  });

  it("classifies workspace file sections (e.g. AGENTS.md, MEMORY.md) as L2", () => {
    const prompt = "## AGENTS.md\nrules\n\n## MEMORY.md\nmemory content";
    const result = analyzeSystemPromptSections(prompt);
    expect(result[0]!.name).toBe("AGENTS.md");
    expect(result[0]!.layer).toBe("L2");
    expect(result[1]!.name).toBe("MEMORY.md");
    expect(result[1]!.layer).toBe("L2");
  });

  it("classifies Available Skills subsection as L1", () => {
    const prompt = "## Available Skills\n- github\n- weather";
    const result = analyzeSystemPromptSections(prompt);
    expect(result[0]!.layer).toBe("L1");
  });

  it("tracks startLine correctly", () => {
    const prompt = ["line0", "line1", "## Safety", "line3", "## Tooling", "line5"].join("\n");
    const result = analyzeSystemPromptSections(prompt);
    expect(result[0]!.startLine).toBe(0); // preamble
    expect(result[1]!.startLine).toBe(2); // Safety
    expect(result[2]!.startLine).toBe(4); // Tooling
  });

  it("handles the Current Mode variants (task/insight/hybrid/proactive)", () => {
    for (const mode of [
      "Current Mode: Task Execution",
      "Current Mode: Thinking Partner",
      "Current Mode: Hybrid",
      "Current Mode: Proactive",
    ]) {
      const result = analyzeSystemPromptSections(`## ${mode}\ncontent`);
      expect(result[0]!.name).toBe(mode);
      expect(result[0]!.layer).toBe("L3");
    }
  });
});

describe("summarizeByLayer", () => {
  it("aggregates tokens/chars per layer", () => {
    const sections: SectionBreakdown[] = [
      { name: "Safety", layer: "L1", chars: 100, approxTokens: 25, startLine: 0 },
      { name: "Tooling", layer: "L1", chars: 200, approxTokens: 50, startLine: 5 },
      { name: "Project Context", layer: "L2", chars: 1000, approxTokens: 300, startLine: 10 },
      { name: "User Cognitive Profile", layer: "L3", chars: 500, approxTokens: 200, startLine: 20 },
    ];
    const summary = summarizeByLayer(sections);
    expect(summary).toEqual([
      { layer: "L1", sections: 2, chars: 300, approxTokens: 75 },
      { layer: "L2", sections: 1, chars: 1000, approxTokens: 300 },
      { layer: "L3", sections: 1, chars: 500, approxTokens: 200 },
    ]);
  });

  it("sorts layers in stable order L1 < L2 < L3 < unknown", () => {
    const sections: SectionBreakdown[] = [
      { name: "Unknown1", layer: "unknown", chars: 1, approxTokens: 1, startLine: 0 },
      { name: "L3-a", layer: "L3", chars: 1, approxTokens: 1, startLine: 0 },
      { name: "L1-a", layer: "L1", chars: 1, approxTokens: 1, startLine: 0 },
      { name: "L2-a", layer: "L2", chars: 1, approxTokens: 1, startLine: 0 },
    ];
    const summary = summarizeByLayer(sections);
    expect(summary.map((s) => s.layer)).toEqual(["L1", "L2", "L3", "unknown"]);
  });

  it("returns empty array for empty input", () => {
    expect(summarizeByLayer([])).toEqual([]);
  });
});

describe("emitContextDebugBreakdown", () => {
  it("writes formatted breakdown to stderr", () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const prompt = "## Safety\nBe safe.\n\n## Tooling\nUse tools.";
    emitContextDebugBreakdown(prompt);

    expect(writeSpy).toHaveBeenCalledOnce();
    const output = writeSpy.mock.calls[0]![0] as string;
    expect(output).toContain("=== KAIJIBOT CONTEXT BREAKDOWN ===");
    expect(output).toContain("Total:");
    expect(output).toContain("By layer:");
    expect(output).toContain("[L1] Safety:");
    expect(output).toContain("[L1] Tooling:");
    expect(output).toContain("=== END BREAKDOWN ===");

    writeSpy.mockRestore();
  });

  it("includes unknown sections in output", () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    emitContextDebugBreakdown("## Unknown Section\ncontent");

    const output = writeSpy.mock.calls[0]![0] as string;
    expect(output).toContain("[unknown] Unknown Section:");
    expect(output).toContain("unknown=");

    writeSpy.mockRestore();
  });
});
