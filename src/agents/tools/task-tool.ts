import { Type } from "typebox";
import { resolveCorrectionUserId } from "../../cognitive/correction/userid.js";
import { createTaskSafely } from "../../cognitive/tasks/service.js";
import { TaskStore } from "../../cognitive/tasks/store.js";
import type { KaijiBotConfig } from "../../config/config.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, textResult } from "./common.js";

const log = createSubsystemLogger("task-tool");

const TaskCreateSchema = Type.Object({
  goal: Type.String({
    description:
      "The outcome to achieve, phrased as a verifiable end state (e.g. 'summarize this week's meeting notes into a wiki page')",
  }),
  maxSteps: Type.Optional(
    Type.Number({
      minimum: 1,
      maximum: 100,
      description: "Optional step ceiling override (default from config, 12)",
    }),
  ),
});

const TaskStatusSchema = Type.Object({});

function summarizeTask(task: {
  id: string;
  goal: string;
  status: string;
  budget: { usedSteps: number; maxSteps: number };
}): string {
  return `[${task.status}] ${task.goal} (steps ${task.budget.usedSteps}/${task.budget.maxSteps})`;
}

/**
 * Agent tools for the cognitive task system: create tasks from conversation
 * requests and report their status. Registered only when
 * cognitive.tasks.enabled is true (flag default off).
 */
export function createTaskTool(deps: {
  config?: KaijiBotConfig;
  sessionKey?: string;
  deliveryTo?: string;
  agentId?: string;
}): AnyAgentTool | null {
  return {
    name: "task_create",
    label: "Create Task",
    description:
      "Create an unattended multi-step task. The agent works on it in bounded steps and reports the result when done. Use when the user delegates an outcome that needs multiple steps or background work.",
    parameters: TaskCreateSchema,
    async execute(_toolCallId: string, rawParams: unknown) {
      const params = rawParams as { goal: string; maxSteps?: number };

      const userId = resolveCorrectionUserId(deps.sessionKey, deps.deliveryTo);
      if (!userId) {
        return textResult("No user session; task not created.", { status: "no_session" });
      }
      const agentId = deps.agentId ?? "main";

      try {
        const { resolveConfigDir } = await import("../../utils.js");
        const { PersonaStore } = await import("../../cognitive/persona/store.js");
        const personaStore = new PersonaStore(resolveConfigDir());
        const taskStore = new TaskStore(resolveConfigDir());

        const result = await createTaskSafely(
          {
            store: taskStore,
            config: deps.config,
            loadPersona: async (aid, uid) => personaStore.load(aid, uid),
          },
          agentId,
          userId,
          {
            goal: params.goal,
            origin: "user",
            ...(params.maxSteps ? { maxSteps: params.maxSteps } : {}),
          },
        );

        if (!result.ok) {
          return jsonResult({
            status: result.code,
            message:
              result.code === "disabled"
                ? "Task system is disabled (cognitive.tasks.enabled is false)."
                : `Task vetoed by pacing gate: ${result.reason}`,
          });
        }

        log.info("task created via agent tool", { agentId, userId, taskId: result.task.id });
        return jsonResult({
          status: "created",
          taskId: result.task.id,
          goal: result.task.goal,
          maxSteps: result.task.budget.maxSteps,
          message:
            "Task queued. It runs unattended in bounded steps; the result will be delivered when done. Use task_status to check progress.",
        });
      } catch (err) {
        log.warn("task_create failed", { error: String(err) });
        return textResult(
          `Task creation failed: ${err instanceof Error ? err.message : String(err)}`,
          {
            status: "error",
          },
        );
      }
    },
  };
}

export function createTaskStatusTool(deps: {
  config?: KaijiBotConfig;
  sessionKey?: string;
  deliveryTo?: string;
  agentId?: string;
}): AnyAgentTool | null {
  return {
    name: "task_status",
    label: "Task Status",
    description:
      "List the current user's cognitive tasks (active first, then recent finished ones).",
    parameters: TaskStatusSchema,
    async execute() {
      const userId = resolveCorrectionUserId(deps.sessionKey, deps.deliveryTo);
      if (!userId) {
        return textResult("No user session.", { status: "no_session" });
      }
      const agentId = deps.agentId ?? "main";
      try {
        const { resolveConfigDir } = await import("../../utils.js");
        const taskStore = new TaskStore(resolveConfigDir());
        const tasks = await taskStore.list(agentId, userId);
        if (tasks.length === 0) {
          return jsonResult({ status: "none", message: "No tasks." });
        }
        const ACTIVE_STATUSES = ["queued", "running", "blocked"];
        const active = tasks.filter((t) => ACTIVE_STATUSES.includes(t.status)).map(summarizeTask);
        const finished = tasks
          .filter((t) => !ACTIVE_STATUSES.includes(t.status))
          .slice(-5)
          .map(summarizeTask);
        return jsonResult({ status: "ok", active, finished });
      } catch (err) {
        return textResult(
          `Task status failed: ${err instanceof Error ? err.message : String(err)}`,
          {
            status: "error",
          },
        );
      }
    },
  };
}
