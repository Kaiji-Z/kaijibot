import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { TaskStore } from "./store.js";
import { isTerminalTaskStatus, type SubtaskResult, type TaskRecord } from "./types.js";

const log = createSubsystemLogger("cognitive/tasks");

export type AggregateOutcome = "none" | "waiting" | "released";

export type AggregatorDeps = {
  store: TaskStore;
  /** Wake the released parent (heartbeat kick; same idiom as task creation). */
  wakeParent?: (params: {
    agentId: string;
    userId: string;
    taskId: string;
  }) => Promise<void> | void;
};

/**
 * Parent aggregation (M3): called when a task reaches a terminal state. When
 * the terminal task is a subtask and EVERY sibling is terminal, the blocked
 * parent is re-queued with the children's results attached — its next step
 * prompt shows them, and the parent's agent turn aggregates and finishes.
 */
export async function aggregateOnTaskTerminal(
  deps: AggregatorDeps,
  child: TaskRecord,
): Promise<AggregateOutcome> {
  if (!child.parentTaskId || !child.parentAgentId) {
    return "none";
  }
  const parent = await deps.store.get(child.parentAgentId, child.userId, child.parentTaskId);
  if (!parent || parent.status !== "blocked") {
    return "none";
  }

  const subtasks = await deps.store.listSubtasks(child.userId, child.parentTaskId);
  if (subtasks.some(({ task }) => !isTerminalTaskStatus(task.status))) {
    return "waiting";
  }

  const subtaskResults: SubtaskResult[] = subtasks.map(({ agentId, task }) => ({
    taskId: task.id,
    agentId,
    goal: task.goal,
    status: task.status,
    ...(task.result ? { result: task.result } : {}),
  }));

  await deps.store.update(child.parentAgentId, child.userId, parent.id, (t) => ({
    ...t,
    status: "queued",
    subtaskResults,
  }));
  await deps.wakeParent?.({
    agentId: child.parentAgentId,
    userId: child.userId,
    taskId: parent.id,
  });
  log.info("parent task released after subtasks completed", {
    parentTaskId: parent.id,
    subtasks: subtaskResults.length,
  });
  return "released";
}
