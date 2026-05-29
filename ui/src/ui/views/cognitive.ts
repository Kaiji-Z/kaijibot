import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { formatMs } from "../format.ts";
import {
  parsePersonaList,
  renderUserSidebar,
  renderEmptyDetail,
  renderTwoColumnLayout,
  phasePill,
  trustBar,
} from "./cognitive-shared.ts";

// ── Types mirroring backend shapes ──────────────────────────────

type CommunicationStyle = {
  formality: "formal" | "casual" | "mixed";
  verbosity: "concise" | "moderate" | "detailed";
  technicalLevel: "beginner" | "intermediate" | "expert";
  preferredLanguage: "zh" | "en" | "mixed";
};

type DomainNode = {
  depth: number;
  recurrence: number;
  lastMentioned: number;
  keyInsights: string[];
  phase?: string;
};

type RapportMetrics = {
  trustScore: number;
  totalExchanges: number;
  avgResponseLength: number;
  selfDisclosureLevel: number;
};

type UserLifecycle = {
  stage: string;
  lastActiveAt: number;
  lastStageTransitionAt: number;
  totalActiveDays: number;
};

type PersonaTree = {
  identity: {
    displayName?: string;
    coreTraits: Record<string, unknown>;
    communicationStyle?: CommunicationStyle;
    primaryLanguage?: string;
    expertDomains: string[];
    interestDomains: string[];
    curiosityDomains: string[];
    userId?: string;
  };
  domains: Record<string, DomainNode>;
  recentFocus: string[];
  feedbackProfile: Record<string, unknown>;
  rapport: RapportMetrics;
  moodHistory: Array<unknown>;
  domainBlacklist: string[];
  lifecycle: UserLifecycle;
  calibrationHistory: Array<unknown>;
};

// ── Public props ────────────────────────────────────────────────

export type CognitiveProps = {
  loading: boolean;
  error: string | null;
  personaList: unknown | null;
  personaDetail: unknown | null;
  agentId: string | null;
  userId: string | null;
  onAgentChange: (agentId: string) => void;
  onUserSelect: (agentId: string, userId: string) => void;
  onRefresh: () => void;
};

// ── Helpers ─────────────────────────────────────────────────────

const STAGE_COLORS: Record<string, string> = {
  new: "color: var(--info); border-color: rgba(59,130,246,0.35); background: rgba(59,130,246,0.08);",
  active: "color: var(--ok); border-color: rgba(34,197,94,0.35); background: rgba(34,197,94,0.08);",
  dormant:
    "color: var(--warn); border-color: rgba(245,158,11,0.35); background: rgba(245,158,11,0.08);",
  lapsed: "color: var(--muted); border-color: var(--border); background: var(--secondary);",
};

function stagePill(stage: string | undefined): unknown {
  if (!stage) {
    return nothing;
  }
  const style = STAGE_COLORS[stage] ?? STAGE_COLORS.dormant;
  return html`<span
    style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:var(--radius-full);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;border:1px solid;${style}"
    >${stage}</span
  >`;
}

function parseDetail(raw: unknown): PersonaTree | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  return raw as PersonaTree;
}

// ── Persona detail panel ────────────────────────────────────────

