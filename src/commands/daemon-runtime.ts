export type GatewayDaemonRuntime = "node" | "bun";

export const DEFAULT_GATEWAY_DAEMON_RUNTIME: GatewayDaemonRuntime = "node";

export const GATEWAY_DAEMON_RUNTIME_OPTIONS: Array<{
  value: GatewayDaemonRuntime;
  label: string;
  hint?: string;
}> = [
  {
    value: "node",
    label: "Node (recommended)",
    hint: "Node 运行时稳定性最佳，推荐使用。",
  },
];

export function isGatewayDaemonRuntime(value: string | undefined): value is GatewayDaemonRuntime {
  return value === "node" || value === "bun";
}
