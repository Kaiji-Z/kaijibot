import type { GatewayBrowserClient } from "../gateway.ts";

export type UsageDashboardState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  usageDashboardLoading: boolean;
  usageDashboardError: string | null;
  usageCostData: unknown | null;
  usageSessionsData: unknown | null;
  usageProviderStatus: unknown | null;
  requestUpdate?: () => void;
};

export async function loadUsageCost(state: UsageDashboardState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.usageDashboardLoading = true;
  state.requestUpdate?.();
  try {
    const [cost, sessions, status] = await Promise.all([
      state.client.request("usage.cost", { days: 30 }).catch((e) => (console.warn("usage.cost", e), null)),
      state.client.request("sessions.usage", { limit: 50 }).catch((e) => (console.warn("sessions.usage", e), null)),
      state.client.request("usage.status", {}).catch((e) => (console.warn("usage.status", e), null)),
    ]);
    state.usageCostData = cost;
    state.usageSessionsData = sessions;
    state.usageProviderStatus = status;
    const failures = [cost, sessions, status].filter((r) => r === null).length;
    state.usageDashboardError =
      failures > 0
        ? `${failures} of 3 usage RPCs failed — data may be incomplete`
        : null;
  } catch (err) {
    state.usageDashboardError = String(err);
  } finally {
    state.usageDashboardLoading = false;
    state.requestUpdate?.();
  }
}
