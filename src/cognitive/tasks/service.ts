import type { KaijiBotConfig } from "../../config/config.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { PersonaTree } from "../types.js";
import { evaluateTaskCreationGate } from "./pacing.js";
import type { TaskStore, CreateTaskInput } from "./store.js";
import type { TaskRecord } from "./types.js";

const log = createSubsystemLogger("cognitive/tasks");

/** Both the cognitive master switch and the tasks flag must be on. */
export function tasksEnabled(cfg: KaijiBotConfig | undefined): boolean {
  if (!cfg) {
    return false;
  }
  const cognitive = cfg.cognitive;
  if (cognitive?.enabled === false) {
    return false;
  }
  return cognitive?.tasks?.enabled === true;
}

export type CreateTaskResult =
  | { ok: true; task: TaskRecord }
  | { ok: false; code: "disabled" | "pacing_vetoed"; reason: string };

export type TaskServiceDeps = {
  store: TaskStore;
  config: KaijiBotConfig | undefined;
  /** Fresh persona snapshot for the pacing gate (ledger U, suppressUntil). */
  loadPersona: (agentId: string, userId: string) => Promise<PersonaTree | undefined>;
  /** Kick after successful creation (heartbeat wake / scheduler nudge). */
  onTaskCreated?: (task: TaskRecord) => void | Promise<void>;
};

/**
 * Task creation entry: flag gate → pacing gate → persist → kick.
 *
 * Pacing note (see pacing.ts): the ledger is cleared by the user-reply path,
 * so entry wiring for user-requested tasks must run AFTER the current turn's
 * post-turn persona extraction — otherwise a stale U can veto a direct
 * request.
 */
export async function createTaskSafely(
  deps: TaskServiceDeps,
  agentId: string,
  userId: string,
  input: CreateTaskInput,
): Promise<CreateTaskResult> {
  if (!tasksEnabled(deps.config)) {
    return {
      ok: false,
      code: "disabled",
      reason: "cognitive.tasks.enabled is false — enable it to create tasks",
    };
  }

  const persona = await deps.loadPersona(agentId, userId);
  if (persona) {
    const gate = evaluateTaskCreationGate(persona);
    if (!gate.allowed) {
      log.info("task creation vetoed by pacing gate", { agentId, userId, reason: gate.reason });
      return { ok: false, code: "pacing_vetoed", reason: gate.reason };
    }
  }
  // No persona yet = brand-new relationship: no ledger debt, no suppression.

  const maxSteps = input.maxSteps ?? deps.config?.cognitive?.tasks?.maxSteps;
  const task = await deps.store.create(agentId, userId, {
    ...input,
    ...(maxSteps !== undefined ? { maxSteps } : {}),
  });
  await deps.onTaskCreated?.(task);
  log.info("task created", { agentId, userId, taskId: task.id, goal: task.goal.slice(0, 80) });
  return { ok: true, task };
}
