import type * as Lark from "@larksuiteoapi/node-sdk";
import type { KaijiBotPluginApi } from "../runtime-api.js";
import { listEnabledFeishuAccounts } from "./accounts.js";
import { FeishuVcSchema, type FeishuVcParams } from "./vc-schema.js";
import { createFeishuToolClient, resolveAnyEnabledFeishuToolsConfig } from "./tool-account.js";
import {
  jsonToolResult,
  toolExecutionErrorResult,
  unknownToolActionResult,
} from "./tool-result.js";

// ============ Internal client types ============

type FeishuVcInternalClient = Lark.Client & {
  request(params: {
    method: "GET" | "POST";
    url: string;
    params?: Record<string, string | undefined>;
    data: unknown;
    timeout?: number;
  }): Promise<unknown>;
};

type FeishuVcApiResponse<T> = {
  code: number;
  msg?: string;
  data?: T;
};

type FeishuVcMeetingItem = {
  meeting_id?: string;
  topic?: string;
  start_time?: number;
  end_time?: number;
  status?: string;
  organizer?: string;
  meeting_number?: string;
};

type FeishuVcSearchResponse = FeishuVcApiResponse<{
  meetings?: FeishuVcMeetingItem[];
  has_more?: boolean;
  page_token?: string;
}>;

type FeishuVcMeetingDetail = {
  meeting_id?: string;
  topic?: string;
  start_time?: number;
  end_time?: number;
  status?: string;
  organizer?: {
    user_id?: string;
    name?: string;
  };
  participants?: Array<{
    user_id?: string;
    name?: string;
    join_time?: number;
    leave_time?: number;
  }>;
  meeting_number?: string;
};

type FeishuVcDetailResponse = FeishuVcApiResponse<FeishuVcMeetingDetail>;

type FeishuVcMinuteItem = {
  minute_id?: string;
  summary?: string;
  action_items?: string;
  topics?: string[];
  create_time?: number;
};

type FeishuVcNotesResponse = FeishuVcApiResponse<{
  minutes?: FeishuVcMinuteItem[];
}>;

// ============ Actions ============

const FEISHU_VC_REQUEST_TIMEOUT_MS = 30_000;

function getVcInternalClient(client: Lark.Client): FeishuVcInternalClient {
  return client as FeishuVcInternalClient;
}

async function requestVcApi<T>(params: {
  client: Lark.Client;
  method: "GET" | "POST";
  url: string;
  query?: Record<string, string | undefined>;
  data?: unknown;
}): Promise<T> {
  const internalClient = getVcInternalClient(params.client);
  return (await internalClient.request({
    method: params.method,
    url: params.url,
    params: params.query ?? {},
    data: params.data ?? {},
    timeout: FEISHU_VC_REQUEST_TIMEOUT_MS,
  })) as T;
}

function normalizePageSize(pageSize: number | undefined): string | undefined {
  if (typeof pageSize !== "number" || !Number.isFinite(pageSize)) {
    return undefined;
  }
  return String(Math.min(Math.max(Math.floor(pageSize), 1), 50));
}

async function searchMeetings(
  client: Lark.Client,
  params: {
    start_time?: string;
    end_time?: string;
    query?: string;
    page_size?: number;
    page_token?: string;
  },
) {
  const query: Record<string, string | undefined> = {
    page_size: normalizePageSize(params.page_size) ?? "20",
    page_token: params.page_token,
    start_time: params.start_time,
    end_time: params.end_time,
    query: params.query,
    user_id_type: "open_id",
  };

  const response = await requestVcApi<FeishuVcSearchResponse>({
    client,
    method: "GET",
    url: "/open-apis/vc/v1/meetings",
    query,
  });

  if (response.code !== 0) {
    throw new Error(response.msg ?? "Feishu VC search failed");
  }

  return {
    meetings:
      response.data?.meetings?.map((m) => ({
        meeting_id: m.meeting_id,
        topic: m.topic,
        start_time: m.start_time,
        end_time: m.end_time,
        status: m.status,
        organizer: m.organizer,
        meeting_number: m.meeting_number,
      })) ?? [],
    has_more: response.data?.has_more ?? false,
    page_token: response.data?.page_token,
  };
}

