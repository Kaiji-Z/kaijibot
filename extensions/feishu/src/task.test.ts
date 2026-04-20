import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestPluginApi } from "../../../test/helpers/plugins/plugin-api.js";
import type { KaijiBotPluginApi, PluginRuntime } from "../runtime-api.js";

const createFeishuToolClientMock = vi.hoisted(() => vi.fn());
const resolveAnyEnabledFeishuToolsConfigMock = vi.hoisted(() => vi.fn());

vi.mock("./tool-account.js", () => ({
  createFeishuToolClient: createFeishuToolClientMock,
  resolveAnyEnabledFeishuToolsConfig: resolveAnyEnabledFeishuToolsConfigMock,
}));

let registerFeishuTaskTools: typeof import("./task.js").registerFeishuTaskTools;

function createFeishuToolRuntime(): PluginRuntime {
  return {} as PluginRuntime;
}

function createTaskToolApi(params: {
  config: KaijiBotPluginApi["config"];
  registerTool: KaijiBotPluginApi["registerTool"];
}): KaijiBotPluginApi {
  return createTestPluginApi({
    id: "feishu-test",
    name: "Feishu Test",
    source: "local",
    config: params.config,
    runtime: createFeishuToolRuntime(),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    registerTool: params.registerTool,
  });
}

