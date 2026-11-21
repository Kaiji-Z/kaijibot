/**
 * Progress tracker for the streaming-card progress panel.
 *
 * Pure state machine: consumes item events (from `GetReplyOptions.onItemEvent`)
 * plus timestamps, and renders markdown for the card content element. No lark
 * API dependencies, so it can be unit-tested in isolation.
 */

export type ProgressItemEvent = {
  itemId?: string;
  kind?: string;
  title?: string;
  name?: string;
  phase?: string;
  status?: string;
  summary?: string;
  progressText?: string;
};

export type ProgressTrackerConfig = {
  /** Run must be at least this old before the panel engages. */
  thresholdMs: number;
  /** Minimum spacing between progress re-renders triggered by item events. */
  minUpdateIntervalMs: number;
  /** Maximum number of step lines rendered in the panel. */
  maxVisibleSteps: number;
};

export const DEFAULT_PROGRESS_THRESHOLD_MS = 15_000;
export const DEFAULT_PROGRESS_MIN_UPDATE_INTERVAL_MS = 2_000;
export const DEFAULT_PROGRESS_MAX_VISIBLE_STEPS = 5;

/** Interval for the elapsed-time ticker kept by the reply dispatcher. */
export const PROGRESS_TICK_INTERVAL_MS = 30_000;

export const DEFAULT_PROGRESS_DELAY_SECONDS = 15;

type ItemStatus = "running" | "completed" | "failed" | "blocked";

type TrackedItem = {
  key: string;
  label: string;
  status: ItemStatus;
  startedAt: number;
  endedAt?: number;
};

const STATUS_EMOJI: Record<ItemStatus, string> = {
  running: "⏳",
  completed: "✅",
  failed: "❌",
  blocked: "🚫",
};

const LABEL_MAX_CHARS = 60;

function clampLabel(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length <= LABEL_MAX_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, LABEL_MAX_CHARS - 1)}…`;
}

/** "45s" / "2m 13s" / "1h 04m" — compact elapsed formatting for card lines. */
export function formatElapsedMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return "0s";
  }
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    const seconds = totalSeconds % 60;
    return seconds > 0
      ? `${totalMinutes}m ${String(seconds).padStart(2, "0")}s`
      : `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function resolveItemStatus(event: ProgressItemEvent): ItemStatus | null {
  if (event.phase === "end") {
    if (event.status === "failed" || event.status === "blocked") {
      return event.status;
    }
    return "completed";
  }
  if (event.phase === "start" || event.phase === "update") {
    return "running";
  }
  return null;
}

function resolveItemKey(event: ProgressItemEvent): string | null {
  if (event.itemId) {
    return event.itemId;
  }
  const fallback = event.name ?? event.title;
  if (fallback) {
    return `name:${event.kind ?? "item"}:${fallback}`;
  }
  return null;
}

export type ProgressTracker = {
  /** Anchor the threshold clock (run start). Later calls are no-ops. */
  setAnchor(now: number): void;
  /** Ingest an item event. */
  recordItem(event: ProgressItemEvent, now: number): void;
  /** True once at least one work item has been observed. */
  hasWorkItems(): boolean;
  /** Threshold reached (elapsed ≥ thresholdMs) and at least one work item seen. */
  shouldEngage(now: number): boolean;
  /** Mark the progress rendering as engaged (panel or footer active). */
  markEngaged(): void;
  /** True once engaged; gates replace-mode card updates. */
  isEngaged(): boolean;
  /** Throttle gate for item-event-triggered re-renders. */
  shouldRender(now: number): boolean;
  markRendered(now: number): void;
  /** Full panel markdown (header + recent steps). */
  renderPanel(now: number): string;
  /** Single-line running-step footer; empty string when nothing is running. */
  renderFooter(now: number): string;
};

export function createProgressTracker(config?: Partial<ProgressTrackerConfig>): ProgressTracker {
  const thresholdMs = config?.thresholdMs ?? DEFAULT_PROGRESS_THRESHOLD_MS;
  const minUpdateIntervalMs =
    config?.minUpdateIntervalMs ?? DEFAULT_PROGRESS_MIN_UPDATE_INTERVAL_MS;
  const maxVisibleSteps = config?.maxVisibleSteps ?? DEFAULT_PROGRESS_MAX_VISIBLE_STEPS;

  const items = new Map<string, TrackedItem>();
  const order: string[] = [];
  let anchorAt: number | null = null;
  let engaged = false;
  let lastRenderAt: number | null = null;

  const visibleItems = (): TrackedItem[] =>
    order.slice(-maxVisibleSteps).map((key) => items.get(key)!);

  const latestRunningItem = (): TrackedItem | null => {
    for (let i = order.length - 1; i >= 0; i -= 1) {
      const item = items.get(order[i]!);
      if (item && item.status === "running") {
        return item;
      }
    }
    return null;
  };

  return {
    setAnchor(now: number): void {
      if (anchorAt === null) {
        anchorAt = now;
      }
    },
    recordItem(event: ProgressItemEvent, now: number): void {
      this.setAnchor(now);
      const key = resolveItemKey(event);
      const status = resolveItemStatus(event);
      if (!key || !status) {
        return;
      }
      const existing = items.get(key);
      if (existing) {
        existing.status = status;
        if (event.title || event.name) {
          existing.label = clampLabel(event.title || event.name || existing.label);
        }
        if (status !== "running") {
          existing.endedAt = now;
        }
        return;
      }
      items.set(key, {
        key,
        label: clampLabel(event.title || event.name || key),
        status,
        startedAt: now,
        endedAt: status === "running" ? undefined : now,
      });
      order.push(key);
    },
    hasWorkItems(): boolean {
      return order.length > 0;
    },
    shouldEngage(now: number): boolean {
      if (engaged || order.length === 0 || anchorAt === null) {
        return false;
      }
      return now - anchorAt >= thresholdMs;
    },
    markEngaged(): void {
      engaged = true;
    },
    isEngaged(): boolean {
      return engaged;
    },
    shouldRender(now: number): boolean {
      if (lastRenderAt === null) {
        return true;
      }
      return now - lastRenderAt >= minUpdateIntervalMs;
    },
    markRendered(now: number): void {
      lastRenderAt = now;
    },
    renderPanel(now: number): string {
      const elapsed = anchorAt === null ? 0 : Math.max(0, now - anchorAt);
      const lines: string[] = [`⏳ **Working** · ${formatElapsedMs(elapsed)}`];
      const visible = visibleItems();
      if (visible.length > 0) {
        lines.push("");
        for (const item of visible) {
          const duration =
            item.endedAt !== undefined
              ? formatElapsedMs(item.endedAt - item.startedAt)
              : formatElapsedMs(Math.max(0, now - item.startedAt));
          const sep = item.status === "running" ? " — " : " ";
          lines.push(`${STATUS_EMOJI[item.status]} ${item.label}${sep}(${duration})`);
        }
        const hiddenCount = order.length - visible.length;
        if (hiddenCount > 0) {
          lines.push("");
          lines.push(
            `<font color='grey'>+${hiddenCount} earlier step${hiddenCount > 1 ? "s" : ""}</font>`,
          );
        }
      }
      return lines.join("\n");
    },
    renderFooter(now: number): string {
      const running = latestRunningItem();
      if (!running) {
        return "";
      }
      const duration = formatElapsedMs(Math.max(0, now - running.startedAt));
      return `> 🔧 ${running.label} — ${duration}`;
    },
  };
}
