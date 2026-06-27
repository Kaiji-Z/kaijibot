import { describe, expect, it, vi } from "vitest";
import { FleetState, type AgentEventPayload } from "./fleet-state.js";
import { attachAgentEventCollector, type SubscribeFn } from "./event-collector.js";

interface MockSubscribe {
  subscribe: SubscribeFn;
  emit: (payload: AgentEventPayload) => void;
  unsubscribed: () => boolean;
  listenerCount: () => number;
}

/** Builds a controllable subscribe double. */
function mockSubscribe(): MockSubscribe {
  let listener: ((payload: AgentEventPayload) => void) | null = null;
  let unsubbed = false;
  const subscribe: SubscribeFn = (l) => {
    listener = l;
    return () => {
      unsubbed = true;
      listener = null;
    };
  };
  return {
    subscribe,
    emit: (payload) => listener?.(payload),
    unsubscribed: () => unsubbed,
    listenerCount: () => (listener ? 1 : 0),
  };
}

const startEvent = (runId = "r1"): AgentEventPayload => ({
  stream: "lifecycle",
  runId,
  data: { phase: "start", model: "glm-5" },
  ts: 1000,
});

describe("attachAgentEventCollector", () => {
  it("subscribe is called with a listener function", () => {
    const state = new FleetState();
    const mock = mockSubscribe();
    attachAgentEventCollector(state, mock.subscribe);
    expect(mock.listenerCount()).toBe(1);
  });

  it("events flow into state.applyEvent", () => {
    const state = new FleetState();
    const mock = mockSubscribe();
    attachAgentEventCollector(state, mock.subscribe);

    mock.emit(startEvent("r-flow"));
    const snap = state.snapshot();
    expect(snap.active).toHaveLength(1);
    expect(snap.active[0].runId).toBe("r-flow");
    expect(snap.active[0].status).toBe("thinking");
    expect(snap.active[0].model).toBe("glm-5");
  });

  it("unsubscribe stops updates", () => {
    const state = new FleetState();
    const mock = mockSubscribe();
    const unsubscribe = attachAgentEventCollector(state, mock.subscribe);

    unsubscribe();
    expect(mock.unsubscribed()).toBe(true);

    // After unsubscribe, emitted events must not reach state.
    mock.emit(startEvent("r-after"));
    expect(state.size()).toBe(0);
  });

  it("malformed event does not throw (caught + logged)", () => {
    // state.applyEvent is stubbed to throw — collector must swallow + log.
    const state = new FleetState();
    const applyEventSpy = vi.spyOn(state, "applyEvent").mockImplementation(() => {
      throw new Error("boom");
    });
    const warn = vi.fn();
    const logger = { warn };

    const mock = mockSubscribe();
    attachAgentEventCollector(state, mock.subscribe, logger);

    expect(() => mock.emit(startEvent("r-x"))).not.toThrow();
    expect(applyEventSpy).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0]?.[0] ?? "";
    expect(msg).toContain("[kindle-portal]");
    expect(msg).toContain("boom");
  });

  it("works without logger (no throw)", () => {
    const state = new FleetState();
    const applyEventSpy = vi.spyOn(state, "applyEvent").mockImplementation(() => {
      throw new Error("boom");
    });
    const mock = mockSubscribe();

    attachAgentEventCollector(state, mock.subscribe); // no logger

    expect(() => mock.emit(startEvent("r-y"))).not.toThrow();
    expect(applyEventSpy).toHaveBeenCalledTimes(1);
  });
});
