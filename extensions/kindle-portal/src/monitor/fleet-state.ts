import type { FleetAgent } from "../types.js";

/**
 * Shape of events emitted by `onAgentEvent` and consumed by FleetState.
 *
 * The `stream` union is intentionally widened with `| string` so unknown
 * streams can be passed through without breaking the type system; FleetState
 * ignores any stream it does not recognize.
 *
 * `data` is declared as a required object because well-formed producers always
 * send it, but FleetState treats the payload as untrusted at runtime and never
 * throws on malformed input.
 */
export interface AgentEventPayload {
  stream: "lifecycle" | "item" | "tool" | "assistant" | "thinking" | "error" | string;
  runId: string;
  sessionKey?: string;
  agentId?: string;
  data: {
    phase?: "start" | "end" | "update";
    kind?: "tool" | "command" | "patch" | "search";
    status?: "running" | "completed" | "failed";
    name?: string;
    toolName?: string;
    toolCallId?: string;
    model?: string;
    provider?: string;
    stopReason?: string;
    error?: string;
    startedAt?: number;
    endedAt?: number;
  };
  ts: number;
}

type AgentStatus = "thinking" | "tool_calling" | "completed" | "failed";

/**
 * Internal mutable run record. Mirrors {@link FleetAgent} plus an internal
 * `toolCallSet` used to deduplicate tool-call counts within a run. This field
 * is never projected out via {@link FleetState.snapshot}.
 */
interface RunRecord {
  runId: string;
  sessionKey?: string;
  agentId?: string;
  userId?: string;
  status: AgentStatus;
  model?: string;
  provider?: string;
  toolName?: string;
  toolCallCount: number;
  startedAt: number;
  lastEventAt: number;
  stale?: boolean;
  stopReason?: string;
  sessionLabel?: string;
  totalTokens?: number;
  estimatedCostUsd?: number;
  toolCallSet: Set<string>;
}

/**
 * Runtime validator for the runId field. Payloads are typed as
 * {@link AgentEventPayload} but producers occasionally violate that contract;
 * this helper accepts `unknown` so the null/non-object/non-string checks
 * compile without fighting TypeScript's declared (non-null) parameter type.
 */
function readRunId(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== "object") return undefined;
  const runId = (payload as { runId?: unknown }).runId;
  return typeof runId === "string" && runId !== "" ? runId : undefined;
}

/**
 * In-memory map of active agent runs keyed by `runId`.
 *
 * State is mutated exclusively through {@link applyEvent}, driven by the live
 * agent event stream. Snapshots are deep projections — no internal state (e.g.
 * `toolCallSet`) leaks by reference, and mutating a returned snapshot never
 * affects subsequent reads.
 *
 * Pruning is driven externally (by the monitor service in T11); FleetState
 * itself never schedules timers.
 */
export class FleetState {
  private readonly records = new Map<string, RunRecord>();

