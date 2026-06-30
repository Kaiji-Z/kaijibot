import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FleetState, type AgentEventPayload } from "./monitor/fleet-state.js";
import { createKindlePortalService, KINDLE_PORTAL_SERVICE_ID } from "./service.js";
import type { KaijiBotPluginServiceContext } from "../api.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const startEvent = (runId = "r1"): AgentEventPayload => ({
  stream: "lifecycle",
  runId,
  data: { phase: "start", model: "glm-5" },
  ts: 1000,
});

/** Minimal context stub accepted by start/stop. */
const noopCtx = {} as KaijiBotPluginServiceContext;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createKindlePortalService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("service.id is 'kindle-portal'", () => {
    const state = new FleetState();
    const subscribe = vi.fn().mockReturnValue(vi.fn());
    const svc = createKindlePortalService({ state, subscribe });
    expect(svc.id).toBe(KINDLE_PORTAL_SERVICE_ID);
  });

  it("start subscribes collector to agent events", () => {
    let capturedListener: ((payload: unknown) => void) | null = null;
    const subscribe = vi.fn().mockImplementation((l) => {
      capturedListener = l;
      return vi.fn();
    });
    const state = new FleetState();
    const svc = createKindlePortalService({ state, subscribe });

    svc.start(noopCtx);

    // Emit a synthetic event through the captured listener.
    capturedListener!(startEvent("r-active"));

    const snap = state.snapshot();
    expect(snap.active).toHaveLength(1);
    expect(snap.active[0].runId).toBe("r-active");
  });

  it("start schedules periodic prune via setInterval", () => {
    const state = new FleetState();
    state.applyEvent(startEvent("r-prune"));

    let _capturedListener: ((payload: unknown) => void) | null = null;
    const subscribe = vi.fn().mockImplementation((l) => {
      _capturedListener = l;
      return vi.fn();
    });

    const svc = createKindlePortalService({
      state,
      subscribe,
      pruneIntervalMs: 100,
      staleAfterMs: 10,
      pruneMaxAgeMs: 50,
    });

    svc.start(noopCtx);

    // One record exists now.
    expect(state.size()).toBe(1);

    // Advance past prune interval so markStale + pruneStale run.
    vi.advanceTimersByTime(150);

    // Record should be pruned (its lastEventAt is 1000, way older than now + 50ms).
    expect(state.size()).toBe(0);
  });

  it("double start is no-op (idempotent)", () => {
    const subscribe = vi.fn().mockReturnValue(vi.fn());
    const state = new FleetState();
    const svc = createKindlePortalService({ state, subscribe });

    svc.start(noopCtx);
    svc.start(noopCtx);

    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it("stop unsubscribes collector", () => {
    let capturedListener: ((payload: unknown) => void) | null = null;
    const unsub = vi.fn();
    const subscribe = vi.fn().mockImplementation((l) => {
      capturedListener = l;
      return unsub;
    });
    const state = new FleetState();
    const svc = createKindlePortalService({ state, subscribe });

    svc.start(noopCtx);
    capturedListener!(startEvent("r-stop-test"));
    expect(state.size()).toBe(1);

    svc.stop!(noopCtx);
    expect(unsub).toHaveBeenCalledTimes(1);
    expect(state.size()).toBe(0);
  });

  it("stop clears interval timer", () => {
    const state = new FleetState();
    const subscribe = vi.fn().mockReturnValue(vi.fn());

    const svc = createKindlePortalService({
      state,
      subscribe,
      pruneIntervalMs: 100,
      staleAfterMs: 10,
      pruneMaxAgeMs: 50,
    });

    svc.start(noopCtx);
    svc.stop!(noopCtx);

    state.applyEvent(startEvent("r-timer"));
    vi.advanceTimersByTime(10_000);

    expect(state.size()).toBe(1);
  });

  it("stop calls state.clear()", () => {
    let capturedListener: ((payload: unknown) => void) | null = null;
    const subscribe = vi.fn().mockImplementation((l) => {
      capturedListener = l;
      return vi.fn();
    });
    const state = new FleetState();
    const svc = createKindlePortalService({ state, subscribe });

    svc.start(noopCtx);
    capturedListener!(startEvent("r-clear"));
    expect(state.size()).toBe(1);

    svc.stop!(noopCtx);
    expect(state.size()).toBe(0);
  });

  it("stop without start is safe (idempotent)", () => {
    const subscribe = vi.fn().mockReturnValue(vi.fn());
    const state = new FleetState();
    const svc = createKindlePortalService({ state, subscribe });

    expect(() => svc.stop!(noopCtx)).not.toThrow();
  });

  it("no leaked references after stop+start cycle", () => {
    let _capturedListener: ((payload: unknown) => void) | null = null;
    const subscribe = vi.fn().mockImplementation((l) => {
      _capturedListener = l;
      return vi.fn();
    });
    const state = new FleetState();
    const svc = createKindlePortalService({ state, subscribe });

    svc.start(noopCtx);
    expect(state.size()).toBe(0);

    svc.stop!(noopCtx);
    expect(state.size()).toBe(0);
    expect(subscribe).toHaveBeenCalledTimes(1);

    svc.start(noopCtx);
    expect(subscribe).toHaveBeenCalledTimes(2);

    svc.stop!(noopCtx);
    expect(state.size()).toBe(0);
  });

  it("logger.info called on start and stop", () => {
    const info = vi.fn();
    const logger = { info };
    const subscribe = vi.fn().mockReturnValue(vi.fn());
    const state = new FleetState();
    const svc = createKindlePortalService({ state, subscribe, logger });

    svc.start(noopCtx);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith("[kindle-portal] service started");

    svc.stop!(noopCtx);
    expect(info).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenCalledWith("[kindle-portal] service stopped");
  });

  it("start does not throw when subscribe throws", () => {
    const warn = vi.fn();
    const logger = { warn };
    const subscribe = vi.fn().mockImplementation(() => {
      throw new Error("subscribe-err");
    });
    const state = new FleetState();
    const svc = createKindlePortalService({ state, subscribe, logger });

    expect(() => svc.start(noopCtx)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("subscribe-err");
  });

  it("stop does not throw when collectorUnsub throws", () => {
    const warn = vi.fn();
    const logger = { warn };
    const unsub = vi.fn().mockImplementation(() => {
      throw new Error("unsub-err");
    });
    const subscribe = vi.fn().mockReturnValue(unsub);
    const state = new FleetState();
    const svc = createKindlePortalService({ state, subscribe, logger });

    svc.start(noopCtx);

    expect(() => svc.stop!(noopCtx)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("unsub-err");
  });

  it("uses default intervals when opts omitted", () => {
    const subscribe = vi.fn().mockReturnValue(vi.fn());
    const state = new FleetState();

    const svc = createKindlePortalService({ state, subscribe });
    expect(svc.id).toBe(KINDLE_PORTAL_SERVICE_ID);
    expect(() => svc.start(noopCtx)).not.toThrow();
  });
});
