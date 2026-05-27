import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { formatRelativeTimestamp } from "../format.ts";
import { icons } from "../icons.ts";
import type { GatewaySessionRow } from "../types.ts";

// ── Types ─────────────────────────────────────────────

export type TranscriptMessage = {
  role?: string;
  content?: unknown;
  timestamp?: number;
};

export type HistoryProps = {
  loading: boolean;
  error: string | null;
  sessions: GatewaySessionRow[];
  searchQuery: string;
  selectedKey: string | null;
  preview: unknown | null;
  messages: TranscriptMessage[];
  onSearch: (query: string) => void;
  onSelectSession: (key: string) => void;
  onRefresh: () => void;
  onDeleteSession: (key: string) => void;
};

// ── Helpers ───────────────────────────────────────────

function messageRoleLabel(role: string): string {
  switch (role) {
    case "user":
      return "User";
    case "assistant":
      return "Assistant";
    case "tool":
      return "Tool";
    case "system":
      return "System";
    default:
      return role;
  }
}

function roleBadgeClass(role: string): string {
  switch (role) {
    case "user":
      return "pill accent";
    case "assistant":
      return "pill";
    case "tool":
      return "pill muted";
    case "system":
      return "pill dim";
    default:
      return "pill";
  }
}

function extractText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((p): p is { type: string; text?: string } => typeof p === "object" && p !== null)
      .map((p) => (p.type === "text" && typeof p.text === "string" ? p.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  if (content == null) {
    return "";
  }
  try {
    return typeof content === "object" ? JSON.stringify(content) : String(content);
  } catch {
    return "";
  }
}

function formatRelativeTime(ts: number | null | undefined): string {
  if (ts == null || !Number.isFinite(ts)) {
    return "";
  }
  return formatRelativeTimestamp(ts);
}

// ── Sub-renders ───────────────────────────────────────

function renderSessionCard(
  session: GatewaySessionRow,
  isSelected: boolean,
  onSelect: () => void,
  onDelete: (key: string) => void,
) {
  const label = session.label || session.displayName || "";
  const updated = formatRelativeTime(session.updatedAt);

  return html`
    <div
      class="card ${isSelected ? "selected" : ""}"
      style="cursor:pointer; padding:var(--space-sm); border-left:3px solid ${isSelected ? "var(--accent)" : "transparent"};"
      @click=${onSelect}
    >
      <div style="display:flex; justify-content:space-between; align-items:center; gap:var(--space-xs);">
        <span class="text-mono" style="font-size:0.8em; word-break:break-all;">${session.key}</span>
        <div style="display:flex; align-items:center; gap:6px;">
          ${updated
            ? html`<span class="text-muted" style="font-size:0.75em; white-space:nowrap;"
                >${updated}</span
              >`
            : nothing}
          <button
            class="btn-icon danger"
            title="Delete session"
            style="font-size:14px;"
            @click=${(e: Event) => { e.stopPropagation(); onDelete(session.key); }}
          >${icons.trash}</button>
        </div>
      </div>
      ${label
        ? html`<div class="text-muted" style="font-size:0.85em; margin-top:2px;">
            ${label}
          </div>`
        : nothing}
    </div>
  `;
}

function renderMessage(msg: TranscriptMessage) {
  const role = msg.role ?? "unknown";
  const text = extractText(msg.content);
  const ts = formatRelativeTime(msg.timestamp ?? null);

  return html`
    <div class="stack" style="gap:var(--space-xs); padding:var(--space-xs) 0;">
      <div style="display:flex; align-items:center; gap:var(--space-xs);">
        <span class="${roleBadgeClass(role)}">${messageRoleLabel(role)}</span>
        ${ts ? html`<span class="text-muted" style="font-size:0.75em;">${ts}</span>` : nothing}
      </div>
      <div style="white-space:pre-wrap; word-break:break-word; font-size:0.9em; line-height:1.5;">
${text}</div>
    </div>
  `;
}

// ── Main render ───────────────────────────────────────

export function renderHistory(props: HistoryProps) {
  if (props.loading) {
    return html`<div class="page-loader">${t("common.loading")}</div>`;
  }
  if (props.error) {
    return html`<div class="callout danger">${props.error}</div>`;
  }

  const filteredSessions = filterSessions(props.sessions, props.searchQuery);

  return html`
    <section class="stack">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h3>${t("tabs.history")}</h3>
        <button class="btn" @click=${props.onRefresh}>
          ${icons.refresh} ${t("common.refresh")}
        </button>
      </div>

      <div style="display:grid; grid-template-columns:40% 60%; gap:var(--space-md); min-height:60vh;">
        <!-- Left panel: session list -->
        <div class="stack" style="gap:var(--space-sm); overflow-y:auto; max-height:75vh;">
          <input
            type="text"
            class="input"
            placeholder="${t("common.search")}…"
            .value=${props.searchQuery}
            @input=${(e: Event) => {
              const target = e.target as HTMLInputElement;
              props.onSearch(target.value);
            }}
          />

          ${filteredSessions.length === 0
            ? html`<div class="callout">${props.searchQuery ? "No matching sessions." : "No sessions found."}</div>`
            : filteredSessions.map(
                (s) =>
                  renderSessionCard(s, s.key === props.selectedKey, () =>
                    props.onSelectSession(s.key),
                  props.onDeleteSession,
                  ),
              )}
        </div>

        <!-- Right panel: transcript viewer -->
        <div
          class="card"
          style="overflow-y:auto; max-height:75vh; padding:var(--space-md);"
        >
          ${props.selectedKey == null
            ? html`<div class="callout">Select a session to view its transcript.</div>`
            : props.messages.length === 0
              ? html`<div class="callout">No messages in this session.</div>`
              : html`<div class="stack" style="gap:var(--space-sm);">
                  ${props.messages.map((msg) => renderMessage(msg))}
                </div>`}
        </div>
      </div>
    </section>
  `;
}

// ── Filter helper ─────────────────────────────────────

function filterSessions(sessions: GatewaySessionRow[], query: string): GatewaySessionRow[] {
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
