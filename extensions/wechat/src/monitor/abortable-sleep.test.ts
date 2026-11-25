import { getEventListeners } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { abortableSleep } from "./abortable-sleep.js";

describe("abortableSleep", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves once the delay has passed", async () => {
    vi.useFakeTimers();
    const settled = vi.fn();
    const pending = abortableSleep(1000).then(settled);

    await vi.advanceTimersByTimeAsync(999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("does not leak an abort listener per completed sleep", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();

    // The monitor retries every couple of seconds while WeChat is unavailable.
    for (let i = 0; i < 20; i += 1) {
      const pending = abortableSleep(10, controller.signal);
      await vi.advanceTimersByTimeAsync(10);
      await pending;
    }

    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("rejects promptly when aborted, before or during the delay", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();

    const pending = abortableSleep(60_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow("aborted");

    // An already-aborted signal must not sit out the full delay (a stale-token
    // pause can be minutes long), or the monitor cannot stop promptly.
    await expect(abortableSleep(60_000, controller.signal)).rejects.toThrow("aborted");
    expect(vi.getTimerCount()).toBe(0);
  });
});
