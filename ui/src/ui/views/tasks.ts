import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";

// ── Types mirroring the tasks.list / tasks.get RPC shapes ───────

type TaskSnapshot = {
  id: string;
  agentId: string;
  userId: string;
  goal: string;
  status: string;
  usedSteps: number;
  maxSteps: number;
  stepCount: number;
  createdAt: number;
  updatedAt: number;
  parentTaskId?: string;
  parentAgentId?: string;
};

type TaskStepTrail = {
  index: number;
  startedAt: number;
  endedAt?: number;
  summary: string;
  status: string;
  error?: string;
};

type SubtaskResultTrail = {
  taskId: string;
  agentId: string;
  goal: string;
  status: string;
  result?: string;
};

type TaskFull = TaskSnapshot & {
  budget: { usedSteps: number; maxSteps: number; maxWallClockMs: number; startedAt?: number };
  steps: TaskStepTrail[];
  result?: string;
  origin?: string;
  subtaskResults?: SubtaskResultTrail[];
};

// ── Props ────────────────────────────────────────────────────────

export type TasksProps = {
  loading: boolean;
  error: string | null;
  tasks: unknown[];
  selectedId: string | null;
  detail: unknown | null;
  detailLoading: boolean;
  includeFinished: boolean;
  onSelect: (taskId: string, userId: string) => void;
  onRefresh: (includeFinished: boolean) => void;
  onToggleFinished: (includeFinished: boolean) => void;
};

// ── Helpers ──────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { color: string; key: string }> = {
  queued: { color: "#94a3b8", key: "tasks.status.queued" },
  running: { color: "#3b82f6", key: "tasks.status.running" },
  blocked: { color: "#eab308", key: "tasks.status.blocked" },
  done: { color: "#22c55e", key: "tasks.status.done" },
  failed: { color: "#ef4444", key: "tasks.status.failed" },
  halted: { color: "#f97316", key: "tasks.status.halted" },
  cancelled: { color: "#94a3b8", key: "tasks.status.cancelled" },
};

export function statusStyle(status: string): { color: string; key: string | null } {
  return STATUS_STYLES[status] ?? { color: "#94a3b8", key: null };
}

export function formatRelative(ts: number | null | undefined): string {
  if (!ts) {
    return "-";
  }
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) {
    return t("tasks.time.justNow");
  }
  if (seconds < 3600) {
    return t("tasks.time.minutesAgo", { n: String(Math.floor(seconds / 60)) });
  }
  if (seconds < 86400) {
    return t("tasks.time.hoursAgo", { n: String(Math.floor(seconds / 3600)) });
  }
  return t("tasks.time.daysAgo", { n: String(Math.floor(seconds / 86400)) });
}

function pill(status: string) {
  const s = statusStyle(status);
  const label = s.key ? t(s.key) : status;
  return html`<span
    class="pill"
    style="font-size: 12px; padding: 3px 8px; color: ${s.color}; border-color: ${s.color}44; background: ${s.color}14;"
    >${label}</span
  >`;
}

// ── Sub-renders ──────────────────────────────────────────────────

function renderTaskCard(task: TaskSnapshot, selected: boolean, onSelect: TasksProps["onSelect"]) {
  return html`
    <div
      class="card card--selectable${selected ? " card--selected" : ""}"
      role="button"
      tabindex="0"
      aria-current=${selected ? "true" : nothing}
      @click=${() => onSelect(task.id, task.userId)}
      @keydown=${(e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(task.id, task.userId);
        }
      }}
    >
      <div class="row" style="margin-bottom: 8px; flex-wrap: wrap; align-items: center;">
        ${pill(task.status)}
        ${task.parentTaskId
          ? html`<span class="pill" style="font-size: 12px; padding: 3px 8px;">
              ${t("tasks.subtaskBadge")}
            </span>`
          : nothing}
        <span style="font-size: 12px; color: var(--muted); margin-left: auto;">
          ${formatRelative(task.updatedAt)}
        </span>
      </div>
      <div style="font-size: 15px; line-height: 1.5; margin-bottom: 8px; overflow-wrap: anywhere;">
        ${task.goal}
      </div>
      <div class="row" style="font-size: 12px; color: var(--muted); flex-wrap: wrap;">
        <span>${task.agentId} · ${task.userId}</span>
        <span style="margin-left: auto;">
          ${t("tasks.stepsProgress", { used: String(task.usedSteps), max: String(task.maxSteps) })}
        </span>
      </div>
    </div>
  `;
}

