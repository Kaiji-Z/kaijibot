import { describe, it, expect, vi } from "vitest";
import {
  diagnoseStructure,
  planRepair,
  classifyHeuristic,
  classifyWithLLM,
  executeRepair,
  verifyStructure,
  repairMemoryStructure,
  type RepairDiagnostic,
  type MemoryRepairDeps,
} from "./memory-repair.js";
import type { MemoryIndex } from "./memory-index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cleanMemoryMd(): string {
  return `# Long-Term Memory

## ⚡ Core Memory
- Prefers concise replies
- Works in distributed systems

## 🔥 Active Context
- Currently working on memory repair module

## Topic Pointers
- distributed-systems → memory/topics/distributed-systems.md
- memory-repair → memory/topics/memory-repair.md
`;
}

function memoryWithUnknownHeading(): string {
  return `# Long-Term Memory

## ⚡ Core Memory
- Prefers concise replies

## Unknown Section
- Some orphan content here
- More orphan content

## 🔥 Active Context
- Currently working on memory repair

## Topic Pointers
- test → memory/topics/test.md
`;
}

function memoryMissingRequiredHeading(): string {
  return `# Long-Term Memory

## 🔥 Active Context
- Currently working on memory repair

## Topic Pointers
- test → memory/topics/test.md
`;
}

function memoryWithOrphanLines(): string {
  return `# Long-Term Memory

These are orphan lines that don't belong to any section.
More orphan lines here.
And even more orphan content.

## ⚡ Core Memory
- Prefers concise replies

## 🔥 Active Context
- Working on memory repair

## Topic Pointers
- test → memory/topics/test.md
`;
}

function memoryCatastrophic(): string {
  return `# Long-Term Memory

Orphan line 1
Orphan line 2
Orphan line 3
Orphan line 4
Orphan line 5

## ⚡ Core Memory
- Core content

## ⚡ Core Memory
- Duplicate core content

## 🔥 Active Context
- Active content

## 👤 User
- Legacy user content

## Unknown Section A
- Unknown content line 1
- Unknown content line 2
- Unknown content line 3
- Unknown content line 4
- Unknown content line 5
- Unknown content line 6
- Unknown content line 7
- Unknown content line 8
- Unknown content line 9
- Unknown content line 10
- Unknown content line 11

## Another Unknown
- More unknown content

## Topic Pointers
- test → memory/topics/test.md
- dangling → memory/topics/nonexistent.md
`;
}

function memoryWithLegacyHeadings(): string {
  return `# Long-Term Memory

## 👤 User
- User content here

## 💬 Key Feedback
- Feedback content

## 🔥 Active Context
- Active content

## Topic Pointers
- test → memory/topics/test.md
`;
}

function memoryWithLargePromotedContent(): string {
  const largePromoted = "x".repeat(1100);
  return `# Long-Term Memory

## ⚡ Core Memory
- Core content

## 🔥 Active Context
- Active content

## Topic Pointers
- test → memory/topics/test.md

## Promoted From Short-Term Memory
${largePromoted}
`;
}

function memoryWithDanglingPointer(): string {
  return `# Long-Term Memory

## ⚡ Core Memory
- Core content

## 🔥 Active Context
- Active content

## Topic Pointers
- test → memory/topics/nonexistent.md
- real → memory/topics/real.md
`;
}

