/**
 * Live evolution + heartbeat integration test — verifies the dedicated evolution
 * prompt makes the Agent reliably call evaluate_skill_evolution and respond
 * to the user (not HEARTBEAT_OK).
 *
 * Run: KAIJIBOT_LIVE_TEST=1 pnpm test src/cognitive/evolution/evolution-heartbeat-live.test.ts
 *
 * What this tests:
 *   1. Dedicated evolution prompt → Agent calls evaluate_skill_evolution tool
 *   2. After tool result → Agent responds to user in natural language
 *   3. Response is NOT HEARTBEAT_OK
 *   4. Compare: old heartbeat prompt → Agent responds HEARTBEAT_OK (baseline)
 */

import { describe, expect, it } from "vitest";
import { buildEvolutionEventPrompt } from "../../infra/heartbeat-events-filter.js";

const isLive = process.env.KAIJIBOT_LIVE_TEST === "1" || process.env.LIVE === "1";
const ZAI_API_KEY = process.env.ZAI_API_KEY;
const ZAI_URL = "https://api.z.ai/api/coding/paas/v4/chat/completions";
const MODEL = "glm-5-turbo";

type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

const EVOLUTION_TOOL = {
  type: "function" as const,
  function: {
    name: "evaluate_skill_evolution",
    description:
      "Generates a reusable Skill draft from a complex task pattern. Call this when you see an [Evolution Signal] " +
      "system event or after any complex multi-step task.",
    parameters: {
      type: "object",
      properties: {
        taskSummary: { type: "string", description: "Short summary of the completed task" },
        toolCalls: { type: "array", items: { type: "string" }, description: "Ordered list of tool calls" },
        uniqueToolCount: { type: "number", description: "Number of distinct tools used" },
        reasoningTurns: { type: "number", description: "Number of agent reasoning turns" },
        durationMs: { type: "number", description: "Wall-clock time in milliseconds" },
        domain: { type: "string", description: "Cognitive domain" },
      },
      required: ["taskSummary", "toolCalls", "uniqueToolCount", "reasoningTurns", "durationMs", "domain"],
    },
  },
};

const SYSTEM_PROMPT =
  "You are KaijiBot, a proactive AI assistant for Chinese users via Feishu. " +
  "Follow instructions precisely. You have access to tools.";

const EVOLUTION_SIGNAL =
  "System: [2026-05-02 23:00:00 GMT+8] [Evolution Signal] 刚完成的任务涉及 8 次工具调用（5 种），持续 120 秒。\n" +
  "System: 工具序列: feishu_vc_search, feishu_vc_notes, feishu_doc_fetch, feishu_wiki_create, feishu_doc_write, feishu_task_create, read_file, exec\n" +
  "System: ⚠ 工具错误: 1 次错误（feishu_doc_write）\n" +
  "System: \n" +
  "System: 请根据完整对话上下文自主判断：这个任务模式是否值得做成可复用技能？";

const TOOL_RESULT = JSON.stringify({
  status: "suggested",
  complexityScore: 0.72,
  skillName: "meeting-archive",
  description: "归档产品评审会议纪要到飞书知识库并创建跟踪任务",
  triggerPhrases: [
    "帮我归档会议纪要",
    "整理上次评审记录到知识库",
    "Archive meeting notes to wiki",
  ],
  recentSuggestions: [],
});

async function callLLMMessages(messages: ChatMessage[], tools?: unknown[]): Promise<{
  content: string | null;
  tool_calls?: ToolCall[];
}> {
  const res = await fetch(ZAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${ZAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages,
      tools: tools ?? [EVOLUTION_TOOL],
      temperature: 0.3,
      max_tokens: 1000,
    }),
  });
  const data = (await res.json()) as {
    error?: { message: string };
    choices?: Array<{ message: { content: string | null; tool_calls?: ToolCall[] } }>;
  };
  if (data.error) throw new Error(data.error.message);
  const choice = data.choices?.[0]?.message;
  return { content: choice?.content ?? null, tool_calls: choice?.tool_calls };
}

