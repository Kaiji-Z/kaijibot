import type { GatewayBrowserClient } from "../gateway.ts";

export type DialogueFile = {
  filename: string;
  date: string;
  time: string;
  size: number;
};

export type DialogueAgent = {
  agentId: string;
  workspace: string;
  dialogues: DialogueFile[];
};

export type DialogueListResult = {
  agents: DialogueAgent[];
};

export type DialogueContent = {
  agentId: string;
  filename: string;
  path: string;
  size: number;
  content: string;
};

export type DialoguesState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  dialoguesLoading: boolean;
  dialoguesError: string | null;
  dialoguesList: DialogueListResult | null;
  dialoguesSelectedAgentId: string | null;
  dialoguesSelectedFilename: string | null;
  dialoguesContent: string | null;
  dialoguesContentLoading: boolean;
  dialoguesContentError: string | null;
  requestUpdate?: () => void;
};

export async function loadDialoguesList(state: DialoguesState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.dialoguesLoading = true;
  state.dialoguesError = null;
  state.requestUpdate?.();
  try {
    const res = await state.client.request("dialogues.list", {});
    state.dialoguesList = res as DialogueListResult;
  } catch (err) {
    state.dialoguesError = String(err);
    state.dialoguesList = null;
  } finally {
    state.dialoguesLoading = false;
    state.requestUpdate?.();
  }
}

export async function loadDialogueContent(
  state: DialoguesState,
  agentId: string,
  filename: string,
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.dialoguesSelectedAgentId = agentId;
  state.dialoguesSelectedFilename = filename;
  state.dialoguesContent = null;
  state.dialoguesContentError = null;
  state.dialoguesContentLoading = true;
  state.requestUpdate?.();
  try {
    const res = await state.client.request("dialogues.get", { agentId, filename });
    state.dialoguesContent = (res as DialogueContent)?.content ?? null;
  } catch (err) {
    state.dialoguesContentError = String(err);
    state.dialoguesContent = null;
  } finally {
    state.dialoguesContentLoading = false;
    state.requestUpdate?.();
  }
}

export function clearDialogueSelection(state: DialoguesState) {
  state.dialoguesSelectedAgentId = null;
  state.dialoguesSelectedFilename = null;
  state.dialoguesContent = null;
  state.dialoguesContentError = null;
  state.requestUpdate?.();
}

/**
 * Group dialogues by date for the sidebar's Agent → Date → Dialogue hierarchy.
 * Returns a sorted map (newest date first) of date → dialogues.
 */
export function groupDialoguesByDate(
  dialogues: DialogueFile[],
): Array<{ date: string; items: DialogueFile[] }> {
  const byDate = new Map<string, DialogueFile[]>();
  for (const d of dialogues) {
    const bucket = byDate.get(d.date);
    if (bucket) {
      bucket.push(d);
    } else {
      byDate.set(d.date, [d]);
    }
  }
  return [...byDate.entries()]
    .map(([date, items]) => ({ date, items }))
    .toSorted((a, b) => b.date.localeCompare(a.date));
}