describe("registerFeishuTaskTools", () => {
  const requestMock = vi.fn();

  beforeAll(async () => {
    ({ registerFeishuTaskTools } = await import("./task.js"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resolveAnyEnabledFeishuToolsConfigMock.mockReturnValue({
      doc: false,
      chat: false,
      wiki: false,
      drive: false,
      perm: false,
      scopes: false,
      vc: false,
      task: true,
    });
    createFeishuToolClientMock.mockReturnValue({
      request: requestMock,
    });
  });

  it("registers feishu_task and handles create action", async () => {
    const registerTool = vi.fn();
    registerFeishuTaskTools(
      createTaskToolApi({
        config: {
          channels: {
            feishu: {
              enabled: true,
              appId: "app_id",
              appSecret: "app_secret",
              tools: { task: true },
            },
          },
        },
        registerTool,
      }),
    );

    expect(registerTool).toHaveBeenCalledTimes(1);
    const toolFactory = registerTool.mock.calls[0]?.[0];
    const tool = toolFactory?.({ agentAccountId: undefined });
    expect(tool?.name).toBe("feishu_task");

    requestMock.mockResolvedValueOnce({
      code: 0,
      data: {
        task: {
          task_id: "t1",
          summary: "Write report",
          description: "Q1 summary report",
          due: { timestamp: "1700090000" },
          status: "todo",
          assignee: { open_id: "ou_assignee" },
          create_time: 1700000000,
        },
      },
    });

    const result = await tool.execute("call-1", {
      action: "create",
      summary: "Write report",
      description: "Q1 summary report",
      due: "1700090000",
      assignee: "ou_assignee",
    });

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "/open-apis/task/v2/tasks",
        data: {
          summary: "Write report",
          description: "Q1 summary report",
          due: { timestamp: "1700090000" },
          assignee: { open_id: "ou_assignee" },
        },
      }),
    );
    expect(result.details).toEqual(
      expect.objectContaining({
        success: true,
        task: expect.objectContaining({
          task_id: "t1",
          summary: "Write report",
          status: "todo",
        }),
      }),
    );
  });

  it("handles list action", async () => {
    const registerTool = vi.fn();
    registerFeishuTaskTools(
      createTaskToolApi({
        config: {
          channels: {
            feishu: {
              enabled: true,
              appId: "app_id",
              appSecret: "app_secret",
              tools: { task: true },
            },
          },
        },
        registerTool,
      }),
    );

    const toolFactory = registerTool.mock.calls[0]?.[0];
    const tool = toolFactory?.({ agentAccountId: undefined });

    requestMock.mockResolvedValueOnce({
      code: 0,
      data: {
        items: [
          {
            task_id: "t1",
            summary: "Task One",
            status: "todo",
            create_time: 1700000000,
          },
          {
            task_id: "t2",
            summary: "Task Two",
            status: "done",
            create_time: 1700001000,
          },
        ],
        has_more: true,
        page_token: "next_page",
      },
    });

    const result = await tool.execute("call-2", {
      action: "list",
      page_size: 10,
    });

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        url: "/open-apis/task/v2/tasks",
      }),
    );
    expect(result.details).toEqual(
      expect.objectContaining({
        tasks: [
          expect.objectContaining({ task_id: "t1", summary: "Task One" }),
          expect.objectContaining({ task_id: "t2", summary: "Task Two" }),
        ],
        has_more: true,
        page_token: "next_page",
      }),
    );
  });

  it("handles update action", async () => {
    const registerTool = vi.fn();
    registerFeishuTaskTools(
      createTaskToolApi({
        config: {
          channels: {
            feishu: {
              enabled: true,
              appId: "app_id",
              appSecret: "app_secret",
              tools: { task: true },
            },
          },
        },
        registerTool,
      }),
    );

    const toolFactory = registerTool.mock.calls[0]?.[0];
    const tool = toolFactory?.({ agentAccountId: undefined });

    requestMock.mockResolvedValueOnce({
      code: 0,
      data: {
        task: {
          task_id: "t1",
          summary: "Updated summary",
          status: "in_progress",
          update_time: 1700002000,
        },
      },
    });

    const result = await tool.execute("call-3", {
      action: "update",
      task_id: "t1",
      status: "in_progress",
      summary: "Updated summary",
    });

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PATCH",
        url: "/open-apis/task/v2/tasks/t1",
        data: {
          status: "in_progress",
          summary: "Updated summary",
        },
      }),
    );
    expect(result.details).toEqual(
      expect.objectContaining({
        success: true,
        task: expect.objectContaining({
          task_id: "t1",
          status: "in_progress",
        }),
      }),
    );
  });

  it("returns error when summary missing for create", async () => {
    const registerTool = vi.fn();
    registerFeishuTaskTools(
      createTaskToolApi({
        config: {
          channels: {
            feishu: {
              enabled: true,
              appId: "app_id",
              appSecret: "app_secret",
              tools: { task: true },
            },
          },
        },
        registerTool,
      }),
    );

    const toolFactory = registerTool.mock.calls[0]?.[0];
    const tool = toolFactory?.({ agentAccountId: undefined });

    const result = await tool.execute("call-4", { action: "create" });
    expect(result.details).toEqual(
      expect.objectContaining({ error: expect.stringContaining("summary is required") }),
    );
  });

  it("returns error when task_id missing for update", async () => {
    const registerTool = vi.fn();
    registerFeishuTaskTools(
      createTaskToolApi({
        config: {
          channels: {
            feishu: {
              enabled: true,
              appId: "app_id",
              appSecret: "app_secret",
              tools: { task: true },
            },
          },
        },
        registerTool,
      }),
    );

    const toolFactory = registerTool.mock.calls[0]?.[0];
    const tool = toolFactory?.({ agentAccountId: undefined });

    const result = await tool.execute("call-5", { action: "update", status: "done" });
    expect(result.details).toEqual(
      expect.objectContaining({ error: expect.stringContaining("task_id is required") }),
    );
  });

  it("returns unknown action for invalid action", async () => {
    const registerTool = vi.fn();
    registerFeishuTaskTools(
      createTaskToolApi({
        config: {
          channels: {
            feishu: {
              enabled: true,
              appId: "app_id",
              appSecret: "app_secret",
              tools: { task: true },
            },
          },
        },
        registerTool,
      }),
    );

    const toolFactory = registerTool.mock.calls[0]?.[0];
    const tool = toolFactory?.({ agentAccountId: undefined });

    const result = await tool.execute("call-6", { action: "delete" });
    expect(result.details).toEqual(
      expect.objectContaining({ error: "Unknown action: delete" }),
    );
  });

  it("surfaces API errors via toolExecutionErrorResult", async () => {
    const registerTool = vi.fn();
    registerFeishuTaskTools(
      createTaskToolApi({
        config: {
          channels: {
            feishu: {
              enabled: true,
              appId: "app_id",
              appSecret: "app_secret",
              tools: { task: true },
            },
          },
        },
        registerTool,
      }),
    );

    const toolFactory = registerTool.mock.calls[0]?.[0];
    const tool = toolFactory?.({ agentAccountId: undefined });

    requestMock.mockResolvedValueOnce({
      code: 99991400,
      msg: "task not found",
    });

    const result = await tool.execute("call-7", {
      action: "update",
      task_id: "nonexistent",
      status: "done",
    });

    expect(result.details).toEqual(
      expect.objectContaining({ error: expect.stringContaining("task not found") }),
    );
  });

  it("skips registration when task tool is disabled", () => {
    resolveAnyEnabledFeishuToolsConfigMock.mockReturnValue({
      doc: false,
      chat: false,
      wiki: false,
      drive: false,
      perm: false,
      scopes: false,
      vc: false,
      task: false,
    });

    const registerTool = vi.fn();
    registerFeishuTaskTools(
      createTaskToolApi({
        config: {
          channels: {
            feishu: {
              enabled: true,
              appId: "app_id",
              appSecret: "app_secret",
              tools: { task: false },
            },
          },
        },
        registerTool,
      }),
    );

    expect(registerTool).not.toHaveBeenCalled();
  });
});
