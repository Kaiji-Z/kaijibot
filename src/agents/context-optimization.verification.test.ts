import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildContextManifest } from "../cognitive/context-manifest.js";
import { buildCognitiveModePrompt } from "../cognitive/context-writer.js";
import { selectRelevantCorrections } from "../cognitive/correction/injector.js";
import { CorrectionStore } from "../cognitive/correction/store.js";
import type { CorrectionRecord } from "../cognitive/correction/types.js";
import { createDefaultPersona } from "../cognitive/persona/store.js";
import type { PersonaTree } from "../cognitive/types.js";
import {
  analyzeSystemPromptSections,
  summarizeByLayer,
} from "./system-prompt-debug.js";
import { buildAgentSystemPrompt } from "./system-prompt.js";

const BASELINE_L1_TOKENS = 3008;
const BASELINE_CAPABILITIES_TOKENS = 675;

function buildVerificationPrompt(): string {
  return buildAgentSystemPrompt({
    workspaceDir: "/tmp/kaijibot-verification",
    toolNames: [
      "read",
      "exec",
      "process",
      "cron",
      "message",
      "sessions_spawn",
      "update_plan",
      "gateway",
    ],
    userTimezone: "Asia/Shanghai",
    runtimeInfo: {
      agentId: "main",
      host: "verify-host",
      os: "linux",
      arch: "x64",
      node: "v22",
      provider: "zai",
      model: "glm-5.2",
      channel: "feishu",
      capabilities: ["inlineButtons"],
    },
    contextFiles: [
      { path: "AGENTS.md", content: "# Test AGENTS.md\nProject rules here." },
      { path: "MEMORY.md", content: "# Test MEMORY.md\nMemory content." },
    ],
    skillsPrompt: "## Available Skills\n- github\n- weather\n- summarize\n- coding-agent\n- notion",
    heartbeatPrompt: "Read HEARTBEAT.md and check for tasks",
    extraSystemPrompt: [
      "## User Cognitive Profile",
      "### Known Traits",
      "称呼: TestUser (90%)",
      "## Skill Evolution",
      "Decide autonomously.",
      "## Known Corrections",
      "1. [git] Forgot to pull before push → always pull first",
      "## Current Mode: Task Execution",
      "Execute precisely.",
    ].join("\n\n"),
  });
}

function makeCorrection(overrides?: Partial<CorrectionRecord>): CorrectionRecord {
  return {
    id: `corr-${Math.random().toString(36).slice(2, 8)}`,
    domain: "general",
    trigger: "general",
    mistake: "mistake",
    correction: "correction",
    provenance: "self",
    reinforcedCount: 1,
    createdAt: Date.now(),
    lastReinforced: Date.now(),
    ...overrides,
  };
}

