import type { GatewayBrowserClient } from "../gateway.ts";

export type TasksState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  tasksLoading: boolean;
  tasksError: string | null;
  tasksList: unknown[];
  tasksSelectedId: string | null;
  tasksDetail: unknown | null;
  tasksDetailLoading: boolean;
  requestUpdate?: () => void;
};

/** Load the task snapshot (active by default) via the tasks.list RPC. */
export async function loadTasks(state: TasksState, includeFinished = false) {
  if (!state.client || !state.connected) {
    return;
  }
  state.tasksLoading = true;
  state.requestUpdate?.();
  try {
    const res = await state.client.request("tasks.list", { includeFinished });
    state.tasksList = (res as { tasks?: unknown[] }).tasks ?? [];
    state.tasksError = null;
  } catch (err) {
    state.tasksError = String(err);
  } finally {
    state.tasksLoading = false;
    state.requestUpdate?.();
  }
}

/** Load one task's full execution trail via the tasks.get RPC. */
export async function loadTaskDetail(state: TasksState, taskId: string, userId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.tasksSelectedId = taskId;
  state.tasksDetailLoading = true;
  state.requestUpdate?.();
  try {
    const res = await state.client.request("tasks.get", { taskId, userId });
    state.tasksDetail = (res as { task?: unknown }).task ?? null;
    state.tasksError = null;
  } catch (err) {
    state.tasksError = String(err);
  } finally {
    state.tasksDetailLoading = false;
    state.requestUpdate?.();
  }
}
