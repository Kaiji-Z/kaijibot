import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerLogTransport,
  setLoggerOverride,
  type LogTransportRecord,
} from "../logging/logger.js";
import {
  emitHeartbeatEvent,
  getLastHeartbeatEvent,
  onHeartbeatEvent,
  resetHeartbeatEventsForTest,
  resolveIndicatorType,
} from "./heartbeat-events.js";
import { resolvePreferredKaijiBotTmpDir } from "./tmp-kaijibot-dir.js";

type HeartbeatEventsModule = typeof import("./heartbeat-events.js");

const heartbeatEventsModuleUrl = new URL("./heartbeat-events.ts", import.meta.url).href;

async function importHeartbeatEventsModule(cacheBust: string): Promise<HeartbeatEventsModule> {
  return (await import(`${heartbeatEventsModuleUrl}?t=${cacheBust}`)) as HeartbeatEventsModule;
}

describe("resolveIndicatorType", () => {
  it("maps heartbeat statuses to indicator types", () => {
    expect(resolveIndicatorType("ok-empty")).toBe("ok");
    expect(resolveIndicatorType("ok-token")).toBe("ok");
    expect(resolveIndicatorType("sent")).toBe("alert");
    expect(resolveIndicatorType("failed")).toBe("error");
    expect(resolveIndicatorType("skipped")).toBeUndefined();
  });
});

describe("heartbeat events", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-09T12:00:00Z"));
  });

  afterEach(() => {
    resetHeartbeatEventsForTest();
    vi.useRealTimers();
  });

  it("stores the last event and timestamps emitted payloads", () => {
    emitHeartbeatEvent({ status: "sent", to: "+123", preview: "ping" });

    expect(getLastHeartbeatEvent()).toEqual({
      ts: 1767960000000,
      status: "sent",
      to: "+123",
      preview: "ping",
    });
  });

  it("delivers events to listeners, isolates listener failures, and supports unsubscribe", () => {
    const seen: string[] = [];
    const unsubscribeFirst = onHeartbeatEvent((evt) => {
      seen.push(`first:${evt.status}`);
    });
    onHeartbeatEvent(() => {
      throw new Error("boom");
    });
    const unsubscribeThird = onHeartbeatEvent((evt) => {
      seen.push(`third:${evt.status}`);
    });

    emitHeartbeatEvent({ status: "ok-empty" });
    unsubscribeFirst();
    unsubscribeThird();
    emitHeartbeatEvent({ status: "failed" });

    expect(seen).toEqual(["first:ok-empty", "third:ok-empty"]);
  });

  it("shares heartbeat state across duplicate module instances", async () => {
    const first = await importHeartbeatEventsModule(`first-${Date.now()}`);
    const second = await importHeartbeatEventsModule(`second-${Date.now()}`);

    first.resetHeartbeatEventsForTest();

    const seen: string[] = [];
    const stop = first.onHeartbeatEvent((evt) => {
      seen.push(evt.status);
    });

    second.emitHeartbeatEvent({ status: "ok-token", preview: "pong" });

    expect(first.getLastHeartbeatEvent()).toEqual({
      ts: 1767960000000,
      status: "ok-token",
      preview: "pong",
    });
    expect(seen).toEqual(["ok-token"]);

    stop();
    first.resetHeartbeatEventsForTest();
  });
});

describe("heartbeat event file logging", () => {
  // The subsystem logger caches its child logger per module instance, so a
  // transport registered per-test would miss emits routed through the cached
  // logger built by an earlier test. One shared transport + index slicing
  // captures every test deterministically.
  const records: LogTransportRecord[] = [];
  let startIndex = 0;

  beforeAll(() => {
    registerLogTransport((record) => records.push(record));
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-09T12:00:00Z"));
    startIndex = records.length;
    setLoggerOverride({
      level: "info",
      consoleLevel: "silent",
      file: path.join(
        resolvePreferredKaijiBotTmpDir(),
        `hb-events-test-${process.pid}-${Date.now()}.log`,
      ),
    });
  });

  afterEach(() => {
    resetHeartbeatEventsForTest();
    setLoggerOverride(null);
    vi.useRealTimers();
  });

  function capturedLogs(): Array<Record<string, unknown>> {
    // Subsystem log records use positional keys: "1" = meta, "2" = message.
    return records.slice(startIndex).map((record) => ({
      message: String(record["2"] ?? ""),
      ...((record["1"] as Record<string, unknown> | undefined) ?? {}),
    }));
  }

  it("logs delivery outcomes (sent) with routing metadata", () => {
    emitHeartbeatEvent({
      status: "sent",
      to: "user:ou_123",
      channel: "feishu",
      durationMs: 29_203,
    });

    const entry = capturedLogs().find((e) => e.status === "sent");
    expect(entry).toMatchObject({
      status: "sent",
      to: "user:ou_123",
      channel: "feishu",
      durationMs: 29_203,
    });
    expect(entry?.message).toContain("heartbeat sent");
  });

  it("logs skipped events with their reason", () => {
    emitHeartbeatEvent({ status: "skipped", reason: "quiet-hours" });

    expect(
      capturedLogs().some(
        (e) =>
          e.status === "skipped" &&
          typeof e.message === "string" &&
          e.message.includes("quiet-hours"),
      ),
    ).toBe(true);
  });

  it("excludes transient requests-in-flight skips", () => {
    emitHeartbeatEvent({ status: "skipped", reason: "requests-in-flight" });

    expect(capturedLogs()).toHaveLength(0);
  });

  it("logs failed outcomes", () => {
    emitHeartbeatEvent({ status: "failed" });

    expect(capturedLogs().some((e) => e.status === "failed")).toBe(true);
  });
});