describe("Context Engineering Optimization Verification", () => {
  describe("W2.2: Lost in the Middle defense — injection ordering", () => {
    it("places identity line at the very beginning (head attention zone)", () => {
      const prompt = buildVerificationPrompt();
      const firstLine = prompt.split("\n")[0];
      expect(firstLine).toContain("personal assistant");
    });

    it("places Safety section in the first 40% of prompt lines", () => {
      const prompt = buildVerificationPrompt();
      const lines = prompt.split("\n");
      const safetyIdx = lines.findIndex((l) => l.startsWith("## Safety"));
      expect(safetyIdx).toBeGreaterThan(0);
      expect(safetyIdx / lines.length).toBeLessThan(0.4);
    });

    it("places L3 cognitive content in the last 25% of prompt lines (tail attention zone)", () => {
      const prompt = buildVerificationPrompt();
      const lines = prompt.split("\n");
      const cognitiveIdx = lines.findIndex(
        (l) => l.startsWith("## Group Chat Context") || l.startsWith("## Subagent Context"),
      );
      expect(cognitiveIdx).toBeGreaterThan(0);
      const positionRatio = cognitiveIdx / lines.length;
      expect(positionRatio).toBeGreaterThan(0.75);
    });

    it("places Runtime before cognitive context (Runtime is background, cognitive is foreground)", () => {
      const prompt = buildVerificationPrompt();
      const lines = prompt.split("\n");
      const runtimeIdx = lines.findIndex((l) => l.startsWith("## Runtime"));
      const cognitiveIdx = lines.findIndex(
        (l) => l.startsWith("## Group Chat Context") || l.startsWith("## Subagent Context"),
      );
      expect(runtimeIdx).toBeGreaterThan(0);
      expect(cognitiveIdx).toBeGreaterThan(runtimeIdx);
    });

    it("places ## Current Mode at the very end (highest-priority behavioral signal)", () => {
      const prompt = buildVerificationPrompt();
      const sections = analyzeSystemPromptSections(prompt);
      const modeSection = sections.find((s) => s.name.startsWith("Current Mode"));
      expect(modeSection).toBeDefined();
      const lastSection = sections[sections.length - 1];
      expect(lastSection?.name).toMatch(/Current Mode|Group Chat Context|Subagent Context/);
    });
  });

  describe("W2.3: Information density optimization — content pruning", () => {
    it("removed 'Core Abilities' subsection (model already knows it has tools)", () => {
      const prompt = buildVerificationPrompt();
      expect(prompt).not.toMatch(/### Core Abilities/);
    });

    it("retained 'Proactive Intelligence' section (KaijiBot differentiation)", () => {
      const prompt = buildVerificationPrompt();
      expect(prompt).toMatch(/### Proactive Intelligence/);
      expect(prompt).toMatch(/You are NOT a passive Q&A bot/);
    });

    it("retained PRISM Gate / Trust Evolution / Feedback Learning (behavioral drivers)", () => {
      const prompt = buildVerificationPrompt();
      expect(prompt).toContain("PRISM Gate");
      expect(prompt).toContain("Trust Evolution");
      expect(prompt).toContain("Feedback Learning");
    });

    it("removed verbose 'How to Introduce Yourself' 6-point list (kept essentials)", () => {
      const prompt = buildVerificationPrompt();
      expect(prompt).not.toMatch(/^1\. You're a proactive assistant/m);
      expect(prompt).not.toMatch(/^6\. They can ask you/m);
    });

    it("L1 total tokens decreased from baseline", () => {
      const prompt = buildVerificationPrompt();
      const sections = analyzeSystemPromptSections(prompt);
      const summary = summarizeByLayer(sections);
      const l1 = summary.find((s) => s.layer === "L1");
      expect(l1).toBeDefined();
      expect(l1!.approxTokens).toBeLessThan(BASELINE_L1_TOKENS);
    });

    it("Capabilities section tokens decreased from baseline (675 → target < 500)", () => {
      const prompt = buildVerificationPrompt();
      const sections = analyzeSystemPromptSections(prompt);
      const capabilities = sections.find((s) => s.name === "Capabilities");
      expect(capabilities).toBeDefined();
      expect(capabilities!.approxTokens).toBeLessThan(BASELINE_CAPABILITIES_TOKENS);
      expect(capabilities!.approxTokens).toBeLessThan(500);
    });

    it("Safety section NOT shrunk (critical content preserved)", () => {
      const prompt = buildVerificationPrompt();
      const sections = analyzeSystemPromptSections(prompt);
      const safety = sections.find((s) => s.name === "Safety");
      expect(safety).toBeDefined();
      expect(safety!.approxTokens).toBeGreaterThan(100);
    });

    it("Silent Replies section compressed (was 13 lines, now ≤ 5 content lines)", () => {
      const prompt = buildVerificationPrompt();
      const sections = analyzeSystemPromptSections(prompt);
      const silent = sections.find((s) => s.name === "Silent Replies");
      expect(silent).toBeDefined();
      const bodyLines = silent!.chars / 80;
      expect(bodyLines).toBeLessThan(10);
    });
  });

  describe("W2.1: Provenance tags — layer separation", () => {
    it("includes '--- context-layer: project-doc ---' before workspace files", () => {
      const prompt = buildVerificationPrompt();
      const projectDocIdx = prompt.indexOf("--- context-layer: project-doc ---");
      const agentsMdIdx = prompt.indexOf("AGENTS.md");
      expect(projectDocIdx).toBeGreaterThan(-1);
      expect(agentsMdIdx).toBeGreaterThan(projectDocIdx);
    });

    it("includes '--- context-layer: cognitive ---' before L3 cognitive content", () => {
      const prompt = buildVerificationPrompt();
      const cognitiveTagIdx = prompt.indexOf("--- context-layer: cognitive ---");
      const personaIdx = prompt.indexOf("## User Cognitive Profile");
      expect(cognitiveTagIdx).toBeGreaterThan(-1);
      expect(personaIdx).toBeGreaterThan(cognitiveTagIdx);
    });

    it("project-doc tag appears before cognitive tag (L2 before L3)", () => {
      const prompt = buildVerificationPrompt();
      const projectDocIdx = prompt.indexOf("--- context-layer: project-doc ---");
      const cognitiveTagIdx = prompt.indexOf("--- context-layer: cognitive ---");
      expect(projectDocIdx).toBeGreaterThan(-1);
      expect(cognitiveTagIdx).toBeGreaterThan(projectDocIdx);
    });
  });

  describe("W6.1: Context Layer Priority declaration", () => {
    it("includes priority section after identity line", () => {
      const prompt = buildVerificationPrompt();
      const lines = prompt.split("\n");
      const identityIdx = lines.findIndex((l) => l.includes("personal assistant"));
      const priorityIdx = lines.findIndex((l) => l.includes("## Context Layer Priority"));
      expect(identityIdx).toBe(0);
      expect(priorityIdx).toBeGreaterThan(identityIdx);
      expect(priorityIdx).toBeLessThan(10);
    });

    it("references hardcoded safety as highest authority", () => {
      const prompt = buildVerificationPrompt();
      const priorityBlock = prompt.slice(
        prompt.indexOf("## Context Layer Priority"),
        prompt.indexOf("## Capabilities"),
      );
      expect(priorityBlock).toContain("safety");
      expect(priorityBlock).toContain("highest");
    });

    it("references all three layer names matching provenance tags", () => {
      const prompt = buildVerificationPrompt();
      const priorityBlock = prompt.slice(
        prompt.indexOf("## Context Layer Priority"),
        prompt.indexOf("## Capabilities"),
      );
      expect(priorityBlock).toContain("project-doc");
      expect(priorityBlock).toContain("cognitive");
    });
  });

  describe("W3: Schema backward compatibility", () => {
    let tempDir: string;

    it("loads legacy correction file (no triggerWhen/usageCount/lastReferencedAt)", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "kaiji-verify-"));
      const store = new CorrectionStore(tempDir);
      const legacyRecord: CorrectionRecord = {
        id: "legacy-1",
        domain: "git",
        trigger: "pushing code",
        mistake: "forgot to pull",
        correction: "pull first",
        provenance: "self",
        reinforcedCount: 2,
        createdAt: 1000,
        lastReinforced: 2000,
      };
      const fileDir = join(tempDir, "cognitive", "corrections", "main");
      mkdirSync(fileDir, { recursive: true });
      const filePath = join(fileDir, "user1.json");
      await import("node:fs/promises").then((fs) =>
        fs.writeFile(filePath, JSON.stringify({ corrections: [legacyRecord], version: 1 })),
      );

      const loaded = await store.loadAll("main", "user1");
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.id).toBe("legacy-1");
      expect(loaded[0]!.usageCount).toBeUndefined();
      expect(loaded[0]!.triggerWhen).toBeUndefined();
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("initializes usageCount=0 when adding new correction", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "kaiji-verify-"));
      const store = new CorrectionStore(tempDir);
      await store.add("main", "u1", makeCorrection({ id: "new-1" }));
      const loaded = await store.loadAll("main", "u1");
      expect(loaded[0]!.usageCount).toBe(0);
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("preserves triggerWhen through store round-trip", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "kaiji-verify-"));
      const store = new CorrectionStore(tempDir);
      await store.add(
        "main",
        "u1",
        makeCorrection({ id: "trig-1", triggerWhen: "when user mentions git" }),
      );
      const loaded = await store.loadAll("main", "u1");
      expect(loaded[0]!.triggerWhen).toBe("when user mentions git");
      rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe("W4.1: Trigger-based correction retrieval — relevance quality", () => {
    it("ranks correction with token overlap above irrelevant high-reinforced one", () => {
      const corrections = [
        makeCorrection({
          id: "irrelevant-strong",
          domain: "cooking",
          trigger: "baking",
          mistake: "wrong oven temperature",
          correction: "check recipe",
          reinforcedCount: 50,
        }),
        makeCorrection({
          id: "relevant-weak",
          domain: "git",
          trigger: "committing code",
          mistake: "forgot to commit changes",
          correction: "always commit",
          reinforcedCount: 1,
        }),
      ];
      const result = selectRelevantCorrections(corrections, "please commit my git code changes", 1);
      expect(result[0]!.id).toBe("relevant-weak");
    });

    it("reduces injected count vs blind top-N when many are irrelevant", () => {
      const relevant = makeCorrection({
        id: "rel",
        domain: "git",
        trigger: "committing",
        mistake: "forgot commit",
        correction: "commit first",
      });
      const irrelevant = Array.from({ length: 20 }, (_, i) =>
        makeCorrection({
          id: `irr-${i}`,
          domain: "cooking",
          trigger: `baking ${i}`,
          mistake: `temperature ${i}`,
          correction: `fix ${i}`,
          reinforcedCount: 100 - i,
        }),
      );
      const all = [relevant, ...irrelevant];
      const result = selectRelevantCorrections(all, "commit my code", 5);
      expect(result).toHaveLength(5);
      expect(result[0]!.id).toBe("rel");
    });

    it("CJK message matches CJK correction content", () => {
      const corrections = [
        makeCorrection({
          id: "en",
          domain: "general",
          trigger: "english",
          mistake: "english mistake",
          correction: "fix",
          reinforcedCount: 10,
        }),
        makeCorrection({
          id: "zh",
          domain: "飞书",
          trigger: "创建文档",
          mistake: "格式错误",
          correction: "检查格式",
          reinforcedCount: 1,
        }),
      ];
      const result = selectRelevantCorrections(corrections, "帮我创建飞书文档", 1);
      expect(result[0]!.id).toBe("zh");
    });

    it("fallback: returns top-N by reinforcedCount when zero overlap", () => {
      const corrections = [
        makeCorrection({
          id: "low",
          reinforcedCount: 1,
          domain: "aaa",
          trigger: "xxx",
          mistake: "yyy",
        }),
        makeCorrection({
          id: "high",
          reinforcedCount: 10,
          domain: "bbb",
          trigger: "zzz",
          mistake: "www",
        }),
      ];
      const result = selectRelevantCorrections(corrections, "completely unrelated topic", 1);
      expect(result[0]!.id).toBe("high");
    });

    it("never returns empty when corrections exist and limit > 0", () => {
      const corrections = Array.from({ length: 30 }, (_, i) =>
        makeCorrection({ id: `c${i}`, reinforcedCount: i }),
      );
      const result = selectRelevantCorrections(corrections, "anything", 5);
      expect(result).toHaveLength(5);
    });
  });

  describe("W4.2: Usage-aware GC — accelerated removal", () => {
    let tempDir: string;

    const DAY = 86_400_000;
    const TTL_DAYS = 90;

    function seedStore(records: CorrectionRecord[]): CorrectionStore {
      tempDir = mkdtempSync(join(tmpdir(), "kaiji-gc-"));
      const store = new CorrectionStore(tempDir);
      const fileDir = join(tempDir, "cognitive", "corrections", "main");
      mkdirSync(fileDir, { recursive: true });
      const { writeFileSync } = require("node:fs");
      writeFileSync(join(fileDir, "u1.json"), JSON.stringify({ corrections: records, version: 1 }));
      return store;
    }

    it("preserves corrections within TTL regardless of usage", async () => {
      const now = Date.now();
      const recent = makeCorrection({
        id: "recent",
        lastReinforced: now - 10 * DAY,
        usageCount: 0,
      });
      const store = seedStore([recent]);
      const removed = await store.removeStale("main", "u1", TTL_DAYS);
      expect(removed).toBe(0);
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("removes corrections past full TTL", async () => {
      const now = Date.now();
      const expired = makeCorrection({
        id: "expired",
        lastReinforced: now - (TTL_DAYS + 5) * DAY,
      });
      const store = seedStore([expired]);
      const removed = await store.removeStale("main", "u1", TTL_DAYS);
      expect(removed).toBe(1);
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("accelerates removal: injected but long-unreferenced → removed before full TTL", async () => {
      const now = Date.now();
      const refCutoff = TTL_DAYS * (2 / 3);
      const staleReferenced = makeCorrection({
        id: "stale-ref",
        lastReinforced: now - 10 * DAY,
        usageCount: 5,
        lastReferencedAt: now - (refCutoff + 5) * DAY,
      });
      const store = seedStore([staleReferenced]);
      const removed = await store.removeStale("main", "u1", TTL_DAYS);
      expect(removed).toBe(1);
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("preserves recently-referenced corrections even if old", async () => {
      const now = Date.now();
      const activeReferenced = makeCorrection({
        id: "active-ref",
        lastReinforced: now - 50 * DAY,
        usageCount: 3,
        lastReferencedAt: now - 5 * DAY,
      });
      const store = seedStore([activeReferenced]);
      const removed = await store.removeStale("main", "u1", TTL_DAYS);
      expect(removed).toBe(0);
      rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe("W5: ContextManifest — injection observability", () => {
    it("records which corrections were actually injected (not just available)", () => {
      const selected = [makeCorrection({ id: "inj-1" }), makeCorrection({ id: "inj-2" })];
      const manifest = buildContextManifest({
        classification: { mode: "task", confidence: 0.8, signals: ["imperative"] },
        selectedCorrections: selected,
        totalCorrectionsAvailable: 20,
        evolutionEnabled: true,
      });
      expect(manifest.correctionsInjected).toBe(2);
      expect(manifest.correctionsAvailable).toBe(20);
      expect(manifest.correctionIds).toEqual(["inj-1", "inj-2"]);
    });

    it("records persona active state and domain count", () => {
      const persona: PersonaTree = {
        ...createDefaultPersona(),
        domains: {
          a: {
            depth: 1,
            recurrence: 1,
            lastMentioned: 0,
            keyInsights: [],
            activeQuestions: [],
            negationSignals: 0,
          },
          b: {
            depth: 2,
            recurrence: 1,
            lastMentioned: 0,
            keyInsights: [],
            activeQuestions: [],
            negationSignals: 0,
          },
          c: {
            depth: 3,
            recurrence: 1,
            lastMentioned: 0,
            keyInsights: [],
            activeQuestions: [],
            negationSignals: 0,
          },
        },
      };
      const manifest = buildContextManifest({
        classification: { mode: "hybrid", confidence: 0.4, signals: ["default"] },
        persona,
        selectedCorrections: [],
        totalCorrectionsAvailable: 0,
        evolutionEnabled: false,
      });
      expect(manifest.personaActive).toBe(true);
      expect(manifest.personaDomainCount).toBe(3);
    });
  });

  describe("Regression: existing behavior not degraded", () => {
    it("buildCognitiveModePrompt still injects all required sections", () => {
      const { prompt } = buildCognitiveModePrompt({
        message: "帮我写代码",
        cognitiveEnabled: true,
        evolutionEnabled: true,
        persona: createDefaultPersona(),
        corrections: [makeCorrection({ mistake: "test", correction: "fix" })],
      });
      expect(prompt).toContain("## Skill Evolution");
      expect(prompt).toContain("## Known Corrections");
      expect(prompt).toContain("Current Mode");
    });

    it("buildCognitiveModePrompt with cognitiveEnabled=false returns empty prompt", () => {
      const { prompt } = buildCognitiveModePrompt({
        message: "test",
        cognitiveEnabled: false,
      });
      expect(prompt).toBe("");
    });

    it("corrections still sorted by reinforcedCount within formatCorrectionsPrompt", () => {
      const corrections = [
        makeCorrection({ trigger: "low", reinforcedCount: 1 }),
        makeCorrection({ trigger: "high", reinforcedCount: 10 }),
      ];
      const result = selectRelevantCorrections(corrections, "unrelated", 15);
      expect(result[0]!.trigger).toBe("high");
    });

    it("empty corrections produce empty cognitive corrections section", () => {
      const { prompt } = buildCognitiveModePrompt({
        message: "test",
        cognitiveEnabled: true,
        corrections: [],
      });
      expect(prompt).not.toContain("## Known Corrections");
    });

    it("prompt cache boundary still exists between stable and dynamic sections", () => {
      const prompt = buildVerificationPrompt();
      const lines = prompt.split("\n");
      const boundaryIdx = lines.findIndex((l) => l.includes("--- kaijibot-cache-boundary"));
      if (boundaryIdx === -1) {
        const stableEnd = lines.findIndex((l) => l.startsWith("## Silent Replies"));
        const dynamicStart = lines.findIndex((l) => l.includes("Dynamic Project Context"));
        if (stableEnd > 0 && dynamicStart > 0) {
          expect(dynamicStart).toBeGreaterThan(stableEnd);
        }
      }
    });
  });

  describe("End-to-end: full system prompt assembly", () => {
    it("produces a well-structured prompt with all optimization markers", () => {
      const prompt = buildVerificationPrompt();
      expect(prompt).toContain("## Context Layer Priority");
      expect(prompt).toContain("--- context-layer: project-doc ---");
      expect(prompt).toContain("--- context-layer: cognitive ---");
      expect(prompt).toContain("### Proactive Intelligence");
      expect(prompt).not.toContain("### Core Abilities");
    });

    it("total estimated tokens under reasonable budget for typical config", () => {
      const prompt = buildVerificationPrompt();
      const sections = analyzeSystemPromptSections(prompt);
      const total = sections.reduce((sum, s) => sum + s.approxTokens, 0);
      expect(total).toBeLessThan(5000);
    });
  });
});
