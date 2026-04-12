export type McpLoopbackRuntime = {
  port: number;
  token: string;
};

let activeRuntime: McpLoopbackRuntime | undefined;

export function getActiveMcpLoopbackRuntime(): McpLoopbackRuntime | undefined {
  return activeRuntime ? { ...activeRuntime } : undefined;
}

export function setActiveMcpLoopbackRuntime(runtime: McpLoopbackRuntime): void {
  activeRuntime = { ...runtime };
}

export function clearActiveMcpLoopbackRuntime(token: string): void {
  if (activeRuntime?.token === token) {
    activeRuntime = undefined;
  }
}

export function createMcpLoopbackServerConfig(port: number) {
  return {
    mcpServers: {
      kaijibot: {
        type: "http",
        url: `http://127.0.0.1:${port}/mcp`,
        headers: {
          Authorization: "Bearer ${KAIJIBOT_MCP_TOKEN}",
          "x-session-key": "${KAIJIBOT_MCP_SESSION_KEY}",
          "x-kaijibot-agent-id": "${KAIJIBOT_MCP_AGENT_ID}",
          "x-kaijibot-account-id": "${KAIJIBOT_MCP_ACCOUNT_ID}",
          "x-kaijibot-message-channel": "${KAIJIBOT_MCP_MESSAGE_CHANNEL}",
        },
      },
    },
  };
}
