import { expect } from "vitest";
import type { KaijiBotConfig } from "../api.js";
import { createMemoryGetTool, createMemorySearchTool } from "./tools.js";

export function asKaijiBotConfig(config: Partial<KaijiBotConfig>): KaijiBotConfig {
  return config;
}

export function createDefaultMemoryToolConfig(): KaijiBotConfig {
  return asKaijiBotConfig({ agents: { list: [{ id: "main", default: true }] } });
}

export function createMemorySearchToolOrThrow(params?: {
  config?: KaijiBotConfig;
  agentSessionKey?: string;
}) {
  const tool = createMemorySearchTool({
    config: params?.config ?? createDefaultMemoryToolConfig(),
    ...(params?.agentSessionKey ? { agentSessionKey: params.agentSessionKey } : {}),
  });
  if (!tool) {
    throw new Error("tool missing");
  }
  return tool;
}

export function createMemoryGetToolOrThrow(
  config: KaijiBotConfig = createDefaultMemoryToolConfig(),
) {
  const tool = createMemoryGetTool({ config });
  if (!tool) {
    throw new Error("tool missing");
  }
  return tool;
}

export function createAutoCitationsMemorySearchTool(agentSessionKey: string) {
  return createMemorySearchToolOrThrow({
    config: asKaijiBotConfig({
      memory: { citations: "auto" },
      agents: { list: [{ id: "main", default: true }] },
    }),
    agentSessionKey,
  });
}

export function expectUnavailableMemorySearchDetails(
  details: unknown,
  params: {
    error: string;
    warning: string;
    action: string;
  },
) {
  expect(details).toEqual({
    results: [],
    disabled: true,
    unavailable: true,
    error: params.error,
    warning: params.warning,
    action: params.action,
  });
}
