import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import {
  parsePersonaList,
  renderUserSidebar,
  renderEmptyDetail,
  renderTwoColumnLayout,
} from "./cognitive-shared.ts";
import type { PersonaListResult } from "./cognitive-shared.ts";

// --- InsightRecord shape (mirrors src/cognitive/types.ts InsightRecord) ---

type InsightSource = { url: string; title: string; credibility: number };

type InsightRecord = {
  id: string;
  generatedAt: number;
  triggerSource: "scheduled" | "event" | "conversational";
  targetDomains: string[];
  sourceDomains: string[];
  content: string;
  rationale: string;
  sources: InsightSource[];
  feedback?: "positive" | "negative" | "neutral" | "engaged";
  deliveredAt?: number;
  userResponse?: string;
  promptVariant?: {
    fewShotSet: number;
    frameIndex: number;
    structureSeed?: number;
    patternFrame?: number;
  };
};

// --- Props ---

export type InsightsProps = {
  loading: boolean;
  error: string | null;
  insights: unknown[];
  personaList: unknown | null;
  agentId: string | null;
  userId: string | null;
  onUserSelect: (agentId: string, userId: string) => void;
  onFeedback: (id: string, feedback: string) => void;
  onRefresh: () => void;
};

// --- Helpers ---

function formatRelativeTime(ts: number | null): string {
  if (!ts) {
    return "-";
  }
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) {
    return t("insights.justNow");
  }
  if (seconds < 3600) {
    return t("insights.minutesAgo", { count: String(Math.floor(seconds / 60)) });
  }
  if (seconds < 86400) {
    return t("insights.hoursAgo", { count: String(Math.floor(seconds / 3600)) });
  }
  return t("insights.daysAgo", { count: String(Math.floor(seconds / 86400)) });
}

function triggerLabel(src: string): string {
  switch (src) {
    case "scheduled":
      return t("insights.triggerScheduled");
    case "event":
      return t("insights.triggerEvent");
    case "conversational":
      return t("insights.triggerConversational");
    default:
      return src;
  }
}

function feedbackColor(fb: string | undefined): string {
  switch (fb) {
    case "positive":
      return "color: #22c55e; border-color: rgba(34,197,94,0.3); background: rgba(34,197,94,0.08);";
    case "negative":
      return "color: #ef4444; border-color: rgba(239,68,68,0.3); background: rgba(239,68,68,0.08);";
    case "neutral":
      return "color: #eab308; border-color: rgba(234,179,8,0.3); background: rgba(234,179,8,0.08);";
    case "engaged":
      return "color: #3b82f6; border-color: rgba(59,130,246,0.3); background: rgba(59,130,246,0.08);";
    default:
      return "color: var(--muted);";
  }
}

function feedbackLabel(fb: string | undefined): string {
  switch (fb) {
    case "positive":
      return t("insights.feedbackPositive");
    case "negative":
      return t("insights.feedbackNegative");
    case "neutral":
      return t("insights.feedbackNeutral");
    case "engaged":
      return t("insights.feedbackEngaged");
    default:
      return t("insights.feedbackNone");
  }
}

function inferMode(record: InsightRecord): string {
  if (record.promptVariant?.patternFrame != null) {
    return "pattern";
  }
  return "knowledge";
}

function modeLabel(mode: string): string {
  return mode === "pattern" ? t("insights.modePattern") : t("insights.modeKnowledge");
}

// --- Sub-renders ---