function renderDetail(persona: PersonaTree): unknown {
  const { identity, domains, recentFocus, rapport, lifecycle } = persona;
  const domainEntries = Object.entries(domains);
  const style = identity.communicationStyle;

  return html`
    <div style="display:grid;gap:16px;">
      <!-- Identity section -->
      <div class="card">
        <h4 style="font-size:15px;font-weight:600;margin:0 0 12px;color:var(--text-strong);">
          Identity
        </h4>
        <div style="display:grid;gap:10px;">
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="font-size:20px;font-weight:700;color:var(--text-strong);"
              >${identity.displayName || "Unknown"}</span
            >
            ${identity.primaryLanguage
              ? html`<span class="pill" style="font-size:12px;">${identity.primaryLanguage}</span>`
              : nothing}
          </div>
          ${style
            ? html`
                <div style="display:flex;flex-wrap:wrap;gap:8px;">
                  <span class="pill" style="font-size:12px;">Formality: ${style.formality}</span>
                  <span class="pill" style="font-size:12px;">Verbosity: ${style.verbosity}</span>
                  <span class="pill" style="font-size:12px;"
                    >Technical: ${style.technicalLevel}</span
                  >
                  <span class="pill" style="font-size:12px;">Lang: ${style.preferredLanguage}</span>
                </div>
              `
            : nothing}
          ${identity.expertDomains.length > 0
            ? html`
                <div>
                  <span
                    class="muted"
                    style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;"
                    >Expert domains</span
                  >
                  <div class="chip-row" style="margin-top:4px;">
                    ${identity.expertDomains.map(
                      (d) => html`<span class="chip chip-ok">${d}</span>`,
                    )}
                  </div>
                </div>
              `
            : nothing}
        </div>
      </div>

      <!-- Trust & Rapport -->
      <div class="card">
        <h4 style="font-size:15px;font-weight:600;margin:0 0 12px;color:var(--text-strong);">
          Trust & Rapport
        </h4>
        <div style="display:grid;gap:10px;">
          <div>
            <div
              class="muted"
              style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;"
            >
              Trust Score
            </div>
            ${trustBar(rapport.trustScore)}
          </div>
          <div style="display:flex;gap:16px;flex-wrap:wrap;">
            <div class="stat-card">
              <span class="stat-label">Total Exchanges</span>
              <span class="stat-value" style="font-size:18px;">${rapport.totalExchanges}</span>
            </div>
            <div class="stat-card">
              <span class="stat-label">Avg Response Length</span>
              <span class="stat-value" style="font-size:18px;"
                >${typeof rapport.avgResponseLength === "number"
                  ? rapport.avgResponseLength.toFixed(0)
                  : "—"}</span
              >
            </div>
            <div class="stat-card">
              <span class="stat-label">Self-Disclosure</span>
              <span class="stat-value" style="font-size:18px;"
                >${typeof rapport.selfDisclosureLevel === "number"
                  ? (rapport.selfDisclosureLevel * 100).toFixed(0) + "%"
                  : "—"}</span
              >
            </div>
          </div>
        </div>
      </div>

      <!-- Domain map -->
      <div class="card">
        <h4 style="font-size:15px;font-weight:600;margin:0 0 12px;color:var(--text-strong);">
          Domain Map
          <span class="muted" style="font-weight:400;font-size:13px;margin-left:6px;"
            >${domainEntries.length} domains</span
          >
        </h4>
        ${domainEntries.length === 0
          ? html`<div class="muted">No domains recorded yet.</div>`
          : html`
              <div style="display:grid;gap:8px;">
                ${domainEntries.map(
                  ([name, node]) => html`
                    <div
                      style="border:1px solid var(--border);border-radius:var(--radius-md);padding:10px 12px;display:grid;gap:4px;"
                    >
                      <div
                        style="display:flex;justify-content:space-between;align-items:center;gap:8px;"
                      >
                        <span style="font-weight:500;font-size:14px;">${name}</span>
                        <div style="display:flex;align-items:center;gap:6px;">
                          ${phasePill(node.phase)}
                          <span class="pill" style="font-size:11px;padding:2px 8px;"
                            >Depth: ${node.depth}</span
                          >
                        </div>
                      </div>
                      <div
                        style="display:flex;align-items:center;gap:12px;font-size:12px;color:var(--muted);"
                      >
                        <span>${node.recurrence} mention${node.recurrence === 1 ? "" : "s"}</span>
                        ${node.lastMentioned
                          ? html`<span>·</span><span>Last: ${formatMs(node.lastMentioned)}</span>`
                          : nothing}
                      </div>
                      ${node.keyInsights.length > 0
                        ? html`
                            <div style="margin-top:4px;display:flex;flex-direction:column;gap:2px;">
                              ${node.keyInsights
                                .slice(0, 3)
                                .map(
                                  (insight) =>
                                    html`<span
                                      class="muted"
                                      style="font-size:12px;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                                      >${insight}</span
                                    >`,
                                )}
                              ${node.keyInsights.length > 3
                                ? html`<span class="muted" style="font-size:11px;"
                                    >+${node.keyInsights.length - 3} more</span
                                  >`
                                : nothing}
                            </div>
                          `
                        : nothing}
                    </div>
                  `,
                )}
              </div>
            `}
      </div>

      <!-- Recent Focus -->
      ${recentFocus.length > 0
        ? html`
            <div class="card">
              <h4 style="font-size:15px;font-weight:600;margin:0 0 12px;color:var(--text-strong);">
                Recent Focus
              </h4>
              <div class="chip-row">
                ${recentFocus.map((f) => html`<span class="chip">${f}</span>`)}
              </div>
            </div>
          `
        : nothing}

      <!-- Lifecycle -->
      <div class="card">
        <h4 style="font-size:15px;font-weight:600;margin:0 0 12px;color:var(--text-strong);">
          Lifecycle
        </h4>
        <div style="display:grid;gap:8px;">
          <div style="display:flex;align-items:center;gap:12px;">
            <span class="muted" style="font-size:13px;font-weight:500;">Stage</span>
            ${stagePill(lifecycle.stage)}
          </div>
          <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--muted);">
            <span>Last active: ${formatMs(lifecycle.lastActiveAt)}</span>
            <span>·</span>
            <span
              >${lifecycle.totalActiveDays} active
              day${lifecycle.totalActiveDays === 1 ? "" : "s"}</span
            >
          </div>
        </div>
      </div>
    </div>
  `;
}

// ── Main render ─────────────────────────────────────────────────

export function renderCognitive(props: CognitiveProps) {
  if (props.loading) {
    return html`<div class="page-loader">${t("common.loading")}</div>`;
  }
  if (props.error) {
    return html`<div class="callout danger">${props.error}</div>`;
  }

  const list = parsePersonaList(props.personaList);
  const detail = parseDetail(props.personaDetail);

  if (!list || list.agents.length === 0) {
    return html`
      <section class="stack">
        <div class="card">
          <div class="row" style="justify-content:space-between;">
            <h3>${t("tabs.cognitive")}</h3>
            <button class="btn btn--sm" @click=${props.onRefresh}>${t("common.refresh")}</button>
          </div>
          <p class="muted">
            No persona data yet. Start a conversation to build cognitive profiles.
          </p>
        </div>
      </section>
    `;
  }

  const sidebar = renderUserSidebar({
    list,
    selectedUserId: props.userId,
    selectedAgentId: props.agentId,
    onUserSelect: props.onUserSelect,
    onRefresh: props.onRefresh,
    headerTitle: "Users",
    emptyMessage: "No persona data yet. Start a conversation to build cognitive profiles.",
  });

  const detailContent = detail
    ? renderDetail(detail)
    : renderEmptyDetail(
        "Select a user to view their persona",
        "Click a user card on the left to explore their cognitive profile.",
      );

  return renderTwoColumnLayout(sidebar, detailContent);
}
