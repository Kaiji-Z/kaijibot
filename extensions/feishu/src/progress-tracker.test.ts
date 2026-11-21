import { describe, expect, it } from "vitest";
import {
  createProgressTracker,
  DEFAULT_PROGRESS_THRESHOLD_MS,
  formatElapsedMs,
  type ProgressItemEvent,
} from "./progress-tracker.js";

const T0 = 1_700_000_000_000;

function itemEvent(overrides: Partial<ProgressItemEvent> = {}): ProgressItemEvent {
  return {
    itemId: "tool:1",
    kind: "tool",
    title: "Search repo",
    phase: "start",
    status: "running",
    ...overrides,
  };
}

describe("formatElapsedMs", () => {
  it("formats seconds below one minute", () => {
    expect(formatElapsedMs(0)).toBe("0s");
    expect(formatElapsedMs(45_000)).toBe("45s");
  });

  it("formats minutes with padded seconds", () => {
    expect(formatElapsedMs(60_000)).toBe("1m");
    expect(formatElapsedMs(133_000)).toBe("2m 13s");
  });

  it("formats hours with padded minutes", () => {
    expect(formatElapsedMs(3_600_000)).toBe("1h 00m");
    expect(formatElapsedMs(3_840_000)).toBe("1h 04m");
  });

  it("clamps invalid values", () => {
    expect(formatElapsedMs(Number.NaN)).toBe("0s");
    expect(formatElapsedMs(-5)).toBe("0s");
  });
});

