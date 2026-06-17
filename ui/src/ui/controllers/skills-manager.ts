import type { GatewayBrowserClient } from "../gateway.ts";
import type { SkillStatusReport } from "../types.ts";

type ClawHubSkillSearchResult = {
  score: number;
  slug: string;
  displayName: string;
  summary?: string;
  version?: string;
  updatedAt?: number;
};

export type SkillsManagerState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  skillsManagerLoading: boolean;
  skillsManagerError: string | null;
  skillsManagerInstalled: SkillStatusReport | null;
  skillsManagerSearchQuery: string;
  skillsManagerSearchResults: ClawHubSkillSearchResult[];
  skillsManagerDetail: unknown | null;
  skillsManagerInstalling: boolean;
  skillsManagerUpdating: boolean;
  skillsManagerActionSlug: string | null;
  requestUpdate?: () => void;
};

export async function loadSkillsInstalled(state: SkillsManagerState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.skillsManagerLoading = true;
  state.requestUpdate?.();
  try {
    const res = await state.client.request("skills.status", {});
    state.skillsManagerInstalled = res as SkillStatusReport;
    state.skillsManagerError = null;
  } catch (err) {
    state.skillsManagerError = String(err);
  } finally {
    state.skillsManagerLoading = false;
    state.requestUpdate?.();
  }
}

export async function searchSkills(state: SkillsManagerState, query: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.skillsManagerSearchQuery = query;
  state.requestUpdate?.();
  try {
    const res = await state.client.request("skills.search", { query, limit: 20 });
    const results = (res as { results?: ClawHubSkillSearchResult[] }).results ?? [];
    state.skillsManagerSearchResults = results;
  } catch {
    state.skillsManagerSearchResults = [];
  }
  state.requestUpdate?.();
}

export async function installSkill(state: SkillsManagerState, slug: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.skillsManagerInstalling = true;
  state.skillsManagerActionSlug = slug;
  state.requestUpdate?.();
  try {
    await state.client.request("skills.install", { source: "clawhub", slug });
    state.skillsManagerError = null;
  } catch (err) {
    state.skillsManagerError = String(err);
  } finally {
    state.skillsManagerInstalling = false;
    state.skillsManagerActionSlug = null;
    state.requestUpdate?.();
    await loadSkillsInstalled(state);
  }
}

export async function updateSkill(state: SkillsManagerState, slug: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.skillsManagerUpdating = true;
  state.skillsManagerActionSlug = slug;
  state.requestUpdate?.();
  try {
    await state.client.request("skills.update", { source: "clawhub", slug });
    state.skillsManagerError = null;
  } catch (err) {
    state.skillsManagerError = String(err);
  } finally {
    state.skillsManagerUpdating = false;
    state.skillsManagerActionSlug = null;
    state.requestUpdate?.();
    await loadSkillsInstalled(state);
  }
}
