import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { t } from "../i18n/index.ts";
import { refreshChatAvatar } from "./app-chat.ts";
import { syncUrlWithSessionKey } from "./app-settings.ts";
import type { AppViewState } from "./app-view-state.ts";
import { KaijiBotApp } from "./app.ts";
import { createChatModelOverride } from "./chat-model-ref.ts";
import {
  resolveChatModelOverrideValue,
  resolveChatModelSelectState,
} from "./chat-model-select-state.ts";
import { refreshVisibleToolsEffectiveForCurrentSession } from "./controllers/agents.ts";
import { ChatState, loadChatHistory } from "./controllers/chat.ts";
import { loadSessions } from "./controllers/sessions.ts";
import { icons } from "./icons.ts";
import { iconForTab, pathForTab, titleForTab, type Tab } from "./navigation.ts";
import { parseAgentSessionKey } from "./session-key.ts";
import { normalizeLowercaseStringOrEmpty, normalizeOptionalString } from "./string-coerce.ts";
import type { ThemeMode } from "./theme.ts";
import {
  listThinkingLevelLabels,
  normalizeThinkLevel,
  resolveThinkingDefaultForModel,
} from "./thinking.ts";
import type { SessionsListResult } from "./types.ts";

type SessionDefaultsSnapshot = {
  mainSessionKey?: string;
  mainKey?: string;
};

export function resolveSidebarChatSessionKey(state: AppViewState): string {
  const snapshot = state.hello?.snapshot as
    | { sessionDefaults?: SessionDefaultsSnapshot }
    | undefined;
  const mainSessionKey = normalizeOptionalString(snapshot?.sessionDefaults?.mainSessionKey);
  if (mainSessionKey) {
    return mainSessionKey;
  }
  const mainKey = normalizeOptionalString(snapshot?.sessionDefaults?.mainKey);
  if (mainKey) {
    return mainKey;
  }
  return "main";
}

export function resetChatStateForSessionSwitch(state: AppViewState, sessionKey: string) {
  state.sessionKey = sessionKey;
  state.chatMessage = "";
  state.chatAttachments = [];
  state.chatMessages = [];
  state.chatToolMessages = [];
  state.chatStreamSegments = [];
  state.chatThinkingLevel = null;
  state.chatStream = null;
  state.lastError = null;
  state.compactionStatus = null;
  state.fallbackStatus = null;
  state.chatAvatarUrl = null;
  state.chatQueue = [];
  (state as unknown as KaijiBotApp).chatStreamStartedAt = null;
  state.chatRunId = null;
  (state as unknown as KaijiBotApp).resetToolStream();
  (state as unknown as KaijiBotApp).resetChatScroll();
  state.applySettings({
    ...state.settings,
    sessionKey,
    lastActiveSessionKey: sessionKey,
  });
}

export function renderTab(state: AppViewState, tab: Tab, opts?: { collapsed?: boolean }) {
  const href = pathForTab(tab, state.basePath);
  const isActive = state.tab === tab;
  const collapsed = opts?.collapsed ?? state.settings.navCollapsed;
  return html`
    <a
      href=${href}
      class="nav-item ${isActive ? "nav-item--active" : ""}"
      @click=${(event: MouseEvent) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        if (tab === "chat") {
          const mainSessionKey = resolveSidebarChatSessionKey(state);
          if (state.sessionKey !== mainSessionKey) {
            resetChatStateForSessionSwitch(state, mainSessionKey);
            void state.loadAssistantIdentity();
          }
        }
        state.setTab(tab);
      }}
      title=${titleForTab(tab)}
    >
      <span class="nav-item__icon" aria-hidden="true">${icons[iconForTab(tab)]}</span>
      ${!collapsed ? html`<span class="nav-item__text">${titleForTab(tab)}</span>` : nothing}
    </a>
  `;
}

