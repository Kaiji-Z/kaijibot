import type { SchedulerEvent } from "../scheduler/types.js";

export class FeishuActivitySource {
  private handle: ReturnType<typeof setInterval> | undefined;
  private listeners: Array<(event: SchedulerEvent) => void> = [];

  constructor(private readonly intervalMs: number) {}

  onEvent(listener: (event: SchedulerEvent) => void): void {
    this.listeners.push(listener);
  }

  start(): void {
    this.handle = setInterval(() => {
      const event: SchedulerEvent = {
        type: "activity_scan",
        timestamp: Date.now(),
        payload: { scanIntervalMs: this.intervalMs },
      };
      for (const listener of this.listeners) {
        listener(event);
      }
    }, this.intervalMs);

    if (this.handle.unref) this.handle.unref();
  }

  stop(): void {
    if (this.handle !== undefined) {
      clearInterval(this.handle);
      this.handle = undefined;
    }
  }
}
