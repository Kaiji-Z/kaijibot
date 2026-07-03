import { describe, it, expect } from "vitest";
import { sanitizeChatHistoryMessages } from "./chat.js";

describe("sanitizeChatHistoryMessages", () => {
  it("drops role=system messages from transcript", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
      { role: "system", content: [{ type: "text", text: "## Skill Evolution\n..." }] },
      { role: "assistant", content: [{ type: "text", text: "hi" }] },
    ];
    const result = sanitizeChatHistoryMessages(messages, 10000);
    expect(result.filter((m) => (m as { role?: string }).role === "system")).toHaveLength(0);
    expect(result).toHaveLength(2);
  });

  it("keeps compaction system markers", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
      {
        role: "system",
        content: [{ type: "text", text: "Compaction" }],
        __kaijibot: { kind: "compaction" },
      },
    ];
    const result = sanitizeChatHistoryMessages(messages, 10000);
    const systemMsgs = result.filter((m) => (m as { role?: string }).role === "system");
    expect(systemMsgs).toHaveLength(1);
    expect((systemMsgs[0] as { __kaijibot?: { kind?: string } }).__kaijibot?.kind).toBe(
      "compaction",
    );
  });

  it("returns empty array unchanged", () => {
    expect(sanitizeChatHistoryMessages([], 10000)).toEqual([]);
  });

  it("drops user messages that are system-event injections (evolution signal)", () => {
    const messages = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "System: [2026-07-03 19:50:20 GMT+8] [Evolution Signal] 刚完成的任务涉及 5 次工具调用\n" +
              "System:\nSystem: 请根据对话上下文自主判断",
          },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "我评估了一下——不值得" }] },
    ];
    const result = sanitizeChatHistoryMessages(messages, 10000);
    const userMsgs = result.filter((m) => (m as { role?: string }).role === "user");
    expect(userMsgs).toHaveLength(0);
    expect(result).toHaveLength(1);
  });

  it("keeps normal user messages that do not start with System: [", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "帮我查一下天气" }] },
      { role: "assistant", content: [{ type: "text", text: "好的" }] },
    ];
    const result = sanitizeChatHistoryMessages(messages, 10000);
    expect(result).toHaveLength(2);
  });
});
