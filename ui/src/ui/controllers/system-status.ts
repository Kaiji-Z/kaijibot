import type { MemoryHealthStatus, UsageStatusResult, CognitiveStatusResult } from "../types.js";

export interface SystemStatusState {
  client: { request<T>(method: string, params: Record<string, unknown>): Promise<T> } | null;
  connected: boolean;
  memoryHealth: MemoryHealthStatus | null;
  usageStatus: UsageStatusResult | null;
  cognitiveStatus: CognitiveStatusResult | null;
}

export async function loadMemoryHealth(state: SystemStatusState): Promise<void> {
  if (!state.client || !state.connected) {return;}
  try {
    const res = await state.client.request<{
      agentId: string;
      provider?: string;
      embedding: { ok: boolean; error?: string };
    }>("doctor.memory.status", {});
    state.memoryHealth = {
      ok: res.embedding.ok,
      provider: res.provider,
      error: res.embedding.error,
    };
  } catch {
    state.memoryHealth = { ok: false, error: "unavailable" };
  }
}

export async function loadUsageStatus(state: SystemStatusState): Promise<void> {
  if (!state.client || !state.connected) {return;}
  try {
    const res = await state.client.request<UsageStatusResult>("usage.status", {});
    state.usageStatus = res;
  } catch {
    // silently ignore — usage is optional
  }
}

export async function loadCognitiveStatus(state: SystemStatusState): Promise<void> {
  if (!state.client || !state.connected) {return;}
  try {
    const res = await state.client.request<CognitiveStatusResult>("cognitive.status", {});
    state.cognitiveStatus = res;
  } catch {
    // silently ignore — cognitive is optional
  }
}
