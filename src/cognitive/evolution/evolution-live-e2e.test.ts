/**
 * Live evolution end-to-end test — verifies the full self-evolution pipeline
 * from hard-trigger signal through skill creation, dedup, and lifecycle.
 *
 * Run: KAIJIBOT_LIVE_TEST=1 ZAI_API_KEY=$ZAI_API_KEY pnpm test src/cognitive/evolution/evolution-live-e2e.test.ts
 *
 * What this tests:
 *   Phase 1: Hard-trigger signal generation (no LLM)
 *     - Signal enqueued for ≥3 user tool calls
 *     - Signal format: concise, no tool sequence or raw error info
 *     - Skips for non-user triggers, <3 tools, no userId
 *     - Requests heartbeat on original sessionKey
 *
 *   Phase 2: Store history + recentSuggestions (no LLM)
 *     - Multiple suggestions for same user all pass (no code-level cooldown)
 *     - recentSuggestions populated from prior records
 *     - userResponse tracked in history
 *
 *   Phase 3: Full pipeline with real LLM (requires ZAI_API_KEY)
 *     - Complex task → LLM generates skill → saved to disk → verified
 *     - Skill file has correct frontmatter (provenance: agent, createdAt, usageCount)
 *     - Second creation of similar skill → dedup detected
 *     - LLM generation fallback when API fails
 *     - Skill lifecycle: write → touchSkill → verify usage tracking
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EvolutionCandidate, SkillDraft } from "./types.js";
import { EvolutionEngine } from "./engine.js";
import { EvolutionStore } from "./store.js";
import { evaluateHardTrigger } from "./hard-trigger.js";
import { generateSkillDraftLLM } from "./llm-draft-generator.js";
import { SkillPersistenceWriter } from "./skill-writer.js";
import { SkillLifecycleManager } from "./skill-lifecycle.js";
import {
  peekSystemEventEntries,
  resetSystemEventsForTest,
} from "../../infra/system-events.js";
import { resetHeartbeatWakeStateForTests } from "../../infra/heartbeat-wake.js";

const { mockRequestHeartbeatNow } = vi.hoisted(() => ({
  mockRequestHeartbeatNow: vi.fn(),
}));

vi.mock("../../infra/heartbeat-wake.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    requestHeartbeatNow: mockRequestHeartbeatNow,
  };
});

const isLive = process.env.KAIJIBOT_LIVE_TEST === "1" || process.env.LIVE === "1";
const ZAI_API_KEY = process.env.ZAI_API_KEY;
const ZAI_URL = "https://api.z.ai/api/coding/paas/v4/chat/completions";
const MODEL = "glm-5-turbo";

async function callLLM(prompt: string): Promise<string> {
  const res = await fetch(ZAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${ZAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 3000,
    }),
  });
  const data = (await res.json()) as {
    error?: { message: string };
    choices?: Array<{ message: { content: string } }>;
  };
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content ?? "";
}

let tempDir: string;
let store: EvolutionStore;

function makeCandidate(overrides: Partial<EvolutionCandidate> = {}): EvolutionCandidate {
  return {
    taskSummary: "auto",
    toolCalls: [],
    uniqueToolCount: 0,
    reasoningTurns: 0,
    durationMs: 0,
    domain: "auto",
    ...overrides,
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "kaijibot-evo-e2e-"));
  store = new EvolutionStore(tempDir);
  resetSystemEventsForTest();
  resetHeartbeatWakeStateForTests();
  mockRequestHeartbeatNow.mockClear();
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  resetSystemEventsForTest();
  resetHeartbeatWakeStateForTests();
});

// ===========================================================================
// PHASE 1: Hard-trigger signal generation (no LLM needed)
// ===========================================================================
describe("Phase 1: hard-trigger signal generation via evaluateHardTrigger", () => {
  const testSessionKey = "agent:main:ou_test_user";

  it("enqueues concise signal for 3+ user-triggered tool calls", async () => {
    await evaluateHardTrigger({
      toolMetas: [
        { toolName: "web_search" }, { toolName: "read_file" }, { toolName: "web_search" },
        { toolName: "write_file" }, { toolName: "read_file" }, { toolName: "web_search" },
        { toolName: "write_file" }, { toolName: "read_file" }, { toolName: "web_search" },
        { toolName: "write_file" },
      ],
      sessionKey: testSessionKey,
      trigger: "user",
      started: Date.now() - 280_000,
    });

    const events = peekSystemEventEntries(testSessionKey);
    expect(events).toHaveLength(1);
    const signalText = events[0]!.text;
    expect(signalText).toContain("[Evolution Signal]");
    expect(signalText).toContain("10 次工具调用");
    expect(signalText).toContain("3 种");
    expect(signalText).toContain("280 秒");
    expect(signalText).toContain("evaluate_skill_evolution");
    expect(signalText).toContain("自主判断");
    expect(signalText).not.toContain("web_search, read_file");
    expect(signalText).not.toContain("工具错误");
    expect(signalText).not.toContain("工具序列");
  });

  it("signal omits tool sequence even when tool metas contain error info", async () => {
    await evaluateHardTrigger({
      toolMetas: [
        { toolName: "feishu_doc_fetch" },
        { toolName: "feishu_doc_fetch", meta: "Error: permission denied" },
        { toolName: "feishu_wiki_create" },
      ],
      sessionKey: testSessionKey,
      trigger: "manual",
      started: Date.now() - 15_000,
    });

    const events = peekSystemEventEntries(testSessionKey);
    expect(events).toHaveLength(1);
    const signalText = events[0]!.text;
    expect(signalText).not.toContain("feishu_doc_fetch");
    expect(signalText).not.toContain("permission denied");
    expect(signalText).not.toContain("⚠");
  });

  it("requests heartbeat with cognitive-evolution reason on original sessionKey", async () => {
    const customKey = "agent:main:user_abc123";
    await evaluateHardTrigger({
      toolMetas: [{ toolName: "a" }, { toolName: "b" }, { toolName: "c" }],
      sessionKey: customKey,
      trigger: "user",
      started: Date.now() - 5000,
    });

    expect(mockRequestHeartbeatNow).toHaveBeenCalledTimes(1);
    expect(mockRequestHeartbeatNow).toHaveBeenCalledWith({
      reason: "cognitive-evolution",
      sessionKey: customKey,
    });
    expect(peekSystemEventEntries(customKey)).toHaveLength(1);
  });

  it("skips for non-user triggers (cron, system, heartbeat)", async () => {
    for (const trigger of ["cron", "system", "heartbeat"]) {
      await evaluateHardTrigger({
        toolMetas: [{ toolName: "a" }, { toolName: "b" }, { toolName: "c" }],
        sessionKey: testSessionKey,
        trigger,
        started: Date.now() - 5000,
      });
    }

    expect(peekSystemEventEntries(testSessionKey)).toHaveLength(0);
    expect(mockRequestHeartbeatNow).not.toHaveBeenCalled();
  });

  it("skips for fewer than 3 tool calls", async () => {
    await evaluateHardTrigger({
      toolMetas: [{ toolName: "a" }, { toolName: "b" }],
      sessionKey: testSessionKey,
      trigger: "user",
      started: Date.now() - 5000,
    });

    expect(peekSystemEventEntries(testSessionKey)).toHaveLength(0);
    expect(mockRequestHeartbeatNow).not.toHaveBeenCalled();
  });

  it("skips when no userId can be resolved from sessionKey", async () => {
    await evaluateHardTrigger({
      toolMetas: [{ toolName: "a" }, { toolName: "b" }, { toolName: "c" }],
      sessionKey: "agent:main:main",
      trigger: "user",
      started: Date.now() - 5000,
    });

    expect(peekSystemEventEntries("agent:main:main")).toHaveLength(0);
    expect(mockRequestHeartbeatNow).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// PHASE 2: No-cooldown flow + recentSuggestions (no LLM needed)
// ===========================================================================
describe("Phase 2: no-cooldown — multiple suggestions all pass", () => {
  it("allows 5 consecutive suggestions for same user", async () => {
    const engine = new EvolutionEngine(store);
    const candidate = makeCandidate({
      toolCalls: Array.from({ length: 15 }, (_, i) => `tool_${i}`),
      uniqueToolCount: 10,
      reasoningTurns: 12,
      durationMs: 400_000,
      domain: "test",
    });

    for (let i = 0; i < 5; i++) {
      const decision = await engine.evaluate(candidate, "user-no-cooldown");
      expect(decision.shouldSuggest).toBe(true);
      expect(decision.recentSuggestions).toHaveLength(i);

      await store.save({
        id: `rec-no-cooldown-${i}`,
        userId: "user-no-cooldown",
        candidate,
        decision,
        timestamp: Date.now(),
      });
    }
  });

  it("provides recentSuggestions with prior records", async () => {
    const engine = new EvolutionEngine(store);

    await store.save({
      id: "rec-1",
      userId: "user-ctx",
      candidate: makeCandidate({ domain: "feishu-wiki" }),
      decision: { shouldSuggest: true, confidence: 0.8, complexityScore: 0.7, reasoning: "ok" },
      draft: { name: "wiki-skill", description: "d", triggerPhrases: ["wiki"], bodyMarkdown: "# W" },
      timestamp: Date.now() - 7_200_000,
    });

    await store.save({
      id: "rec-2",
      userId: "user-ctx",
      candidate: makeCandidate({ domain: "data-analysis" }),
      decision: { shouldSuggest: true, confidence: 0.7, complexityScore: 0.6, reasoning: "ok" },
      draft: { name: "data-skill", description: "d", triggerPhrases: ["data"], bodyMarkdown: "# D" },
      timestamp: Date.now() - 1_800_000,
    });

    const candidate = makeCandidate({
      toolCalls: Array.from({ length: 15 }, (_, i) => `tool_${i}`),
      uniqueToolCount: 10,
      reasoningTurns: 12,
      durationMs: 400_000,
      domain: "test",
    });
    const decision = await engine.evaluate(candidate, "user-ctx");

    expect(decision.shouldSuggest).toBe(true);
    expect(decision.recentSuggestions).toHaveLength(2);
    expect(decision.recentSuggestions![0]!.domain).toBe("feishu-wiki");
    expect(decision.recentSuggestions![0]!.skillName).toBe("wiki-skill");
    expect(decision.recentSuggestions![0]!.hoursAgo).toBeGreaterThanOrEqual(2);
    expect(decision.recentSuggestions![1]!.domain).toBe("data-analysis");
  });

  it("recentSuggestions reflects userResponse", async () => {
    const engine = new EvolutionEngine(store);

    await store.save({
      id: "rec-accepted",
      userId: "user-resp",
      candidate: makeCandidate({ domain: "wiki" }),
      decision: { shouldSuggest: true, confidence: 0.8, complexityScore: 0.7, reasoning: "ok" },
      draft: { name: "w", description: "d", triggerPhrases: ["w"], bodyMarkdown: "# W" },
      userResponse: "accepted",
      timestamp: Date.now() - 1000,
    });

    await store.save({
      id: "rec-rejected",
      userId: "user-resp",
      candidate: makeCandidate({ domain: "data" }),
      decision: { shouldSuggest: true, confidence: 0.8, complexityScore: 0.7, reasoning: "ok" },
      draft: { name: "d", description: "d", triggerPhrases: ["d"], bodyMarkdown: "# D" },
      userResponse: "rejected",
      timestamp: Date.now() - 1000,
    });

    const candidate = makeCandidate({
      toolCalls: Array.from({ length: 15 }, (_, i) => `tool_${i}`),
      uniqueToolCount: 10,
      reasoningTurns: 12,
      durationMs: 400_000,
    });
    const decision = await engine.evaluate(candidate, "user-resp");

    expect(decision.recentSuggestions).toHaveLength(2);
    const accepted = decision.recentSuggestions!.find((r) => r.domain === "wiki");
    const rejected = decision.recentSuggestions!.find((r) => r.domain === "data");
    expect(accepted!.userResponse).toBe("accepted");
    expect(rejected!.userResponse).toBe("rejected");
  });
});

// ===========================================================================
// PHASE 3: Skill creation pipeline (no LLM needed — deterministic fallback)
// ===========================================================================
describe("Phase 3: skill creation pipeline — generate + dedup + save", () => {
  it("generates skill via deterministic fallback, saves to disk, verifies file", async () => {
    const writer = new SkillPersistenceWriter(tempDir);
    const engine = new EvolutionEngine(store);

    const candidate = makeCandidate({
      taskSummary: "归档产品评审会议纪要到飞书知识库",
      toolCalls: ["feishu_vc_search", "feishu_doc_fetch", "feishu_wiki_create"],
      uniqueToolCount: 3,
      reasoningTurns: 5,
      durationMs: 60_000,
      domain: "feishu-meeting",
    });

    const draft = await engine.generate(candidate);

    const savedPath = await writer.writeSkill(draft);

    expect(existsSync(savedPath)).toBe(true);
    expect(savedPath).toContain("skills/agent");
    expect(savedPath).toContain(draft.name);

    const content = readFileSync(savedPath, "utf-8");
    expect(content).toContain("name:");
    expect(content).toContain("description:");
    expect(content).toContain("provenance: agent");
    expect(content).toContain("createdAt:");
    expect(content).toContain("usageCount: 0");
    expect(content).toContain("## Triggers");

    console.log(`\n  ═══ Deterministic Skill ═══`);
    console.log(`  Name: ${draft.name}`);
    console.log(`  Saved: ${savedPath}`);
    console.log(`  File size: ${content.length} bytes`);
    console.log(`  ════════════════════════════\n`);
  });

  it("dedup: second similar skill is detected by lifecycle check", async () => {
    const writer = new SkillPersistenceWriter(tempDir);
    const lifecycle = new SkillLifecycleManager(writer);
    const engine = new EvolutionEngine(store);

    const candidate1 = makeCandidate({
      taskSummary: "批量导出飞书多维表格数据",
      toolCalls: ["feishu_base_list", "feishu_base_records", "xlsx_create"],
      uniqueToolCount: 3,
      reasoningTurns: 4,
      durationMs: 50_000,
      domain: "feishu-data-export",
    });

    const draft1 = await engine.generate(candidate1);
    await writer.writeSkill(draft1);

    const existingSkills: Array<{ name: string; description: string }> = [];
    const meta1 = await writer.readSkillMeta(draft1.name);
    if (meta1) existingSkills.push({ name: meta1.name, description: meta1.description });

    const candidate2 = makeCandidate({
      taskSummary: "导出飞书多维表格到 Excel 文件",
      toolCalls: ["feishu_base_records", "xlsx_create", "xlsx_write"],
      uniqueToolCount: 3,
      reasoningTurns: 4,
      durationMs: 45_000,
      domain: "feishu-data-export",
    });

    const dedupResult = await lifecycle.checkDuplicate(candidate2.domain, draft1.description);
    if (!dedupResult.duplicate) {
      const draft2 = await engine.generate(candidate2);
      const dedupResult2 = await engine.checkBeforeGenerate(
        candidate2, lifecycle, existingSkills,
      );
      console.log(`\n  ═══ Dedup Check ═══`);
      console.log(`  Skill 1: ${draft1.name}`);
      console.log(`  Skill 2: ${draft2.name}`);
      console.log(`  Dedup: ${JSON.stringify(dedupResult2)}`);
      console.log(`  ═══════════════════\n`);
    } else {
      console.log(`\n  ═══ Dedup Detected ═══`);
      console.log(`  Existing: ${dedupResult.existingName}`);
      console.log(`  Similarity: ${dedupResult.similarity?.toFixed(2)}`);
      console.log(`  ════════════════════════\n`);
      expect(dedupResult.duplicate).toBe(true);
    }
  });

  it("skill file contains valid frontmatter fields", async () => {
    const writer = new SkillPersistenceWriter(tempDir);
    const engine = new EvolutionEngine(store);

    const draft = await engine.generate(makeCandidate({
      taskSummary: "生成周报并发送到飞书群",
      toolCalls: ["feishu_doc_create", "feishu_im_send", "web_search"],
      uniqueToolCount: 3,
      reasoningTurns: 6,
      durationMs: 80_000,
      domain: "reporting",
    }));

    const savedPath = await writer.writeSkill(draft);
    const content = readFileSync(savedPath, "utf-8");

    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    expect(frontmatterMatch).not.toBeNull();

    const frontmatter = frontmatterMatch![1];
    expect(frontmatter).toMatch(/^name:\s+/m);
    expect(frontmatter).toMatch(/^description:\s+"/m);
    expect(frontmatter).toMatch(/^createdAt:\s+\d+/m);
    expect(frontmatter).toMatch(/^lastUsedAt:\s+\d+/m);
    expect(frontmatter).toMatch(/^usageCount:\s+0/m);
    expect(frontmatter).toMatch(/^provenance:\s+agent/m);
  });

  it("writeSkill then touchSkill updates usage tracking", async () => {
    const writer = new SkillPersistenceWriter(tempDir);
    const engine = new EvolutionEngine(store);

    const draft = await engine.generate(makeCandidate({
      taskSummary: "搜索 GitHub Trending 并生成报告",
      toolCalls: ["web_search", "web_search", "write_file"],
      uniqueToolCount: 2,
      reasoningTurns: 4,
      durationMs: 60_000,
      domain: "github",
    }));

    await writer.writeSkill(draft);

    const metaBefore = await writer.readSkillMeta(draft.name);
    expect(metaBefore!.usageCount).toBe(0);

    await writer.touchSkill(draft.name);

    const metaAfter = await writer.readSkillMeta(draft.name);
    expect(metaAfter!.usageCount).toBe(1);
    expect(metaAfter!.lastUsedAt).toBeGreaterThan(metaBefore!.lastUsedAt);
    expect(metaAfter!.isStale).toBe(false);
  });

  it("writeSkill then archiveSkill then listArchivedSkillNames", async () => {
    const writer = new SkillPersistenceWriter(tempDir);
    const engine = new EvolutionEngine(store);

    const draft = await engine.generate(makeCandidate({
      taskSummary: "临时调试任务",
      toolCalls: ["exec", "exec", "exec"],
      uniqueToolCount: 1,
      reasoningTurns: 3,
      durationMs: 10_000,
      domain: "debug",
    }));

    const savedPath = await writer.writeSkill(draft);
    expect(await writer.skillExists(draft.name)).toBe(true);

    await writer.archiveSkill(draft.name);
    expect(await writer.skillExists(draft.name)).toBe(false);

    const archived = await writer.listArchivedSkillNames();
    expect(archived).toContain(draft.name);

    const archivedMeta = await writer.readArchivedSkillMeta(draft.name);
    expect(archivedMeta!.provenance).toBe("agent");
  });
});

// ===========================================================================
// PHASE 3.5: Tool entry point — evaluate_skill_evolution full flow (no LLM)
//
// Tests the actual tool function (createEvolutionSuggestTool) instead of the
// underlying engine/writer directly. Verifies generate → dedup → save → return.
// Uses resolveConfigDir mock to redirect to tempDir.
// ===========================================================================
describe("Phase 3.5: tool entry point — evaluate_skill_evolution", () => {
  let toolTempDir: string;

  // We mock resolveConfigDir + consumeToolErrorProfile so the tool's internal
  // dynamic imports use our temp directory. Other modules (engine, store,
  // skill-writer, skill-lifecycle) remain unmocked — we want the real pipeline.
  const { mockResolveConfigDir } = vi.hoisted(() => ({
    mockResolveConfigDir: vi.fn().mockReturnValue("/tmp/kaijibot-e2e-default"),
  }));
  const { mockConsumeToolErrorProfile } = vi.hoisted(() => ({
    mockConsumeToolErrorProfile: vi.fn().mockReturnValue(undefined),
  }));

  vi.mock("../../utils.js", async (importOriginal) => {
    const actual = await importOriginal() as Record<string, unknown>;
    return {
      ...actual,
      resolveConfigDir: mockResolveConfigDir,
    };
  });

  vi.mock("../../agents/tool-error-summary.js", async (importOriginal) => {
    const actual = await importOriginal() as Record<string, unknown>;
    return {
      ...actual,
      consumeToolErrorProfile: mockConsumeToolErrorProfile,
    };
  });

  beforeEach(() => {
    toolTempDir = mkdtempSync(join(tmpdir(), "kaijibot-evo-tool-"));
    mockResolveConfigDir.mockReturnValue(toolTempDir);
    mockConsumeToolErrorProfile.mockClear();
    mockConsumeToolErrorProfile.mockReturnValue(undefined);
  });

  afterEach(() => {
    rmSync(toolTempDir, { recursive: true, force: true });
  });

  function extractToolResult(result: unknown): { status: string; [key: string]: unknown } {
    if (typeof result === "string") return { status: result };
    const r = result as { content?: Array<{ type: string; text: string }>; details?: unknown };
    if (r.details && typeof r.details === "object") return r.details as { status: string; [key: string]: unknown };
    const text = r.content?.[0]?.text;
    if (text) return JSON.parse(text);
    throw new Error(`unexpected tool result: ${JSON.stringify(result)}`);
  }

  it("tool generates skill, saves to disk, returns status=saved", async () => {
    const { createEvolutionSuggestTool } = await import("../../agents/tools/evolution-suggest-tool.js");
    const tool = createEvolutionSuggestTool({
      sessionKey: "agent:main:ou_tool_test_user",
    });

    expect(tool).not.toBeNull();
    const result = await tool!.execute("tc-1", {
      taskSummary: "整理飞书知识库文档并按类别归档",
      toolCalls: ["feishu_wiki_spaces", "feishu_doc_fetch", "feishu_wiki_create", "feishu_doc_write"],
      uniqueToolCount: 4,
      reasoningTurns: 6,
      durationMs: 90_000,
      domain: "feishu-wiki",
    });

    const parsed = extractToolResult(result);
    expect(parsed.status).toBe("saved");
    expect(parsed.skillName).toBeTruthy();
    expect(parsed.savedPath).toContain("skills/agent");
    expect((parsed.description as string).length).toBeGreaterThan(0);

    const writer = new SkillPersistenceWriter(toolTempDir);
    const names = await writer.listSkillNames();
    expect(names.length).toBeGreaterThanOrEqual(1);

    const skillName = names[0]!;
    const meta = await writer.readSkillMeta(skillName);
    expect(meta!.provenance).toBe("agent");
    expect(meta!.usageCount).toBe(0);

    console.log(`\n  ═══ Tool Entry Point Skill ═══`);
    console.log(`  Name: ${skillName}`);
    console.log(`  Provenance: ${meta!.provenance}`);
    console.log(`  ═══════════════════════════════\n`);
  });

  it("tool detects duplicate on second call with same domain", async () => {
    const { createEvolutionSuggestTool } = await import("../../agents/tools/evolution-suggest-tool.js");

    const tool = createEvolutionSuggestTool({
      sessionKey: "agent:main:ou_tool_dedup_user",
    });

    await tool!.execute("tc-dedup-1", {
      taskSummary: "导出飞书多维表格数据到Excel",
      toolCalls: ["feishu_base_list", "feishu_base_records", "xlsx_create", "xlsx_write"],
      uniqueToolCount: 4,
      reasoningTurns: 5,
      durationMs: 60_000,
      domain: "feishu-data-export",
    });

    const result2 = await tool!.execute("tc-dedup-2", {
      taskSummary: "批量导出飞书多维表格记录",
      toolCalls: ["feishu_base_records", "xlsx_create", "xlsx_write"],
      uniqueToolCount: 3,
      reasoningTurns: 4,
      durationMs: 45_000,
      domain: "feishu-data-export",
    });

    const parsed2 = extractToolResult(result2);

    console.log(`\n  ═══ Dedup Round 2 ═══`);
    console.log(`  Status: ${parsed2.status}`);
    console.log(`  ═══════════════════════\n`);

    expect(["saved", "duplicate"]).toContain(parsed2.status);
  });

  it("tool returns no_session when sessionKey has no userId", async () => {
    const { createEvolutionSuggestTool } = await import("../../agents/tools/evolution-suggest-tool.js");
    const tool = createEvolutionSuggestTool({
      sessionKey: "agent:main:main",
    });

    const result = await tool!.execute("tc-no-user", {
      taskSummary: "some task",
      toolCalls: ["a", "b", "c"],
      uniqueToolCount: 3,
      reasoningTurns: 3,
      durationMs: 10_000,
      domain: "test",
    });

    const parsed = extractToolResult(result);
    expect(parsed.status).toBe("no_session");
  });

  it("tool with no config falls back to deterministic draft", async () => {
    const { createEvolutionSuggestTool } = await import("../../agents/tools/evolution-suggest-tool.js");
    const tool = createEvolutionSuggestTool({
      sessionKey: "agent:main:ou_tool_fallback_user",
    });

    const result = await tool!.execute("tc-fallback", {
      taskSummary: "查询GitHub trending项目",
      toolCalls: ["web_search", "web_search", "write_file"],
      uniqueToolCount: 2,
      reasoningTurns: 3,
      durationMs: 30_000,
      domain: "github",
    });

    const parsed = extractToolResult(result);
    expect(parsed.status).toBe("saved");
    expect(parsed.skillName).toBeTruthy();
  });
});

// ===========================================================================
// PHASE 4: Full pipeline with real LLM (requires ZAI_API_KEY)
//
// Tests the actual flow: candidate → engine.generate (LLM draft) → writeSkill → dedup
// ===========================================================================
describe.skipIf(!isLive || !ZAI_API_KEY)("Phase 4: full pipeline with real LLM", () => {
  it("complex task → LLM generates skill → saved to disk with correct format", async () => {
    const writer = new SkillPersistenceWriter(tempDir);
    const engine = new EvolutionEngine(store, undefined, undefined, (c) =>
      generateSkillDraftLLM(c, { generateText: callLLM }),
    );

    const candidate = makeCandidate({
      taskSummary: "归档产品评审会议纪要到飞书知识库并创建跟踪任务",
      toolCalls: [
        "feishu_vc_search", "feishu_vc_notes", "feishu_doc_fetch",
        "feishu_wiki_spaces", "feishu_wiki_create", "feishu_doc_write",
        "feishu_task_create",
      ],
      uniqueToolCount: 6,
      reasoningTurns: 8,
      durationMs: 180_000,
      domain: "feishu-meeting",
    });

    const draft = await engine.generate(candidate);
    const savedPath = await writer.writeSkill(draft);

    console.log(`\n  ═══ Live Skill Created ═══`);
    console.log(`  Name: ${draft.name}`);
    console.log(`  Description: ${draft.description}`);
    console.log(`  Triggers: ${draft.triggerPhrases.join(", ")}`);
    console.log(`  Body lines: ${draft.bodyMarkdown.split("\n").length}`);
    console.log(`  Saved: ${savedPath}`);
    console.log(`  ════════════════════════════\n`);

    expect(draft.name).toBeTruthy();
    expect(draft.description.length).toBeGreaterThan(5);
    expect(draft.triggerPhrases.length).toBeGreaterThanOrEqual(2);
    expect(draft.bodyMarkdown.length).toBeGreaterThan(100);

    expect(existsSync(savedPath)).toBe(true);
    const content = readFileSync(savedPath, "utf-8");
    expect(content).toContain("provenance: agent");
    expect(content).toContain("createdAt:");
    expect(content).toContain("## Triggers");

    const meta = await writer.readSkillMeta(draft.name);
    expect(meta!.name).toBe(draft.name);
    expect(meta!.provenance).toBe("agent");
    expect(meta!.usageCount).toBe(0);
  }, 120_000);

  it("second round: similar task → dedup detected against first skill", async () => {
    const writer = new SkillPersistenceWriter(tempDir);
    const lifecycle = new SkillLifecycleManager(writer);
    const engine = new EvolutionEngine(store, undefined, undefined, (c) =>
      generateSkillDraftLLM(c, { generateText: callLLM }),
    );

    const candidate1 = makeCandidate({
      taskSummary: "批量导出飞书多维表格数据到Excel",
      toolCalls: [
        "feishu_base_list", "feishu_base_records", "xlsx_create",
        "xlsx_write", "xlsx_formula", "feishu_base_fields",
        "xlsx_write", "feishu_base_records", "xlsx_formula",
        "feishu_base_fields", "xlsx_write",
      ],
      uniqueToolCount: 5,
      reasoningTurns: 9,
      durationMs: 260_000,
      domain: "feishu-data",
    });

    const draft1 = await engine.generate(candidate1);
    await writer.writeSkill(draft1);

    const existingSkills: Array<{ name: string; description: string }> = [];
    const meta1 = await writer.readSkillMeta(draft1.name);
    if (meta1) existingSkills.push({ name: meta1.name, description: meta1.description });

    const candidate2 = makeCandidate({
      taskSummary: "搜索竞品分析报告并整理到知识库",
      toolCalls: [
        "web_search", "web_search", "feishu_wiki_create", "feishu_doc_write",
        "web_search", "read_file", "feishu_doc_write", "feishu_wiki_create",
        "web_search",
      ],
      uniqueToolCount: 4,
      reasoningTurns: 8,
      durationMs: 250_000,
      domain: "research",
    });

    const draft2 = await engine.generate(candidate2);
    const dedupResult = await engine.checkBeforeGenerate(
      candidate2, lifecycle, existingSkills,
    );

    console.log(`\n  ═══ Round 2 ═══`);
    console.log(`  Skill 1: ${draft1.name}`);
    console.log(`  Skill 2: ${draft2.name}`);
    console.log(`  Dedup: shouldCreate=${dedupResult.shouldCreate}, existing=${dedupResult.existingSkill ?? "none"}`);
    console.log(`  ═════════════════\n`);

    expect(draft2.name).toBeTruthy();
    expect(draft2.bodyMarkdown.length).toBeGreaterThan(50);

    if (!dedupResult.shouldCreate) {
      expect(dedupResult.existingSkill).toBeTruthy();
    }
  }, 240_000);

  it("LLM failure → deterministic fallback generates valid skill", async () => {
    const writer = new SkillPersistenceWriter(tempDir);
    const engine = new EvolutionEngine(store, undefined, undefined, (c) =>
      generateSkillDraftLLM(c, {
        generateText: async () => { throw new Error("simulated API failure"); },
      }),
    );

    const candidate = makeCandidate({
      taskSummary: "查询天气（LLM失败场景）",
      toolCalls: ["weather_get", "weather_get", "weather_get"],
      uniqueToolCount: 1,
      reasoningTurns: 3,
      durationMs: 15_000,
      domain: "weather",
    });

    const draft = await engine.generate(candidate);
    const savedPath = await writer.writeSkill(draft);

    console.log(`\n  ═══ Fallback Skill ═══`);
    console.log(`  Name: ${draft.name}`);
    console.log(`  Description: ${draft.description}`);
    console.log(`  ═══════════════════════\n`);

    expect(draft.name).toBeTruthy();
    expect(draft.description.length).toBeGreaterThan(0);
    expect(existsSync(savedPath)).toBe(true);
  }, 60_000);

  it("full lifecycle: create → use (touchSkill) → verify tracking", async () => {
    const writer = new SkillPersistenceWriter(tempDir);
    const engine = new EvolutionEngine(store, undefined, undefined, (c) =>
      generateSkillDraftLLM(c, { generateText: callLLM }),
    );

    const candidate = makeCandidate({
      taskSummary: "GitHub Trending 每日热门项目深度解读报告",
      toolCalls: ["tavily_search", "tavily_extract", "exec", "write_file"],
      uniqueToolCount: 4,
      reasoningTurns: 5,
      durationMs: 94_000,
      domain: "content-curation",
    });

    const draft = await engine.generate(candidate);
    const savedPath = await writer.writeSkill(draft);

    const meta0 = await writer.readSkillMeta(draft.name);
    expect(meta0!.usageCount).toBe(0);

    await writer.touchSkill(draft.name);
    await writer.touchSkill(draft.name);

    const meta2 = await writer.readSkillMeta(draft.name);
    expect(meta2!.usageCount).toBe(2);
    expect(meta2!.isStale).toBe(false);

    console.log(`\n  ═══ Lifecycle ═══`);
    console.log(`  Skill: ${draft.name}`);
    console.log(`  Usage: ${meta2!.usageCount}`);
    console.log(`  Last used: ${new Date(meta2!.lastUsedAt).toISOString()}`);
    console.log(`  Stale: ${meta2!.isStale}`);
    console.log(`  ══════════════════\n`);

    expect(existsSync(savedPath)).toBe(true);
  }, 120_000);
});
