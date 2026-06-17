import type { GatewayBrowserClient } from "../gateway.ts";

export type CognitiveState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  cognitiveLoading: boolean;
  cognitiveError: string | null;
  cognitiveAgentId: string | null;
  cognitiveUserId: string | null;
  cognitivePersonaList: unknown | null;
  cognitivePersonaDetail: unknown | null;
  requestUpdate?: () => void;
};

export async function loadPersonaList(state: CognitiveState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.cognitiveLoading = true;
  state.requestUpdate?.();
  try {
    const res = await state.client.request("cognitive.persona.list", {});
    state.cognitivePersonaList = res;
    state.cognitiveError = null;
  } catch (err) {
    state.cognitiveError = String(err);
  } finally {
    state.cognitiveLoading = false;
    state.requestUpdate?.();
  }
}

export async function loadPersonaDetail(state: CognitiveState) {
  if (!state.client || !state.connected || !state.cognitiveAgentId || !state.cognitiveUserId) {
    return;
  }
  state.cognitiveLoading = true;
  state.requestUpdate?.();
  try {
    const res = await state.client.request("cognitive.persona.detail", {
      agentId: state.cognitiveAgentId,
      userId: state.cognitiveUserId,
    });
    state.cognitivePersonaDetail = res;
    state.cognitiveError = null;
  } catch (err) {
    state.cognitiveError = String(err);
  } finally {
    state.cognitiveLoading = false;
    state.requestUpdate?.();
  }
}
