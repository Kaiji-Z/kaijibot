import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";

import {
  type DialogueAgent,
  type DialogueFile,
  groupDialoguesByDate,
} from "../controllers/dialogues.ts";
import { toSanitizedMarkdownHtml } from "../markdown.ts";
import {
  renderEmptyDetail,
  renderTwoColumnLayout,
} from "./cognitive-shared.ts";

export type DialoguesProps = {
  loading: boolean;
  error: string | null;
  list: { agents: DialogueAgent[] } | null;
  selectedAgentId: string | null;
  selectedFilename: string | null;
  content: string | null;
  contentLoading: boolean;
  contentError: string | null;
  onSelect: (agentId: string, filename: string) => void;
  onClearSelection: () => void;
  onRefresh: () => void;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function hasSelection(props: DialoguesProps): boolean {
  return Boolean(props.selectedAgentId && props.selectedFilename);
}

function renderSidebar(props: DialoguesProps): unknown {
  const { list, loading, error, selectedAgentId, selectedFilename } = props;

  if (loading && !list) {
    return html`
      <div style="display:flex;flex-direction:column;gap:8px;overflow-y:auto;">
        <h3 style="font-size:16px;font-weight:600;margin:0;">聊天记录</h3>
        <div class="muted" style="text-align:center;padding:32px 16px;">加载中…</div>
      </div>
    `;
  }

  if (error) {
    return html`
      <div style="display:flex;flex-direction:column;gap:8px;overflow-y:auto;">
        <h3 style="font-size:16px;font-weight:600;margin:0;">聊天记录</h3>
        <div class="callout danger">${error}</div>
        <button class="btn btn--sm" @click=${props.onRefresh}>重试</button>
      </div>
    `;
  }

  const agents = list?.agents ?? [];
  if (agents.every((a) => a.dialogues.length === 0)) {
    return html`
      <div style="display:flex;flex-direction:column;gap:8px;overflow-y:auto;">
        <h3 style="font-size:16px;font-weight:600;margin:0;">聊天记录</h3>
        <div class="muted" style="text-align:center;padding:32px 16px;">
          暂无归档对话。每次 /new 或 /reset 时会自动保存对话到 memory/dialogues/。
        </div>
      </div>
    `;
  }

  return html`
    <div style="display:flex;flex-direction:column;gap:8px;overflow-y:auto;">
      <div class="row" style="justify-content:space-between;">
        <h3 style="font-size:16px;font-weight:600;margin:0;">聊天记录</h3>
        <button class="btn btn--sm" @click=${props.onRefresh}>刷新</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;">
        ${agents.map((agent) => renderAgentSection(agent, selectedAgentId, selectedFilename, props))}
      </div>
    </div>
  `;
}

function renderAgentSection(
  agent: DialogueAgent,
  selectedAgentId: string | null,
  selectedFilename: string | null,
  props: DialoguesProps,
): unknown {
  if (agent.dialogues.length === 0) {
    return nothing;
  }
  const grouped = groupDialoguesByDate(agent.dialogues);
  return html`
    <div>
      <div
        style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--muted);margin-bottom:6px;padding:0 4px;"
      >
        ${agent.agentId}
        <span style="font-weight:400;text-transform:none;">(${agent.dialogues.length} 篇)</span>
      </div>
      <div style="display:grid;gap:8px;">
        ${grouped.map(
          (group) => html`
            <div>
              <div
                style="font-size:11px;color:var(--muted);padding:2px 4px 4px;border-bottom:1px solid var(--border);margin-bottom:4px;"
              >
                ${group.date}
              </div>
              <div style="display:grid;gap:4px;">
                ${group.items.map(
                  (d) =>
                    renderDialogueItem(agent.agentId, d, selectedAgentId, selectedFilename, props),
                )}
              </div>
            </div>
          `,
        )}
      </div>
    </div>
  `;
}

function renderDialogueItem(
  agentId: string,
  dialogue: DialogueFile,
  selectedAgentId: string | null,
  selectedFilename: string | null,
  props: DialoguesProps,
): unknown {
  const isSelected = selectedAgentId === agentId && selectedFilename === dialogue.filename;
  return html`
    <div
      class="list-item-clickable${isSelected ? " list-item-selected" : ""}"
      style="border:1px solid ${isSelected ? "var(--accent)" : "var(--border)"};border-radius:var(--radius-md);padding:8px 10px;background:var(--card);cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:8px;transition:border-color var(--duration-fast) var(--ease-out);"
      @click=${() => props.onSelect(agentId, dialogue.filename)}
    >
      <span style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        ${dialogue.time}
      </span>
      <span style="font-size:11px;color:var(--muted);flex-shrink:0;">
        ${formatSize(dialogue.size)}
      </span>
    </div>
  `;
}

function renderDetail(props: DialoguesProps): unknown {
  const hasSel = hasSelection(props);
  if (!hasSel) {
    return renderEmptyDetail(
      "选择一个对话",
      "从左侧选择 agent 和日期下的对话以查看完整内容。",
    );
  }

  if (props.contentLoading) {
    return html`
      <div class="card" style="display:flex;align-items:center;justify-content:center;min-height:300px;">
        <div class="muted">加载对话内容…</div>
      </div>
    `;
  }

  if (props.contentError) {
    return html`
      <div class="card" style="padding:16px;">
        <div class="callout danger">${props.contentError}</div>
      </div>
    `;
  }

  if (!props.content) {
    return renderEmptyDetail("对话为空", "该文件没有内容。");
  }

  return html`
    <div class="card" style="padding:20px;max-height:100%;overflow-y:auto;">
      <div class="markdown-body">
        ${unsafeHTML(toSanitizedMarkdownHtml(props.content))}
      </div>
    </div>
  `;
}

export function renderDialogues(props: DialoguesProps): unknown {
  const detailActive = hasSelection(props);
  const contextLabel = props.selectedFilename
    ? `${props.selectedAgentId ?? ""} · ${props.selectedFilename}`
    : undefined;
  return renderTwoColumnLayout(
    renderSidebar(props),
    renderDetail(props),
    detailActive,
    props.onClearSelection,
    contextLabel,
  );
}
