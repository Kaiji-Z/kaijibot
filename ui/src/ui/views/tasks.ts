import { html, nothing } from "lit";

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

const STATUS_STYLES: Record<string, { color: string; label: string }> = {
  queued: { color: "#94a3b8", label: "排队" },
  running: { color: "#3b82f6", label: "运行中" },
  blocked: { color: "#eab308", label: "等待子任务" },
  done: { color: "#22c55e", label: "完成" },
  failed: { color: "#ef4444", label: "失败" },
  halted: { color: "#f97316", label: "已暂停" },
  cancelled: { color: "#94a3b8", label: "已取消" },
};

export function statusStyle(status: string): { color: string; label: string } {
  return STATUS_STYLES[status] ?? { color: "#94a3b8", label: status };
}

export function formatRelative(ts: number | null | undefined): string {
  if (!ts) {
    return "-";
  }
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) {
    return "刚刚";
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}分钟前`;
  }
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}小时前`;
  }
  return `${Math.floor(seconds / 86400)}天前`;
}

function pill(status: string) {
  const s = statusStyle(status);
  return html`<span
    class="pill"
    style="font-size: 12px; padding: 3px 8px; color: ${s.color}; border-color: ${s.color}44; background: ${s.color}14;"
    >${s.label}</span
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
          ? html`<span class="pill" style="font-size: 12px; padding: 3px 8px;">子任务</span>`
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
        <span style="margin-left: auto;">步骤 ${task.usedSteps}/${task.maxSteps}</span>
      </div>
    </div>
  `;
}

function renderStep(step: TaskStepTrail) {
  const ok = step.status === "ok";
  return html`
    <div style="padding: 8px 0; border-bottom: 1px solid var(--border);">
      <div class="row" style="font-size: 12px; color: var(--muted); margin-bottom: 4px;">
        <span
          >第 ${step.index} 步 ·
          ${ok ? "成功" : step.status === "error" ? "错误" : step.status}</span
        >
        <span style="margin-left: auto;">${formatRelative(step.startedAt)}</span>
      </div>
      <div style="font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere;">
        ${step.summary || "（无摘要）"}
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
          步骤 ${task.budget.usedSteps}/${task.budget.maxSteps}
        </span>
        ${task.origin
          ? html`<span class="pill" style="font-size: 12px; padding: 3px 8px;">
              来源：${task.origin}
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
                子任务结果
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

      <div style="font-size: 13px; color: var(--muted); margin-bottom: 6px;">执行轨迹</div>
      ${task.steps.length
        ? task.steps.map(renderStep)
        : html`<div style="font-size: 13px; color: var(--muted);">尚无已执行步骤</div>`}
      ${task.result
        ? html`
            <div style="margin-top: 12px;">
              <div style="font-size: 13px; color: var(--muted); margin-bottom: 6px;">最终结果</div>
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
        <div style="font-size: 18px; font-weight: 600;">任务</div>
        <label
          style="font-size: 13px; color: var(--muted); margin-left: 16px; display: flex; gap: 6px; align-items: center;"
        >
          <input
            type="checkbox"
            .checked=${props.includeFinished}
            @change=${(e: Event) => props.onToggleFinished((e.target as HTMLInputElement).checked)}
          />
          显示已完结
        </label>
        <button
          class="btn"
          style="margin-left: auto;"
          @click=${() => props.onRefresh(props.includeFinished)}
        >
          刷新
        </button>
      </div>

      ${props.error
        ? html`<div class="card" style="color: var(--danger);">${props.error}</div>`
        : nothing}
      ${props.loading
        ? html`<div class="card" style="color: var(--muted);">加载中…</div>`
        : tasks.length === 0
          ? html`<div class="card" style="color: var(--muted);">
              当前没有${props.includeFinished ? "" : "活跃"}任务。通过聊天委派一个任务（需开启
              cognitive.tasks.enabled）后，这里会显示执行轨迹。
            </div>`
          : tasks.map((task) => renderTaskCard(task, task.id === props.selectedId, props.onSelect))}
      ${props.detailLoading
        ? html`<div class="card" style="color: var(--muted); margin-top: 12px;">加载轨迹…</div>`
        : props.detail
          ? html`<div style="margin-top: 12px;">${renderDetail(props.detail as TaskFull)}</div>`
          : nothing}
    </section>
  `;
}
