import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEnqueue = vi.fn().mockReturnValue(true);
vi.mock("../../infra/system-events.js", () => ({
  enqueueSystemEvent: mockEnqueue,
}));

const mockHeartbeat = vi.fn();
vi.mock("../../infra/heartbeat-wake.js", () => ({
  requestHeartbeatNow: mockHeartbeat,
}));

describe("evaluateHardTrigger", () => {
  beforeEach(() => vi.clearAllMocks());

  it("enqueues evolution signal and requests heartbeat for 3+ tool calls", async () => {
    const { evaluateHardTrigger } = await import("./hard-trigger.js");

    await evaluateHardTrigger({
      toolMetas: [{ toolName: "a" }, { toolName: "b" }, { toolName: "c" }, { toolName: "d" }],
      sessionKey: "agent:main:feishu:direct:ou_test",
      trigger: "user",
      senderId: "ou_test",
      started: Date.now() - 5000,
    });

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    const [signalText, opts] = mockEnqueue.mock.calls[0];
    expect(signalText).toContain("[Evolution Signal]");
    expect(signalText).toContain("4 次工具调用");
    expect(opts.sessionKey).toBe("agent:main:feishu:direct:ou_test");

    expect(mockHeartbeat).toHaveBeenCalledTimes(1);
    expect(mockHeartbeat.mock.calls[0][0].reason).toBe("cognitive-evolution");
    expect(mockHeartbeat.mock.calls[0][0].sessionKey).toBe("agent:main:feishu:direct:ou_test");
  });

  it("routes signal to original session, not heartbeat session", async () => {
    const { evaluateHardTrigger } = await import("./hard-trigger.js");

    await evaluateHardTrigger({
      toolMetas: [{ toolName: "a" }, { toolName: "b" }, { toolName: "c" }],
      sessionKey: "agent:main:feishu:direct:ou_test",
      trigger: "user",
      senderId: "ou_test",
      started: Date.now() - 1000,
    });

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue.mock.calls[0][1].sessionKey).toBe("agent:main:feishu:direct:ou_test");
    expect(mockHeartbeat.mock.calls[0][0].sessionKey).toBe("agent:main:feishu:direct:ou_test");
  });

  it("skips when trigger is not user/manual/undefined", async () => {
    const { evaluateHardTrigger } = await import("./hard-trigger.js");

    await evaluateHardTrigger({
      toolMetas: [{ toolName: "a" }, { toolName: "b" }, { toolName: "c" }],
      sessionKey: "agent:main:feishu:direct:ou_test",
      trigger: "heartbeat",
      started: Date.now(),
    });

    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockHeartbeat).not.toHaveBeenCalled();
  });

  it("skips when toolMetas has fewer than 3 items", async () => {
    const { evaluateHardTrigger } = await import("./hard-trigger.js");

    await evaluateHardTrigger({
      toolMetas: [{ toolName: "a" }, { toolName: "b" }],
      sessionKey: "agent:main:feishu:direct:ou_test",
      trigger: "user",
      started: Date.now(),
    });

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("signal text includes stats but not tool sequence", async () => {
    const { evaluateHardTrigger } = await import("./hard-trigger.js");

    await evaluateHardTrigger({
      toolMetas: [
        { toolName: "web_search" },
        { toolName: "read_file" },
        { toolName: "web_search" },
      ],
      sessionKey: "agent:main:feishu:direct:ou_test",
      trigger: "user",
      senderId: "ou_test",
      started: Date.now() - 3000,
    });

    const signalText = mockEnqueue.mock.calls[0][0] as string;
    expect(signalText).toContain("3 次工具调用");
    expect(signalText).toContain("2 种");
    expect(signalText).toContain("evaluate_skill_evolution");
    expect(signalText).not.toContain("web_search, read_file, web_search");
  });

  it("signal text includes guidance for user review", async () => {
    const { evaluateHardTrigger } = await import("./hard-trigger.js");

    await evaluateHardTrigger({
      toolMetas: [{ toolName: "a" }, { toolName: "b" }, { toolName: "c" }],
      sessionKey: "agent:main:feishu:direct:ou_test",
      trigger: "user",
      senderId: "ou_test",
      started: Date.now() - 2000,
    });

    const signalText = mockEnqueue.mock.calls[0][0] as string;
    expect(signalText).toContain("生成技能草稿");
    expect(signalText).toContain("让用户审核");
    expect(signalText).toContain("改进已有技能");
  });

  it("signal includes existing skills when configDir has skills", async () => {
    const { evaluateHardTrigger } = await import("./hard-trigger.js");
    const { SkillPersistenceWriter } = await import("./skill-writer.js");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const tempDir = mkdtempSync(join(tmpdir(), "kaijibot-trigger-skills-test-"));
    try {
      const writer = new SkillPersistenceWriter(tempDir);
      await writer.writeSkill({
        name: "existing-skill",
        description: "An existing skill",
        triggerPhrases: ["test"],
        bodyMarkdown: "# Test",
      });

      await evaluateHardTrigger({
        toolMetas: [{ toolName: "a" }, { toolName: "b" }, { toolName: "c" }],
        sessionKey: "agent:main:feishu:direct:ou_test",
        trigger: "user",
        senderId: "ou_test",
        started: Date.now() - 1000,
        configDir: tempDir,
      });

      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      const signalText = mockEnqueue.mock.calls[0][0] as string;
      expect(signalText).toContain("已有技能：");
      expect(signalText).toContain("existing-skill");
      expect(signalText).toContain("An existing skill");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("signal works without configDir (backward compat)", async () => {
    const { evaluateHardTrigger } = await import("./hard-trigger.js");

    await evaluateHardTrigger({
      toolMetas: [{ toolName: "a" }, { toolName: "b" }, { toolName: "c" }],
      sessionKey: "agent:main:feishu:direct:ou_test",
      trigger: "user",
      senderId: "ou_test",
      started: Date.now() - 1000,
    });

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    const signalText = mockEnqueue.mock.calls[0][0] as string;
    expect(signalText).not.toContain("已有技能：");
  });
});