function renderStep(step: TaskStepTrail) {
  const ok = step.status === "ok";
  return html`
    <div style="padding: 8px 0; border-bottom: 1px solid var(--border);">
      <div class="row" style="font-size: 12px; color: var(--muted); margin-bottom: 4px;">
        <span>
          ${t("tasks.stepLabel", { index: String(step.index) })} ·
          ${ok ? t("tasks.stepOk") : step.status === "error" ? t("tasks.stepError") : step.status}
        </span>
        <span style="margin-left: auto;">${formatRelative(step.startedAt)}</span>
      </div>
      <div style="font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere;">
        ${step.summary || t("tasks.noSummary")}
      </div>
      ${step.error
        ? html`<div style="font-size: 12px; color: var(--danger); margin-top: 4px;">
            ${step.error}
          </div>`
        : nothing}
    </div>
  `;
}

function renderDetail(task: TaskFull) {
  return html`
    <div class="card">
      <div class="row" style="margin-bottom: 10px; flex-wrap: wrap; align-items: center;">
        ${pill(task.status)}
        <span class="pill" style="font-size: 12px; padding: 3px 8px;">
          ${t("tasks.stepsProgress", {
            used: String(task.budget.usedSteps),
            max: String(task.budget.maxSteps),
          })}
        </span>
        ${task.origin
          ? html`<span class="pill" style="font-size: 12px; padding: 3px 8px;">
              ${t("tasks.origin", { origin: task.origin })}
            </span>`
          : nothing}
        <span style="font-size: 12px; color: var(--muted); margin-left: auto;">
          ${task.agentId} · ${task.userId}
        </span>
      </div>
      <div style="font-size: 16px; line-height: 1.5; margin-bottom: 12px; overflow-wrap: anywhere;">
        ${task.goal}
      </div>

      ${task.subtaskResults?.length
        ? html`
            <div style="margin-bottom: 12px;">
              <div style="font-size: 13px; color: var(--muted); margin-bottom: 6px;">
                ${t("tasks.subtaskResults")}
              </div>
              ${task.subtaskResults.map(
                (s) => html`
                  <div
                    style="padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 13px;"
                  >
                    ${pill(s.status)}
                    <span style="margin-left: 6px;">${s.agentId} · ${s.goal}</span>
                    ${s.result
                      ? html`<div
                          style="white-space: pre-wrap; margin-top: 4px; overflow-wrap: anywhere;"
                        >
                          ${s.result}
                        </div>`
                      : nothing}
                  </div>
                `,
              )}
            </div>
          `
        : nothing}

      <div style="font-size: 13px; color: var(--muted); margin-bottom: 6px;">
        ${t("tasks.trail")}
      </div>
      ${task.steps.length
        ? task.steps.map(renderStep)
        : html`<div style="font-size: 13px; color: var(--muted);">${t("tasks.noSteps")}</div>`}
      ${task.result
        ? html`
            <div style="margin-top: 12px;">
              <div style="font-size: 13px; color: var(--muted); margin-bottom: 6px;">
                ${t("tasks.finalResult")}
              </div>
              <div style="font-size: 14px; white-space: pre-wrap; overflow-wrap: anywhere;">
                ${task.result}
              </div>
            </div>
          `
        : nothing}
    </div>
  `;
}

// ── Main view ────────────────────────────────────────────────────

export function renderTasks(props: TasksProps) {
  const tasks = props.tasks as TaskSnapshot[];
  return html`
    <section style="max-width: 960px; margin: 0 auto; padding: 16px;">
      <div class="row" style="margin-bottom: 16px; align-items: center;">
        <div style="font-size: 18px; font-weight: 600;">${t("tabs.tasks")}</div>
        <label
          style="font-size: 13px; color: var(--muted); margin-left: 16px; display: flex; gap: 6px; align-items: center;"
        >
          <input
            type="checkbox"
            .checked=${props.includeFinished}
            @change=${(e: Event) => props.onToggleFinished((e.target as HTMLInputElement).checked)}
          />
          ${t("tasks.showFinished")}
        </label>
        <button
          class="btn"
          style="margin-left: auto;"
          @click=${() => props.onRefresh(props.includeFinished)}
        >
          ${t("common.refresh")}
        </button>
      </div>

      ${props.error
        ? html`<div class="card" style="color: var(--danger);">${props.error}</div>`
        : nothing}
      ${props.loading
        ? html`<div class="card" style="color: var(--muted);">${t("common.loading")}</div>`
        : tasks.length === 0
          ? html`<div class="card" style="color: var(--muted);">
              ${props.includeFinished ? t("tasks.emptyAll") : t("tasks.emptyActive")}
            </div>`
          : tasks.map((task) => renderTaskCard(task, task.id === props.selectedId, props.onSelect))}
      ${props.detailLoading
        ? html`<div class="card" style="color: var(--muted); margin-top: 12px;">
            ${t("tasks.loadingTrail")}
          </div>`
        : props.detail
          ? html`<div style="margin-top: 12px;">${renderDetail(props.detail as TaskFull)}</div>`
          : nothing}
    </section>
  `;
}