function renderCronFilterIcon(hiddenCount: number) {
  return html`
    <span style="position: relative; display: inline-flex; align-items: center;">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
      </svg>
      ${hiddenCount > 0
        ? html`<span
            style="
              position: absolute;
              top: -5px;
              right: -6px;
              background: var(--color-accent, #6366f1);
              color: #fff;
              border-radius: var(--radius-full);
              font-size: 9px;
              line-height: 1;
              padding: 1px 3px;
              pointer-events: none;
            "
            >${hiddenCount}</span
          >`
        : ""}
    </span>
  `;
}

export function renderChatSessionSelect(state: AppViewState) {
  const sessionGroups = resolveSessionOptionGroups(state, state.sessionKey, state.sessionsResult);
  const modelSelect = renderChatModelSelect(state);
  const thinkingSelect = renderChatThinkingSelect(state);
  const selectedSessionLabel =
    sessionGroups.flatMap((group) => group.options).find((entry) => entry.key === state.sessionKey)
      ?.label ?? state.sessionKey;
  return html`
    <div class="chat-controls__session-row">
      <label class="field chat-controls__session">
        <select
          .value=${state.sessionKey}
          title=${selectedSessionLabel}
          ?disabled=${!state.connected || sessionGroups.length === 0}
          @change=${(e: Event) => {
            const next = (e.target as HTMLSelectElement).value;
            if (state.sessionKey === next) {
              return;
            }
            switchChatSession(state, next);
          }}
        >
          ${repeat(
            sessionGroups,
            (group) => group.id,
            (group) =>
              html`<optgroup label=${group.label}>
                ${repeat(
                  group.options,
                  (entry) => entry.key,
                  (entry) =>
                    html`<option value=${entry.key} title=${entry.title}>${entry.label}</option>`,
                )}
              </optgroup>`,
          )}
        </select>
      </label>
      ${modelSelect} ${thinkingSelect}
    </div>
  `;
}



export function switchChatSession(state: AppViewState, nextSessionKey: string) {
  resetChatStateForSessionSwitch(state, nextSessionKey);
  void state.loadAssistantIdentity();
  void refreshChatAvatar(state);
  syncUrlWithSessionKey(
    state as unknown as Parameters<typeof syncUrlWithSessionKey>[0],
    nextSessionKey,
    true,
  );
  void loadChatHistory(state as unknown as ChatState);
  void refreshSessionOptions(state);
}

async function refreshSessionOptions(state: AppViewState) {
  await loadSessions(state as unknown as Parameters<typeof loadSessions>[0], {
    activeMinutes: 0,
    limit: 0,
    includeGlobal: true,
    includeUnknown: true,
  });
}

function renderChatModelSelect(state: AppViewState) {
  const { currentOverride, defaultLabel, options } = resolveChatModelSelectState(state);
  const busy =
    state.chatLoading || state.chatSending || Boolean(state.chatRunId) || state.chatStream !== null;
  const disabled =
    !state.connected || busy || (state.chatModelsLoading && options.length === 0) || !state.client;
  const selectedLabel =
    currentOverride === ""
      ? defaultLabel
      : (options.find((entry) => entry.value === currentOverride)?.label ?? currentOverride);
  return html`
    <label class="field chat-controls__session chat-controls__model">
      <select
        data-chat-model-select="true"
        aria-label="Chat model"
        title=${selectedLabel}
        ?disabled=${disabled}
        @change=${async (e: Event) => {
          const next = (e.target as HTMLSelectElement).value.trim();
          await switchChatModel(state, next);
        }}
      >
        <option value="" ?selected=${currentOverride === ""}>${defaultLabel}</option>
        ${repeat(
          options,
          (entry) => entry.value,
          (entry) =>
            html`<option value=${entry.value} ?selected=${entry.value === currentOverride}>
              ${entry.label}
            </option>`,
        )}
      </select>
    </label>
  `;
}

type ChatThinkingSelectOption = {
  value: string;
  label: string;
};

type ChatThinkingSelectState = {
  currentOverride: string;
  defaultLabel: string;
  options: ChatThinkingSelectOption[];
};

function resolveThinkingTargetModel(state: AppViewState): {
  provider: string | null;
  model: string | null;
} {
  const activeRow = state.sessionsResult?.sessions?.find((row) => row.key === state.sessionKey);
  return {
    provider: activeRow?.modelProvider ?? state.sessionsResult?.defaults?.modelProvider ?? null,
    model: activeRow?.model ?? state.sessionsResult?.defaults?.model ?? null,
  };
}

function buildThinkingOptions(
  provider: string | null,
  model: string | null,
  currentOverride: string,
): ChatThinkingSelectOption[] {
  const seen = new Set<string>();
  const options: ChatThinkingSelectOption[] = [];

  const addOption = (value: string, label?: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    const key = normalizeLowercaseStringOrEmpty(trimmed);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    options.push({
      value: trimmed,
      label:
        label ??
        trimmed
          .split(/[-_]/g)
          .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
          .join(" "),
    });
  };

  for (const label of listThinkingLevelLabels(provider)) {
    const normalized = normalizeThinkLevel(label) ?? normalizeLowercaseStringOrEmpty(label);
    addOption(normalized);
  }
  if (currentOverride) {
    addOption(currentOverride);
  }
  return options;
}

function resolveChatThinkingSelectState(state: AppViewState): ChatThinkingSelectState {
  const activeRow = state.sessionsResult?.sessions?.find((row) => row.key === state.sessionKey);
  const persisted = activeRow?.thinkingLevel;
  const currentOverride =
    typeof persisted === "string" && persisted.trim()
      ? (normalizeThinkLevel(persisted) ?? persisted.trim())
      : "";
  const { provider, model } = resolveThinkingTargetModel(state);
  const defaultLevel =
    provider && model
      ? resolveThinkingDefaultForModel({
          provider,
          model,
          catalog: state.chatModelCatalog ?? [],
        })
      : "off";
  return {
    currentOverride,
    defaultLabel: `Default (${defaultLevel})`,
    options: buildThinkingOptions(provider, model, currentOverride),
  };
}

function renderChatThinkingSelect(state: AppViewState) {
  const { currentOverride, defaultLabel, options } = resolveChatThinkingSelectState(state);
  const busy =
    state.chatLoading || state.chatSending || Boolean(state.chatRunId) || state.chatStream !== null;
  const disabled = !state.connected || busy || !state.client;
  const selectedLabel =
    currentOverride === ""
      ? defaultLabel
      : (options.find((entry) => entry.value === currentOverride)?.label ?? currentOverride);
  return html`
    <label class="field chat-controls__session chat-controls__thinking-select">
      <select
        data-chat-thinking-select="true"
        aria-label="Chat thinking level"
        title=${selectedLabel}
        ?disabled=${disabled}
        @change=${async (e: Event) => {
          const next = (e.target as HTMLSelectElement).value.trim();
          await switchChatThinkingLevel(state, next);
        }}
      >
        <option value="" ?selected=${currentOverride === ""}>${defaultLabel}</option>
        ${repeat(
          options,
          (entry) => entry.value,
          (entry) =>
            html`<option value=${entry.value} ?selected=${entry.value === currentOverride}>
              ${entry.label}
            </option>`,
        )}
      </select>
    </label>
  `;
}

async function switchChatModel(state: AppViewState, nextModel: string) {
  if (!state.client || !state.connected) {
    return;
  }
  const currentOverride = resolveChatModelOverrideValue(state);
  if (currentOverride === nextModel) {
    return;
  }
  const targetSessionKey = state.sessionKey;
  const prevOverride = state.chatModelOverrides[targetSessionKey];
  state.lastError = null;
  // Write the override cache immediately so the picker stays in sync during the RPC round-trip.
  state.chatModelOverrides = {
    ...state.chatModelOverrides,
    [targetSessionKey]: createChatModelOverride(nextModel),
  };
  try {
    await state.client.request("sessions.patch", {
      key: targetSessionKey,
      model: nextModel || null,
    });
    void refreshVisibleToolsEffectiveForCurrentSession(state);
    await refreshSessionOptions(state);
  } catch (err) {
    // Roll back so the picker reflects the actual server model.
    state.chatModelOverrides = { ...state.chatModelOverrides, [targetSessionKey]: prevOverride };
    state.lastError = `Failed to set model: ${String(err)}`;
  }
}

function patchSessionThinkingLevel(
  state: AppViewState,
  sessionKey: string,
  thinkingLevel: string | undefined,
) {
  const current = state.sessionsResult;
  if (!current) {
    return;
  }
  state.sessionsResult = {
    ...current,
    sessions: current.sessions.map((row) =>
      row.key === sessionKey
        ? {
            ...row,
            thinkingLevel,
          }
        : row,
    ),
  };
}

async function switchChatThinkingLevel(state: AppViewState, nextThinkingLevel: string) {
  if (!state.client || !state.connected) {
    return;
  }
  const targetSessionKey = state.sessionKey;
  const activeRow = state.sessionsResult?.sessions?.find((row) => row.key === targetSessionKey);
  const previousThinkingLevel = activeRow?.thinkingLevel;
  const normalizedNext =
    (normalizeThinkLevel(nextThinkingLevel) ?? nextThinkingLevel.trim()) || undefined;
  const normalizedPrev =
    typeof previousThinkingLevel === "string" && previousThinkingLevel.trim()
      ? (normalizeThinkLevel(previousThinkingLevel) ?? previousThinkingLevel.trim())
      : undefined;
  if ((normalizedPrev ?? "") === (normalizedNext ?? "")) {
    return;
  }
  state.lastError = null;
  patchSessionThinkingLevel(state, targetSessionKey, normalizedNext);
  state.chatThinkingLevel = normalizedNext ?? null;
  try {
    await state.client.request("sessions.patch", {
      key: targetSessionKey,
      thinkingLevel: normalizedNext ?? null,
    });
    await refreshSessionOptions(state);
  } catch (err) {
    patchSessionThinkingLevel(state, targetSessionKey, previousThinkingLevel);
    state.chatThinkingLevel = normalizedPrev ?? null;
    state.lastError = `Failed to set thinking level: ${String(err)}`;
  }
}

/* ── Channel display labels ────────────────────────────── */
const CHANNEL_LABELS: Record<string, string> = {
  bluebubbles: "iMessage",
  telegram: "Telegram",
  discord: "Discord",
  signal: "Signal",
  slack: "Slack",
  whatsapp: "WhatsApp",
  matrix: "Matrix",
  email: "Email",
  sms: "SMS",
};

const KNOWN_CHANNEL_KEYS = Object.keys(CHANNEL_LABELS);

/** Parsed type / context extracted from a session key. */
export type SessionKeyInfo = {
  /** Prefix for typed sessions (Subagent:/Cron:). Empty for others. */
  prefix: string;
  /** Human-readable fallback when no label / displayName is available. */
  fallbackName: string;
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Parse a session key to extract type information and a human-readable
 * fallback display name.  Exported for testing.
 */
export function parseSessionKey(key: string): SessionKeyInfo {
  const normalized = normalizeLowercaseStringOrEmpty(key);

  // ── Main session ─────────────────────────────────
  if (key === "main" || key === "agent:main:main") {
    return { prefix: "", fallbackName: "Main Session" };
  }

  // ── Subagent ─────────────────────────────────────
  if (key.includes(":subagent:")) {
    return { prefix: "Subagent:", fallbackName: "Subagent:" };
  }

  // ── Cron job ─────────────────────────────────────
  if (normalized.startsWith("cron:") || key.includes(":cron:")) {
    return { prefix: "Cron:", fallbackName: "Cron Job:" };
  }

  // ── Direct chat  (agent:<x>:<channel>:direct:<id>) ──
  const directMatch = key.match(/^agent:[^:]+:([^:]+):direct:(.+)$/);
  if (directMatch) {
    const channel = directMatch[1];
    const identifier = directMatch[2];
    const channelLabel = CHANNEL_LABELS[channel] ?? capitalize(channel);
    return { prefix: "", fallbackName: `${channelLabel} · ${identifier}` };
  }

  // ── Group chat  (agent:<x>:<channel>:group:<id>) ────
  const groupMatch = key.match(/^agent:[^:]+:([^:]+):group:(.+)$/);
  if (groupMatch) {
    const channel = groupMatch[1];
    const channelLabel = CHANNEL_LABELS[channel] ?? capitalize(channel);
    return { prefix: "", fallbackName: `${channelLabel} Group` };
  }

  // ── Channel-prefixed legacy keys (e.g. "bluebubbles:g-…") ──
  for (const ch of KNOWN_CHANNEL_KEYS) {
    if (key === ch || key.startsWith(`${ch}:`)) {
      return { prefix: "", fallbackName: `${CHANNEL_LABELS[ch]} Session` };
    }
  }

  // ── Unknown — return key as-is ───────────────────
  return { prefix: "", fallbackName: key };
}

export function resolveSessionDisplayName(
  key: string,
  row?: SessionsListResult["sessions"][number],
): string {
  const label = normalizeOptionalString(row?.label) ?? "";
  const displayName = normalizeOptionalString(row?.displayName) ?? "";
  const { prefix, fallbackName } = parseSessionKey(key);

  const applyTypedPrefix = (name: string): string => {
    if (!prefix) {
      return name;
    }
    const prefixPattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*`, "i");
    return prefixPattern.test(name) ? name : `${prefix} ${name}`;
  };

  if (label && label !== key) {
    return applyTypedPrefix(label);
  }
  if (displayName && displayName !== key) {
    return applyTypedPrefix(displayName);
  }
  return fallbackName;
}

export function isCronSessionKey(key: string): boolean {
  const normalized = normalizeLowercaseStringOrEmpty(key);
  if (!normalized) {
    return false;
  }
  if (normalized.startsWith("cron:")) {
    return true;
  }
  if (!normalized.startsWith("agent:")) {
    return false;
  }
  const parts = normalized.split(":").filter(Boolean);
  if (parts.length < 3) {
    return false;
  }
  const rest = parts.slice(2).join(":");
  return rest.startsWith("cron:");
}

type SessionOptionEntry = {
  key: string;
  label: string;
  scopeLabel: string;
  title: string;
};

type SessionOptionGroup = {
  id: string;
  label: string;
  options: SessionOptionEntry[];
};

export function resolveSessionOptionGroups(
  state: AppViewState,
  sessionKey: string,
  sessions: SessionsListResult | null,
): SessionOptionGroup[] {
  const rows = sessions?.sessions ?? [];
  const hideCron = state.sessionsHideCron ?? true;
  const byKey = new Map<string, SessionsListResult["sessions"][number]>();
  for (const row of rows) {
    byKey.set(row.key, row);
  }

  const seenKeys = new Set<string>();
  const groups = new Map<string, SessionOptionGroup>();
  const ensureGroup = (groupId: string, label: string): SessionOptionGroup => {
    const existing = groups.get(groupId);
    if (existing) {
      return existing;
    }
    const created: SessionOptionGroup = {
      id: groupId,
      label,
      options: [],
    };
    groups.set(groupId, created);
    return created;
  };

  const addOption = (key: string) => {
    if (!key || seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);
    const row = byKey.get(key);
    const parsed = parseAgentSessionKey(key);
    const group = parsed
      ? ensureGroup(
          `agent:${normalizeLowercaseStringOrEmpty(parsed.agentId)}`,
          resolveAgentGroupLabel(state, parsed.agentId),
        )
      : ensureGroup("other", "Other Sessions");
    const scopeLabel = normalizeOptionalString(parsed?.rest) ?? key;
    const label = resolveSessionScopedOptionLabel(key, row, parsed?.rest);
    group.options.push({
      key,
      label,
      scopeLabel,
      title: key,
    });
  };

  for (const row of rows) {
    if (row.key !== sessionKey && (row.kind === "global" || row.kind === "unknown")) {
      continue;
    }
    if (hideCron && row.key !== sessionKey && isCronSessionKey(row.key)) {
      continue;
    }
    addOption(row.key);
  }
  addOption(sessionKey);

  for (const group of groups.values()) {
    const counts = new Map<string, number>();
    for (const option of group.options) {
      counts.set(option.label, (counts.get(option.label) ?? 0) + 1);
    }
    for (const option of group.options) {
      if ((counts.get(option.label) ?? 0) > 1 && option.scopeLabel !== option.label) {
        option.label = `${option.label} · ${option.scopeLabel}`;
      }
    }
  }

  const allOptions = Array.from(groups.values()).flatMap((group) =>
    group.options.map((option) => ({ groupLabel: group.label, option })),
  );
  const labels = new Map(allOptions.map(({ option }) => [option, option.label]));
  const countAssignedLabels = () => {
    const counts = new Map<string, number>();
    for (const { option } of allOptions) {
      const label = labels.get(option) ?? option.label;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return counts;
  };
  const labelIncludesScopeLabel = (label: string, scopeLabel: string) => {
    const trimmedScope = scopeLabel.trim();
    if (!trimmedScope) {
      return false;
    }
    return (
      label === trimmedScope ||
      label.endsWith(` · ${trimmedScope}`) ||
      label.endsWith(` / ${trimmedScope}`)
    );
  };

  const globalCounts = countAssignedLabels();
  for (const { groupLabel, option } of allOptions) {
    const currentLabel = labels.get(option) ?? option.label;
    if ((globalCounts.get(currentLabel) ?? 0) <= 1) {
      continue;
    }
    const scopedPrefix = `${groupLabel} / `;
    if (currentLabel.startsWith(scopedPrefix)) {
      continue;
    }
    // Keep the agent visible once the native select collapses to a single chosen label.
    labels.set(option, `${groupLabel} / ${currentLabel}`);
  }

  const scopedCounts = countAssignedLabels();
  for (const { option } of allOptions) {
    const currentLabel = labels.get(option) ?? option.label;
    if ((scopedCounts.get(currentLabel) ?? 0) <= 1) {
      continue;
    }
    if (labelIncludesScopeLabel(currentLabel, option.scopeLabel)) {
      continue;
    }
    labels.set(option, `${currentLabel} · ${option.scopeLabel}`);
  }

  const finalCounts = countAssignedLabels();
  for (const { option } of allOptions) {
    const currentLabel = labels.get(option) ?? option.label;
    if ((finalCounts.get(currentLabel) ?? 0) <= 1) {
      continue;
    }
    // Fall back to the full key only when every friendlier disambiguator still collides.
    labels.set(option, `${currentLabel} · ${option.key}`);
  }

  for (const { option } of allOptions) {
    option.label = labels.get(option) ?? option.label;
  }

  return Array.from(groups.values());
}

/** Count sessions with a cron: key that would be hidden when hideCron=true. */
function countHiddenCronSessions(sessionKey: string, sessions: SessionsListResult | null): number {
  if (!sessions?.sessions) {
    return 0;
  }
  // Don't count the currently active session even if it's a cron.
  return sessions.sessions.filter((s) => isCronSessionKey(s.key) && s.key !== sessionKey).length;
}

function resolveAgentGroupLabel(state: AppViewState, agentIdRaw: string): string {
  const normalized = normalizeLowercaseStringOrEmpty(agentIdRaw);
  const agent = (state.agentsList?.agents ?? []).find(
    (entry) => normalizeLowercaseStringOrEmpty(entry.id) === normalized,
  );
  const name =
    normalizeOptionalString(agent?.identity?.name) ?? normalizeOptionalString(agent?.name) ?? "";
  return name && name !== agentIdRaw ? `${name} (${agentIdRaw})` : agentIdRaw;
}

function resolveSessionScopedOptionLabel(
  key: string,
  row?: SessionsListResult["sessions"][number],
  rest?: string,
) {
  const base = normalizeOptionalString(rest) ?? key;
  if (!row) {
    return base;
  }

  const label = normalizeOptionalString(row.label) ?? "";
  const displayName = normalizeOptionalString(row.displayName) ?? "";
  if ((label && label !== key) || (displayName && displayName !== key)) {
    return resolveSessionDisplayName(key, row);
  }

  return base;
}

type ThemeModeOption = { id: ThemeMode; label: string; short: string };
const THEME_MODE_OPTIONS: ThemeModeOption[] = [
  { id: "system", label: "System", short: "SYS" },
  { id: "light", label: "Light", short: "LIGHT" },
  { id: "dark", label: "Dark", short: "DARK" },
];

/**
 * Generic theme-mode selector suitable for settings drawers or context menus.
 *
 * CSS for `.theme-mode-select*` lives in `components.css` (Wave 5).
 * The old `.topbar-theme-mode*` classes are no longer emitted.
 */
export function renderThemeModeSelect(state: AppViewState) {
  const modeIcon = (mode: ThemeMode) => {
    if (mode === "system") return icons.monitor;
    if (mode === "light") return icons.sun;
    return icons.moon;
  };

  const applyMode = (mode: ThemeMode, e: Event) => {
    if (mode === state.themeMode) return;
    state.setThemeMode(mode, { element: e.currentTarget as HTMLElement });
  };

  return html`
    <div class="theme-mode-select" role="group" aria-label="Color mode">
      ${THEME_MODE_OPTIONS.map(
        (opt) => html`
          <button
            type="button"
            class="theme-mode-select__btn ${opt.id === state.themeMode
              ? "theme-mode-select__btn--active"
              : ""}"
            title=${opt.label}
            aria-label="Color mode: ${opt.label}"
            aria-pressed=${opt.id === state.themeMode}
            @click=${(e: Event) => applyMode(opt.id, e)}
          >
            ${modeIcon(opt.id)}
            <span class="theme-mode-select__label">${opt.label}</span>
          </button>
        `,
      )}
    </div>
  `;
}

/** @deprecated Use renderThemeModeSelect instead */
export const renderTopbarThemeModeToggle = renderThemeModeSelect;

export function renderConnectionStatusDot(state: AppViewState) {
  const label = state.connected ? t("common.online") : t("common.offline");
  const toneClass = state.connected
    ? "connection-status__dot"
    : "connection-status__dot connection-status__dot--disconnected";

  return html`
    <span
      class="${toneClass}"
      role="img"
      aria-live="polite"
      aria-label="Gateway status: ${label}"
      title="Gateway status: ${label}"
    ></span>
  `;
}

/** @deprecated Use renderConnectionStatusDot instead */
export const renderSidebarConnectionStatus = renderConnectionStatusDot;

/* ── Input area controls (model chip, thinking chip, token ring, settings popover) ── */

export function renderModelChip(
  state: AppViewState,
  open: boolean,
  onToggle: () => void,
) {
  const { currentOverride, defaultLabel, options } = resolveChatModelSelectState(state);
  const busy =
    state.chatLoading || state.chatSending || Boolean(state.chatRunId) || state.chatStream !== null;
  const disabled =
    !state.connected || busy || (state.chatModelsLoading && options.length === 0) || !state.client;
  const selectedLabel =
    currentOverride === ""
      ? defaultLabel
      : (options.find((entry) => entry.value === currentOverride)?.label ?? currentOverride);
  const display = selectedLabel.length > 22 ? selectedLabel.slice(0, 20) + "…" : selectedLabel;
  return html`
    <label class="model-chip" title=${selectedLabel} style="position:relative;display:inline-flex;">
      <button
        class="model-chip__trigger"
        type="button"
        ?disabled=${disabled}
        @click=${(e: Event) => { e.stopPropagation(); onToggle(); }}
      >${display} ▾</button>
      ${open
        ? html`<div class="chip-dropdown chip-dropdown--up" @click=${(e: Event) => e.stopPropagation()}>
            <button
              class="chip-dropdown__item ${currentOverride === "" ? "chip-dropdown__item--active" : ""}"
              @click=${async () => { await switchChatModel(state, ""); onToggle(); }}
            >${defaultLabel}</button>
            ${repeat(
              options,
              (entry) => entry.value,
              (entry) => html`
                <button
                  class="chip-dropdown__item ${entry.value === currentOverride ? "chip-dropdown__item--active" : ""}"
                  @click=${async () => { await switchChatModel(state, entry.value); onToggle(); }}
                >${entry.label}</button>
              `,
            )}
          </div>`
        : nothing}
    </label>
  `;
}

export function renderThinkingChip(
  state: AppViewState,
  open: boolean,
  onToggle: () => void,
) {
  const { currentOverride, defaultLabel, options } = resolveChatThinkingSelectState(state);
  const busy =
    state.chatLoading || state.chatSending || Boolean(state.chatRunId) || state.chatStream !== null;
  const disabled = !state.connected || busy || !state.client;
  const levelDots = (val: string): string => {
    const n = normalizeLowercaseStringOrEmpty(val);
    if (n === "off") return "○";
    if (n === "low") return "●";
    if (n === "medium") return "●●";
    if (n === "high") return "●●●";
    if (n === "default") return "Auto";
    return val.slice(0, 3);
  };
  const display = currentOverride === "" ? "Auto" : levelDots(currentOverride);
  return html`
    <label class="thinking-chip" title=${currentOverride === "" ? defaultLabel : currentOverride} style="position:relative;display:inline-flex;">
      <button
        class="thinking-chip__trigger"
        type="button"
        ?disabled=${disabled}
        @click=${(e: Event) => { e.stopPropagation(); onToggle(); }}
      >${display} ▾</button>
      ${open
        ? html`<div class="chip-dropdown chip-dropdown--up" @click=${(e: Event) => e.stopPropagation()}>
            <button
              class="chip-dropdown__item ${currentOverride === "" ? "chip-dropdown__item--active" : ""}"
              @click=${async () => { await switchChatThinkingLevel(state, ""); onToggle(); }}
            >${defaultLabel}</button>
            ${repeat(
              options,
              (entry) => entry.value,
              (entry) => html`
                <button
                  class="chip-dropdown__item ${entry.value === currentOverride ? "chip-dropdown__item--active" : ""}"
                  @click=${async () => { await switchChatThinkingLevel(state, entry.value); onToggle(); }}
                >${entry.label}</button>
              `,
            )}
          </div>`
        : nothing}
    </label>
  `;
}

export function renderSessionChip(
  state: AppViewState,
  open: boolean,
  onToggle: () => void,
) {
  const groups = resolveSessionOptionGroups(state, state.sessionKey, state.sessionsResult);
  if (groups.length === 0) {
    return nothing;
  }
  const allOptions = groups.flatMap((g) => g.options);
  const current = allOptions.find((opt) => opt.key === state.sessionKey);
  const fullLabel = current?.label ?? state.sessionKey;
  const displayLabel = fullLabel.length > 20 ? fullLabel.slice(0, 18) + "…" : fullLabel;
  return html`
    <label class="session-chip" title=${fullLabel}>
      <button
        class="session-chip__trigger"
        type="button"
        ?disabled=${!state.connected}
        @click=${(e: Event) => { e.stopPropagation(); onToggle(); }}
      >${displayLabel} ▾</button>
      ${open
        ? html`<div class="chip-dropdown chip-dropdown--up" @click=${(e: Event) => e.stopPropagation()}>
            ${groups.map(
              (group) => html`
                <div class="chip-dropdown__group">
                  ${groups.length > 1
                    ? html`<div class="chip-dropdown__group-label">${group.label}</div>`
                    : nothing}
                  ${group.options.map(
                    (opt) => html`
                      <button
                        class="chip-dropdown__item ${opt.key === state.sessionKey ? "chip-dropdown__item--active" : ""}"
                        @click=${() => {
                          if (opt.key !== state.sessionKey) {
                            switchChatSession(state, opt.key);
                          }
                          onToggle();
                        }}
                      >${opt.label}</button>
                    `,
                  )}
                </div>
              `,
            )}
          </div>`
        : nothing}
    </label>
  `;
}

export function renderTokenRing(used: number, total: number) {
  if (!used || !total) return nothing;
  const ratio = Math.min(used / total, 1);
  const pct = Math.round(ratio * 100);
  const r = 9;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - ratio);
  const color =
    ratio < 0.5 ? "var(--ok)" : ratio < 0.8 ? "var(--warn)" : "var(--danger)";
  return html`
    <span class="token-ring" title="${used.toLocaleString()} / ${total.toLocaleString()} tokens (${pct}%)">
      <svg class="token-ring__svg" width="32" height="32" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r=${r} fill="none" stroke="var(--border-strong)" stroke-width="2.5" />
        <circle
          cx="12"
          cy="12"
          r=${r}
          fill="none"
          stroke=${color}
          stroke-width="2.5"
          stroke-dasharray=${circ}
          stroke-dashoffset=${offset}
          stroke-linecap="round"
          transform="rotate(-90 12 12)"
        />
      </svg>
    </span>
  `;
}

export function renderInputSettingsPopover(
  state: AppViewState,
  open: boolean,
  onToggle: () => void,
) {
  const showThinking = state.onboarding ? false : state.settings.chatShowThinking;
  const showToolCalls = state.onboarding ? true : state.settings.chatShowToolCalls;
  const focusActive = state.onboarding ? true : state.settings.chatFocusMode;
  const hideCron = state.sessionsHideCron ?? true;
  const toggleRow = (
    icon: unknown,
    label: string,
    checked: boolean,
    onChange: () => void,
  ) => html`
    <label class="input-settings-popover__toggle-row">
      <span class="input-settings-popover__toggle-icon">${icon}</span>
      <span class="input-settings-popover__toggle-label">${label}</span>
      <input
        type="checkbox"
        class="input-settings-popover__checkbox"
        .checked=${checked}
        @change=${onChange}
      />
      <span class="input-settings-popover__switch">
        <span class="input-settings-popover__switch-thumb"></span>
      </span>
    </label>
  `;
  return html`
    <div class="input-settings-wrapper">
      <button
        class="agent-chat__input-btn ${open ? "agent-chat__input-btn--active" : ""}"
        @click=${(e: Event) => {
          e.stopPropagation();
          onToggle();
        }}
        title="Chat settings"
        aria-label="Chat settings"
      >
        ${icons.settings}
      </button>
      ${open
        ? html`
            <div class="input-settings-popover" @click=${(e: Event) => e.stopPropagation()}>
              ${toggleRow(
                icons.brain,
                "Show thinking",
                showThinking,
                () =>
                  state.applySettings({
                    ...state.settings,
                    chatShowThinking: !state.settings.chatShowThinking,
                  }),
              )}
              ${toggleRow(
                icons.settings,
                "Show tool calls",
                showToolCalls,
                () =>
                  state.applySettings({
                    ...state.settings,
                    chatShowToolCalls: !state.settings.chatShowToolCalls,
                  }),
              )}
              ${toggleRow(
                icons.eye,
                "Focus mode",
                focusActive,
                () =>
                  state.applySettings({
                    ...state.settings,
                    chatFocusMode: !state.settings.chatFocusMode,
                  }),
              )}
              ${toggleRow(
                renderCronFilterIcon(
                  hideCron
                    ? countHiddenCronSessions(state.sessionKey, state.sessionsResult)
                    : 0,
                ),
                "Hide cron",
                hideCron,
                () => {
                  state.sessionsHideCron = !hideCron;
                },
              )}
            </div>
          `
        : nothing}
    </div>
  `;
}

const ACTIVE_FINE_STATUSES = new Set(["thinking", "tool_call", "streaming"]);

function countActiveSessions(sessionDetails: Record<string, import("./views/agents-utils.js").SessionDetailState>): number {
  let count = 0;
  for (const detail of Object.values(sessionDetails)) {
    if (ACTIVE_FINE_STATUSES.has(detail.fineStatus)) count++;
  }
  return count;
}

function formatRelativeTime(ms: number | null | undefined): string {
  if (!ms) return "";
  const diff = ms - Date.now();
  if (diff <= 0) return "now";
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return remainMins ? `${hours}h ${remainMins}m` : `${hours}h`;
}

export function renderSidebarSessionList(state: AppViewState) {
  const groups = resolveSessionOptionGroups(state, state.sessionKey, state.sessionsResult);
  if (groups.length === 0) {
    return nothing;
  }
  return html`
    <div class="shell-nav__sessions">
      <div class="shell-nav__section-title">Sessions</div>
      ${groups.map(
        (group) => html`
          ${groups.length > 1
            ? html`<div class="shell-nav__session-group-title">${group.label}</div>`
            : nothing}
          ${group.options.map(
            (opt) => html`
              <button
                type="button"
                class="shell-nav__session-item ${opt.key === state.sessionKey
                  ? "shell-nav__session-item--active"
                  : ""}"
                title=${opt.title}
                ?disabled=${opt.key === state.sessionKey}
                @click=${() => {
                  if (opt.key !== state.sessionKey) {
                    switchChatSession(state, opt.key);
                  }
                }}
              >
                <span class="shell-nav__session-dot"></span>
                <span class="shell-nav__session-item-label">${opt.label}</span>
              </button>
            `,
          )}
        `,
      )}
    </div>
  `;
}

function formatUptime(ms: number | null | undefined): string {
  if (!ms) return "—";
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function renderSidebarStatusSection(state: AppViewState) {
  const agents = state.agentsList?.agents ?? [];
  const agentCount = agents.length;
  const activeCount = countActiveSessions(state.sessionDetails ?? {});
  const agentDotClass = activeCount > 0 ? "shell-nav__status-dot--ok" : "shell-nav__status-dot--idle";

  const cronEnabled = state.cronStatus?.enabled ?? false;
  const cronJobs = state.cronStatus?.jobs ?? 0;
  const nextWake = formatRelativeTime(state.cronStatus?.nextWakeAtMs);
  const cronDotClass = cronEnabled ? "shell-nav__status-dot--ok" : "shell-nav__status-dot--idle";

  const uptime = formatUptime(state.gatewayUptimeMs);

  const usage = state.usageStatus;
  let usageLabel = "—";
  let usageDotClass: string = "shell-nav__status-dot--idle";
  if (usage?.providers?.length) {
    const peak = Math.max(
      ...usage.providers.flatMap((p) => p.windows?.map((w) => w.usedPercent ?? 0) ?? []),
      0,
    );
    usageLabel = `${Math.round(peak)}%`;
    usageDotClass = peak >= 90 ? "shell-nav__status-dot--warn" : peak > 0 ? "shell-nav__status-dot--ok" : "shell-nav__status-dot--idle";
  }

  const cog = state.cognitiveStatus;
  const cogEnabled = cog?.enabled ?? false;
  const cogDotClass = cogEnabled ? "shell-nav__status-dot--ok" : "shell-nav__status-dot--idle";
  const cogDomains = cog?.domains ?? 0;
  const cogInsights = cog?.insights ?? 0;
  const cogLabel = cogEnabled
    ? [
        cogDomains > 0 ? `${cogDomains} domains` : "",
        cogInsights > 0 ? `${cogInsights} insights` : "",
      ]
        .filter(Boolean)
        .join(" · ") || "Active"
    : "Disabled";

  return html`
    <div class="shell-nav__section">
      <div class="shell-nav__section-title">System</div>
      <div class="shell-nav__status-row">
        <span class="shell-nav__status-label">Agents</span>
        <span class="shell-nav__status-value">
          ${agentCount}${activeCount > 0 ? html` · ${activeCount} active` : ""}
          <span class="shell-nav__status-dot ${agentDotClass}"></span>
        </span>
      </div>
      <div class="shell-nav__status-row" style="cursor:pointer" @click=${() => state.setTab("cron")}>
        <span class="shell-nav__status-label">Cron</span>
        <span class="shell-nav__status-value">
          ${cronEnabled ? html`${cronJobs} jobs${nextWake ? html` · ${nextWake}` : ""}` : "Disabled"}
          <span class="shell-nav__status-dot ${cronDotClass}"></span>
        </span>
      </div>
      <div class="shell-nav__status-row">
        <span class="shell-nav__status-label">Uptime</span>
        <span class="shell-nav__status-value">
          ${uptime}
          <span class="shell-nav__status-dot ${state.gatewayUptimeMs ? "shell-nav__status-dot--ok" : "shell-nav__status-dot--idle"}"></span>
        </span>
      </div>
      <div class="shell-nav__status-row">
        <span class="shell-nav__status-label">Usage</span>
        <span class="shell-nav__status-value">
          ${usageLabel}
          <span class="shell-nav__status-dot ${usageDotClass}"></span>
        </span>
      </div>
      <div class="shell-nav__status-row">
        <span class="shell-nav__status-label">Cognitive</span>
        <span class="shell-nav__status-value">
          ${cogLabel}
          <span class="shell-nav__status-dot ${cogDotClass}"></span>
        </span>
      </div>
    </div>
  `;
}
