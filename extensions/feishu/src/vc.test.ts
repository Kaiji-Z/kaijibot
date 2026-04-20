import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestPluginApi } from "../../../test/helpers/plugins/plugin-api.js";
import type { KaijiBotPluginApi, PluginRuntime } from "../runtime-api.js";

const createFeishuToolClientMock = vi.hoisted(() => vi.fn());
const resolveAnyEnabledFeishuToolsConfigMock = vi.hoisted(() => vi.fn());

vi.mock("./tool-account.js", () => ({
  createFeishuToolClient: createFeishuToolClientMock,
  resolveAnyEnabledFeishuToolsConfig: resolveAnyEnabledFeishuToolsConfigMock,
}));

let registerFeishuVcTools: typeof import("./vc.js").registerFeishuVcTools;

function createFeishuToolRuntime(): PluginRuntime {
  return {} as PluginRuntime;
}

function createVcToolApi(params: {
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

describe("registerFeishuVcTools", () => {
  const requestMock = vi.fn();

  beforeAll(async () => {
    ({ registerFeishuVcTools } = await import("./vc.js"));
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
      vc: true,
      task: false,
    });
    createFeishuToolClientMock.mockReturnValue({
      request: requestMock,
    });
  });

  it("registers feishu_vc and handles search action", async () => {
    const registerTool = vi.fn();
    registerFeishuVcTools(
      createVcToolApi({
        config: {
          channels: {
            feishu: {
              enabled: true,
              appId: "app_id",
              appSecret: "app_secret",
              tools: { vc: true },
            },
          },
        },
        registerTool,
      }),
    );

    expect(registerTool).toHaveBeenCalledTimes(1);
    const toolFactory = registerTool.mock.calls[0]?.[0];
    const tool = toolFactory?.({ agentAccountId: undefined });
    expect(tool?.name).toBe("feishu_vc");

    requestMock.mockResolvedValueOnce({
      code: 0,
      data: {
        meetings: [
          {
            meeting_id: "m1",
            topic: "Team Standup",
            start_time: 1700000000,
            end_time: 1700003600,
            status: "ended",
            organizer: "ou_manager",
          },
        ],
        has_more: false,
      },
    });

    const result = await tool.execute("call-1", {
      action: "search",
      start_time: "1700000000",
      end_time: "1700090000",
    });

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        url: "/open-apis/vc/v1/meetings",
      }),
    );
    expect(result.details).toEqual(
      expect.objectContaining({
        meetings: [
          expect.objectContaining({
            meeting_id: "m1",
            topic: "Team Standup",
            status: "ended",
          }),
        ],
        has_more: false,
      }),
    );
  });

  it("handles notes action", async () => {
    const registerTool = vi.fn();
    registerFeishuVcTools(
      createVcToolApi({
        config: {
          channels: {
            feishu: {
              enabled: true,
              appId: "app_id",
              appSecret: "app_secret",
              tools: { vc: true },
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
        minutes: [
          {
            minute_id: "min_1",
            summary: "Discussed Q1 roadmap",
            action_items: "Follow up on budget",
            topics: ["roadmap", "budget"],
            create_time: 1700001000,
          },
        ],
      },
    });

    const result = await tool.execute("call-2", {
      action: "notes",
      meeting_id: "m1",
    });

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        url: "/open-apis/vc/v1/meetings/m1/minutes",
      }),
    );
    expect(result.details).toEqual(
      expect.objectContaining({
        meeting_id: "m1",
        minutes: [
          expect.objectContaining({
            minute_id: "min_1",
            summary: "Discussed Q1 roadmap",
            action_items: "Follow up on budget",
          }),
        ],
      }),
    );
  });

  it("handles detail action with participants", async () => {
    const registerTool = vi.fn();
    registerFeishuVcTools(
      createVcToolApi({
        config: {
          channels: {
            feishu: {
              enabled: true,
              appId: "app_id",
              appSecret: "app_secret",
              tools: { vc: true },
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
        meeting_id: "m1",
        topic: "Sprint Planning",
        start_time: 1700000000,
        end_time: 1700003600,
        status: "ended",
        organizer: { user_id: "ou_lead", name: "Lead" },
        participants: [
          { user_id: "ou_a", name: "Alice", join_time: 1700000000, leave_time: 1700003600 },
          { user_id: "ou_b", name: "Bob", join_time: 1700000100, leave_time: 1700003500 },
        ],
      },
    });

    const result = await tool.execute("call-3", {
      action: "detail",
      meeting_id: "m1",
      with_participants: true,
    });

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        url: "/open-apis/vc/v1/meetings/m1",
      }),
    );
    expect(result.details).toEqual(
      expect.objectContaining({
        meeting_id: "m1",
        topic: "Sprint Planning",
        participants: [
          expect.objectContaining({ user_id: "ou_a", name: "Alice" }),
          expect.objectContaining({ user_id: "ou_b", name: "Bob" }),
        ],
      }),
    );
  });

  it("returns error when meeting_id missing for notes", async () => {
    const registerTool = vi.fn();
    registerFeishuVcTools(
      createVcToolApi({
        config: {
          channels: {
            feishu: {
              enabled: true,
              appId: "app_id",
              appSecret: "app_secret",
              tools: { vc: true },
            },
          },
        },
        registerTool,
      }),
    );

    const toolFactory = registerTool.mock.calls[0]?.[0];
    const tool = toolFactory?.({ agentAccountId: undefined });

    const result = await tool.execute("call-4", { action: "notes" });
    expect(result.details).toEqual(
      expect.objectContaining({ error: "meeting_id is required for action notes" }),
    );
  });

  it("returns error when meeting_id missing for detail", async () => {
    const registerTool = vi.fn();
    registerFeishuVcTools(
      createVcToolApi({
        config: {
          channels: {
            feishu: {
              enabled: true,
              appId: "app_id",
              appSecret: "app_secret",
              tools: { vc: true },
            },
          },
        },
        registerTool,
      }),
    );

    const toolFactory = registerTool.mock.calls[0]?.[0];
    const tool = toolFactory?.({ agentAccountId: undefined });

    const result = await tool.execute("call-5", { action: "detail" });
    expect(result.details).toEqual(
      expect.objectContaining({ error: "meeting_id is required for action detail" }),
    );
  });

  it("returns unknown action for invalid action", async () => {
    const registerTool = vi.fn();
    registerFeishuVcTools(
      createVcToolApi({
        config: {
          channels: {
            feishu: {
              enabled: true,
              appId: "app_id",
              appSecret: "app_secret",
              tools: { vc: true },
            },
          },
        },
        registerTool,
      }),
    );

    const toolFactory = registerTool.mock.calls[0]?.[0];
    const tool = toolFactory?.({ agentAccountId: undefined });

    const result = await tool.execute("call-6", { action: "invalid" });
    expect(result.details).toEqual(
      expect.objectContaining({ error: "Unknown action: invalid" }),
    );
  });

  it("surfaces API errors via toolExecutionErrorResult", async () => {
    const registerTool = vi.fn();
    registerFeishuVcTools(
      createVcToolApi({
        config: {
          channels: {
            feishu: {
              enabled: true,
              appId: "app_id",
              appSecret: "app_secret",
              tools: { vc: true },
            },
          },
        },
        registerTool,
      }),
    );

    const toolFactory = registerTool.mock.calls[0]?.[0];
    const tool = toolFactory?.({ agentAccountId: undefined });

    requestMock.mockResolvedValueOnce({
      code: 99991668,
      msg: "meeting not found",
    });

    const result = await tool.execute("call-7", {
      action: "detail",
      meeting_id: "nonexistent",
    });

    expect(result.details).toEqual(
      expect.objectContaining({ error: expect.stringContaining("meeting not found") }),
    );
  });

  it("skips registration when vc tool is disabled", () => {
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
    registerFeishuVcTools(
      createVcToolApi({
        config: {
          channels: {
            feishu: {
              enabled: true,
              appId: "app_id",
              appSecret: "app_secret",
              tools: { vc: false },
            },
          },
        },
        registerTool,
      }),
    );

    expect(registerTool).not.toHaveBeenCalled();
  });
});