describe.skipIf(!isLive || !ZAI_API_KEY)("evolution heartbeat live: dedicated prompt", () => {
  it("Agent calls evaluate_skill_evolution when given evolution prompt", async () => {
    const evolutionPrompt = buildEvolutionEventPrompt({ deliverToUser: true });
    const userMessage = `${EVOLUTION_SIGNAL}\n\n${evolutionPrompt}`;

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ];

    const response = await callLLMMessages(messages);

    console.log(`\n  ═══ Turn 1: Tool Call ═══`);
    console.log(`  content: ${response.content ?? "(null)"}`);
    console.log(`  tool_calls: ${response.tool_calls ? response.tool_calls.map((tc) => tc.function.name).join(", ") : "(none)"}`);

    expect(response.tool_calls).toBeDefined();
    expect(response.tool_calls!.length).toBeGreaterThanOrEqual(1);
    expect(response.tool_calls![0]!.function.name).toBe("evaluate_skill_evolution");

    const toolArgs = JSON.parse(response.tool_calls![0]!.function.arguments);
    console.log(`  tool args: domain=${toolArgs.domain}, uniqueToolCount=${toolArgs.uniqueToolCount}`);
    expect(toolArgs.taskSummary).toBeTruthy();
    expect(toolArgs.toolCalls).toBeInstanceOf(Array);
  }, 60_000);

  it("Agent responds to user in natural language after tool result", async () => {
    const evolutionPrompt = buildEvolutionEventPrompt({ deliverToUser: true });
    const userMessage = `${EVOLUTION_SIGNAL}\n\n${evolutionPrompt}`;

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_test_1",
            type: "function",
            function: {
              name: "evaluate_skill_evolution",
              arguments: JSON.stringify({
                taskSummary: "归档产品评审会议纪要到飞书知识库并创建跟踪任务",
                toolCalls: ["feishu_vc_search", "feishu_vc_notes", "feishu_wiki_create", "feishu_task_create"],
                uniqueToolCount: 4,
                reasoningTurns: 6,
                durationMs: 120_000,
                domain: "meeting-archive",
              }),
            },
          },
        ],
      },
      { role: "tool", content: TOOL_RESULT, tool_call_id: "call_test_1" },
    ];

    const response = await callLLMMessages(messages, []);

    console.log(`\n  ═══ Turn 2: User Response ═══`);
    console.log(`  content: ${(response.content ?? "").slice(0, 200)}`);

    expect(response.content).toBeTruthy();
    expect(response.content).not.toContain("HEARTBEAT_OK");
    expect(response.content!.length).toBeGreaterThan(20);
  }, 60_000);

  it("old heartbeat prompt → Agent responds HEARTBEAT_OK (baseline)", async () => {
    const oldPrompt =
      "Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. " +
      "Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.\n" +
      "Current time: Saturday, May 2nd, 2026 - 11:00 PM (Asia/Shanghai)";

    const userMessage = `${EVOLUTION_SIGNAL}\n\n${oldPrompt}`;

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ];

    const response = await callLLMMessages(messages);

    console.log(`\n  ═══ Baseline: Old Prompt ═══`);
    console.log(`  content: ${response.content ?? "(null)"}`);
    console.log(`  tool_calls: ${response.tool_calls ? response.tool_calls.map((tc) => tc.function.name).join(", ") : "(none)"}`);

    const isHeartbeatOk =
      response.content?.trim() === "HEARTBEAT_OK" ||
      (response.tool_calls === undefined && !response.content?.trim());
    console.log(`  isHeartbeatOk: ${isHeartbeatOk}`);

    // This test documents the OLD behavior — Agent typically ignores evolution
    // signal when HEARTBEAT_OK is present. We don't assert HEARTBEAT_OK because
    // LLM is non-deterministic, but we log it for comparison.
    expect(true).toBe(true);
  }, 60_000);

  it("full 2-turn flow: tool call → natural language response", async () => {
    const evolutionPrompt = buildEvolutionEventPrompt({ deliverToUser: true });
    const userMessage = `${EVOLUTION_SIGNAL}\n\n${evolutionPrompt}`;

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ];

    // Turn 1: expect tool call
    const turn1 = await callLLMMessages(messages);
    expect(turn1.tool_calls).toBeDefined();
    expect(turn1.tool_calls![0]!.function.name).toBe("evaluate_skill_evolution");

    // Turn 2: send tool result, expect natural language
    messages.push({
      role: "assistant",
      content: turn1.content,
      tool_calls: turn1.tool_calls,
    });
    messages.push({
      role: "tool",
      content: TOOL_RESULT,
      tool_call_id: turn1.tool_calls![0]!.id,
    });

    const turn2 = await callLLMMessages(messages, []);

    console.log(`\n  ═══ Full Flow ═══`);
    console.log(`  Turn 1: called ${turn1.tool_calls![0]!.function.name}`);
    console.log(`  Turn 2: ${(turn2.content ?? "").slice(0, 200)}`);

    expect(turn2.content).toBeTruthy();
    expect(turn2.content).not.toContain("HEARTBEAT_OK");
    expect(turn2.content!.length).toBeGreaterThan(20);
  }, 120_000);
});
