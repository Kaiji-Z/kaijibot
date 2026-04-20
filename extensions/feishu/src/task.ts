import type * as Lark from "@larksuiteoapi/node-sdk";
import type { KaijiBotPluginApi } from "../runtime-api.js";
import { listEnabledFeishuAccounts } from "./accounts.js";
import { FeishuTaskSchema, type FeishuTaskParams } from "./task-schema.js";
import { createFeishuToolClient, resolveAnyEnabledFeishuToolsConfig } from "./tool-account.js";
import {
  jsonToolResult,
  toolExecutionErrorResult,
  unknownToolActionResult,
} from "./tool-result.js";

// ============ Internal client types ============

type FeishuTaskInternalClient = Lark.Client & {
  request(params: {
    method: "GET" | "POST" | "PATCH";
    url: string;
    params?: Record<string, string | undefined>;
    data: unknown;
    timeout?: number;
  }): Promise<unknown>;
};

type FeishuTaskApiResponse<T> = {
  code: number;
  msg?: string;
  data?: T;
};

type FeishuTaskItem = {
  task_id?: string;
  summary?: string;
  description?: string;
  due?: {
    timestamp?: string;
  };
  status?: string;
  assignee?: {
    open_id?: string;
  };
  create_time?: number;
  update_time?: number;
};

type FeishuTaskListResponse = FeishuTaskApiResponse<{
  items?: FeishuTaskItem[];
  has_more?: boolean;
  page_token?: string;
}>;

type FeishuTaskCreateResponse = FeishuTaskApiResponse<{
  task: FeishuTaskItem;
}>;

type FeishuTaskUpdateResponse = FeishuTaskApiResponse<{
  task: FeishuTaskItem;
}>;

// ============ Actions ============

const FEISHU_TASK_REQUEST_TIMEOUT_MS = 30_000;

function getTaskInternalClient(client: Lark.Client): FeishuTaskInternalClient {
  return client as FeishuTaskInternalClient;
}

async function requestTaskApi<T>(params: {
  client: Lark.Client;
  method: "GET" | "POST" | "PATCH";
  url: string;
  query?: Record<string, string | undefined>;
  data?: unknown;
}): Promise<T> {
  const internalClient = getTaskInternalClient(params.client);
  return (await internalClient.request({
    method: params.method,
    url: params.url,
    params: params.query ?? {},
    data: params.data ?? {},
    timeout: FEISHU_TASK_REQUEST_TIMEOUT_MS,
  })) as T;
}

function normalizePageSize(pageSize: number | undefined): string | undefined {
  if (typeof pageSize !== "number" || !Number.isFinite(pageSize)) {
    return undefined;
  }
  return String(Math.min(Math.max(Math.floor(pageSize), 1), 50));
}

function normalizeTaskItem(item: FeishuTaskItem) {
  return {
    task_id: item.task_id,
    summary: item.summary,
    description: item.description,
    due: item.due?.timestamp,
    status: item.status,
    assignee: item.assignee?.open_id,
    create_time: item.create_time,
    update_time: item.update_time,
  };
}

async function createTask(
  client: Lark.Client,
  params: {
    summary?: string;
    description?: string;
    due?: string;
    assignee?: string;
  },
) {
  if (!params.summary) {
    throw new Error("summary is required for create");
  }

  const data: Record<string, unknown> = {
    summary: params.summary,
  };

  if (params.description) {
    data.description = params.description;
  }
  if (params.due) {
    data.due = { timestamp: params.due };
  }
  if (params.assignee) {
    data.assignee = { open_id: params.assignee };
  }

  const response = await requestTaskApi<FeishuTaskCreateResponse>({
    client,
    method: "POST",
    url: "/open-apis/task/v2/tasks",
    query: { user_id_type: "open_id" },
    data,
  });

  if (response.code !== 0) {
    throw new Error(response.msg ?? "Feishu Task create failed");
  }

  return {
    success: true,
    task: normalizeTaskItem(response.data?.task ?? {}),
  };
}

