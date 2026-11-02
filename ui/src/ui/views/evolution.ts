import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import {
  parsePersonaList,
  renderUserSidebar,
  renderEmptyDetail,
  renderTwoColumnLayout,
} from "./cognitive-shared.ts";

// --- Local types (mirror src/cognitive/evolution/types.ts & audit-log.ts) ---

type EvolutionUserResponse = "accepted" | "modified" | "rejected";

type EvolutionCandidate = {
  taskSummary: string;
  toolCalls: string[];
  uniqueToolCount: number;
  reasoningTurns: number;
  durationMs: number;
  domain: string;
  transcript?: string;
  hasTrialAndError?: boolean;
  userCorrections?: number;
  trialErrorSignals?: string[];
  errorProfile?: {
    errorCount: number;
    failedToolNames: string[];
    hasMutatingErrors: boolean;
  };
};

type SkillDraft = {
  name: string;
  description: string;
  triggerPhrases: string[];
  bodyMarkdown: string;
  references?: Record<string, string>;
  scripts?: Record<string, string>;
  assets?: Record<string, string>;
};

type RecentSuggestionSummary = {
  skillName?: string;
  domain: string;
  hoursAgo: number;
  userResponse?: EvolutionUserResponse;
};

type EvolutionDecision = {
  shouldSuggest: boolean;
  confidence: number;
  complexityScore: number;
  reasoning: string;
  recentSuggestions?: RecentSuggestionSummary[];
};

type EvolutionRecord = {
  id: string;
  userId: string;
  candidate: EvolutionCandidate;
  decision?: EvolutionDecision;
  draft?: SkillDraft;
  userResponse?: EvolutionUserResponse;
  savedSkillPath?: string;
  timestamp: number;
};

type AuditEntry = {
  id: string;
  timestamp: number;
  operation: string;
  actor: string;
  target: string;
  outcome: "success" | "failure" | "skipped";
  agentId?: string;
  metadata?: Record<string, unknown>;
};

// --- Props ---

export type EvolutionProps = {
  loading: boolean;
  error: string | null;
  records: unknown[];
  auditEntries: unknown[];
  agentId: string | null;
  userId: string | null;
  personaList: unknown | null;
  onUserSelect: (agentId: string, userId: string) => void;
  onRefresh: () => void;
};

// --- Helpers ---

function relativeTime(epochMs: number): string {
  const diff = Date.now() - epochMs;
  if (diff < 0) {
    return t("evolution.justNow");
  }
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) {
    return t("evolution.justNow");
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return t("evolution.minutesAgo", { count: String(minutes) });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t("evolution.hoursAgo", { count: String(hours) });
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return t("evolution.daysAgo", { count: String(days) });
  }
  const months = Math.floor(days / 30);
  return t("evolution.monthsAgo", { count: String(months) });
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainSec = Math.floor(seconds % 60);
  return `${minutes}m ${remainSec}s`;
}

function complexityColor(score: number): string {
  if (score >= 0.7) {
    return "color: #ef4444; border-color: rgba(239,68,68,0.3); background: rgba(239,68,68,0.08);";
  }
  if (score >= 0.4) {
    return "color: #eab308; border-color: rgba(234,179,8,0.3); background: rgba(234,179,8,0.08);";
  }
  return "color: var(--muted);";
}

function userResponseBadge(response: EvolutionUserResponse | undefined) {
  if (!response) {
    return html`<span class="pill" style="opacity:0.6;">${t("evolution.noResponse")}</span>`;
  }
  const config: Record<EvolutionUserResponse, { label: string; style: string }> = {
    accepted: {
      label: t("evolution.accepted"),
      style: "color: #22c55e; border-color: rgba(34,197,94,0.3); background: rgba(34,197,94,0.08);",
    },
    modified: {
      label: t("evolution.modified"),
      style: "color: #eab308; border-color: rgba(234,179,8,0.3); background: rgba(234,179,8,0.08);",
    },
    rejected: {
      label: t("evolution.rejected"),
      style: "color: #ef4444; border-color: rgba(239,68,68,0.3); background: rgba(239,68,68,0.08);",
    },
  };
  const { label, style } = config[response];
  return html`<span class="pill" style="${style}">${label}</span>`;
}

