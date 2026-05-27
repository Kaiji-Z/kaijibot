import type { GatewayBrowserClient } from "../gateway.ts";

export type InsightsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  insightsLoading: boolean;
  insightsError: string | null;
  insightsAgentId: string | null;
  insightsUserId: string | null;
  insightsList: unknown[];
  cognitivePersonaList: unknown | null;
  requestUpdate?: () => void;
};

export async function loadInsights(state: InsightsState) {
  if (!state.client || !state.connected || !state.insightsAgentId || !state.insightsUserId) return;
  state.insightsLoading = true;
  state.requestUpdate?.();
  try {
    const res = await state.client.request("cognitive.insights.list", {
      agentId: state.insightsAgentId,
      userId: state.insightsUserId,
    });
    state.insightsList = (res as { insights?: unknown[] }).insights ?? [];
    state.insightsError = null;
  } catch (err) {
    state.insightsError = String(err);
  } finally {
    state.insightsLoading = false;
    state.requestUpdate?.();
  }
}

export async function submitFeedback(
  state: InsightsState,
  agentId: string,
  userId: string,
  id: string,
  feedback: string,
) {
  if (!state.client || !state.connected) return;
  try {
    await state.client.request("cognitive.insights.feedback", {
      agentId,
      userId,
      id,
      feedback,
    });
    // Reload the list to reflect the updated feedback
    state.insightsAgentId = agentId;
    state.insightsUserId = userId;
    await loadInsights(state);
  } catch (err) {
    state.insightsError = String(err);
    state.requestUpdate?.();
  }
}
