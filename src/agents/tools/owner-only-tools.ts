export const KAIJIBOT_OWNER_ONLY_CORE_TOOL_NAMES = ["cron", "gateway", "mcp_config", "nodes"] as const;

const KAIJIBOT_OWNER_ONLY_CORE_TOOL_NAME_SET: ReadonlySet<string> = new Set(
  KAIJIBOT_OWNER_ONLY_CORE_TOOL_NAMES,
);

export function isKaijiBotOwnerOnlyCoreToolName(toolName: string): boolean {
  return KAIJIBOT_OWNER_ONLY_CORE_TOOL_NAME_SET.has(toolName);
}
