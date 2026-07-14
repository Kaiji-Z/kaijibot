import { describe, expect, it } from "vitest";
import { FleetState, type AgentEventPayload } from "./fleet-state.js";

/**
 * Tiny event builder helpers — keep tests declarative and readable.
 * The `ts` field is always explicit so time-based assertions are deterministic.
 */
function start(
  runId: string,
  opts: {
    sessionKey?: string;
    agentId?: string;
    model?: string;
    provider?: string;
    startedAt?: number;
    ts?: number;
  } = {},
): AgentEventPayload {
  return {
    stream: "lifecycle",
    runId,
    sessionKey: opts.sessionKey,
    agentId: opts.agentId,
    data: { phase: "start", model: opts.model, provider: opts.provider, startedAt: opts.startedAt },
    ts: opts.ts ?? 1000,
  };
}

function itemStartTool(
  runId: string,
  opts: { name?: string; toolCallId?: string; ts?: number } = {},
): AgentEventPayload {
  return {
    stream: "item",
    runId,
    data: { phase: "start", kind: "tool", name: opts.name, toolCallId: opts.toolCallId },
    ts: opts.ts ?? 2000,
  };
}

function itemEndTool(runId: string, ts = 3000): AgentEventPayload {
  return { stream: "item", runId, data: { phase: "end", kind: "tool" }, ts };
}

function toolRunning(
  runId: string,
  opts: { toolName?: string; name?: string; toolCallId?: string; ts?: number } = {},
): AgentEventPayload {
  return {
    stream: "tool",
    runId,
    data: {
      status: "running",
      toolName: opts.toolName,
      name: opts.name,
      toolCallId: opts.toolCallId,
    },
    ts: opts.ts ?? 2000,
  };
}

function toolDone(
  runId: string,
  status: "completed" | "failed" = "completed",
  ts = 3000,
): AgentEventPayload {
  return { stream: "tool", runId, data: { status }, ts };
}

function assistant(runId: string, ts = 2500): AgentEventPayload {
  return { stream: "assistant", runId, data: {}, ts };
}

function thinkingStream(runId: string, ts = 2600): AgentEventPayload {
  return { stream: "thinking", runId, data: {}, ts };
}

function lifecycleEnd(
  runId: string,
  opts: { stopReason?: string; ts?: number } = {},
): AgentEventPayload {
  return {
    stream: "lifecycle",
    runId,
    data: { phase: "end", stopReason: opts.stopReason },
    ts: opts.ts ?? 4000,
  };
}

function errorStream(
  runId: string,
  opts: { stopReason?: string; error?: string; ts?: number } = {},
): AgentEventPayload {
  return {
    stream: "error",
    runId,
    data: { stopReason: opts.stopReason, error: opts.error },
    ts: opts.ts ?? 5000,
  };
}