  /** Apply a single agent event, advancing the per-run state machine. */
  applyEvent(payload: AgentEventPayload): void {
    try {
      const runId = readRunId(payload);
      if (runId === undefined) return;

      const data = payload.data;
      const stream = payload.stream;
      const ts = payload.ts;
      const existing = this.records.get(runId);

      // lifecycle.start always (re)creates a fresh record — handles runId reuse.
      if (stream === "lifecycle" && data.phase === "start") {
        this.records.set(runId, {
          runId,
          sessionKey: payload.sessionKey,
          agentId: payload.agentId,
          status: "thinking",
          model: data.model,
          provider: data.provider,
          toolCallCount: 0,
          startedAt: typeof data.startedAt === "number" ? data.startedAt : ts,
          lastEventAt: ts,
          toolCallSet: new Set<string>(),
        });
        return;
      }

      // Unknown run + non-start event → ignore.
      if (existing === undefined) return;

      switch (stream) {
        case "item": {
          if (data.phase === "start" && data.kind === "tool") {
            if (existing.status === "completed" || existing.status === "failed") break;
            existing.status = "tool_calling";
            existing.toolName = data.name;
            bumpToolCall(existing, data.toolCallId);
            existing.lastEventAt = ts;
          } else if (data.phase === "end" && data.kind === "tool") {
            if (existing.status === "tool_calling") {
              existing.status = "thinking";
              existing.lastEventAt = ts;
            }
          }
          break;
        }
        case "tool": {
          if (data.status === "running") {
            if (existing.status === "completed" || existing.status === "failed") break;
            existing.status = "tool_calling";
            existing.toolName = data.toolName ?? data.name;
            bumpToolCall(existing, data.toolCallId);
            existing.lastEventAt = ts;
          } else if (data.status === "completed" || data.status === "failed") {
            if (existing.status === "tool_calling") {
              existing.status = "thinking";
              existing.lastEventAt = ts;
            }
          }
          break;
        }
        case "assistant":
        case "thinking": {
          // Content stream — touches activity only, never changes status.
          if (existing.status === "completed" || existing.status === "failed") break;
          existing.lastEventAt = ts;
          break;
        }
        case "lifecycle": {
          if (data.phase === "end") {
            if (existing.status === "completed" || existing.status === "failed") break;
            existing.status = "completed";
            existing.stopReason = data.stopReason;
            existing.lastEventAt = ts;
          }
          break;
        }
        case "error": {
          if (existing.status === "completed" || existing.status === "failed") break;
          existing.status = "failed";
          const explicit = data.stopReason ?? data.error;
          existing.stopReason =
            typeof explicit === "string" && explicit !== "" ? explicit : "error";
          existing.lastEventAt = ts;
          break;
        }
        default:
          // Unknown stream → ignore (do not even bump lastEventAt).
          break;
      }
    } catch {
      // Swallow intentionally: the live event stream must never break the
      // monitor. A thrown exception here would tear down the subscriber.
    }
  }

  /**
   * Returns a deep-cloned projection of all current records (terminal records
   * included until pruned), sorted by `startedAt` ascending. The returned
   * objects never share references with internal state.
   */
  snapshot(): { active: FleetAgent[] } {
    const records = [...this.records.values()].sort((a, b) => a.startedAt - b.startedAt);
    return { active: records.map(projectFleetAgent) };
  }

  /**
   * Remove records whose `lastEventAt` is older than `now - maxAgeMs`.
   * Returns the number of records removed.
   */
  pruneStale(maxAgeMs: number): number {
    const now = Date.now();
    let removed = 0;
    for (const [id, rec] of this.records) {
      if (now - rec.lastEventAt > maxAgeMs) {
        this.records.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  /**
   * Flag records inactive for longer than `staleAfterMs` as `stale = true`.
   * Records already flagged are skipped. Returns the number of newly-flagged
   * records.
   */
  markStale(staleAfterMs: number): number {
    const now = Date.now();
    let flagged = 0;
    for (const rec of this.records.values()) {
      if (rec.stale === true) continue;
      if (now - rec.lastEventAt > staleAfterMs) {
        rec.stale = true;
        flagged += 1;
      }
    }
    return flagged;
  }

  /** Empty the map. */
  clear(): void {
    this.records.clear();
  }

  /** Current record count (terminal records included until pruned). */
  size(): number {
    return this.records.size;
  }
}

/** Deduplicate and increment tool-call count by toolCallId. Mutates `rec`. */
function bumpToolCall(rec: RunRecord, toolCallId: string | undefined): void {
  if (typeof toolCallId !== "string" || toolCallId === "") return;
  if (rec.toolCallSet.has(toolCallId)) return;
  rec.toolCallSet.add(toolCallId);
  rec.toolCallCount += 1;
}

/** Project an internal record into a fresh public FleetAgent object. */
function projectFleetAgent(rec: RunRecord): FleetAgent {
  return {
    runId: rec.runId,
    sessionKey: rec.sessionKey,
    agentId: rec.agentId,
    userId: rec.userId,
    status: rec.status,
    model: rec.model,
    provider: rec.provider,
    toolName: rec.toolName,
    toolCallCount: rec.toolCallCount,
    startedAt: rec.startedAt,
    lastEventAt: rec.lastEventAt,
    stale: rec.stale,
    stopReason: rec.stopReason,
    sessionLabel: rec.sessionLabel,
    totalTokens: rec.totalTokens,
    estimatedCostUsd: rec.estimatedCostUsd,
  };
}
