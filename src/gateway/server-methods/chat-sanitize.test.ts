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
});