describe("createProgressTracker", () => {
  it("never engages without work items even past the threshold", () => {
    const tracker = createProgressTracker({ thresholdMs: 1000 });
    tracker.setAnchor(T0);
    expect(tracker.hasWorkItems()).toBe(false);
    expect(tracker.shouldEngage(T0 + 60_000)).toBe(false);
  });

  it("does not engage before the threshold even with work items", () => {
    const tracker = createProgressTracker({ thresholdMs: 15_000 });
    tracker.setAnchor(T0);
    tracker.recordItem(itemEvent(), T0 + 1_000);
    expect(tracker.hasWorkItems()).toBe(true);
    expect(tracker.shouldEngage(T0 + 10_000)).toBe(false);
    expect(tracker.shouldEngage(T0 + 15_000)).toBe(true);
  });

  it("uses default threshold constant when not configured", () => {
    const tracker = createProgressTracker();
    tracker.setAnchor(T0);
    tracker.recordItem(itemEvent(), T0);
    expect(DEFAULT_PROGRESS_THRESHOLD_MS).toBe(15_000);
    expect(tracker.shouldEngage(T0 + DEFAULT_PROGRESS_THRESHOLD_MS - 1)).toBe(false);
    expect(tracker.shouldEngage(T0 + DEFAULT_PROGRESS_THRESHOLD_MS)).toBe(true);
  });

  it("engages only once", () => {
    const tracker = createProgressTracker({ thresholdMs: 1000 });
    tracker.setAnchor(T0);
    tracker.recordItem(itemEvent(), T0);
    tracker.markEngaged();
    expect(tracker.isEngaged()).toBe(true);
    expect(tracker.shouldEngage(T0 + 60_000)).toBe(false);
  });

  it("falls back to the first item timestamp as anchor", () => {
    const tracker = createProgressTracker({ thresholdMs: 1000 });
    tracker.recordItem(itemEvent(), T0);
    expect(tracker.shouldEngage(T0 + 999)).toBe(false);
    expect(tracker.shouldEngage(T0 + 1000)).toBe(true);
  });

  it("renders a panel with header and step statuses", () => {
    const tracker = createProgressTracker({ thresholdMs: 1000 });
    tracker.setAnchor(T0);
    tracker.recordItem(itemEvent({ itemId: "tool:1", title: "Search repo" }), T0);
    tracker.recordItem(
      itemEvent({ itemId: "tool:1", phase: "end", status: "completed" }),
      T0 + 12_000,
    );
    tracker.recordItem(itemEvent({ itemId: "tool:2", title: "Write summary" }), T0 + 20_000);

    const panel = tracker.renderPanel(T0 + 65_000);
    expect(panel).toContain("⏳ **Working** · 1m 05s");
    expect(panel).toContain("✅ Search repo (12s)");
    expect(panel).toContain("⏳ Write summary — (45s)");
  });

  it("renders failed and blocked statuses from end events", () => {
    const tracker = createProgressTracker({ thresholdMs: 1000 });
    tracker.setAnchor(T0);
    tracker.recordItem(itemEvent({ itemId: "a", title: "Run tests" }), T0);
    tracker.recordItem(
      itemEvent({ itemId: "a", title: "Run tests", phase: "end", status: "failed" }),
      T0 + 5_000,
    );
    tracker.recordItem(itemEvent({ itemId: "b", title: "Blocked step" }), T0 + 6_000);
    tracker.recordItem(
      itemEvent({ itemId: "b", title: "Blocked step", phase: "end", status: "blocked" }),
      T0 + 7_000,
    );

    const panel = tracker.renderPanel(T0 + 8_000);
    expect(panel).toContain("❌ Run tests (5s)");
    expect(panel).toContain("🚫 Blocked step (1s)");
  });

  it("caps visible steps and counts hidden earlier steps", () => {
    const tracker = createProgressTracker({ thresholdMs: 1000, maxVisibleSteps: 2 });
    tracker.setAnchor(T0);
    for (let i = 1; i <= 4; i += 1) {
      tracker.recordItem(itemEvent({ itemId: `tool:${i}`, title: `Step ${i}` }), T0 + i * 1000);
    }
    const panel = tracker.renderPanel(T0 + 10_000);
    expect(panel).toContain("Step 4");
    expect(panel).toContain("Step 3");
    expect(panel).not.toContain("Step 2 (");
    expect(panel).toContain("+2 earlier steps");
  });

  it("falls back to name when title is absent", () => {
    const tracker = createProgressTracker({ thresholdMs: 1000 });
    tracker.setAnchor(T0);
    tracker.recordItem(itemEvent({ title: undefined, name: "bash" }), T0);
    expect(tracker.renderPanel(T0 + 1000)).toContain("⏳ bash");
  });

  it("ignores events without an identifiable key or phase", () => {
    const tracker = createProgressTracker({ thresholdMs: 1000 });
    tracker.setAnchor(T0);
    tracker.recordItem({ phase: "start" }, T0);
    tracker.recordItem({ itemId: "tool:1", phase: "unknown-phase" }, T0);
    expect(tracker.hasWorkItems()).toBe(false);
  });

  it("renders a footer with the latest running item and empty when idle", () => {
    const tracker = createProgressTracker({ thresholdMs: 1000 });
    tracker.setAnchor(T0);
    tracker.recordItem(itemEvent({ itemId: "a", title: "Run tests" }), T0);
    expect(tracker.renderFooter(T0 + 30_000)).toBe("> 🔧 Run tests — 30s");
    tracker.recordItem(itemEvent({ itemId: "a", phase: "end" }), T0 + 31_000);
    expect(tracker.renderFooter(T0 + 32_000)).toBe("");
  });

  it("throttles renders to the configured interval", () => {
    const tracker = createProgressTracker({ thresholdMs: 1000, minUpdateIntervalMs: 2000 });
    expect(tracker.shouldRender(T0)).toBe(true);
    tracker.markRendered(T0);
    expect(tracker.shouldRender(T0 + 1999)).toBe(false);
    expect(tracker.shouldRender(T0 + 2000)).toBe(true);
  });

  it("treats phase end without status as completed", () => {
    const tracker = createProgressTracker({ thresholdMs: 1000 });
    tracker.setAnchor(T0);
    tracker.recordItem(itemEvent({ itemId: "a" }), T0);
    tracker.recordItem(itemEvent({ itemId: "a", phase: "end", status: undefined }), T0 + 3000);
    expect(tracker.renderPanel(T0 + 4000)).toContain("✅");
  });

  it("truncates long labels", () => {
    const tracker = createProgressTracker({ thresholdMs: 1000 });
    tracker.setAnchor(T0);
    tracker.recordItem(itemEvent({ title: "x".repeat(100) }), T0);
    const panel = tracker.renderPanel(T0 + 1000);
    expect(panel).toContain("…");
    expect(panel.match(/x{60}/)).toBeNull();
  });
});
