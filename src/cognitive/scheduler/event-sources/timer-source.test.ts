import { describe, it, expect, vi, afterEach } from "vitest";
import { TimerSource } from "./timer-source.js";

describe("TimerSource", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits timer events at interval", () => {
    vi.useFakeTimers();
    const source = new TimerSource(1000);
    const events: Array<{ type: string }> = [];

    source.onEvent((event) => events.push(event));
    source.start();

    vi.advanceTimersByTime(2500);

    expect(events.length).toBe(2);
    expect(events[0].type).toBe("timer");

    source.stop();
  });

  it("stops emitting after stop()", () => {
    vi.useFakeTimers();
    const source = new TimerSource(1000);
    const events: Array<{ type: string }> = [];

    source.onEvent((event) => events.push(event));
    source.start();

    vi.advanceTimersByTime(1000);
    source.stop();
    vi.advanceTimersByTime(3000);

    expect(events.length).toBe(1);
  });

  it("supports multiple listeners", () => {
    vi.useFakeTimers();
    const source = new TimerSource(500);
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
});
