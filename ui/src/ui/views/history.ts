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
  onSelectSession: (key: string | null) => void;
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

/**
 * Parse a raw session key (e.g. "agent:main:cron:uuid") into a human-readable
 * label. The raw key is still used as the data/value attribute — this only
 * controls the display text shown to the user.
 */
function formatSessionLabel(key: string | null): string {
  if (!key) {
    return "";
  }
  const parts = key.split(":");
  if (parts.length >= 2) {
    const agent = parts[1];
    if (parts.length >= 3) {
      const third = parts[2];
      if (third === "main") {
        return `${agent} / main`;
      }
      if (third.startsWith("ou_")) {
        return `${agent} / ${third.slice(0, 12)}…`;
      }
      if (third === "cron") {
        return `${agent} / 定时任务`;
      }
      return `${agent} / ${third.slice(0, 20)}`;
    }
    return agent;
  }
  return key.slice(0, 30);
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
  const sessionLabel = formatSessionLabel(session.key);

  return html`
    <div
      class="card ${isSelected ? "selected" : ""}"
      style="cursor:pointer; padding:var(--space-xs) var(--space-sm); ${isSelected
        ? "background:var(--accent-subtle); border-color:var(--accent-muted);"
        : ""}"
      @click=${onSelect}
    >
      <div
        style="display:flex; justify-content:space-between; align-items:center; gap:var(--space-xs);"
      >
        <span
          class="text-mono"
          style="font-size:0.8em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0;"
          >${sessionLabel}</span
        >
        <div style="display:flex; align-items:center; gap:4px; flex-shrink:0;">
          ${updated
            ? html`<span class="text-muted" style="font-size:0.7em; white-space:nowrap;"
                >${updated}</span
              >`
            : nothing}
          <button
            class="btn-icon danger"
            title="Delete session"
            style="font-size:14px;"
            @click=${(e: Event) => {
              e.stopPropagation();
              onDelete(session.key);
            }}
          >
            ${icons.trash}
          </button>
        </div>
      </div>
      ${label
        ? html`<div
            class="text-muted"
            style="font-size:0.8em; margin-top:1px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"
          >
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
        ${text}
      </div>
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

      <div class="two-col-layout ${props.selectedKey ? "two-col-layout--detail" : ""}">
        <div class="two-col-layout__sidebar">
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
              ? html`<div class="callout">
                  ${props.searchQuery ? "No matching sessions." : "No sessions found."}
                </div>`
              : filteredSessions.map((s) =>
                  renderSessionCard(
                    s,
                    s.key === props.selectedKey,
                    () => props.onSelectSession(s.key),
                    props.onDeleteSession,
                  ),
                )}
          </div>
        </div>

        <div class="two-col-layout__detail">
          ${props.selectedKey
            ? html`<div class="two-col-back-bar" @click=${() => props.onSelectSession(null)}>
                <span class="two-col-back-bar__arrow" aria-hidden="true"></span
                ><span class="two-col-back-bar__context"
                  >${formatSessionLabel(props.selectedKey)}</span
                >
              </div>`
            : nothing}
          <div class="card" style="overflow-y:auto; max-height:75vh; padding:var(--space-md);">
            ${props.selectedKey == null
              ? html`<div class="callout">Select a session to view its transcript.</div>`
              : props.messages.length === 0
                ? html`<div class="callout">No messages in this session.</div>`
                : html`<div class="stack" style="gap:var(--space-sm);">
                    ${props.messages.map((msg) => renderMessage(msg))}
                  </div>`}
          </div>
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