function renderInsightCard(
  record: InsightRecord,
  onFeedback: (id: string, feedback: string) => void,
) {
  const mode = inferMode(record);

  return html`
    <div class="card" style="animation-delay: 0s;">
      <!-- Header row: mode + trigger + time -->
      <div class="row" style="margin-bottom: 10px; flex-wrap: wrap;">
        <span
          class="pill"
          style="font-size: 12px; padding: 3px 8px;"
          title=${mode === "pattern"
            ? t("insights.modePatternTitle")
            : t("insights.modeKnowledgeTitle")}
        >
          ${modeLabel(mode)}
        </span>
        <span class="pill" style="font-size: 12px; padding: 3px 8px;">
          ${triggerLabel(record.triggerSource)}
        </span>
        <span style="font-size: 13px; color: var(--muted); margin-left: auto;">
          ${formatRelativeTime(record.generatedAt)}
        </span>
      </div>

      <!-- Content -->
      <div style="font-size: 15px; line-height: 1.6; margin-bottom: 12px; white-space: pre-wrap;">
        ${record.content}
      </div>

      <!-- Target domains -->
      ${record.targetDomains.length > 0
        ? html`
            <div class="row" style="flex-wrap: wrap; gap: 6px; margin-bottom: 10px;">
              ${record.targetDomains.map(
                (d) =>
                  html`<span class="pill" style="font-size: 12px; padding: 2px 8px;">${d}</span>`,
              )}
            </div>
          `
        : nothing}

      <!-- Sources -->
      ${record.sources.length > 0
        ? html`
            <div style="margin-bottom: 10px;">
              <span style="font-size: 12px; color: var(--muted);">${t("insights.sources")}</span>
              ${record.sources.map(
                (s) =>
                  html`<a
                    href=${s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style="font-size: 12px; margin-left: 6px; text-decoration: underline; color: var(--info);"
                    >${s.title}</a
                  >`,
              )}
            </div>
          `
        : nothing}

      <!-- Footer: feedback pill + thumbs -->
      <div class="row" style="margin-top: 8px; flex-wrap: wrap; gap: 8px;">
        <span
          class="pill"
          style="font-size: 12px; padding: 3px 8px; ${feedbackColor(record.feedback)}"
        >
          ${feedbackLabel(record.feedback)}
        </span>
        <span style="flex: 1;"></span>
        <button
          class="btn btn--sm"
          style=${record.feedback === "positive"
            ? "color: #22c55e; border-color: rgba(34,197,94,0.4);"
            : ""}
          title=${t("insights.feedbackPositiveTitle")}
          @click=${() => onFeedback(record.id, "positive")}
        >
          👍
        </button>
        <button
          class="btn btn--sm"
          style=${record.feedback === "negative"
            ? "color: #ef4444; border-color: rgba(239,68,68,0.4);"
            : ""}
          title=${t("insights.feedbackNegativeTitle")}
          @click=${() => onFeedback(record.id, "negative")}
        >
          👎
        </button>
      </div>
    </div>
  `;
}

// --- Main render ---

export function renderInsights(props: InsightsProps) {
  if (props.loading) {
    return html`<div class="page-loader">${t("common.loading")}</div>`;
  }
  if (props.error) {
    return html`<div class="callout danger">${props.error}</div>`;
  }

  const parsed = parsePersonaList(props.personaList);

  // No persona data at all — single-card empty state
  if (!parsed || parsed.agents.length === 0) {
    return html`
      <section class="stack">
        <div class="card">
          <div class="card-title">${t("tabs.insights")}</div>
          <div class="callout info">${t("insights.emptyPersona")}</div>
        </div>
      </section>
    `;
  }

  // Build right panel content
  const records = props.insights as InsightRecord[];
  const hasSelection = props.agentId && props.userId;

  let detailContent: unknown;
  if (!hasSelection) {
    detailContent = renderEmptyDetail(t("insights.selectUserTitle"), t("insights.selectUserHint"));
  } else if (records.length === 0) {
    detailContent = html`<div class="callout info">${t("insights.emptyRecords")}</div>`;
  } else {
    detailContent = html`
      <div class="stack">${records.map((r) => renderInsightCard(r, props.onFeedback))}</div>
    `;
  }

  return renderTwoColumnLayout(
    renderUserSidebar({
      list: parsed as PersonaListResult,
      selectedUserId: props.userId,
      selectedAgentId: props.agentId,
      onUserSelect: props.onUserSelect,
      onRefresh: props.onRefresh,
      headerTitle: t("insights.usersHeader"),
    }),
    detailContent,
    !!hasSelection,
    () => props.onUserSelect("", ""),
    `${props.agentId ?? ""} / ${props.userId ?? ""}`,
  );
}