async function getMeetingNotes(client: Lark.Client, meetingId: string) {
  const response = await requestVcApi<FeishuVcNotesResponse>({
    client,
    method: "GET",
    url: `/open-apis/vc/v1/meetings/${encodeURIComponent(meetingId)}/minutes`,
    query: { user_id_type: "open_id" },
  });

  if (response.code !== 0) {
    throw new Error(response.msg ?? "Feishu VC notes failed");
  }

  return {
    meeting_id: meetingId,
    minutes:
      response.data?.minutes?.map((m) => ({
        minute_id: m.minute_id,
        summary: m.summary,
        action_items: m.action_items,
        topics: m.topics,
        create_time: m.create_time,
      })) ?? [],
  };
}

async function getMeetingDetail(
  client: Lark.Client,
  meetingId: string,
  withParticipants?: boolean,
) {
  const query: Record<string, string | undefined> = {
    user_id_type: "open_id",
    with_participants: withParticipants ? "true" : undefined,
  };

  const response = await requestVcApi<FeishuVcDetailResponse>({
    client,
    method: "GET",
    url: `/open-apis/vc/v1/meetings/${encodeURIComponent(meetingId)}`,
    query,
  });

  if (response.code !== 0) {
    throw new Error(response.msg ?? "Feishu VC detail failed");
  }

  const data = response.data;
  return {
    meeting_id: data?.meeting_id,
    topic: data?.topic,
    start_time: data?.start_time,
    end_time: data?.end_time,
    status: data?.status,
    organizer: data?.organizer,
    meeting_number: data?.meeting_number,
    ...(withParticipants && { participants: data?.participants ?? [] }),
  };
}

// ============ Tool Registration ============

export function registerFeishuVcTools(api: KaijiBotPluginApi) {
  if (!api.config) {
    api.logger.debug?.("feishu_vc: No config available, skipping vc tools");
    return;
  }

  const accounts = listEnabledFeishuAccounts(api.config);
  if (accounts.length === 0) {
    api.logger.debug?.("feishu_vc: No Feishu accounts configured, skipping vc tools");
    return;
  }

  const toolsCfg = resolveAnyEnabledFeishuToolsConfig(accounts);
  if (!toolsCfg.vc) {
    api.logger.debug?.("feishu_vc: vc tool disabled in config");
    return;
  }

  type FeishuVcExecuteParams = FeishuVcParams & { accountId?: string };

  api.registerTool(
    (ctx) => {
      const defaultAccountId = ctx.agentAccountId;
      return {
        name: "feishu_vc",
        label: "Feishu VC",
        description: "Feishu video conference operations. Actions: search, notes, detail",
        parameters: FeishuVcSchema,
        async execute(_toolCallId, params) {
          const p = params as FeishuVcExecuteParams;
          try {
            const client = createFeishuToolClient({
              api,
              executeParams: p,
              defaultAccountId,
            });
            switch (p.action) {
              case "search":
                return jsonToolResult(
                  await searchMeetings(client, {
                    start_time: p.start_time,
                    end_time: p.end_time,
                    query: p.query,
                    page_size: p.page_size,
                    page_token: p.page_token,
                  }),
                );
              case "notes": {
                if (!p.meeting_id) {
                  return jsonToolResult({
                    error: "meeting_id is required for action notes",
                  });
                }
                return jsonToolResult(await getMeetingNotes(client, p.meeting_id));
              }
              case "detail": {
                if (!p.meeting_id) {
                  return jsonToolResult({
                    error: "meeting_id is required for action detail",
                  });
                }
                return jsonToolResult(
                  await getMeetingDetail(client, p.meeting_id, p.with_participants),
                );
              }
              default:
                return unknownToolActionResult((p as { action?: unknown }).action);
            }
          } catch (err) {
            return toolExecutionErrorResult(err);
          }
        },
      };
    },
    { name: "feishu_vc" },
  );

  api.logger.info?.(`feishu_vc: Registered feishu_vc tool`);
}
