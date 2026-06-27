import { describe, expect, it, vi } from "vitest";
import { FleetState } from "./fleet-state.js";
import { buildFleetSnapshot, type SnapshotSourceOpts } from "./snapshot-source.js";
import type { LoadSessionStore, SessionStoreSnapshot } from "./scope-resolver.js";
import type { FleetAgent } from "../types.js";
import type { KindleConfig } from "../config.js";

/**
 * Fleet snapshot source — merges live event state with session store metadata.
 *
 * Tests cover enrichment, resilience, defensive sort, and that the snapshot
 * can never throw (degrades to un-enriched agents when the store is broken).
 */

const baseCfg: KindleConfig = {
  enabled: true,
  refreshIntervalSeconds: 15,
  mapRefreshSeconds: 300,
  scope: "last-active",
  showWiki: true,
  maxDomains: 20,
  pngWidth: 758,
};

/**
 * Minimal live FleetAgent. Snapshot-source is purely a consumer of
 * FleetState.snapshot() output — it does not need to drive real events.
 */
function liveAgent(overrides: Partial<FleetAgent> = {}): FleetAgent {
  return {
    runId: "run-1",
    sessionKey: "agent:main:feishu:direct:ou_abc@feishu",
    agentId: "agent-main",
    status: "thinking",
    toolCallCount: 0,
    startedAt: 1000,
    lastEventAt: 1000,
    ...overrides,
  };
}

/** Build a SnapshotSourceOpts with a mocked FleetState. */
function optsWithMockState(
  active: FleetAgent[],
  store: SessionStoreSnapshot | (() => Promise<SessionStoreSnapshot>),
  overrides: Partial<SnapshotSourceOpts> = {},
): SnapshotSourceOpts {
  const state = {
    snapshot: () => ({ active }),
  } as unknown as FleetState;
  const loadStore: LoadSessionStore =
    typeof store === "function"
      ? (store as LoadSessionStore)
      : (vi.fn().mockResolvedValue(store) as LoadSessionStore);
  return {
    state,
    loadStore,
    cfg: baseCfg,
    ...overrides,
  };
}

