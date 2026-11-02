import { html } from "lit";
import { t } from "../../i18n/index.ts";
import {
  parsePersonaList,
  renderEmptyDetail,
  renderTwoColumnLayout,
  renderUserSidebar,
} from "./cognitive-shared.ts";

type CorrectionProvenance = "self" | "user";

export type CorrectionRecord = {
  id: string;
  domain: string;
  trigger: string;
  mistake: string;
  correction: string;
  provenance: CorrectionProvenance;
  reinforcedCount: number;
  createdAt: number;
  lastReinforced: number;
};

export type CorrectionsProps = {
  loading: boolean;
  error: string | null;
  personaList: unknown | null;
  corrections: CorrectionRecord[];
  agentId: string | null;
  userId: string | null;
  onUserSelect: (agentId: string, userId: string) => void;
  onRefresh: () => void;
};

const TTL_DAYS = 90;
const MS_PER_DAY = 86_400_000;

function relativeTime(epochMs: number): string {
  const diff = Date.now() - epochMs;
  if (diff < 0) {
    return t("corrections.justNow");
  }
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) {
    return t("corrections.justNow");
  }
  if (minutes < 60) {
    return t("corrections.minutesAgo", { count: String(minutes) });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t("corrections.hoursAgo", { count: String(hours) });
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return t("corrections.daysAgo", { count: String(days) });
  }
  const months = Math.floor(days / 30);
  return t("corrections.monthsAgo", { count: String(months) });
}

function daysRemaining(createdAtMs: number): number {
  const elapsed = (Date.now() - createdAtMs) / MS_PER_DAY;
  return Math.max(0, Math.round(TTL_DAYS - elapsed));
}

function provenanceBadge(provenance: CorrectionProvenance) {
  const label = provenance === "self" ? "Agent" : t("corrections.provenanceUser");
  const cls = provenance === "self" ? "info" : "warning";
  return html`<span class="pill ${cls}">${label}</span>`;
}

function renderCorrectionCard(rec: CorrectionRecord) {
  const ttlLeft = daysRemaining(rec.createdAt);
  const ttlCls = ttlLeft <= 7 ? "danger" : ttlLeft <= 30 ? "warning" : "";
  const ttlText = t("corrections.ttlDays", { count: String(ttlLeft) });

  return html`
    <div class="card" style="padding: 12px;">
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px; flex-wrap:wrap;">
        <span class="pill" style="color:var(--text);">${rec.domain}</span>
        ${provenanceBadge(rec.provenance)}
        <span
          class="pill ${rec.reinforcedCount > 2 ? "danger" : ""}"
          style="font-weight:${rec.reinforcedCount > 2 ? "700" : "400"};"
        >
          ×${rec.reinforcedCount}
        </span>
        ${ttlCls
          ? html`<span class="pill ${ttlCls}">${ttlText}</span>`
          : html`<span class="pill" style="opacity:0.6;">${ttlText}</span>`}
      </div>
      <div style="margin-bottom:6px;">
        <strong>${t("corrections.triggerLabel")}</strong>
        <span class="text-muted">${rec.trigger}</span>
      </div>
      <div class="callout danger" style="margin-bottom:6px; padding:6px 10px;">
        <strong>${t("corrections.mistakeLabel")}</strong> ${rec.mistake}
      </div>
      <div class="callout success" style="margin-bottom:6px; padding:6px 10px;">
        <strong>${t("corrections.correctionLabel")}</strong> ${rec.correction}
      </div>
      <div class="text-muted" style="font-size:0.85em;">
        ${t("corrections.createdAt", { time: relativeTime(rec.createdAt) })} ·
        ${t("corrections.lastReinforced", { time: relativeTime(rec.lastReinforced) })}
      </div>
    </div>
  `;
}

export function renderCorrections(props: CorrectionsProps) {
  if (props.loading) {
    return html`<div class="page-loader">${t("common.loading")}</div>`;
  }
  if (props.error) {
    return html`<div class="callout danger">${props.error}</div>`;
  }

  const list = parsePersonaList(props.personaList);

  if (!list || list.agents.length === 0) {
    return html`
      <div class="card" style="padding:24px;text-align:center;">
        <div class="muted">${t("corrections.emptyPersona")}</div>
      </div>
    `;
  }

  const sorted = props.corrections.toSorted((a, b) => b.reinforcedCount - a.reinforcedCount);

  const sidebar = renderUserSidebar({
    list,
    selectedUserId: props.userId,
    selectedAgentId: props.agentId,
    onUserSelect: props.onUserSelect,
    onRefresh: props.onRefresh,
    headerTitle: t("corrections.usersHeader"),
  });

  let detail: unknown;
  if (!props.userId) {
    detail = renderEmptyDetail(t("corrections.selectUserTitle"), t("corrections.selectUserHint"));
  } else if (sorted.length === 0) {
    detail = html`
      <div style="display:flex;flex-direction:column;gap:8px;">
        <div class="row" style="justify-content:space-between;align-items:center;">
          <h3 style="font-size:16px;font-weight:600;margin:0;">${t("tabs.corrections")}</h3>
        </div>
        <div class="callout info">${t("corrections.emptyRecords")}</div>
      </div>
    `;
  } else {
    detail = html`
      <div style="display:flex;flex-direction:column;gap:8px;">
        <div class="row" style="justify-content:space-between;align-items:center;">
          <h3 style="font-size:16px;font-weight:600;margin:0;">${t("tabs.corrections")}</h3>
          <span class="text-muted" style="white-space:nowrap;"
            >${t("corrections.count", { count: String(sorted.length) })}</span
          >
        </div>
        <div class="stack">${sorted.map((rec) => renderCorrectionCard(rec))}</div>
      </div>
    `;
  }

  return renderTwoColumnLayout(
    sidebar,
    detail,
    !!props.userId,
    () => props.onUserSelect("", ""),
    `${props.agentId ?? ""} / ${props.userId ?? ""}`,
  );
}