describe("FleetState lifecycle + transitions", () => {
  it("lifecycle.start creates thinking record", () => {
    const s = new FleetState();
    s.applyEvent(
      start("r1", { sessionKey: "sess-a", agentId: "ag-1", model: "glm-5", provider: "zai" }),
    );
    const snap = s.snapshot();
    expect(snap.active).toHaveLength(1);
    const rec = snap.active[0];
    expect(rec.runId).toBe("r1");
    expect(rec.status).toBe("thinking");
    expect(rec.sessionKey).toBe("sess-a");
    expect(rec.agentId).toBe("ag-1");
    expect(rec.model).toBe("glm-5");
    expect(rec.provider).toBe("zai");
    expect(rec.toolCallCount).toBe(0);
    expect(rec.startedAt).toBe(1000);
    expect(rec.lastEventAt).toBe(1000);
  });

  it("lifecycle.start falls back to ts when startedAt missing", () => {
    const s = new FleetState();
    s.applyEvent(start("r1", { ts: 7777 }));
    expect(s.snapshot().active[0].startedAt).toBe(7777);
  });

  it("item.start tool → tool_calling + increments count", () => {
    const s = new FleetState();
    s.applyEvent(start("r1"));
    s.applyEvent(itemStartTool("r1", { name: "search", toolCallId: "tc-1" }));
    const rec = s.snapshot().active[0];
    expect(rec.status).toBe("tool_calling");
    expect(rec.toolName).toBe("search");
    expect(rec.toolCallCount).toBe(1);
    expect(rec.lastEventAt).toBe(2000);
  });

  it("item.start with same toolCallId does not double-count", () => {
    const s = new FleetState();
    s.applyEvent(start("r1"));
    s.applyEvent(itemStartTool("r1", { name: "search", toolCallId: "tc-1" }));
    s.applyEvent(itemStartTool("r1", { name: "search", toolCallId: "tc-1" }));
    const rec = s.snapshot().active[0];
    expect(rec.toolCallCount).toBe(1);
  });

  it("item.end tool → thinking", () => {
    const s = new FleetState();
    s.applyEvent(start("r1"));
    s.applyEvent(itemStartTool("r1", { toolCallId: "tc-1" }));
    s.applyEvent(itemEndTool("r1"));
    expect(s.snapshot().active[0].status).toBe("thinking");
    expect(s.snapshot().active[0].lastEventAt).toBe(3000);
  });

  it("tool stream running → tool_calling", () => {
    const s = new FleetState();
    s.applyEvent(start("r1"));
    s.applyEvent(toolRunning("r1", { toolName: "browser", toolCallId: "tc-tool-1" }));
    const rec = s.snapshot().active[0];
    expect(rec.status).toBe("tool_calling");
    expect(rec.toolName).toBe("browser");
    expect(rec.toolCallCount).toBe(1);
  });

  it("tool stream running prefers data.toolName and falls back to data.name", () => {
    const s = new FleetState();
    s.applyEvent(start("r1"));
    s.applyEvent(toolRunning("r1", { name: "fromName" }));
    expect(s.snapshot().active[0].toolName).toBe("fromName");
  });

  it("tool stream completed → thinking", () => {
    const s = new FleetState();
    s.applyEvent(start("r1"));
    s.applyEvent(toolRunning("r1", { toolCallId: "tc-1" }));
    s.applyEvent(toolDone("r1", "completed"));
    expect(s.snapshot().active[0].status).toBe("thinking");
  });

  it("assistant stream keeps status thinking", () => {
    const s = new FleetState();
    s.applyEvent(start("r1"));
    s.applyEvent(assistant("r1", 9999));
    const rec = s.snapshot().active[0];
    expect(rec.status).toBe("thinking");
    expect(rec.lastEventAt).toBe(9999);
  });

  it("thinking stream keeps status thinking", () => {
    const s = new FleetState();
    s.applyEvent(start("r1"));
    s.applyEvent(thinkingStream("r1", 9999));
    const rec = s.snapshot().active[0];
    expect(rec.status).toBe("thinking");
    expect(rec.lastEventAt).toBe(9999);
  });

  it("lifecycle.end → completed (captures stopReason)", () => {
    const s = new FleetState();
    s.applyEvent(start("r1"));
    s.applyEvent(lifecycleEnd("r1", { stopReason: "stop" }));
    const rec = s.snapshot().active[0];
    expect(rec.status).toBe("completed");
    expect(rec.stopReason).toBe("stop");
    expect(rec.lastEventAt).toBe(4000);
  });

  it("error stream → failed (stopReason defaults to 'error')", () => {
    const s = new FleetState();
    s.applyEvent(start("r1"));
    s.applyEvent(errorStream("r1", {}));
    const rec = s.snapshot().active[0];
    expect(rec.status).toBe("failed");
    expect(rec.stopReason).toBe("error");
  });

  it("error stream prefers explicit stopReason then error message", () => {
    const s = new FleetState();
    s.applyEvent(start("r1"));
    s.applyEvent(errorStream("r1", { stopReason: "rate_limited" }));
    expect(s.snapshot().active[0].stopReason).toBe("rate_limited");

    const s2 = new FleetState();
    s2.applyEvent(start("r2"));
    s2.applyEvent(errorStream("r2", { error: "boom" }));
    expect(s2.snapshot().active[0].stopReason).toBe("boom");
  });
});