describe("buildFleetSnapshot", () => {
  describe("enrichment", () => {
    it("merges active runs with session metadata", async () => {
      const agents: FleetAgent[] = [
        liveAgent({ runId: "run-1", sessionKey: "sess-A" }),
        liveAgent({ runId: "run-2", sessionKey: "sess-B" }),
      ];
      const store: SessionStoreSnapshot = {
        agents: [
          {
            agentId: "agent-main",
            sessions: [
              { sessionKey: "sess-A", updatedAt: 1, label: "Alice chat", totalTokens: 500, estimatedCostUsd: 0.02 },
              { sessionKey: "sess-B", updatedAt: 2, label: "Bob chat", totalTokens: 800, estimatedCostUsd: 0.04 },
            ],
          },
        ],
      };

      const snap = await buildFleetSnapshot(optsWithMockState(agents, store));

      expect(snap.agents).toHaveLength(2);
      expect(snap.agents[0]).toMatchObject({
        runId: "run-1",
        sessionLabel: "Alice chat",
        totalTokens: 500,
        estimatedCostUsd: 0.02,
      });
      expect(snap.agents[1]).toMatchObject({
        runId: "run-2",
        sessionLabel: "Bob chat",
        totalTokens: 800,
        estimatedCostUsd: 0.04,
      });
    });

    it("agents without session entry are passed through unenriched", async () => {
      const agents: FleetAgent[] = [
        liveAgent({ runId: "run-1", sessionKey: "sess-A" }),
        liveAgent({ runId: "run-2", sessionKey: "sess-ORPHAN" }),
      ];
      const store: SessionStoreSnapshot = {
        agents: [
          {
            agentId: "agent-main",
            sessions: [
              { sessionKey: "sess-A", updatedAt: 1, label: "Alice chat", totalTokens: 100, estimatedCostUsd: 0.01 },
            ],
          },
        ],
      };

      const snap = await buildFleetSnapshot(optsWithMockState(agents, store));

      expect(snap.agents).toHaveLength(2);
      expect(snap.agents[0]).toMatchObject({ runId: "run-1", sessionLabel: "Alice chat" });
      // Orphan run: no enrichment fields populated.
      expect(snap.agents[1]).toMatchObject({ runId: "run-2" });
      expect(snap.agents[1].sessionLabel).toBeUndefined();
      expect(snap.agents[1].totalTokens).toBeUndefined();
      expect(snap.agents[1].estimatedCostUsd).toBeUndefined();
    });
  });

  describe("idle state", () => {
    it("idle when no active runs", async () => {
      const snap = await buildFleetSnapshot(optsWithMockState([], { agents: [] }));
      expect(snap.idle).toBe(true);
      expect(snap.agents).toEqual([]);
    });

    it("non-idle when active runs present", async () => {
      const snap = await buildFleetSnapshot(
        optsWithMockState([liveAgent()], { agents: [] }),
      );
      expect(snap.idle).toBe(false);
      expect(snap.agents).toHaveLength(1);
    });
  });

  describe("lanes contract (Option A)", () => {
    it("lanes is always empty array", async () => {
      const snap = await buildFleetSnapshot(optsWithMockState([], { agents: [] }));
      expect(snap.lanes).toEqual([]);
    });

    it("laneSupport is always 'unavailable'", async () => {
      const snap = await buildFleetSnapshot(optsWithMockState([], { agents: [] }));
      expect(snap.laneSupport).toBe("unavailable");
    });
  });

  describe("metadata fields", () => {
    it("generatedAt is a number (timestamp)", async () => {
      const before = Date.now();
      const snap = await buildFleetSnapshot(optsWithMockState([], { agents: [] }));
      const after = Date.now();
      expect(typeof snap.generatedAt).toBe("number");
      expect(snap.generatedAt).toBeGreaterThanOrEqual(before);
      expect(snap.generatedAt).toBeLessThanOrEqual(after);
    });

    it("pngCapability defaults to 'unknown' when not provided", async () => {
      const snap = await buildFleetSnapshot(optsWithMockState([], { agents: [] }));
      expect(snap.pngCapability).toBe("unknown");
    });

    it("pngCapability reflects provided value", async () => {
      const snap = await buildFleetSnapshot(
        optsWithMockState([], { agents: [] }, { pngCapability: "graphviz-dot" }),
      );
      expect(snap.pngCapability).toBe("graphviz-dot");
    });
  });

  describe("resilience", () => {
    it("loadStore throwing → snapshot still built with un-enriched agents", async () => {
      const agents: FleetAgent[] = [liveAgent({ runId: "run-1", sessionKey: "sess-A" })];
      const rejectingStore = vi.fn().mockRejectedValue(new Error("disk gone"));
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const snap = await buildFleetSnapshot(
        optsWithMockState(agents, rejectingStore as unknown as LoadSessionStore),
      );

      expect(snap.agents).toHaveLength(1);
      expect(snap.agents[0].runId).toBe("run-1");
      expect(snap.agents[0].sessionLabel).toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("never throws on malformed store shape", async () => {
      // The runtime store contract is untrusted; consumers may hand us
      // anything. Cast required only here to simulate the malformed payload.
      const malformed = { agents: "not-an-array" } as unknown as SessionStoreSnapshot;
      const agents: FleetAgent[] = [liveAgent({ runId: "run-1", sessionKey: "sess-A" })];

      const snap = await buildFleetSnapshot(optsWithMockState(agents, malformed));

      expect(snap.agents).toHaveLength(1);
      expect(snap.agents[0].runId).toBe("run-1");
      // No enrichment possible — fields stay undefined.
      expect(snap.agents[0].sessionLabel).toBeUndefined();
    });
  });

  describe("defensive sort", () => {
    it("agents sorted by startedAt ascending", async () => {
      const agents: FleetAgent[] = [
        liveAgent({ runId: "run-new", startedAt: 5000 }),
        liveAgent({ runId: "run-old", startedAt: 1000 }),
        liveAgent({ runId: "run-mid", startedAt: 3000 }),
      ];

      const snap = await buildFleetSnapshot(optsWithMockState(agents, { agents: [] }));

      expect(snap.agents.map((a) => a.runId)).toEqual(["run-old", "run-mid", "run-new"]);
    });
  });
});