function outcomeBadge(outcome: "success" | "failure" | "skipped") {
  const config = {
    success: {
      label: t("evolution.success"),
      style: "color: #22c55e; border-color: rgba(34,197,94,0.3); background: rgba(34,197,94,0.08);",
    },
    failure: {
      label: t("evolution.failure"),
      style: "color: #ef4444; border-color: rgba(239,68,68,0.3); background: rgba(239,68,68,0.08);",
    },
    skipped: {
      label: t("evolution.skipped"),
      style: "color: var(--muted); opacity: 0.6;",
    },
  };
  const { label, style } = config[outcome];
  return html`<span class="pill" style="${style}">${label}</span>`;
}

// --- Sub-renders ---

function renderRecordTimeline(records: EvolutionRecord[]) {
  if (records.length === 0) {
    return html`<div class="callout info">${t("evolution.emptyRecords")}</div>`;
  }

  return html`
    <div style="position: relative; padding-left: 24px;">
      <!-- Vertical timeline line -->
      <div
        style="
        position: absolute;
        left: 8px;
        top: 0;
        bottom: 0;
        width: 2px;
        background: var(--border, #e5e7eb);
      "
      ></div>

      ${records.map((rec) => {
        const c = rec.candidate;
        const d = rec.decision;

        return html`
          <div style="position: relative; margin-bottom: 16px;">
            <!-- Timeline dot -->
            <div
              style="
              position: absolute;
              left: -20px;
              top: 14px;
              width: 12px;
              height: 12px;
              border-radius: 50%;
              background: ${d?.shouldSuggest ? "#3b82f6" : "var(--muted, #9ca3af)"};
              border: 2px solid var(--bg, #fff);
            "
            ></div>

            <div class="card" style="padding: 12px;">
              <!-- Header: task summary + time -->
              <div
                style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px; margin-bottom:8px; flex-wrap:wrap;"
              >
                <div style="font-weight:600; flex:1; min-width:200px;">${c.taskSummary}</div>
                <span class="text-muted" style="font-size:0.85em; white-space:nowrap;"
                  >${relativeTime(rec.timestamp)}</span
                >
              </div>

              <!-- Badges row -->
              <div
                style="display:flex; align-items:center; gap:6px; margin-bottom:8px; flex-wrap:wrap;"
              >
                <span class="pill">${c.domain}</span>
                <span class="pill" style="font-size:0.8em;"
                  >${t("evolution.toolCallStats", {
                    calls: String(c.toolCalls.length),
                    unique: String(c.uniqueToolCount),
                  })}</span
                >
                <span class="pill" style="font-size:0.8em;">${formatDuration(c.durationMs)}</span>
                ${c.hasTrialAndError
                  ? html`<span class="pill warning" style="font-size:0.8em;"
                      >${t("evolution.trialAndError")}</span
                    >`
                  : nothing}
                ${d
                  ? html`
                      <span
                        class="pill"
                        style="font-size:0.8em; ${complexityColor(d.complexityScore)}"
                      >
                        ${t("evolution.complexity", {
                          percent: (d.complexityScore * 100).toFixed(0),
                        })}
                      </span>
                      <span
                        class="pill ${d.shouldSuggest ? "success" : ""}"
                        style="font-size:0.8em;"
                      >
                        ${d.shouldSuggest ? t("evolution.suggested") : t("evolution.notSuggested")}
                      </span>
                      <span class="pill" style="font-size:0.8em;">
                        ${t("evolution.confidence", { percent: (d.confidence * 100).toFixed(0) })}
                      </span>
                    `
                  : nothing}
              </div>

              <!-- Decision reasoning -->
              ${d?.reasoning
                ? html`
                    <div class="text-muted" style="font-size:0.85em; margin-bottom:8px;">
                      ${d.reasoning}
                    </div>
                  `
                : nothing}

              <!-- User response -->
              <div style="display:flex; align-items:center; gap:6px; margin-bottom:8px;">
                ${userResponseBadge(rec.userResponse)}
                ${rec.savedSkillPath
                  ? html`<span class="text-muted" style="font-size:0.8em;"
                      >→ ${rec.savedSkillPath}</span
                    >`
                  : nothing}
              </div>

              <!-- Skill draft preview -->
              ${rec.draft
                ? html`
                    <div class="callout info" style="padding:8px 12px; margin-top:4px;">
                      <div style="font-weight:600; margin-bottom:4px;">
                        ${t("evolution.draft", { name: rec.draft.name })}
                      </div>
                      <div class="text-muted" style="font-size:0.85em; margin-bottom:4px;">
                        ${rec.draft.description}
                      </div>
                      ${rec.draft.triggerPhrases.length > 0
                        ? html`
                            <div style="display:flex; gap:4px; flex-wrap:wrap;">
                              ${rec.draft.triggerPhrases.map(
                                (p) =>
                                  html`<span class="pill" style="font-size:0.75em;">"${p}"</span>`,
                              )}
                            </div>
                          `
                        : nothing}
                    </div>
                  `
                : nothing}
            </div>
          </div>
        `;
      })}
    </div>
  `;
}

function renderAuditTable(entries: AuditEntry[]) {
  if (entries.length === 0) {
    return html`<div class="callout info">${t("evolution.emptyAudit")}</div>`;
  }

  return html`
    <div style="overflow-x: auto;">
      <table style="width:100%; border-collapse:collapse; font-size:0.9em;">
        <thead>
          <tr style="border-bottom:2px solid var(--border, #e5e7eb); text-align:left;">
            <th style="padding:8px 12px;">${t("evolution.time")}</th>
            <th style="padding:8px 12px;">${t("evolution.operation")}</th>
            <th style="padding:8px 12px;">${t("evolution.actor")}</th>
            <th style="padding:8px 12px;">${t("evolution.target")}</th>
            <th style="padding:8px 12px;">${t("evolution.outcome")}</th>
          </tr>
        </thead>
        <tbody>
          ${entries.map((entry) => {
            return html`
              <tr style="border-bottom:1px solid var(--border, #e5e7eb);">
                <td style="padding:8px 12px; white-space:nowrap; color:var(--muted, #9ca3af);">
                  ${relativeTime(entry.timestamp)}
                </td>
                <td style="padding:8px 12px;">${entry.operation}</td>
                <td style="padding:8px 12px;">${entry.actor}</td>
                <td
                  style="padding:8px 12px; max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"
                  title=${entry.target}
                >
                  ${entry.target}
                </td>
                <td style="padding:8px 12px;">${outcomeBadge(entry.outcome)}</td>
              </tr>
            `;
          })}
        </tbody>
      </table>
    </div>
  `;
}

// --- Main render ---

export function renderEvolution(props: EvolutionProps) {
  if (props.loading) {
    return html`<div class="page-loader">${t("common.loading")}</div>`;
  }
  if (props.error) {
    return html`<div class="callout danger">${props.error}</div>`;
  }

  const parsed = parsePersonaList(props.personaList);
  if (!parsed || parsed.agents.length === 0) {
    return renderEmptyDetail(t("evolution.noUserData"), t("evolution.noUserDataHint"));
  }

  const sidebar = renderUserSidebar({
    list: parsed,
    selectedUserId: props.userId,
    selectedAgentId: props.agentId,
    onUserSelect: props.onUserSelect,
    onRefresh: props.onRefresh,
    headerTitle: t("evolution.users"),
  });

  // No user selected → empty detail
  if (!props.agentId || !props.userId) {
    return renderTwoColumnLayout(
      sidebar,
      renderEmptyDetail(t("evolution.selectUser"), t("evolution.selectUserHint")),
      false,
    );
  }

  const records = props.records as EvolutionRecord[];
  const auditEntries = props.auditEntries as AuditEntry[];

  // Sort records newest first
  const sortedRecords = records.toSorted((a, b) => b.timestamp - a.timestamp);
  // Sort audit entries newest first
  const sortedAudit = auditEntries.toSorted((a, b) => b.timestamp - a.timestamp);

  const rightPanel = html`
    <div class="stack">
      <!-- Evolution Records Timeline -->
      <div class="card">
        <div
          style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;"
        >
          <h4 style="margin:0;">${t("evolution.recordsTitle")}</h4>
          <span class="text-muted" style="font-size:0.85em;"
            >${t("evolution.recordCount", { count: String(sortedRecords.length) })}</span
          >
        </div>
        ${renderRecordTimeline(sortedRecords)}
      </div>

      <!-- Audit Log -->
      <div class="card">
        <div
          style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;"
        >
          <h4 style="margin:0;">${t("evolution.auditTitle")}</h4>
          <span class="text-muted" style="font-size:0.85em;"
            >${t("evolution.auditCount", { count: String(sortedAudit.length) })}</span
          >
        </div>
        ${renderAuditTable(sortedAudit)}
      </div>
    </div>
  `;

  return renderTwoColumnLayout(
    sidebar,
    rightPanel,
    true,
    () => props.onUserSelect("", ""),
    `${props.agentId ?? ""} / ${props.userId ?? ""}`,
  );
}