async function listTasks(
  client: Lark.Client,
  params: {
    page_size?: number;
    page_token?: string;
  },
) {
  const query: Record<string, string | undefined> = {
    page_size: normalizePageSize(params.page_size) ?? "20",
    page_token: params.page_token,
    user_id_type: "open_id",
  };

  const response = await requestTaskApi<FeishuTaskListResponse>({
    client,
    method: "GET",
    url: "/open-apis/task/v2/tasks",
    query,
  });

  if (response.code !== 0) {
    throw new Error(response.msg ?? "Feishu Task list failed");
  }

  return {
    tasks: (response.data?.items ?? []).map(normalizeTaskItem),
    has_more: response.data?.has_more ?? false,
    page_token: response.data?.page_token,
  };
}

async function updateTask(
  client: Lark.Client,
  params: {
    task_id?: string;
    summary?: string;
    description?: string;
    due?: string;
    assignee?: string;
    status?: string;
  },
) {
  if (!params.task_id) {
    throw new Error("task_id is required for update");
  }

  const data: Record<string, unknown> = {};

  if (params.summary) {
    data.summary = params.summary;
  }
  if (params.description) {
    data.description = params.description;
  }
  if (params.due) {
    data.due = { timestamp: params.due };
  }
  if (params.assignee) {
    data.assignee = { open_id: params.assignee };
  }
  if (params.status) {
    data.status = params.status;
  }

  const response = await requestTaskApi<FeishuTaskUpdateResponse>({
    client,
    method: "PATCH",
    url: `/open-apis/task/v2/tasks/${encodeURIComponent(params.task_id)}`,
    query: { user_id_type: "open_id" },
    data,
  });

  if (response.code !== 0) {
    throw new Error(response.msg ?? "Feishu Task update failed");
  }

  return {
    success: true,
    task: normalizeTaskItem(response.data?.task ?? {}),
  };
}

// ============ Tool Registration ============

export function registerFeishuTaskTools(api: KaijiBotPluginApi) {
  if (!api.config) {
    api.logger.debug?.("feishu_task: No config available, skipping task tools");
    return;
  }

  const accounts = listEnabledFeishuAccounts(api.config);
  if (accounts.length === 0) {
    api.logger.debug?.("feishu_task: No Feishu accounts configured, skipping task tools");
    return;
  }

  const toolsCfg = resolveAnyEnabledFeishuToolsConfig(accounts);
  if (!toolsCfg.task) {
    api.logger.debug?.("feishu_task: task tool disabled in config");
    return;
  }

  type FeishuTaskExecuteParams = FeishuTaskParams & { accountId?: string };

  api.registerTool(
    (ctx) => {
      const defaultAccountId = ctx.agentAccountId;
      return {
        name: "feishu_task",
        label: "Feishu Task",
        description: "Feishu task operations. Actions: create, list, update",
        parameters: FeishuTaskSchema,
        async execute(_toolCallId, params) {
          const p = params as FeishuTaskExecuteParams;
          try {
            const client = createFeishuToolClient({
              api,
              executeParams: p,
              defaultAccountId,
            });
            switch (p.action) {
              case "create":
                return jsonToolResult(
                  await createTask(client, {
                    summary: p.summary,
                    description: p.description,
                    due: p.due,
                    assignee: p.assignee,
                  }),
                );
              case "list":
                return jsonToolResult(
                  await listTasks(client, {
                    page_size: p.page_size,
                    page_token: p.page_token,
                  }),
                );
              case "update":
                return jsonToolResult(
                  await updateTask(client, {
                    task_id: p.task_id,
                    summary: p.summary,
                    description: p.description,
                    due: p.due,
                    assignee: p.assignee,
                    status: p.status,
                  }),
                );
              default:
                return unknownToolActionResult((p as { action?: unknown }).action);
            }
          } catch (err) {
            return toolExecutionErrorResult(err);
          }
        },
      };
    },
    { name: "feishu_task" },
  );

  api.logger.info?.(`feishu_task: Registered feishu_task tool`);
}
