import type { GatewaySessionRow } from "../types.ts";
import type { GatewayBrowserClient } from "../gateway.ts";

export type TranscriptMessage = {
  role?: string;
  content?: unknown;
  timestamp?: number;
};

export type HistoryState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  historyLoading: boolean;
  historyError: string | null;
  historySessions: GatewaySessionRow[];
  historySearchQuery: string;
  historySelectedKey: string | null;
  historyPreview: unknown | null;
  historyMessages: TranscriptMessage[];
  requestUpdate?: () => void;
};

export async function loadHistorySessions(state: HistoryState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.historyLoading = true;
  state.requestUpdate?.();
  try {
    const res = await state.client.request("sessions.list", {});
    state.historySessions = (res as { sessions?: GatewaySessionRow[] }).sessions ?? [];
    state.historyError = null;
  } catch (err) {
    state.historyError = String(err);
  } finally {
    state.historyLoading = false;
    state.requestUpdate?.();
  }
}

export async function loadSessionMessages(state: HistoryState, key: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.historySelectedKey = key;
  state.historyMessages = [];
  state.requestUpdate?.();
  try {
    const res = await state.client.request("sessions.get", { key, limit: 200 });
    state.historyMessages = (res as { messages?: TranscriptMessage[] }).messages ?? [];
  } catch {
    state.historyMessages = [];
  }
  state.requestUpdate?.();
}

export async function deleteHistorySession(state: HistoryState, key: string) {
  if (!state.client || !state.connected) {return;}
  state.historyLoading = true;
  state.requestUpdate?.();
  try {
    await state.client.request("sessions.delete", { key, deleteTranscript: true });
    state.historySessions = state.historySessions.filter((s) => s.key !== key);
    if (state.historySelectedKey === key) {
      state.historySelectedKey = null;
      state.historyMessages = [];
    }
    state.historyError = null;
  } catch (err) {
    state.historyError = String(err);
  } finally {
    state.historyLoading = false;
    state.requestUpdate?.();
  }
}

export function filterHistorySessions(
  sessions: GatewaySessionRow[],
  query: string,
): GatewaySessionRow[] {
  if (!query.trim()) {
    return sessions;
  }
  const q = query.toLowerCase();
  return sessions.filter((s) => {
    const key = s.key.toLowerCase();
    const label = (s.label ?? s.displayName ?? "").toLowerCase();
    return key.includes(q) || label.includes(q);
  });
}
