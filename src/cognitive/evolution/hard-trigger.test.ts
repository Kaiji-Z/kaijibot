import { beforeEach, describe, expect, it, vi } from "vitest";

const mockConsumeToolErrorProfile = vi.fn().mockReturnValue(undefined);
vi.mock("../../agents/tool-error-summary.js", () => ({
  consumeToolErrorProfile: mockConsumeToolErrorProfile,
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

  it("enqueues evolution signal and requests heartbeat for 3+ tool calls", async () => {
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

  it("includes error info in signal when errorProfile has errors", async () => {
    mockConsumeToolErrorProfile.mockReturnValueOnce({
      errorCount: 2,
      failedToolNames: ["web_search", "read_file"],
    });

    const { evaluateHardTrigger } = await import("./hard-trigger.js");

    await evaluateHardTrigger({
      toolMetas: [{ toolName: "a" }, { toolName: "b" }, { toolName: "c" }],
      sessionKey: "agent:main:ou_test",
      trigger: "user",
      config: {} as never,
      senderId: "ou_test",
      started: Date.now() - 2000,
    });

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    const signalText = mockEnqueue.mock.calls[0][0] as string;
    expect(signalText).toContain("工具错误");
    expect(signalText).toContain("2 次错误");
    expect(signalText).toContain("web_search, read_file");
  });

  it("skips error info when no errors", async () => {
    const { evaluateHardTrigger } = await import("./hard-trigger.js");

    await evaluateHardTrigger({
      toolMetas: [{ toolName: "a" }, { toolName: "b" }, { toolName: "c" }],
      sessionKey: "agent:main:ou_test",
      trigger: "user",
      config: {} as never,
      senderId: "ou_test",
      started: Date.now(),
    });

    const signalText = mockEnqueue.mock.calls[0][0] as string;
    expect(signalText).not.toContain("工具错误");
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