describe("FleetState maintenance ops", () => {
  it("pruneStale removes records older than maxAgeMs", () => {
    const s = new FleetState();
    const now = Date.now();
    s.applyEvent(start("old", { ts: now - 2000 }));
    s.applyEvent(start("fresh", { ts: now }));
    const removed = s.pruneStale(1000);
    expect(removed).toBe(1);
    expect(s.size()).toBe(1);
    expect(s.snapshot().active[0].runId).toBe("fresh");
  });

  it("pruneStale removes nothing when all fresh", () => {
    const s = new FleetState();
    const now = Date.now();
    s.applyEvent(start("r1", { ts: now }));
    expect(s.pruneStale(10_000)).toBe(0);
    expect(s.size()).toBe(1);
  });

  it("markStale flags inactive records", () => {
    const s = new FleetState();
    const now = Date.now();
    s.applyEvent(start("r1", { ts: now - 200 }));
    const flagged = s.markStale(100);
    expect(flagged).toBe(1);
    expect(s.snapshot().active[0].stale).toBe(true);
  });

  it("markStale does not re-flag already stale records", () => {
    const s = new FleetState();
    const now = Date.now();
    s.applyEvent(start("r1", { ts: now - 500 }));
    expect(s.markStale(100)).toBe(1);
    expect(s.markStale(100)).toBe(0);
  });

  it("markStale skips fresh records", () => {
    const s = new FleetState();
    const now = Date.now();
    s.applyEvent(start("r1", { ts: now }));
    expect(s.markStale(10_000)).toBe(0);
    expect(s.snapshot().active[0].stale).toBeUndefined();
  });

  it("clear empties state", () => {
    const s = new FleetState();
    s.applyEvent(start("r1"));
    s.applyEvent(start("r2"));
    s.clear();
    expect(s.size()).toBe(0);
    expect(s.snapshot().active).toHaveLength(0);
  });

  it("size counts terminal records until pruned", () => {
    const s = new FleetState();
    s.applyEvent(start("r1"));
    s.applyEvent(lifecycleEnd("r1"));
    expect(s.size()).toBe(1);
  });
});

describe("FleetState snapshot invariants", () => {
  it("snapshot is deep clone (mutating result does not affect state)", () => {
    const s = new FleetState();
    s.applyEvent(start("r1", { model: "glm-5" }));
    const snap1 = s.snapshot();
    // Cast through unknown to a mutable view — FleetAgent fields are readonly
    // on the public type, so this simulates a hostile consumer mutating the
    // returned snapshot buffer.
    const hostile = snap1.active[0] as unknown as {
      status: string;
      model: string;
      runId: string;
    };
    hostile.status = "completed";
    hostile.model = "TAMPERED";
    hostile.runId = "HACKED";
    snap1.active.push({
      runId: "fake",
      status: "thinking",
      toolCallCount: 0,
      startedAt: 0,
      lastEventAt: 0,
    });

    const snap2 = s.snapshot();
    expect(snap2.active).toHaveLength(1);
    expect(snap2.active[0].runId).toBe("r1");
    expect(snap2.active[0].status).toBe("thinking");
    expect(snap2.active[0].model).toBe("glm-5");
  });

  it("snapshot sorted by startedAt ascending", () => {
    const s = new FleetState();
    // Insert out of order.
    s.applyEvent(start("c", { startedAt: 30 }));
    s.applyEvent(start("a", { startedAt: 10 }));
    s.applyEvent(start("b", { startedAt: 20 }));
    const active = s.snapshot().active;
    expect(active.map((r) => r.startedAt)).toEqual([10, 20, 30]);
    expect(active.map((r) => r.runId)).toEqual(["a", "b", "c"]);
  });

  it("snapshot does not leak internal toolCallSet", () => {
    const s = new FleetState();
    s.applyEvent(start("r1"));
    s.applyEvent(itemStartTool("r1", { toolCallId: "tc-1" }));
    const rec = s.snapshot().active[0] as unknown as Record<string, unknown>;
    expect(rec.toolCallSet).toBeUndefined();
  });
});

