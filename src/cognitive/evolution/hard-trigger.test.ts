import { homedir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./engine.js", () => ({
  EvolutionEngine: class {
    evaluate = vi.fn().mockResolvedValue({
      shouldSuggest: true,
      complexityScore: 0.8,
      reasoning: "complex",
      confidence: 0.9,
    });
    generate = vi.fn().mockResolvedValue({
      name: "test-skill",
      description: "A test skill",
      triggerPhrases: ["test"],
      bodyMarkdown: "# Test",
    });
  },
}));

vi.mock("./store.js", () => ({
  EvolutionStore: class {
    save = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock("./llm-draft-generator.js", () => ({
  generateSkillDraftLLM: vi.fn(),
}));

vi.mock("./standalone-generate.js", () => ({
  createStandaloneGenerateText: vi.fn().mockRejectedValue("no llm"),
}));

vi.mock("../../agents/tool-error-summary.js", () => ({
  consumeToolErrorProfile: vi.fn().mockReturnValue(undefined),
}));

vi.mock("../../utils.js", async (orig) => ({
  ...(await orig<typeof import("../../utils.js")>()),
  resolveConfigDir: vi.fn().mockReturnValue("/home/test/.kaijibot"),
}));

vi.mock("../../agents/agent-scope.js", async (orig) => {
  const actual = await orig<typeof import("../../agents/agent-scope.js")>();
  return {
    ...actual,
    resolveAgentWorkspaceDir: vi.fn().mockReturnValue("/home/test/.kaijibot/workspace"),
  };
});

vi.mock("../../routing/session-key.js", async (orig) => {
  const actual = await orig<typeof import("../../routing/session-key.js")>();
  return {
    ...actual,
    resolveAgentIdFromSessionKey: vi.fn().mockReturnValue("main"),
  };
});

const mockDeliver = vi.fn().mockResolvedValue(undefined);
vi.mock("../../infra/outbound/deliver.js", () => ({
  deliverOutboundPayloads: mockDeliver,
}));

vi.mock("../../gateway/cognitive-delivery.js", () => ({
  resolveCognitiveDeliveryTarget: vi.fn().mockReturnValue({
    sessionKey: "agent:main:ou_test",
    channel: "feishu",
    to: "ou_test",
    accountId: "default",
  }),
}));

vi.mock("../../infra/outbound/session-context.js", () => ({
  buildOutboundSessionContext: vi.fn().mockReturnValue({}),
}));

describe("evaluateHardTrigger", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delivers suggestion with resolved workspace path using ~ notation", async () => {
    const { evaluateHardTrigger } = await import("./hard-trigger.js");
    const { resolveAgentWorkspaceDir } = await import("../../agents/agent-scope.js");
    const { resolveAgentIdFromSessionKey } = await import("../../routing/session-key.js");

    (resolveAgentWorkspaceDir as ReturnType<typeof vi.fn>).mockReturnValue(
      `${homedir()}/.kaijibot/workspace`,
    );

    await evaluateHardTrigger({
      toolMetas: [{ toolName: "a" }, { toolName: "b" }, { toolName: "c" }, { toolName: "d" }],
      sessionKey: "agent:main:ou_test",
      trigger: "user",
      config: {} as never,
      senderId: "ou_test",
      started: Date.now() - 5000,
    });

    expect(resolveAgentIdFromSessionKey).toHaveBeenCalledWith("agent:main:ou_test");
    expect(resolveAgentWorkspaceDir).toHaveBeenCalled();
    expect(mockDeliver).toHaveBeenCalledTimes(1);
    const payload = mockDeliver.mock.calls[0][0];
    const text: string = payload.payloads[0].text;
    expect(text).toContain("~/");
    expect(text).toContain("skills/test-skill");
  });

  it("uses resolveAgentWorkspaceDir with correct agentId for non-default agent", async () => {
    const { evaluateHardTrigger } = await import("./hard-trigger.js");
    const { resolveAgentWorkspaceDir } = await import("../../agents/agent-scope.js");
    const { resolveAgentIdFromSessionKey } = await import("../../routing/session-key.js");

    (resolveAgentIdFromSessionKey as ReturnType<typeof vi.fn>).mockReturnValue("custom");
    (resolveAgentWorkspaceDir as ReturnType<typeof vi.fn>).mockReturnValue("/data/custom-workspace");

    await evaluateHardTrigger({
      toolMetas: [{ toolName: "a" }, { toolName: "b" }, { toolName: "c" }, { toolName: "d" }],
      sessionKey: "agent:custom:ou_test",
      trigger: "user",
      config: {} as never,
      senderId: "ou_test",
      started: Date.now() - 5000,
    });

    expect(resolveAgentIdFromSessionKey).toHaveBeenCalledWith("agent:custom:ou_test");
    expect(resolveAgentWorkspaceDir).toHaveBeenCalledWith({}, "custom");
    const text: string = mockDeliver.mock.calls[0][0].payloads[0].text;
    expect(text).toContain("/data/custom-workspace/skills/test-skill");
  });

  it("skips when trigger is not user/manual/undefined", async () => {
    const { evaluateHardTrigger } = await import("./hard-trigger.js");
    const { resolveAgentWorkspaceDir } = await import("../../agents/agent-scope.js");

    await evaluateHardTrigger({
      toolMetas: [{ toolName: "a" }, { toolName: "b" }, { toolName: "c" }],
      sessionKey: "agent:main:ou_test",
      trigger: "heartbeat",
      config: {} as never,
      started: Date.now(),
    });

    expect(resolveAgentWorkspaceDir).not.toHaveBeenCalled();
    expect(mockDeliver).not.toHaveBeenCalled();
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

    expect(mockDeliver).not.toHaveBeenCalled();
  });
});
