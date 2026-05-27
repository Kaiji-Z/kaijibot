import type { GatewayBrowserClient } from "../gateway.ts";

export type CorrectionsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  correctionsLoading: boolean;
  correctionsError: string | null;
  correctionsAgentId: string | null;
  correctionsUserId: string | null;
  correctionsUserIds: string[];
  correctionsList: unknown[];
  requestUpdate?: () => void;
};

export async function loadCorrectionUsers(state: CorrectionsState) {
  if (!state.client || !state.connected || !state.correctionsAgentId) return;
  state.correctionsLoading = true;
  state.requestUpdate?.();
  try {
    const res = await state.client.request("cognitive.corrections.users", {
      agentId: state.correctionsAgentId,
    });
    state.correctionsUserIds = (res as { userIds?: string[] }).userIds ?? [];
    state.correctionsError = null;
  } catch (err) {
    state.correctionsError = String(err);
  } finally {
    state.correctionsLoading = false;
    state.requestUpdate?.();
  }
}

export async function loadCorrections(state: CorrectionsState) {
  if (!state.client || !state.connected || !state.correctionsAgentId || !state.correctionsUserId) return;
  state.correctionsLoading = true;
  state.requestUpdate?.();
  try {
    const res = await state.client.request("cognitive.corrections.list", {
      agentId: state.correctionsAgentId,
      userId: state.correctionsUserId,
    });
    state.correctionsList = (res as { corrections?: unknown[] }).corrections ?? [];
    state.correctionsError = null;
  } catch (err) {
    state.correctionsError = String(err);
  } finally {
    state.correctionsLoading = false;
    state.requestUpdate?.();
  }
}
