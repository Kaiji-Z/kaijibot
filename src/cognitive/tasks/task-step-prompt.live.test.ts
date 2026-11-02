/**
 * Live task-step contract test — real LLM tool-calling against the
 * production [Task Step] prompt.
 *
 * Verifies the glue that stub-LLM tests cannot: a real model, given the
 * step driver's production prompt and the REAL tool schemas, (1) closes the
 * step handshake with task_step_report (correct taskId/stepIndex, summary,
 * done) and (2) splits a delegatable goal via task_create with correct
 * parent linkage.
 *
 * Run (local only, real API cost):
 *   KAIJIBOT_LIVE_TEST=1 pnpm test src/cognitive/tasks/task-step-prompt.live.test.ts
 * Requires ZAI_API_KEY (loaded from ~/.kaijibot/.env in dev environments).
 * Live-named test files are excluded from normal `pnpm test`; this config is
 * reached only through the dedicated live entrypoint.
 */
import { describe, expect, it } from "vitest";
import { createTaskTool, createTaskStepReportTool } from "../../agents/tools/task-tool.js";
import { buildStepPrompt } from "./step-driver.js";
import type { TaskRecord } from "./types.js";

const isLive = process.env.KAIJIBOT_LIVE_TEST === "1" || process.env.LIVE === "1";
const ZAI_API_KEY = process.env.ZAI_API_KEY;
const ZAI_URL = "https://api.z.ai/api/coding/paas/v4/chat/completions";
const MODEL = "glm-5-turbo";

type ToolCall = { name: string; arguments: string };

async function chatWithTools(params: {
  system: string;
  user: string;
  tools: Array<{
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }>;
  timeoutMs?: number;
}): Promise<ToolCall[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 90_000);
  try {
    const res = await fetch(ZAI_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${ZAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: params.system },
          { role: "user", content: params.user },
        ],
        tools: params.tools,
        tool_choice: "auto",
        temperature: 0.2,
        max_tokens: 1500,
      }),
    });
    const data = (await res.json()) as {
      error?: { message: string };
      choices?: Array<{
        message: { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> };
      }>;
    };
    if (data.error) {
      // Auth failures mean the local key is stale — the harness itself is fine.
      throw new Error(
        `ZAI API error (verify ZAI_API_KEY freshness in ~/.kaijibot/.env): ${data.error.message}`,
      );
    }
    return (data.choices?.[0]?.message.tool_calls ?? [])
      .map((call) => ({
        name: call.function?.name ?? "",
        arguments: call.function?.arguments ?? "{}",
      }))
      .filter((call) => call.name);
  } finally {
    clearTimeout(timer);
  }
}

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task-live-0001",
    agentId: "main",
    userId: "ou_live",
    goal: "",
    status: "running",
    budget: { usedSteps: 0, maxSteps: 3, maxWallClockMs: 30 * 60 * 1000 },
    steps: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    origin: "user",
    ...overrides,
  };
}

const SYSTEM = "你是 KaijiBot，一个常驻的个人助理 agent。严格按照指令使用工具。";

const describeLive = isLive && ZAI_API_KEY ? describe : describe.skip;

describeLive("task step prompt contract (live, real LLM)", () => {
  it(
    "a real model closes the step handshake with task_step_report",
    { timeout: 120_000 },
    async () => {
      const task = makeTask({
        goal: "把“坚持早睡早起”的三个好处整理成一句话清单，作为最终结果",
      });
      const prompt = buildStepPrompt(task, 1);
      const reportTool = createTaskStepReportTool();

      const calls = await chatWithTools({
        system: SYSTEM,
        user: prompt,
        tools: [
          {
            type: "function",
            function: {
              name: reportTool.name,
              description: reportTool.description,
              parameters: reportTool.parameters as Record<string, unknown>,
            },
          },
        ],
      });

      const report = calls.find((c) => c.name === "task_step_report");
      expect(
        report,
        `expected a task_step_report call, got: ${JSON.stringify(calls)}`,
      ).toBeTruthy();

      const args = JSON.parse(report!.arguments) as {
        taskId?: string;
        stepIndex?: number;
        summary?: string;
        done?: boolean;
      };
      // The contract: the model must echo the prompt's task id and step number.
      expect(args.taskId).toBe(task.id);
      expect(args.stepIndex).toBe(1);
      expect((args.summary ?? "").length).toBeGreaterThan(4);
      expect(args.done).toBe(true);
    },
  );

  it(
    "a real model splits a delegatable goal via task_create with parent linkage",
    { timeout: 120_000 },
    async () => {
      const task = makeTask({
        id: "task-live-0002",
        goal: "分别整理“早睡的好处”和“多喝水的好处”两路资料，最后合并成一份两行简报（两路可并行处理）",
      });
      const prompt = buildStepPrompt(task, 1);
      const createTool = createTaskTool({
        config: {
          cognitive: { enabled: true, tasks: { enabled: true } },
        } as never,
        sessionKey: "agent:main:ou_live",
        agentId: "main",
      })!;
      const reportTool = createTaskStepReportTool();

      const calls = await chatWithTools({
        system: SYSTEM,
        user: prompt,
        tools: [
          {
            type: "function",
            function: {
              name: createTool.name,
              description: createTool.description,
              parameters: createTool.parameters as Record<string, unknown>,
            },
          },
          {
            type: "function",
            function: {
              name: reportTool.name,
              description: reportTool.description,
              parameters: reportTool.parameters as Record<string, unknown>,
            },
          },
        ],
      });

      const splits = calls.filter((c) => c.name === "task_create");
      expect(
        splits.length,
        `expected task_create split calls, got: ${JSON.stringify(calls)}`,
      ).toBeGreaterThanOrEqual(2);

      for (const split of splits) {
        const args = JSON.parse(split.arguments) as {
          goal?: string;
          parentTaskId?: string;
          assignToAgent?: string;
        };
        expect((args.goal ?? "").length).toBeGreaterThan(4);
        // Parent linkage is the core contract: children must reference the
        // prompt's task id or the parent waits forever.
        expect(args.parentTaskId).toBe(task.id);
      }
    },
  );
});
