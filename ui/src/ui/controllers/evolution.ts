import type { GatewayBrowserClient } from "../gateway.ts";

export type EvolutionState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  evolutionLoading: boolean;
  evolutionError: string | null;
  evolutionAgentId: string | null;
  evolutionUserId: string | null;
  evolutionRecords: unknown[];
  evolutionAuditEntries: unknown[];
  requestUpdate?: () => void;
};

export async function loadEvolutionRecords(state: EvolutionState) {
  if (!state.client || !state.connected || !state.evolutionAgentId || !state.evolutionUserId) {
    return;
  }
  state.evolutionLoading = true;
  state.requestUpdate?.();
  try {
    const res = await state.client.request("cognitive.evolution.list", {
      agentId: state.evolutionAgentId,
      userId: state.evolutionUserId,
    });
    state.evolutionRecords = (res as { records?: unknown[] }).records ?? [];
    state.evolutionError = null;
  } catch (err) {
    state.evolutionError = String(err);
  } finally {
    state.evolutionLoading = false;
    state.requestUpdate?.();
  }
}

export async function loadEvolutionAudit(state: EvolutionState) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request("cognitive.evolution.audit", {});
    state.evolutionAuditEntries = (res as { entries?: unknown[] }).entries ?? [];
  } catch {
    // non-critical
  }
  state.requestUpdate?.();
}