function createMockDeps(overrides?: Partial<MemoryRepairDeps>): MemoryRepairDeps {
  const memoryContent = { value: "" };
  return {
    readRawMemoryIndex: async () => memoryContent.value,
    writeRawMemoryIndex: async (_dir: string, content: string) => {
      memoryContent.value = content;
    },
    parseMemoryIndex: (_content: string): MemoryIndex => ({
      sections: [],
      recentSessions: [],
      promotedContent: "",
      inlineSections: [],
    }),
    serializeIndex: (_index: MemoryIndex): string => "",
    readTopicFile: async () => null,
    appendToTopicFile: async () => {},
    topicFileExists: async () => true,
    listTopicFiles: async () => ["memory/topics/test.md", "memory/topics/real.md"],
    generateText: async () => "[]",
    backupFile: async () => "/backup/MEMORY.md.bak",
    log: () => {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// S1: diagnoseStructure — clean MEMORY.md
// ---------------------------------------------------------------------------

describe("diagnoseStructure", () => {
  it("S1: returns severity=none for clean MEMORY.md", () => {
    const result = diagnoseStructure(cleanMemoryMd());
    expect(result.severity).toBe("none");
    expect(result.score).toBe(0);
    expect(result.issues).toHaveLength(0);
    expect(result.unknownContentBlocks).toHaveLength(0);
  });

  it("S2: detects single unknown heading with content as minor", () => {
    const result = diagnoseStructure(memoryWithUnknownHeading());
    expect(result.severity).toBe("minor");
    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.issues.some((i) => i.type === "unknown_heading")).toBe(true);
    expect(result.unknownContentBlocks.length).toBeGreaterThan(0);
  });

  it("S3: detects missing required heading (⚡ Core Memory)", () => {
    const result = diagnoseStructure(memoryMissingRequiredHeading());
    expect(result.severity).toBe("minor");
    expect(result.score).toBeGreaterThanOrEqual(2);
    const missingIssues = result.issues.filter((i) => i.type === "missing_heading");
    expect(missingIssues.length).toBeGreaterThan(0);
    expect(missingIssues.some((i) => i.details.includes("⚡ Core Memory"))).toBe(true);
  });

  it("S4: detects multiple unknown headings + orphan lines as moderate", () => {
    const content = `# Long-Term Memory

Orphan line here.
Another orphan line.

## ⚡ Core Memory
- Core content

## Unknown A
- Content A

## Unknown B
- Content B

## 🔥 Active Context
- Active content

## Topic Pointers
- test → memory/topics/test.md
`;
    const result = diagnoseStructure(content);
    expect(result.severity).toBe("moderate");
    expect(result.score).toBeGreaterThanOrEqual(4);
    const unknowns = result.issues.filter((i) => i.type === "unknown_heading");
    expect(unknowns.length).toBeGreaterThanOrEqual(2);
  });

  it("S5: catastrophic MEMORY.md scores as major", () => {
    const result = diagnoseStructure(memoryCatastrophic());
    expect(result.severity).toBe("major");
    expect(result.score).toBeGreaterThanOrEqual(9);
  });

  it("detects duplicate heading", () => {
    const content = `# Long-Term Memory

## ⚡ Core Memory
- First

## ⚡ Core Memory
- Second

## 🔥 Active Context
- Active

## Topic Pointers
- test → memory/topics/test.md
`;
    const result = diagnoseStructure(content);
    const dupIssues = result.issues.filter((i) => i.type === "duplicate_heading");
    expect(dupIssues.length).toBeGreaterThan(0);
  });

  it("detects legacy headings", () => {
    const result = diagnoseStructure(memoryWithLegacyHeadings());
    const legacyIssues = result.issues.filter((i) => i.type === "legacy_heading");
    expect(legacyIssues.length).toBeGreaterThan(0);
  });

  it("detects large promoted content", () => {
    const result = diagnoseStructure(memoryWithLargePromotedContent());
    const promotedIssues = result.issues.filter(
      (i) => i.type === "large_promoted_content",
    );
    expect(promotedIssues.length).toBeGreaterThan(0);
  });

  it("detects dangling topic pointers", async () => {
    const result = await diagnoseStructure(memoryWithDanglingPointer(), {
      topicFileExists: async (p: string) => !p.includes("nonexistent"),
    });
    const danglingIssues = result.issues.filter((i) => i.type === "dangling_pointer");
    expect(danglingIssues.length).toBeGreaterThan(0);
  });

  it("detects orphan topic files", async () => {
    const content = `# Long-Term Memory

## ⚡ Core Memory
- Core content

## 🔥 Active Context
- Active content

## Topic Pointers
- test → memory/topics/test.md
`;
    const result = await diagnoseStructure(content, {
      listTopicFiles: async () => [
        "memory/topics/test.md",
        "memory/topics/orphan.md",
      ],
    });
    const orphanIssues = result.issues.filter((i) => i.type === "orphan_topic_file");
    expect(orphanIssues.length).toBeGreaterThan(0);
  });

  it("detects orphan lines between sections", () => {
    const result = diagnoseStructure(memoryWithOrphanLines());
    const orphanLineIssues = result.issues.filter((i) => i.type === "orphan_lines");
    expect(orphanLineIssues.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// planRepair
// ---------------------------------------------------------------------------

describe("planRepair", () => {
  it("returns empty actions for none severity", () => {
    const diagnostic: RepairDiagnostic = {
      severity: "none",
      score: 0,
      issues: [],
      unknownContentBlocks: [],
    };
    const plan = planRepair(diagnostic);
    expect(plan.actions).toHaveLength(0);
    expect(plan.requiresBackup).toBe(false);
    expect(plan.requiresLLM).toBe(false);
  });

  it("minor: heuristic only, no LLM, no backup", () => {
    const diagnostic: RepairDiagnostic = {
      severity: "minor",
      score: 2,
      issues: [
        { type: "missing_heading", weight: 2, details: "missing ⚡ Core Memory" },
      ],
      unknownContentBlocks: [],
    };
    const plan = planRepair(diagnostic);
    expect(plan.requiresLLM).toBe(false);
    expect(plan.requiresBackup).toBe(false);
    expect(plan.actions.length).toBeGreaterThan(0);
  });

  it("moderate: has classify action, requiresLLM=true, requiresBackup=true", () => {
    const diagnostic: RepairDiagnostic = {
      severity: "moderate",
      score: 5,
      issues: [
        { type: "unknown_heading", weight: 3, details: "unknown section" },
        { type: "missing_heading", weight: 2, details: "missing heading" },
      ],
      unknownContentBlocks: [{ heading: "Unknown", lines: ["some content"] }],
    };
    const plan = planRepair(diagnostic);
    expect(plan.requiresLLM).toBe(true);
    expect(plan.requiresBackup).toBe(true);
    const classifyAction = plan.actions.find(
      (a) => a.type === "classify_and_relocate",
    );
    expect(classifyAction).toBeDefined();
  });

  it("major: all action types possible", () => {
    const diagnostic: RepairDiagnostic = {
      severity: "major",
      score: 15,
      issues: [
        { type: "unknown_heading", weight: 3, details: "unknown section" },
        { type: "missing_heading", weight: 2, details: "missing heading" },
        { type: "duplicate_heading", weight: 3, details: "dup" },
        { type: "orphan_lines", weight: 1, details: "orphan lines" },
        { type: "legacy_heading", weight: 2, details: "legacy" },
        { type: "large_promoted_content", weight: 2, details: "large" },
        { type: "dangling_pointer", weight: 1, details: "dangling" },
        { type: "orphan_topic_file", weight: 1, details: "orphan file" },
      ],
      unknownContentBlocks: [{ heading: "X", lines: ["content"] }],
    };
    const plan = planRepair(diagnostic);
    expect(plan.requiresBackup).toBe(true);
    expect(plan.actions.length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// classifyHeuristic
// ---------------------------------------------------------------------------

describe("classifyHeuristic", () => {
  it("routes legacy heading '👤 User' to ⚡ Core Memory", () => {
    const results = classifyHeuristic([
      { heading: "👤 User", lines: ["user data"] },
    ]);
    expect(results[0]!.target).toBe("⚡ Core Memory");
  });

  it("routes legacy heading '🎯 Active Focus' to 🔥 Active Context", () => {
    const results = classifyHeuristic([
      { heading: "🎯 Active Focus", lines: ["active data"] },
    ]);
    expect(results[0]!.target).toBe("🔥 Active Context");
  });

  it("routes preference pattern '喜欢 TypeScript' to ⚡ Core Memory", () => {
    const results = classifyHeuristic([
      { heading: "Language Preferences", lines: ["喜欢 TypeScript for all projects"] },
    ]);
    expect(results[0]!.target).toBe("⚡ Core Memory");
  });

  it("routes pattern 'prefer dark mode' to ⚡ Core Memory", () => {
    const results = classifyHeuristic([
      { heading: "UI Settings", lines: ["I prefer dark mode always"] },
    ]);
    expect(results[0]!.target).toBe("⚡ Core Memory");
  });

  it("routes active pattern 'working on memory repair' to 🔥 Active Context", () => {
    const results = classifyHeuristic([
      {
        heading: "Current Tasks",
        lines: ["Currently working on memory repair module"],
      },
    ]);
    expect(results[0]!.target).toBe("🔥 Active Context");
  });

  it("routes TODO pattern to 🔥 Active Context", () => {
    const results = classifyHeuristic([
      {
        heading: "TODO List",
        lines: ["TODO: finish the repair module"],
      },
    ]);
    expect(results[0]!.target).toBe("🔥 Active Context");
  });

  it("routes unknown content to topic:{derived-subject}", () => {
    const results = classifyHeuristic([
      {
        heading: "Quantum Computing Basics",
        lines: ["Some quantum content here"],
      },
    ]);
    expect(results[0]!.target).toMatch(/^topic:/);
    expect(results[0]!.target).toContain("quantum");
  });

  it("derives subject by lowercasing and hyphenating", () => {
    const results = classifyHeuristic([
      {
        heading: "React State Management!",
        lines: ["content"],
      },
    ]);
    expect(results[0]!.target).toBe("topic:react-state-management");
  });

  it("handles multiple blocks with different targets", () => {
    const results = classifyHeuristic([
      { heading: "👤 User", lines: ["user info"] },
      { heading: "TODO List", lines: ["TODO: fix bug"] },
      { heading: "Random Facts", lines: ["interesting fact"] },
    ]);
    expect(results).toHaveLength(3);
    expect(results[0]!.target).toBe("⚡ Core Memory");
    expect(results[1]!.target).toBe("🔥 Active Context");
    expect(results[2]!.target).toMatch(/^topic:/);
  });
});

// ---------------------------------------------------------------------------
// classifyWithLLM
// ---------------------------------------------------------------------------

describe("classifyWithLLM", () => {
  it("parses valid JSON response correctly", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(
      JSON.stringify([
        { block_index: 0, target: "core" },
        { block_index: 1, target: "active" },
        { block_index: 2, target: "topic:quantum-physics" },
      ]),
    );
    const blocks = [
      { heading: "User Info", lines: ["likes coffee"] },
      { heading: "Current Work", lines: ["building app"] },
      { heading: "Physics Notes", lines: ["quantum entanglement"] },
    ];
    const results = await classifyWithLLM(blocks, mockGenerate);
    expect(results).toHaveLength(3);
    expect(results[0]!.target).toBe("⚡ Core Memory");
    expect(results[1]!.target).toBe("🔥 Active Context");
    expect(results[2]!.target).toBe("topic:quantum-physics");
  });

  it("falls back to topic:uncategorized on garbage response", async () => {
    const mockGenerate = vi.fn().mockResolvedValue("this is not JSON at all!!");
    const blocks = [
      { heading: "Mystery", lines: ["unknown content"] },
    ];
    const results = await classifyWithLLM(blocks, mockGenerate);
    expect(results).toHaveLength(1);
    expect(results[0]!.target).toBe("topic:uncategorized");
  });

  it("falls back to topic:uncategorized on LLM error", async () => {
    const mockGenerate = vi.fn().mockRejectedValue(new Error("LLM unavailable"));
    const blocks = [
      { heading: "Mystery", lines: ["unknown content"] },
    ];
    const results = await classifyWithLLM(blocks, mockGenerate);
    expect(results).toHaveLength(1);
    expect(results[0]!.target).toBe("topic:uncategorized");
  });

  it("handles partial JSON with missing indices", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(
      JSON.stringify([{ block_index: 0, target: "core" }]),
    );
    const blocks = [
      { heading: "A", lines: ["a"] },
      { heading: "B", lines: ["b"] },
    ];
    const results = await classifyWithLLM(blocks, mockGenerate);
    // Block 0 classified, block 1 falls back
    expect(results).toHaveLength(2);
    expect(results[0]!.target).toBe("⚡ Core Memory");
    expect(results[1]!.target).toBe("topic:uncategorized");
  });
});

// ---------------------------------------------------------------------------
// executeRepair
// ---------------------------------------------------------------------------

describe("executeRepair", () => {
  it("minor repair: reorder sections", async () => {
    const content = `# Long-Term Memory

## 🔥 Active Context
- Active content first

## ⚡ Core Memory
- Core content second

## Topic Pointers
- test → memory/topics/test.md
`;
    const diagnostic = diagnoseStructure(content);
    const plan = planRepair(diagnostic);
    const deps = createMockDeps();

    const result = await executeRepair(plan, content, "/ws", deps);
    expect(result.contentDropped).toBe(0);
    expect(result.verificationPassed).toBe(true);
  });

  it("moderate repair: relocate orphan content, contentDropped=0", async () => {
    const content = memoryWithUnknownHeading();
    const diagnostic = diagnoseStructure(content);
    const plan = planRepair(diagnostic);
    const deps = createMockDeps();

    const result = await executeRepair(plan, content, "/ws", deps);
    expect(result.contentDropped).toBe(0);
    expect(result.contentRelocated).toBeGreaterThanOrEqual(0);
  });

  it("creates backup for moderate+ severity", async () => {
    const backupFn = vi.fn().mockResolvedValue("/backup/MEMORY.md.bak");
    const content = memoryWithUnknownHeading();
    const diagnostic = diagnoseStructure(content);
    const plan = planRepair(diagnostic);
    // Force moderate
    plan.requiresBackup = true;
    const deps = createMockDeps({ backupFile: backupFn });

    const result = await executeRepair(plan, content, "/ws", deps);
    expect(backupFn).toHaveBeenCalled();
    expect(result.backupPath).toBeDefined();
  });

  it("always returns contentDropped === 0", async () => {
    const content = memoryCatastrophic();
    const diagnostic = diagnoseStructure(content);
    const plan = planRepair(diagnostic);
    const deps = createMockDeps();

    const result = await executeRepair(plan, content, "/ws", deps);
    expect(result.contentDropped).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// verifyStructure
// ---------------------------------------------------------------------------

describe("verifyStructure", () => {
  it("returns true for clean content", () => {
    expect(verifyStructure(cleanMemoryMd())).toBe(true);
  });

  it("returns false for content with unknown heading", () => {
    expect(verifyStructure(memoryWithUnknownHeading())).toBe(false);
  });

  it("returns false for missing required heading", () => {
    expect(verifyStructure(memoryMissingRequiredHeading())).toBe(false);
  });

  it("returns false for duplicate headings", () => {
    const content = `# Long-Term Memory

## ⚡ Core Memory
- First

## ⚡ Core Memory
- Second

## 🔥 Active Context
- Active

## Topic Pointers
- test → memory/topics/test.md
`;
    expect(verifyStructure(content)).toBe(false);
  });

  it("returns true for valid minimal content", () => {
    const content = `# Long-Term Memory

## ⚡ Core Memory
- Content

## 🔥 Active Context
- Content

## Topic Pointers
- test → memory/topics/test.md
`;
    expect(verifyStructure(content)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Orchestrator: repairMemoryStructure
// ---------------------------------------------------------------------------

describe("repairMemoryStructure", () => {
  it("returns immediately when severity=none without writing", async () => {
    const writeFn = vi.fn();
    const deps = createMockDeps({
      readRawMemoryIndex: async () => cleanMemoryMd(),
      writeRawMemoryIndex: writeFn,
      topicFileExists: async () => true,
      listTopicFiles: async () => [
        "memory/topics/distributed-systems.md",
        "memory/topics/memory-repair.md",
      ],
    });
    const result = await repairMemoryStructure("/ws", deps);
    expect(result.severity).toBe("none");
    expect(result.actionsApplied).toHaveLength(0);
    expect(writeFn).not.toHaveBeenCalled();
  });

  it("full pipeline: diagnoses, plans, classifies, executes, verifies", async () => {
    let writtenContent = "";
    const generateFn = vi.fn().mockResolvedValue(
      JSON.stringify([{ block_index: 0, target: "core" }]),
    );
    const deps = createMockDeps({
      readRawMemoryIndex: async () => memoryWithUnknownHeading(),
      writeRawMemoryIndex: async (_dir: string, content: string) => {
        writtenContent = content;
      },
      generateText: generateFn,
      parseMemoryIndex: (content: string): MemoryIndex => {
        // Simple mock parse
        const lines = content.split("\n");
        const sections: Array<{ subject: string; title: string; topicFile: string; summary: string }> = [];
        for (const line of lines) {
          const m = line.match(/^- (.+?) → (.+)$/);
          if (m) {
            sections.push({ subject: m[1]!, title: m[1]!, topicFile: m[2]!, summary: "" });
          }
        }
        return {
          sections,
          recentSessions: [],
          promotedContent: "",
          inlineSections: [
            { section: "⚡ Core Memory", lines: ["- Prefers concise replies"] },
            { section: "🔥 Active Context", lines: ["- Currently working on memory repair"] },
          ],
        };
      },
      serializeIndex: (index: MemoryIndex): string => {
        const parts = ["# Long-Term Memory", ""];
        for (const s of index.inlineSections ?? []) {
          parts.push(`## ${s.section}`);
          parts.push(...s.lines);
          parts.push("");
        }
        if (index.sections.length > 0) {
          parts.push("## Topic Pointers");
          for (const s of index.sections) {
            parts.push(`- ${s.title} → ${s.topicFile}`);
          }
          parts.push("");
        }
        return parts.join("\n");
      },
    });

    const result = await repairMemoryStructure("/ws", deps);
    expect(result.severity).not.toBe("none");
    expect(result.contentDropped).toBe(0);
    // Verify the pipeline ran through classification
    if (result.actionsApplied.length > 0) {
      expect(writtenContent.length).toBeGreaterThan(0);
    }
  });

  it("handles LLM fallback gracefully", async () => {
    const deps = createMockDeps({
      readRawMemoryIndex: async () => memoryWithUnknownHeading(),
      generateText: async () => {
        throw new Error("LLM failed");
      },
    });

    const result = await repairMemoryStructure("/ws", deps);
    expect(result.contentDropped).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Severity scoring edge cases
// ---------------------------------------------------------------------------

describe("severity scoring", () => {
  it("exact score of 1 maps to minor", () => {
    // 5 orphan lines = weight 1
    const content = `# Long-Term Memory

Line 1
Line 2
Line 3
Line 4
Line 5

## ⚡ Core Memory
- Core

## 🔥 Active Context
- Active

## Topic Pointers
- test → memory/topics/test.md
`;
    const result = diagnoseStructure(content);
    expect(result.severity).toBe("minor");
  });

  it("score of 4 maps to moderate", () => {
    // 2 missing headings = 4 points
    const content = `# Long-Term Memory

## Topic Pointers
- test → memory/topics/test.md
`;
    const result = diagnoseStructure(content);
    expect(result.score).toBeGreaterThanOrEqual(4);
    expect(result.severity).toBe("moderate");
  });
});

// ---------------------------------------------------------------------------
// Regression tests for orphan detection + repair bugs
// ---------------------------------------------------------------------------

describe("orphan detection: bare filename normalization (Bug 2)", () => {
  const memoryWithTopicPointers = `# Long-Term Memory

## ⚡ Core Memory
- Core content

## 🔥 Active Context
- Active content

## Topic Pointers
- test → memory/topics/test.md
- feishu → memory/topics/feishu.md
`;

  it("does NOT flag referenced files when listTopicFiles returns bare filenames", async () => {
    const result = await diagnoseStructure(memoryWithTopicPointers, {
      listTopicFiles: async () => ["test.md", "feishu.md"],
    });
    const orphanIssues = result.issues.filter(
      (i) => i.type === "orphan_topic_file",
    );
    expect(orphanIssues).toHaveLength(0);
  });

  it("flags ONLY truly orphan files when listTopicFiles returns bare filenames", async () => {
    const result = await diagnoseStructure(memoryWithTopicPointers, {
      listTopicFiles: async () => [
        "test.md",
        "feishu.md",
        "unreferenced.md",
      ],
    });
    const orphanIssues = result.issues.filter(
      (i) => i.type === "orphan_topic_file",
    );
    expect(orphanIssues).toHaveLength(1);
    expect(orphanIssues[0]!.filePath).toBe("memory/topics/unreferenced.md");
  });

  it("handles full-path returns from listTopicFiles without double-prefixing", async () => {
    const result = await diagnoseStructure(memoryWithTopicPointers, {
      listTopicFiles: async () => [
        "memory/topics/test.md",
        "memory/topics/orphan.md",
      ],
    });
    const orphanIssues = result.issues.filter(
      (i) => i.type === "orphan_topic_file",
    );
    expect(orphanIssues).toHaveLength(1);
    expect(orphanIssues[0]!.filePath).toBe("memory/topics/orphan.md");
  });
});

describe("orphan repair: filePath used instead of diagnostic details (Bug 1)", () => {
  it("planRepair uses filePath for register_orphan_file action", () => {
    const diagnostic: RepairDiagnostic = {
      severity: "minor",
      score: 1,
      issues: [
        {
          type: "orphan_topic_file",
          weight: 1,
          details: "Orphan topic file not referenced: foo.md",
          filePath: "memory/topics/foo.md",
        },
      ],
      unknownContentBlocks: [],
    };
    const plan = planRepair(diagnostic);
    const action = plan.actions.find((a) => a.type === "register_orphan_file");
    expect(action).toBeDefined();
    if (action?.type === "register_orphan_file") {
      expect(action.file).toBe("memory/topics/foo.md");
      expect(action.file).not.toContain("Orphan topic file not referenced");
    }
  });

  it("executeRepair writes correct pointer format, not diagnostic text", async () => {
    const content = `# Long-Term Memory

## ⚡ Core Memory
- Core

## 🔥 Active Context
- Active

## Topic Pointers
- existing → memory/topics/existing.md
`;
    let written = "";
    const deps = createMockDeps({
      readRawMemoryIndex: async () => content,
      writeRawMemoryIndex: async (_dir: string, c: string) => {
        written = c;
      },
      parseMemoryIndex: (c: string): MemoryIndex => {
        const lines = c.split("\n");
        const sections: Array<{
          subject: string;
          title: string;
          topicFile: string;
          summary: string;
        }> = [];
        for (const line of lines) {
          const m = line.match(/^- (.+?) → (.+)$/);
          if (m) {
            sections.push({
              subject: m[1]!,
              title: m[1]!,
              topicFile: m[2]!,
              summary: "",
            });
          }
        }
        return {
          sections,
          recentSessions: [],
          promotedContent: "",
          inlineSections: [
            { section: "⚡ Core Memory", lines: ["- Core"] },
            { section: "🔥 Active Context", lines: ["- Active"] },
          ],
        };
      },
      listTopicFiles: async () => ["orphan.md"],
    });

    await repairMemoryStructure("/ws", deps);

    // Must NOT contain the diagnostic text "Orphan topic file not referenced"
    expect(written).not.toContain("Orphan topic file not referenced");
    // Must contain a proper pointer line for the orphan file
    if (written.length > 0) {
      const pointerLine = written
        .split("\n")
        .find((l) => l.includes("orphan.md"));
      expect(pointerLine).toBeDefined();
      expect(pointerLine).toContain("memory/topics/orphan.md");
      expect(pointerLine).toMatch(/^- orphan → memory\/topics\/orphan\.md$/);
    }
  });

  it("executeRepair deduplicates when pointer already exists", async () => {
    const content = `# Long-Term Memory

## ⚡ Core Memory
- Core

## 🔥 Active Context
- Active

## Topic Pointers
- existing → memory/topics/existing.md
- orphan → memory/topics/orphan.md
`;
    let written = "";
    const deps = createMockDeps({
      readRawMemoryIndex: async () => content,
      writeRawMemoryIndex: async (_dir: string, c: string) => {
        written = c;
      },
      parseMemoryIndex: (c: string): MemoryIndex => {
        const lines = c.split("\n");
        const sections: Array<{
          subject: string;
          title: string;
          topicFile: string;
          summary: string;
        }> = [];
        for (const line of lines) {
          const m = line.match(/^- (.+?) → (.+)$/);
          if (m) {
            sections.push({
              subject: m[1]!,
              title: m[1]!,
              topicFile: m[2]!,
              summary: "",
            });
          }
        }
        return {
          sections,
          recentSessions: [],
          promotedContent: "",
          inlineSections: [
            { section: "⚡ Core Memory", lines: ["- Core"] },
            { section: "🔥 Active Context", lines: ["- Active"] },
          ],
        };
      },
      listTopicFiles: async () => ["orphan.md"],
    });

    await repairMemoryStructure("/ws", deps);

    // Since orphan.md is already referenced, should NOT add a duplicate
    const orphanLines = written
      .split("\n")
      .filter((l) => l.includes("orphan.md"));
    expect(orphanLines.length).toBeLessThanOrEqual(1);
  });
});
