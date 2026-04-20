import { describe, it, expect, vi, afterEach } from "vitest";
import { EvolutionSource } from "./evolution-source.js";

describe("EvolutionSource", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("constructs without error", () => {
    const source = new EvolutionSource(5000);
    expect(source).toBeInstanceOf(EvolutionSource);
  });

  it("emits events at configured interval", () => {
    vi.useFakeTimers();
    const source = new EvolutionSource(1000);
    const events: Array<{ type: string }> = [];

    source.onEvent((event) => events.push(event));
    source.start();

    vi.advanceTimersByTime(2500);

    expect(events.length).toBe(2);

    source.stop();
  });

  it("emits events with type evolution_scan and payload", () => {
    vi.useFakeTimers();
    const source = new EvolutionSource(1000);
    const events: Array<{ type: string; payload?: unknown }> = [];

    source.onEvent((event) => events.push(event));
    source.start();

    vi.advanceTimersByTime(1000);

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("evolution_scan");
    expect(events[0].payload).toEqual({ scanIntervalMs: 1000 });

    source.stop();
  });

  it("stops emitting after stop()", () => {
    vi.useFakeTimers();
    const source = new EvolutionSource(1000);
    const events: Array<{ type: string }> = [];

    source.onEvent((event) => events.push(event));
    source.start();

    vi.advanceTimersByTime(1000);
    source.stop();
    vi.advanceTimersByTime(3000);

    expect(events.length).toBe(1);
  });

  it("delivers events to all registered listeners", () => {
    vi.useFakeTimers();
    const source = new EvolutionSource(500);
    const events1: unknown[] = [];
    const events2: unknown[] = [];

    source.onEvent((e) => events1.push(e));
    source.onEvent((e) => events2.push(e));
    source.start();

    vi.advanceTimersByTime(600);

    expect(events1.length).toBe(1);
    expect(events2.length).toBe(1);

    source.stop();
  });

  it("unrefs the timer handle", () => {
    vi.useFakeTimers();
    const source = new EvolutionSource(1000);
    const unrefSpy = vi.fn();

    const originalSetInterval = globalThis.setInterval;
    vi.spyOn(globalThis, "setInterval").mockImplementation((() => {
      const handle = originalSetInterval(() => {}, 99999) as ReturnType<typeof setInterval>;
      (handle as unknown as { unref: typeof unrefSpy }).unref = unrefSpy;
      return handle;
    }) as unknown as typeof setInterval);

    source.start();

    expect(unrefSpy).toHaveBeenCalledOnce();

    source.stop();
    vi.restoreAllMocks();
  });
});
