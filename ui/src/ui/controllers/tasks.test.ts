import { describe, expect, it, vi } from "vitest";
import { loadTaskDetail, loadTasks, type TasksState } from "./tasks.ts";

function createState(): { state: TasksState; request: ReturnType<typeof vi.fn> } {
  const request = vi.fn();
  const state: TasksState = {
    client: { request } as unknown as TasksState["client"],
    connected: true,
    tasksLoading: false,
    tasksError: null,
    tasksList: [],
    tasksSelectedId: null,
    tasksDetail: null,
    tasksDetailLoading: false,
  };
  return { state, request };
}

describe("tasks controller", () => {
  it("loadTasks stores the list and clears the error", async () => {
    const { state, request } = createState();
    request.mockResolvedValue({ tasks: [{ id: "t1" }] });
    state.tasksError = "stale";

    await loadTasks(state, false);

    expect(request).toHaveBeenCalledWith("tasks.list", { includeFinished: false });
    expect(state.tasksList).toEqual([{ id: "t1" }]);
    expect(state.tasksError).toBeNull();
    expect(state.tasksLoading).toBe(false);
  });

  it("loadTasks records request failures", async () => {
    const { state, request } = createState();
    request.mockRejectedValue(new Error("rpc down"));

    await loadTasks(state, true);

    expect(state.tasksError).toContain("rpc down");
    expect(state.tasksLoading).toBe(false);
  });

  it("does nothing when disconnected", async () => {
    const { state, request } = createState();
    state.connected = false;

    await loadTasks(state, false);
    await loadTaskDetail(state, "t1", "ou_x");

    expect(request).not.toHaveBeenCalled();
  });

  it("last click wins: a slow older detail response never clobbers a newer one", async () => {
    const { state, request } = createState();
    // Task A resolves slowly; task B resolves fast.
    let resolveA: (v: unknown) => void = () => {};
    request
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveA = resolve;
          }),
      )
      .mockResolvedValueOnce({ task: { id: "task-b", goal: "B" } });

    const first = loadTaskDetail(state, "task-a", "ou_x");
    const second = loadTaskDetail(state, "task-b", "ou_x");
    await second;
    resolveA({ task: { id: "task-a", goal: "A" } });
    await first;

    expect(state.tasksSelectedId).toBe("task-b");
    expect(state.tasksDetail).toEqual({ id: "task-b", goal: "B" });
    expect(state.tasksDetailLoading).toBe(false);
  });

  it("a stale detail error does not overwrite the newer selection", async () => {
    const { state, request } = createState();
    let rejectA: (e: unknown) => void = () => {};
    request
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectA = reject;
          }),
      )
      .mockResolvedValueOnce({ task: { id: "task-b", goal: "B" } });

    const first = loadTaskDetail(state, "task-a", "ou_x");
    await loadTaskDetail(state, "task-b", "ou_x");
    rejectA(new Error("slow failure"));
    await first;

    expect(state.tasksError).toBeNull();
    expect(state.tasksDetail).toEqual({ id: "task-b", goal: "B" });
  });
});