describe("FleetState defensive guards", () => {
  it("applyEvent with non-string runId is ignored", () => {
    const s = new FleetState();
    const malformed = {
      stream: "lifecycle",
      runId: 12345,
      data: { phase: "start" },
      ts: 1000,
    } as unknown as AgentEventPayload;
    s.applyEvent(malformed);
    expect(s.size()).toBe(0);
  });

  it("applyEvent with empty-string runId is ignored", () => {
    const s = new FleetState();
    const malformed = {
      stream: "lifecycle",
      runId: "",
      data: { phase: "start" },
      ts: 1000,
    } as unknown as AgentEventPayload;
    s.applyEvent(malformed);
    expect(s.size()).toBe(0);
  });

  it("applyEvent for unknown runId non-start event is ignored", () => {
    const s = new FleetState();
    s.applyEvent(itemStartTool("ghost", { toolCallId: "tc-1" }));
    s.applyEvent(assistant("ghost"));
    s.applyEvent(lifecycleEnd("ghost"));
    s.applyEvent(errorStream("ghost"));
    expect(s.size()).toBe(0);
  });

  it("applyEvent with unknown stream is ignored", () => {
    const s = new FleetState();
    s.applyEvent(start("r1"));
    const before = s.snapshot().active[0];
    const malformed = {
      stream: "mystery-stream",
      runId: "r1",
      data: { phase: "start" },
      ts: 9999,
    } as unknown as AgentEventPayload;
    s.applyEvent(malformed);
    const after = s.snapshot().active[0];
    expect(after.status).toBe("thinking");
    // Unknown stream must not bump lastEventAt.
    expect(after.lastEventAt).toBe(before.lastEventAt);
  });

  it("applyEvent never throws on malformed payload", () => {
    const s = new FleetState();

    // 1. undefined data (data is required by type — simulate runtime hole)
    const withUndefinedData = {
      stream: "lifecycle",
      runId: "r1",
      ts: 1000,
    } as unknown as AgentEventPayload;
    expect(() => s.applyEvent(withUndefinedData)).not.toThrow();

    // 2. missing stream
    const missingStream = {
      runId: "r2",
      data: { phase: "start" },
      ts: 1,
    } as unknown as AgentEventPayload;
    expect(() => s.applyEvent(missingStream)).not.toThrow();

    // 3. null payload
    expect(() => s.applyEvent(null as unknown as AgentEventPayload)).not.toThrow();

    // 4. non-string runId
    const numericRunId = {
      stream: "lifecycle",
      runId: 99,
      data: { phase: "start" },
      ts: 1,
    } as unknown as AgentEventPayload;
    expect(() => s.applyEvent(numericRunId)).not.toThrow();

    // 5. circular reference in data — must not cause infinite recursion / throw
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const withCircularData = {
      stream: "lifecycle",
      runId: "r3",
      data: circular as unknown as AgentEventPayload["data"],
      ts: 1,
    } as unknown as AgentEventPayload;
    expect(() => s.applyEvent(withCircularData)).not.toThrow();

    // None of the malformed payloads should have produced records via the
    // guarded paths (null/numeric/empty runId short-circuit; missing stream
    // falls through to default; undefined/circular data do not satisfy
    // lifecycle.start's phase check).
    expect(s.size()).toBe(0);
  });
});
