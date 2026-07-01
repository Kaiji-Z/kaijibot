import { html, nothing } from "lit";
import { formatMs } from "../format.ts";

// ── Shared types (mirrors cognitive.persona.list response) ──────────

export type PersonaListUser = {
  userId: string;
  displayName?: string;
  domainCount: number;
  trustScore?: number;
  phase?: string;
  lastActive?: number;
};

export type PersonaListAgent = {
  agentId: string;
  users: PersonaListUser[];
};

export type PersonaListResult = {
  agents: PersonaListAgent[];
};

// ── Shared helpers ────────────────────────────────────────────────

const PHASE_COLORS: Record<string, string> = {
  emergent:
    "color: var(--info); border-color: rgba(59,130,246,0.35); background: rgba(59,130,246,0.08);",
  stable: "color: var(--ok); border-color: rgba(34,197,94,0.35); background: rgba(34,197,94,0.08);",
  declining:
    "color: var(--warn); border-color: rgba(245,158,11,0.35); background: rgba(245,158,11,0.08);",
  dormant: "color: var(--muted); border-color: var(--border); background: var(--secondary);",
  revived:
    "color: #f97316; border-color: rgba(249,115,22,0.35); background: rgba(249,115,22,0.08);",
};

export function phasePill(phase: string | undefined): unknown {
  if (!phase) {
    return nothing;
  }
  const style = PHASE_COLORS[phase] ?? PHASE_COLORS.dormant;
  return html`<span
    style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:var(--radius-full);font-size:12px;font-weight:500;border:1px solid;${style}"
    >${phase}</span
  >`;
}

export function trustBar(score: number | undefined | null): unknown {
  const raw = typeof score === "number" && Number.isFinite(score) ? score : 0;
  const pct = Math.max(0, Math.min(1, raw));
  const pctDisplay = Math.round(pct * 100);
  const color = pctDisplay >= 70 ? "var(--ok)" : pctDisplay >= 40 ? "var(--warn)" : "var(--danger)";
  return html`
    <div style="display:flex;align-items:center;gap:8px;">
      <div
        style="flex:1;height:6px;border-radius:var(--radius-full);background:var(--border);overflow:hidden;"
      >
        <div
          style="height:100%;width:${pctDisplay}%;border-radius:var(--radius-full);background:${color};transition:width var(--duration-normal) var(--ease-out);"
        ></div>
      </div>
      <span style="font-size:13px;font-weight:600;color:${color};min-width:36px;text-align:right;"
        >${pctDisplay}%</span
      >
    </div>
  `;
}

export function parsePersonaList(raw: unknown): PersonaListResult | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  return raw as PersonaListResult;
}

// ── Shared sidebar renderer ───────────────────────────────────────

export function renderUserSidebar(opts: {
  list: PersonaListResult;
  selectedUserId: string | null;
  selectedAgentId: string | null;
  onUserSelect: (agentId: string, userId: string) => void;
  onRefresh: () => void;
  headerTitle?: string;
  emptyMessage?: string;
}): unknown {
  const {
    list,
    selectedUserId,
    selectedAgentId,
    onUserSelect,
    onRefresh,
    headerTitle = "用户",
    emptyMessage = "暂无用户数据。先与机器人对话后，画像会自动生成。",
  } = opts;

  const agents = list.agents;

  return html`
    <div style="display:flex;flex-direction:column;gap:8px;overflow-y:auto;">
      <div class="row" style="justify-content:space-between;">
        <h3 style="font-size:16px;font-weight:600;margin:0;">${headerTitle}</h3>
        <button class="btn btn--sm" @click=${onRefresh}>刷新</button>
      </div>
      ${agents.length === 0
        ? html`<div class="muted" style="text-align:center;padding:32px 16px;">
            ${emptyMessage}
          </div>`
        : html`
            <div style="display:flex;flex-direction:column;gap:12px;">
              ${agents.map(
                (agent) => html`
                  <div>
                    <div
                      style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--muted);margin-bottom:6px;padding:0 4px;"
                    >
                      ${agent.agentId}
                      <span style="font-weight:400;text-transform:none;"
                        >(${agent.users.length} 用户)</span
                      >
                    </div>
                    <div style="display:grid;gap:6px;">
                      ${agent.users.map((user) => {
                        const isSelected =
                          selectedAgentId === agent.agentId && selectedUserId === user.userId;
                        return html`
                          <div
                            class="list-item-clickable${isSelected ? " list-item-selected" : ""}"
                            style="border:1px solid ${isSelected
                              ? "var(--accent)"
                              : "var(--border)"};border-radius:var(--radius-md);padding:10px 12px;background:var(--card);cursor:pointer;display:grid;gap:4px;transition:border-color var(--duration-fast) var(--ease-out);"
                            @click=${() => onUserSelect(agent.agentId, user.userId)}
                          >
                            <div
                              style="display:flex;justify-content:space-between;align-items:center;gap:8px;"
                            >
                              <span
                                style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                                >${user.displayName || user.userId}</span
                              >
                              ${phasePill(user.phase)}
                            </div>
                            <div style="display:flex;align-items:center;gap:12px;">
                              ${trustBar(user.trustScore)}
                            </div>
                            <div
                              style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--muted);"
                            >
                              <span>${user.domainCount} 领域</span>
                              ${user.lastActive
                                ? html`<span>·</span><span>${formatMs(user.lastActive)}</span>`
                                : nothing}
                            </div>
                          </div>
                        `;
                      })}
                    </div>
                  </div>
                `,
              )}
            </div>
          `}
    </div>
  `;
}

// ── Shared empty detail placeholder ───────────────────────────────

export function renderEmptyDetail(title: string, subtitle: string): unknown {
  return html`
    <div
      class="card"
      style="display:flex;align-items:center;justify-content:center;min-height:300px;"
    >
      <div class="muted" style="text-align:center;">
        <div style="font-size:15px;font-weight:500;">${title}</div>
        <div style="font-size:13px;margin-top:4px;">${subtitle}</div>
      </div>
    </div>
  `;
}

// ── Two-column layout wrapper ─────────────────────────────────────

export function renderTwoColumnLayout(
  sidebar: unknown,
  detail: unknown,
  detailActive = false,
  onBack?: () => void,
  contextLabel?: string,
): unknown {
  return html`
    <section class="two-col-layout ${detailActive ? "two-col-layout--detail" : ""}">
      <div class="two-col-layout__sidebar">${sidebar}</div>
      <div class="two-col-layout__detail">
        ${detailActive && onBack
          ? html`<div class="two-col-back-bar" @click=${onBack}>
              <span class="two-col-back-bar__arrow" aria-hidden="true"></span>
              ${contextLabel
                ? html`<span class="two-col-back-bar__context">${contextLabel}</span>`
                : nothing}
            </div>`
          : nothing}
        ${detail}
      </div>
    </section>
  `;
}
