import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./engine.js", () => {
  const evaluate = vi.fn().mockResolvedValue({
    shouldSuggest: true,
    complexityScore: 0.8,
    reasoning: "complex",
    confidence: 0.9,
  });
  return {
    EvolutionEngine: class {
      evaluate = evaluate;
    },
    __mockEvaluate: evaluate,
  };
});

vi.mock("./store.js", () => ({
  EvolutionStore: class {},
}));

vi.mock("../../agents/tool-error-summary.js", () => ({
  consumeToolErrorProfile: vi.fn().mockReturnValue(undefined),
}));

vi.mock("../../utils.js", async (orig) => ({
  ...(await orig<typeof import("../../utils.js")>()),
  resolveConfigDir: vi.fn().mockReturnValue("/home/test/.kaijibot"),
}));

const mockEnqueue = vi.fn().mockReturnValue(true);
vi.mock("../../infra/system-events.js", () => ({
  enqueueSystemEvent: mockEnqueue,
}));

const mockHeartbeat = vi.fn();
vi.mock("../../infra/heartbeat-wake.js", () => ({
  requestHeartbeatNow: mockHeartbeat,
}));

vi.mock("../../gateway/cognitive-delivery.js", () => ({
  resolveCognitiveDeliveryTarget: vi.fn().mockReturnValue({
    sessionKey: "agent:main:ou_test",
    channel: "feishu",
    to: "ou_test",
    accountId: "default",
  }),
}));

describe("evaluateHardTrigger", () => {
  beforeEach(() => vi.clearAllMocks());

  it("enqueues evolution signal and requests heartbeat when shouldSuggest is true", async () => {
    const { evaluateHardTrigger } = await import("./hard-trigger.js");

    await evaluateHardTrigger({
      toolMetas: [{ toolName: "a" }, { toolName: "b" }, { toolName: "c" }, { toolName: "d" }],
      sessionKey: "agent:main:ou_test",
      trigger: "user",
      config: {} as never,
      senderId: "ou_test",
      started: Date.now() - 5000,
    });

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    const [signalText, opts] = mockEnqueue.mock.calls[0];
    expect(signalText).toContain("[Evolution Signal]");
    expect(signalText).toContain("4 次工具调用");
    expect(opts.sessionKey).toBeTruthy();

    expect(mockHeartbeat).toHaveBeenCalledTimes(1);
    expect(mockHeartbeat.mock.calls[0][0].reason).toBe("cognitive-evolution");
  });

  it("uses resolved cognitive delivery session key", async () => {
    const { evaluateHardTrigger } = await import("./hard-trigger.js");

    await evaluateHardTrigger({
      toolMetas: [{ toolName: "a" }, { toolName: "b" }, { toolName: "c" }],
      sessionKey: "agent:main:ou_test",
      trigger: "user",
      config: {} as never,
      senderId: "ou_test",
      started: Date.now() - 1000,
    });

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue.mock.calls[0][1].sessionKey).toBe("agent:main:ou_test");
    expect(mockHeartbeat.mock.calls[0][0].sessionKey).toBe("agent:main:ou_test");
  });

  it("skips when trigger is not user/manual/undefined", async () => {
    const { evaluateHardTrigger } = await import("./hard-trigger.js");

    await evaluateHardTrigger({
      toolMetas: [{ toolName: "a" }, { toolName: "b" }, { toolName: "c" }],
      sessionKey: "agent:main:ou_test",
      trigger: "heartbeat",
      config: {} as never,
      started: Date.now(),
    });

    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockHeartbeat).not.toHaveBeenCalled();
  });

  it("skips when toolMetas has fewer than 3 items", async () => {
    const { evaluateHardTrigger } = await import("./hard-trigger.js");

    await evaluateHardTrigger({
      toolMetas: [{ toolName: "a" }, { toolName: "b" }],
      sessionKey: "agent:main:ou_test",
      trigger: "user",
      config: {} as never,
      started: Date.now(),
    });

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("does not enqueue when engine decides not to suggest", async () => {
    const engineModule = await import("./engine.js") as typeof import("./engine.js") & { __mockEvaluate: ReturnType<typeof vi.fn> };
    engineModule.__mockEvaluate.mockResolvedValueOnce({
      shouldSuggest: false,
      complexityScore: 0.1,
      reasoning: "too simple",
    });

    const { evaluateHardTrigger } = await import("./hard-trigger.js");

    await evaluateHardTrigger({
      toolMetas: [{ toolName: "a" }, { toolName: "b" }, { toolName: "c" }],
      sessionKey: "agent:main:ou_test",
      trigger: "user",
      config: {} as never,
      senderId: "ou_test",
      started: Date.now(),
    });

    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockHeartbeat).not.toHaveBeenCalled();
  });

  it("signal text includes tool sequence", async () => {
    const { evaluateHardTrigger } = await import("./hard-trigger.js");

    await evaluateHardTrigger({
      toolMetas: [
        { toolName: "web_search" },
        { toolName: "read_file" },
        { toolName: "web_search" },
      ],
      sessionKey: "agent:main:ou_test",
      trigger: "user",
      config: {} as never,
      senderId: "ou_test",
      started: Date.now() - 3000,
    });

    const signalText = mockEnqueue.mock.calls[0][0] as string;
    expect(signalText).toContain("web_search, read_file, web_search");
    expect(signalText).toContain("evaluate_skill_evolution");
  });

  it("falls back to current sessionKey when cognitive delivery target is unavailable", async () => {
    const { resolveCognitiveDeliveryTarget } = await import("../../gateway/cognitive-delivery.js");
    (resolveCognitiveDeliveryTarget as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);

    const { evaluateHardTrigger } = await import("./hard-trigger.js");

    await evaluateHardTrigger({
      toolMetas: [{ toolName: "a" }, { toolName: "b" }, { toolName: "c" }],
      sessionKey: "agent:main:ou_test",
      trigger: "user",
      config: {} as never,
      senderId: "ou_test",
      started: Date.now(),
    });

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue.mock.calls[0][1].sessionKey).toBe("agent:main:ou_test");
  });
});
