import { afterEach, describe, expect, it, vi } from "vitest";
import type { KaijiBotConfig } from "../config/config.js";
import { startHeartbeatRunner } from "./heartbeat-runner.js";
import { requestHeartbeatNow, resetHeartbeatWakeStateForTests } from "./heartbeat-wake.js";

// ┌─────────────────────────────────────────────────────────────────────────────
// │ PROOF: cognitive wake for non-default agents must reach runOnce            │
// │                                                                             │
// │ Bug: HeartbeatRunner.run() checked state.agents.get(targetAgentId) BEFORE   │
// │      calling runOnce. When only the default agent is in state.agents (the   │
// │      normal case when agents have no explicit heartbeat config), any wake   │
// │      targeting a non-default agent was blocked at this check and returned   │
// │      { status: "skipped", reason: "disabled" }.                             │
// │                                                                             │
// │      This caused cognitive insight/evolution wakes for agents like          │
// │      "jiroubao", "xiantiaojun-bot" to never execute. The insight was        │
// │      generated but never delivered — it sat in the system event queue until │
// │      the user started a conversation 10 hours later, at which point it was  │
// │      drained as a bare "System:" line instead of via the heartbeat prompt.  │
// │                                                                             │
// │ Fix: For reason === "cognitive-insight" | "cognitive-evolution", construct  │
// │      a temporary HeartbeatAgentState on-the-fly so the wake proceeds to     │
// │      runOnce, where the existing cognitive bypass (Fix B) handles the rest. │
// │                                                                             │
// │ These tests prove the fix by verifying runOnce IS called for cognitive      │
// │ wakes targeting non-default agents, and is NOT called for non-cognitive     │
// │ wakes (negative control).                                                   │
// └─────────────────────────────────────────────────────────────────────────────

describe.skipIf(process.env.CI)(
  "HeartbeatRunner cognitive wake bypass for non-default agents",
  () => {
    type RunOnce = Parameters<typeof startHeartbeatRunner>[0]["runOnce"];

    // Config mirrors the real-world scenario:
    //   - Default agent "main" has heartbeat (→ appears in state.agents)
    //   - Non-default agent "bot2" has NO explicit heartbeat config
    //     (→ resolveHeartbeatAgents returns ONLY "main" → bot2 NOT in state.agents)
    const cfg = {
      agents: {
        defaults: { heartbeat: { every: "30m" }, model: { primary: "test/model" } },
        list: [
          { id: "main", default: true, name: "Main" },
          { id: "bot2", name: "Bot2" },
        ],
      },
    } as unknown as KaijiBotConfig;

    afterEach(() => {
      resetHeartbeatWakeStateForTests();
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    // ── Positive: cognitive wakes MUST reach runOnce ──────────────────────────

    it("routes cognitive-insight wake to non-default agent (state.agents bypass)", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(0));

      const runSpy = vi
        .fn()
        .mockResolvedValue({ status: "ran", durationMs: 1 }) as unknown as RunOnce;
      const runner = startHeartbeatRunner({ cfg, runOnce: runSpy });

      // bot2 is NOT in state.agents (no explicit heartbeat config).
      //
      // BEFORE fix: state.agents.get("bot2") → undefined → run() returns
      //   { status: "skipped", reason: "disabled" } → runOnce NEVER called.
      //
      // AFTER fix: reason === "cognitive-insight" → temp HeartbeatAgentState
      //   constructed → runOnce IS called with agentId "bot2".
      requestHeartbeatNow({
        reason: "cognitive-insight",
        sessionKey: "agent:bot2:feishu:direct:ou_test",
        coalesceMs: 0,
      });

      await vi.advanceTimersByTimeAsync(1);

      expect(runSpy).toHaveBeenCalledTimes(1);
      expect(runSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: "bot2",
          reason: "cognitive-insight",
          sessionKey: "agent:bot2:feishu:direct:ou_test",
        }),
      );

      runner.stop();
    });

    it("routes cognitive-evolution wake to non-default agent (state.agents bypass)", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(0));

      const runSpy = vi
        .fn()
        .mockResolvedValue({ status: "ran", durationMs: 1 }) as unknown as RunOnce;
      const runner = startHeartbeatRunner({ cfg, runOnce: runSpy });

      requestHeartbeatNow({
        reason: "cognitive-evolution",
        sessionKey: "agent:bot2:feishu:direct:ou_test",
        coalesceMs: 0,
      });

      await vi.advanceTimersByTimeAsync(1);

      expect(runSpy).toHaveBeenCalledTimes(1);
      expect(runSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: "bot2",
          reason: "cognitive-evolution",
        }),
      );

      runner.stop();
    });

    it("routes cognitive-insight wake by agentId only (no sessionKey)", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(0));

      const runSpy = vi
        .fn()
        .mockResolvedValue({ status: "ran", durationMs: 1 }) as unknown as RunOnce;
      const runner = startHeartbeatRunner({ cfg, runOnce: runSpy });

      requestHeartbeatNow({
        reason: "cognitive-insight",
        agentId: "bot2",
        coalesceMs: 0,
      });

      await vi.advanceTimersByTimeAsync(1);

      expect(runSpy).toHaveBeenCalledTimes(1);
      expect(runSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: "bot2",
          reason: "cognitive-insight",
        }),
      );

      runner.stop();
    });

    // ── Negative control: non-cognitive wakes MUST still be blocked ───────────

    it("blocks non-cognitive targeted wake for non-default agent", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(0));
      const runSpy = vi.fn().mockResolvedValue({ status: "ran", durationMs: 1 });
      const runner = startHeartbeatRunner({ cfg, runOnce: runSpy as unknown as RunOnce });

      // A regular exec-event wake for bot2 — must NOT trigger runOnce.
      // The fix only applies to cognitive-insight / cognitive-evolution.
      requestHeartbeatNow({
        reason: "exec-event",
        sessionKey: "agent:bot2:feishu:direct:ou_test",
        coalesceMs: 0,
      });

      await vi.advanceTimersByTimeAsync(1);

      // No call to runOnce should target bot2.
      expect(runSpy.mock.calls.some((call) => call[0]?.agentId === "bot2")).toBe(false);

      runner.stop();
    });

    it("blocks unspecified-reason targeted wake for non-default agent", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(0));

      const runSpy = vi.fn().mockResolvedValue({ status: "ran", durationMs: 1 });
      const runner = startHeartbeatRunner({ cfg, runOnce: runSpy as unknown as RunOnce });

      requestHeartbeatNow({
        sessionKey: "agent:bot2:feishu:direct:ou_test",
        coalesceMs: 0,
      });

      await vi.advanceTimersByTimeAsync(1);

      expect(runSpy.mock.calls.some((call) => call[0]?.agentId === "bot2")).toBe(false);

      runner.stop();
    });

    // ── Sanity: default agent still works normally for all reasons ────────────

    it("routes cognitive-insight wake to default agent normally", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(0));

      const runSpy = vi
        .fn()
        .mockResolvedValue({ status: "ran", durationMs: 1 }) as unknown as RunOnce;
      const runner = startHeartbeatRunner({ cfg, runOnce: runSpy });

      requestHeartbeatNow({
        reason: "cognitive-insight",
        sessionKey: "agent:main:feishu:direct:ou_op",
        coalesceMs: 0,
      });

      await vi.advanceTimersByTimeAsync(1);

      expect(runSpy).toHaveBeenCalledTimes(1);
      expect(runSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: "main",
          reason: "cognitive-insight",
        }),
      );

      runner.stop();
    });
  },
);
