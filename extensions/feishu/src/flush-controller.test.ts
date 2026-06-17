import { afterEach, describe, expect, it, vi } from "vitest";
import { FlushController } from "./flush-controller.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a FlushController with a tracked mock doFlush. */
function createController() {
  const flushCalls: number[] = [];
  let flushDurationMs = 0;
  const doFlush = vi.fn(async () => {
    const start = Date.now();
    flushCalls.push(start);
    if (flushDurationMs > 0) {
      await new Promise((r) => setTimeout(r, flushDurationMs));
    }
  });
  const controller = new FlushController(doFlush);
  return {
    controller,
    doFlush,
    flushCalls,
    setFlushDuration: (ms: number) => (flushDurationMs = ms),
  };
}

// ---------------------------------------------------------------------------
// Basic construction
// ---------------------------------------------------------------------------

describe("FlushController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with cardMessageReady = false", () => {
    const { controller } = createController();
    expect(controller.cardMessageReady()).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // setCardMessageReady / cardMessageReady
  // ---------------------------------------------------------------------------

  describe("cardMessageReady", () => {
    it("can be set to true and read back", () => {
      const { controller } = createController();
      controller.setCardMessageReady(true);
      expect(controller.cardMessageReady()).toBe(true);
    });

    it("can be toggled back to false", () => {
      const { controller } = createController();
      controller.setCardMessageReady(true);
      controller.setCardMessageReady(false);
      expect(controller.cardMessageReady()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // flush
  // ---------------------------------------------------------------------------

  describe("flush", () => {
    it("does nothing when cardMessageReady is false", async () => {
      const { controller, doFlush } = createController();
      await controller.flush();
      expect(doFlush).not.toHaveBeenCalled();
    });

    it("calls doFlush when cardMessageReady is true", async () => {
      const { controller, doFlush } = createController();
      controller.setCardMessageReady(true);
      await controller.flush();
      expect(doFlush).toHaveBeenCalledTimes(1);
    });

    it("does not call doFlush after complete()", async () => {
      const { controller, doFlush } = createController();
      controller.setCardMessageReady(true);
      controller.complete();
      await controller.flush();
      expect(doFlush).not.toHaveBeenCalled();
    });

    it("mutex-guards: concurrent flushes do not overlap", async () => {
      vi.useFakeTimers();
      const { controller, doFlush } = createController();
      controller.setCardMessageReady(true);

      // Make the first flush take a while
      let resolveFirst: () => void;
      doFlush.mockImplementationOnce(() => new Promise<void>((r) => (resolveFirst = r)));

      const first = controller.flush();
      const second = controller.flush();

      // Only one doFlush call so far
      expect(doFlush).toHaveBeenCalledTimes(1);

      resolveFirst!();
      await first;
      await second;

      // Second flush should trigger a reflush via timer
      expect(doFlush).toHaveBeenCalledTimes(1);
    });

    it("schedules a reflush when needsReflush was set during in-progress flush", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { controller, doFlush } = createController();
      controller.setCardMessageReady(true);

      let resolveFirst: () => void;
      doFlush.mockImplementationOnce(() => new Promise<void>((r) => (resolveFirst = r)));

      const first = controller.flush();
      // This sets needsReflush = true (flushInProgress && !isCompleted)
      await controller.flush();
      expect(doFlush).toHaveBeenCalledTimes(1);

      resolveFirst!();
      await first;

      // Allow the setTimeout(0) to fire
      await vi.advanceTimersByTimeAsync(10);

      expect(doFlush).toHaveBeenCalledTimes(2);
    });

    it("does not reflush after complete()", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { controller, doFlush } = createController();
      controller.setCardMessageReady(true);

      let resolveFirst: () => void;
      doFlush.mockImplementationOnce(() => new Promise<void>((r) => (resolveFirst = r)));

      const first = controller.flush();
      controller.complete();
      await controller.flush(); // sets needsReflush but isCompleted

      resolveFirst!();
      await first;
      await vi.advanceTimersByTimeAsync(10);

      // No reflush — only the first call
      expect(doFlush).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // waitForFlush
  // ---------------------------------------------------------------------------

  describe("waitForFlush", () => {
    it("resolves immediately when no flush is in progress", async () => {
      const { controller } = createController();
      await expect(controller.waitForFlush()).resolves.toBeUndefined();
    });

    it("waits for an in-progress flush to complete", async () => {
      vi.useFakeTimers();
      const { controller, doFlush } = createController();
      controller.setCardMessageReady(true);

      let resolveFlush: () => void;
      doFlush.mockImplementationOnce(() => new Promise<void>((r) => (resolveFlush = r)));

      const flushPromise = controller.flush();
      const waitPromise = controller.waitForFlush();

      // Neither resolved yet
      let resolved = false;
      waitPromise.then(() => (resolved = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(resolved).toBe(false);

      resolveFlush!();
      await flushPromise;
      await waitPromise;
      expect(resolved).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // cancelPendingFlush
  // ---------------------------------------------------------------------------

  describe("cancelPendingFlush", () => {
    it("clears the pending timer", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { controller, doFlush } = createController();
      controller.setCardMessageReady(true);

      // Trigger a throttled update that schedules a deferred flush
      await controller.throttledUpdate(10000);
      expect(doFlush).not.toHaveBeenCalled();

      controller.cancelPendingFlush();
      await vi.advanceTimersByTimeAsync(15000);

      // Timer was cancelled, no flush
      expect(doFlush).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // complete
  // ---------------------------------------------------------------------------

  describe("complete", () => {
    it("prevents future flush calls", async () => {
      const { controller, doFlush } = createController();
      controller.setCardMessageReady(true);
      controller.complete();
      await controller.flush();
      expect(doFlush).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // throttledUpdate
  // ---------------------------------------------------------------------------

  describe("throttledUpdate", () => {
    it("does nothing when cardMessageReady is false", async () => {
      const { controller, doFlush } = createController();
      await controller.throttledUpdate(100);
      expect(doFlush).not.toHaveBeenCalled();
    });

    it("flushes immediately when throttle interval has elapsed", async () => {
      const { controller, doFlush } = createController();
      controller.setCardMessageReady(true);
      // lastUpdateTime was just set by setCardMessageReady
      await controller.throttledUpdate(0);
      expect(doFlush).toHaveBeenCalledTimes(1);
    });

    it("schedules a deferred flush when inside throttle window", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { controller, doFlush } = createController();
      controller.setCardMessageReady(true);

      // First flush immediately
      await controller.flush();
      expect(doFlush).toHaveBeenCalledTimes(1);

      // Second call is within throttle window — schedules deferred
      await controller.throttledUpdate(1000);
      expect(doFlush).toHaveBeenCalledTimes(1);

      // Advance past throttle window
      await vi.advanceTimersByTimeAsync(1100);
      expect(doFlush).toHaveBeenCalledTimes(2);
    });

    it("does not schedule another timer if one is already pending", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { controller, doFlush } = createController();
      controller.setCardMessageReady(true);

      await controller.flush();
      expect(doFlush).toHaveBeenCalledTimes(1);

      // Call throttledUpdate twice within the window
      await controller.throttledUpdate(1000);
      await controller.throttledUpdate(1000);

      // Only one deferred flush should fire
      await vi.advanceTimersByTimeAsync(1100);
      expect(doFlush).toHaveBeenCalledTimes(2);
    });

    it("batches after a long gap (LONG_GAP_THRESHOLD_MS)", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { controller, doFlush } = createController();

      // Set lastUpdateTime far in the past
      controller.setCardMessageReady(true);
      // Simulate long gap by advancing time past LONG_GAP_THRESHOLD_MS (2000ms)
      await vi.advanceTimersByTimeAsync(3000);

      await controller.throttledUpdate(100);
      // Should not flush immediately — batches briefly
      expect(doFlush).toHaveBeenCalledTimes(0);

      // After BATCH_AFTER_GAP_MS (300ms), flush fires
      await vi.advanceTimersByTimeAsync(400);
      expect(doFlush).toHaveBeenCalledTimes(1);
    });

    it("flushes immediately when throttle elapsed but not a long gap", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { controller, doFlush } = createController();
      controller.setCardMessageReady(true);

      // Advance past throttle but under long gap threshold
      await vi.advanceTimersByTimeAsync(500);
      await controller.throttledUpdate(100);
      expect(doFlush).toHaveBeenCalledTimes(1);
    });
  });
});
