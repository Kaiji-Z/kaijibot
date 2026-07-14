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
    return t("common.justNow") ?? "刚刚";
  }
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) {
    return t("common.justNow") ?? "刚刚";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}分钟前`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}小时前`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}天前`;
  }
  const months = Math.floor(days / 30);
  return `${months}个月前`;
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
    return html`<span class="pill" style="opacity:0.6;">无回应</span>`;
  }
  const config: Record<EvolutionUserResponse, { label: string; style: string }> = {
    accepted: {
      label: "已接受",
      style: "color: #22c55e; border-color: rgba(34,197,94,0.3); background: rgba(34,197,94,0.08);",
    },
    modified: {
      label: "已修改",
      style: "color: #eab308; border-color: rgba(234,179,8,0.3); background: rgba(234,179,8,0.08);",
    },
    rejected: {
      label: "已拒绝",
      style: "color: #ef4444; border-color: rgba(239,68,68,0.3); background: rgba(239,68,68,0.08);",
    },
  };
  const { label, style } = config[response];
  return html`<span class="pill" style="${style}">${label}</span>`;
}

function outcomeBadge(outcome: "success" | "failure" | "skipped") {
  const config = {
    success: {
      label: "成功",
      style: "color: #22c55e; border-color: rgba(34,197,94,0.3); background: rgba(34,197,94,0.08);",
    },
    failure: {
      label: "失败",
      style: "color: #ef4444; border-color: rgba(239,68,68,0.3); background: rgba(239,68,68,0.08);",
    },
    skipped: {
      label: "已跳过",
      style: "color: var(--muted); opacity: 0.6;",
    },
  };
  const { label, style } = config[outcome];
  return html`<span class="pill" style="${style}">${label}</span>`;
}

// --- Sub-renders ---

function renderRecordTimeline(records: EvolutionRecord[]) {
  if (records.length === 0) {
    return html`<div class="callout info">暂无进化记录。</div>`;
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
                  >${c.toolCalls.length}次调用 · ${c.uniqueToolCount}个独立</span
                >
                <span class="pill" style="font-size:0.8em;">${formatDuration(c.durationMs)}</span>
                ${c.hasTrialAndError
                  ? html`<span class="pill warning" style="font-size:0.8em;">试错</span>`
                  : nothing}
                ${d
                  ? html`
                      <span
                        class="pill"
                        style="font-size:0.8em; ${complexityColor(d.complexityScore)}"
                      >
                        复杂度：${(d.complexityScore * 100).toFixed(0)}%
                      </span>
                      <span
                        class="pill ${d.shouldSuggest ? "success" : ""}"
                        style="font-size:0.8em;"
                      >
                        ${d.shouldSuggest ? "已建议" : "跳过"}
                      </span>
                      <span class="pill" style="font-size:0.8em;">
                        置信度：${(d.confidence * 100).toFixed(0)}%
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
                      <div style="font-weight:600; margin-bottom:4px;">草稿：${rec.draft.name}</div>
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
    return html`<div class="callout info">暂无审计日志。</div>`;
  }

  return html`
    <div style="overflow-x: auto;">
      <table style="width:100%; border-collapse:collapse; font-size:0.9em;">
        <thead>
          <tr style="border-bottom:2px solid var(--border, #e5e7eb); text-align:left;">
            <th style="padding:8px 12px;">时间</th>
            <th style="padding:8px 12px;">操作</th>
            <th style="padding:8px 12px;">执行者</th>
            <th style="padding:8px 12px;">目标</th>
            <th style="padding:8px 12px;">结果</th>
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
    return renderEmptyDetail("暂无用户数据", "先与机器人对话后，画像会自动生成。");
  }

  const sidebar = renderUserSidebar({
    list: parsed,
    selectedUserId: props.userId,
    selectedAgentId: props.agentId,
    onUserSelect: props.onUserSelect,
    onRefresh: props.onRefresh,
    headerTitle: "用户",
  });

  // No user selected → empty detail
  if (!props.agentId || !props.userId) {
    return renderTwoColumnLayout(
      sidebar,
      renderEmptyDetail("请选择一个用户查看进化记录", "点击左侧用户卡片查看进化历史。"),
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
          <h4 style="margin:0;">进化记录</h4>
          <span class="text-muted" style="font-size:0.85em;">${sortedRecords.length}条记录</span>
        </div>
        ${renderRecordTimeline(sortedRecords)}
      </div>

      <!-- Audit Log -->
      <div class="card">
        <div
          style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;"
        >
          <h4 style="margin:0;">审计日志</h4>
          <span class="text-muted" style="font-size:0.85em;">${sortedAudit.length}条审计</span>
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
