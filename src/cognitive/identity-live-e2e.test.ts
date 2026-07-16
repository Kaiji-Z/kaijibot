/**
 * Live e2e test for the cognitive identity system.
 *
 * Run: KAIJIBOT_LIVE_TEST=1 pnpm test src/cognitive/identity-live-e2e.test.ts
 *
 * Phase 1 (no LLM): resolveCognitiveUserId + stores + consolidation + dmScope
 * Phase 2 (LLM):    full evolution pipeline for operator session
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetHeartbeatWakeStateForTests } from "../infra/heartbeat-wake.js";
import { peekSystemEventEntries, resetSystemEventsForTest } from "../infra/system-events.js";

const isLive = process.env.KAIJIBOT_LIVE_TEST === "1" || process.env.LIVE === "1";
const ZAI_API_KEY = process.env.ZAI_API_KEY;

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "cognitive-identity-e2e-"));
  resetSystemEventsForTest();
  resetHeartbeatWakeStateForTests();
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  resetSystemEventsForTest();
  resetHeartbeatWakeStateForTests();
});

// ===========================================================================
// Phase 1: Unified resolver + stores (no LLM)
// ===========================================================================
describe("Phase 1: resolveCognitiveUserId end-to-end with stores", () => {
  it("operator session: persona store creates file at persona/{agentId}/operator.json", async () => {
    const { resolveCognitiveUserId, OPERATOR_USER_ID } = await import("./identity.js");
    const { PersonaStore, createDefaultPersona } = await import("./persona/store.js");

    const sessionKey = "agent:main:main";
    const userId = resolveCognitiveUserId(sessionKey);
    expect(userId).toBe(OPERATOR_USER_ID);

    const store = new PersonaStore(tempDir);
    const persona = createDefaultPersona();
    await store.save("main", userId!, persona);

    const filePath = join(tempDir, "cognitive", "persona", "main", "operator.json");
    expect(existsSync(filePath)).toBe(true);

    const loaded = await store.load("main", userId!);
    expect(loaded).toBeDefined();
  });

  it("operator session: correction store creates file at corrections/main/operator.json", async () => {
    const { resolveCognitiveUserId } = await import("./identity.js");
    const { CorrectionStore } = await import("./correction/store.js");

    const userId = resolveCognitiveUserId("agent:main:main");
    expect(userId).toBe("operator");

    const store = new CorrectionStore(tempDir);
    await store.addOrReinforce("main", userId!, {
      id: "corr-test-1",
      domain: "test",
      trigger: "test trigger",
      mistake: "did wrong thing",
      correction: "do right thing",
      provenance: "self",
      reinforcedCount: 1,
      createdAt: Date.now(),
      lastReinforced: Date.now(),
    });

    const filePath = join(tempDir, "cognitive", "corrections", "main", "operator.json");
    expect(existsSync(filePath)).toBe(true);

    const active = await store.listActive("main", userId!);
    expect(active).toHaveLength(1);
    expect(active[0]!.mistake).toBe("did wrong thing");
  });

  it("operator session: evolution store creates file at evolution/main/operator.json", async () => {
    const { resolveCognitiveUserId } = await import("./identity.js");
    const { EvolutionStore } = await import("./evolution/store.js");

    const userId = resolveCognitiveUserId("agent:main:main");
    const store = new EvolutionStore(tempDir);
    await store.save("main", {
      id: "evo-test-1",
      userId: userId!,
      candidate: {
        taskSummary: "test",
        toolCalls: [],
        uniqueToolCount: 0,
        reasoningTurns: 0,
        durationMs: 0,
        domain: "test",
      },
      timestamp: Date.now(),
    });

    const filePath = join(tempDir, "cognitive", "evolution", "main", "operator.json");
    expect(existsSync(filePath)).toBe(true);
  });

  it("multi-agent: operator persona isolated per agentId", async () => {
    const { resolveCognitiveUserId } = await import("./identity.js");
    const { PersonaStore, createDefaultPersona } = await import("./persona/store.js");

    const store = new PersonaStore(tempDir);

    // main agent
    const mainUserId = resolveCognitiveUserId("agent:main:main");
    const mainPersona = createDefaultPersona();
    await store.save("main", mainUserId!, mainPersona);

    // beta agent
    const betaUserId = resolveCognitiveUserId("agent:beta:main");
    const betaPersona = createDefaultPersona();
    await store.save("beta", betaUserId!, betaPersona);

    // Verify isolation
    const mainFile = join(tempDir, "cognitive", "persona", "main", "operator.json");
    const betaFile = join(tempDir, "cognitive", "persona", "beta", "operator.json");
    expect(existsSync(mainFile)).toBe(true);
    expect(existsSync(betaFile)).toBe(true);

    const loadedMain = await store.load("main", mainUserId!);
    const loadedBeta = await store.load("beta", betaUserId!);
    expect(loadedMain).toBeDefined();
    expect(loadedBeta).toBeDefined();
  });

  it("feishu user: persona stored at persona/main/ou_xxx.json (not operator)", async () => {
    const { resolveCognitiveUserId } = await import("./identity.js");
    const { PersonaStore, createDefaultPersona } = await import("./persona/store.js");

    const userId = resolveCognitiveUserId("agent:main:feishu:direct:ou_alice");
    expect(userId).toBe("ou_alice");

    const store = new PersonaStore(tempDir);
    const persona = createDefaultPersona();
    await store.save("main", userId!, persona);

    const operatorFile = join(tempDir, "cognitive", "persona", "main", "operator.json");
    const aliceFile = join(tempDir, "cognitive", "persona", "main", "ou_alice.json");
    expect(existsSync(operatorFile)).toBe(false);
    expect(existsSync(aliceFile)).toBe(true);
  });

  it("wechat userId: channel-agnostic resolution", async () => {
    const { resolveCognitiveUserId } = await import("./identity.js");
    expect(resolveCognitiveUserId("agent:main:wechat:direct:wx_charlie")).toBe("wx_charlie");
  });

  it("group session without sender: returns null", async () => {
    const { resolveCognitiveUserId } = await import("./identity.js");
    expect(resolveCognitiveUserId("agent:main:feishu:group:oc_xyz")).toBeNull();
  });

  it("group session with sender: resolves sender userId", async () => {
    const { resolveCognitiveUserId } = await import("./identity.js");
    expect(resolveCognitiveUserId("agent:main:feishu:group:oc_xyz:sender:ou_bob")).toBe("ou_bob");
  });

  it("senderId takes priority over sessionKey", async () => {
    const { resolveCognitiveUserId } = await import("./identity.js");
    expect(resolveCognitiveUserId("agent:main:main", "ou_feishu_user")).toBe("ou_feishu_user");
    expect(resolveCognitiveUserId("agent:main:feishu:direct:ou_x", "kaijibot-tui")).toBe(
      "operator",
    );
  });
});

// ===========================================================================
// Phase 1b: Hard-trigger with operator session (no LLM)
// ===========================================================================
describe("Phase 1b: hard-trigger fires for operator session", () => {
  it("evaluateHardTrigger enqueues signal for operator main session", async () => {
    const { evaluateHardTrigger } = await import("./evolution/hard-trigger.js");
    const sessionKey = "agent:main:main";

    await evaluateHardTrigger({
      toolMetas: [
        { toolName: "read_file" },
        { toolName: "web_search" },
        { toolName: "write_file" },
      ],
      sessionKey,
      trigger: "user",
      senderId: "operator",
      started: Date.now() - 5000,
      configDir: tempDir,
    });

    const events = peekSystemEventEntries(sessionKey);
    expect(events).toHaveLength(1);
    expect(events[0]!.text).toContain("[Evolution Signal]");
  });

  it("evaluateHardTrigger skips group session without sender", async () => {
    const { evaluateHardTrigger } = await import("./evolution/hard-trigger.js");
    const sessionKey = "agent:main:feishu:group:oc_nosender";

    await evaluateHardTrigger({
      toolMetas: [{ toolName: "a" }, { toolName: "b" }, { toolName: "c" }],
      sessionKey,
      trigger: "user",
      started: Date.now(),
    });

    expect(peekSystemEventEntries(sessionKey)).toHaveLength(0);
  });
});

// ===========================================================================
// Phase 1c: Consolidation resolves operator from main session (no LLM)
// ===========================================================================
describe("Phase 1c: consolidation resolves operator userId", () => {
  it("resolveUserIdForSessionFile returns 'operator' for main session", async () => {
    const { resolveUserIdForSessionFile } =
      await import("../memory-host-sdk/consolidation-userid.js");

    const sessionsDir = join(tempDir, "sessions", "main");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(
      join(sessionsDir, "sessions.json"),
      JSON.stringify({ "agent:main:main": { sessionId: "session-op" } }),
    );
    writeFileSync(join(sessionsDir, "session-op.jsonl"), "");

    const userId = await resolveUserIdForSessionFile(join(sessionsDir, "session-op.jsonl"));
    expect(userId).toBe("operator");
  });

  it("resolveUserIdForSessionFile resolves wechat userId (channel-agnostic)", async () => {
    const { resolveUserIdForSessionFile } =
      await import("../memory-host-sdk/consolidation-userid.js");

    const sessionsDir = join(tempDir, "sessions", "main");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(
      join(sessionsDir, "sessions.json"),
      JSON.stringify({ "agent:main:wechat:direct:wx_dan": { sessionId: "session-wx" } }),
    );
    writeFileSync(join(sessionsDir, "session-wx.jsonl"), "");

    const userId = await resolveUserIdForSessionFile(join(sessionsDir, "session-wx.jsonl"));
    expect(userId).toBe("wx_dan");
  });
});

// ===========================================================================
// Phase 1d: dmScope adaptive (no LLM)
// ===========================================================================
describe("Phase 1d: resolveEffectiveDmScope adaptive promotion", () => {
  it("promotes main→per-peer when feishu channel configured", async () => {
    const { resolveEffectiveDmScope } = await import("../routing/session-key.js");
    const result = resolveEffectiveDmScope({
      session: { dmScope: "main" },
      channels: { feishu: { appId: "cli_x", appSecret: "secret" } },
    });
    expect(result).toBe("per-peer");
  });

  it("keeps main when no channels configured", async () => {
    const { resolveEffectiveDmScope } = await import("../routing/session-key.js");
    expect(resolveEffectiveDmScope({ session: { dmScope: "main" } })).toBe("main");
  });

  it("respects explicit per-channel-peer", async () => {
    const { resolveEffectiveDmScope } = await import("../routing/session-key.js");
    const result = resolveEffectiveDmScope({
      session: { dmScope: "per-channel-peer" },
      channels: { feishu: { appId: "x" } },
    });
    expect(result).toBe("per-channel-peer");
  });

  it("promotes when wechat configured", async () => {
    const { resolveEffectiveDmScope } = await import("../routing/session-key.js");
    expect(
      resolveEffectiveDmScope({
        session: {},
        channels: { wechat: { appId: "wx_x", token: "t" } },
      }),
    ).toBe("per-peer");
  });
});

// ===========================================================================
// Phase 1e: Correction backward compat (no LLM)
// ===========================================================================
describe("Phase 1e: resolveCorrectionUserId backward compat", () => {
  it("deliveryTo strips user: prefix", async () => {
    const { resolveCorrectionUserId } = await import("./correction/userid.js");
    expect(resolveCorrectionUserId(undefined, "user:ou_abc")).toBe("ou_abc");
  });

  it("deliveryTo strips feishu: prefix", async () => {
    const { resolveCorrectionUserId } = await import("./correction/userid.js");
    expect(resolveCorrectionUserId(undefined, "feishu:ou_abc")).toBe("ou_abc");
  });

  it("sessionKey fallback resolves operator from main", async () => {
    const { resolveCorrectionUserId } = await import("./correction/userid.js");
    expect(resolveCorrectionUserId("agent:main:main")).toBe("operator");
  });

  it("sessionKey fallback resolves feishu userId", async () => {
    const { resolveCorrectionUserId } = await import("./correction/userid.js");
    expect(resolveCorrectionUserId("agent:main:feishu:direct:ou_x")).toBe("ou_x");
  });
});

// ===========================================================================
// Phase 2: Full evolution pipeline for operator (requires LLM)
// ===========================================================================
describe.skipIf(!isLive || !ZAI_API_KEY)(
  "Phase 2: evolution pipeline for operator session (LLM)",
  () => {
    it("operator session: hard-trigger → evolution tool → skill saved under operator path", async () => {
      const { evaluateHardTrigger } = await import("./evolution/hard-trigger.js");
      const { createEvolutionSuggestTool } =
        await import("../agents/tools/evolution-suggest-tool.js");
      const { SkillPersistenceWriter } = await import("./evolution/skill-writer.js");

      const sessionKey = "agent:main:main";

      // Step 1: hard-trigger
      await evaluateHardTrigger({
        toolMetas: [
          { toolName: "read_file" },
          { toolName: "web_search" },
          { toolName: "write_file" },
        ],
        sessionKey,
        trigger: "user",
        senderId: "operator",
        started: Date.now() - 10_000,
        configDir: tempDir,
      });

      expect(peekSystemEventEntries(sessionKey)).toHaveLength(1);

      // Step 2: evolution tool creates skill
      const tool = createEvolutionSuggestTool({
        sessionKey,
        deliveryTo: "operator",
        config: { cognitive: { enabled: true, evolution: { enabled: true } } },
      });
      expect(tool).not.toBeNull();

      const result = await tool!.execute("tc-op-evo", {
        taskSummary: "Read a file, search the web, then write results to a file",
        toolCalls: ["read_file", "web_search", "write_file"],
        uniqueToolCount: 3,
        reasoningTurns: 2,
        durationMs: 10_000,
        domain: "file-processing",
        transcript: "User asked to read config, search for updates, and save results.",
      });

      const content = Array.isArray(result.content)
        ? (result.content.find((c): c is { type: "text"; text: string } => c.type === "text")
            ?.text ?? "")
        : String(result.content);
      const parsed = JSON.parse(content) as { status?: string };
      expect(["saved", "duplicate", "quality_rejected"]).toContain(parsed.status);
      expect(parsed.status).not.toBe("no_session");

      // Step 3: verify skill saved to disk (only when accepted)
      if (parsed.status === "saved" || parsed.status === "duplicate") {
        const writer = new SkillPersistenceWriter(tempDir);
        const skills = await writer.listSkillNames();
        expect(skills.length).toBeGreaterThan(0);
      }
    });
  },
);

// ===========================================================================
// Phase 1f: Insight delivery via heartbeat (no LLM)
// ===========================================================================
describe("Phase 1f: insight heartbeat delivery chain", () => {
  it("isInsightEvent detects [Cognitive Insight] marker", async () => {
    const { isInsightEvent } = await import("../infra/heartbeat-events-filter.js");
    expect(isInsightEvent("System: [ts] [Cognitive Insight] some insight text")).toBe(true);
    expect(isInsightEvent("[Evolution Signal] something")).toBe(false);
    expect(isInsightEvent("regular message")).toBe(false);
  });

  it("buildInsightEventPrompt returns non-empty relay instruction", async () => {
    const { buildInsightEventPrompt } = await import("../infra/heartbeat-events-filter.js");
    const prompt = buildInsightEventPrompt();
    expect(prompt).toContain("洞察");
    expect(prompt.length).toBeGreaterThan(20);
  });

  it("enqueueSystemEvent + drainFormattedSystemEvents produces correct format", async () => {
    const { enqueueSystemEvent } = await import("../infra/system-events.js");

    const sessionKey = "agent:main:main";
    const insightText = "你最近关注的 Rust 和嵌入式有个交叉点值得看看";
    enqueueSystemEvent(`[Cognitive Insight] ${insightText}`, { sessionKey });

    const { drainFormattedSystemEvents } =
      await import("../auto-reply/reply/session-system-events.js");
    const block = await drainFormattedSystemEvents({
      cfg: {} as never,
      sessionKey,
      isMainSession: true,
      isNewSession: false,
    });
    expect(block).toBeDefined();
    expect(block!).toContain("[Cognitive Insight]");
    expect(block!).toContain(insightText);
    expect(block!).toContain("System:");
  });

  it("shouldDropSystemEventUserMessage filters insight system event from chat history", async () => {
    const { sanitizeChatHistoryMessages } = await import("../gateway/server-methods/chat.js");

    const messages = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "System: [2026-07-04 10:00:00 GMT+8] [Cognitive Insight] Rust RTOS article\n" +
              "System:\nSystem: 一条主动洞察已生成",
          },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "嘿，还记得你之前聊过 Rust 吗？" }],
      },
      {
        role: "user",
        content: [{ type: "text", text: "帮我查天气" }],
      },
    ];

    const result = sanitizeChatHistoryMessages(messages, 10000);
    const userMsgs = result.filter((m) => (m as { role?: string }).role === "user");
    expect(userMsgs).toHaveLength(1);
    expect((userMsgs[0] as { content: Array<{ text: string }> }).content[0]!.text).toBe(
      "帮我查天气",
    );
    expect(result).toHaveLength(2);
  });

  it("findSessionKeyForUserId resolves operator session for insight delivery", async () => {
    const { findSessionKeyForUserId } = await import("../gateway/cognitive-delivery.js");

    const sessionsDir = join(tempDir, "sessions", "main");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(
      join(sessionsDir, "sessions.json"),
      JSON.stringify({
        "agent:main:main": { sessionId: "s1", lastChannel: "webchat" },
      }),
    );

    const cfg = { session: { store: join(sessionsDir, "sessions.json") } } as never;
    expect(findSessionKeyForUserId(cfg, "operator")).toBe("agent:main:main");
  });
});
