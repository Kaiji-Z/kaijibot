import { describe, expect, it } from "vitest";
import {
  preprocessSessionTranscript,
  stripMessageMetadata,
} from "./transcript.js";

// ---------------------------------------------------------------------------
// Helpers to build JSONL fixtures inline
// ---------------------------------------------------------------------------

function sessionHeader(): string {
  return JSON.stringify({
    type: "session",
    version: 2,
    id: "test-session",
    timestamp: "2026-01-01T00:00:00Z",
    cwd: "/test",
  });
}

function userMsg(text: string, extra?: Record<string, unknown>): string {
  return JSON.stringify({
    type: "message",
    timestamp: "2026-01-01T00:00:01Z",
    message: { role: "user", content: text, ...extra },
  });
}

function userArrayMsg(
  blocks: Array<{ type: string; text?: string }>,
  extra?: Record<string, unknown>,
): string {
  return JSON.stringify({
    type: "message",
    timestamp: "2026-01-01T00:00:01Z",
    message: { role: "user", content: blocks, ...extra },
  });
}

function assistantMsg(text: string, extra?: Record<string, unknown>): string {
  return JSON.stringify({
    type: "message",
    timestamp: "2026-01-01T00:00:02Z",
    message: { role: "assistant", content: text, ...extra },
  });
}

function assistantToolMsg(
  text: string,
  tools: Array<{ id: string; name: string; arguments: Record<string, unknown> }>,
): string {
  return JSON.stringify({
    type: "message",
    timestamp: "2026-01-01T00:00:02Z",
    message: {
      role: "assistant",
      content: [
        { type: "text", text },
        ...tools.map((t) => ({ type: "toolCall", id: t.id, name: t.name, arguments: t.arguments })),
      ],
    },
  });
}

function toolResultMsg(text: string): string {
  return JSON.stringify({
    type: "message",
    timestamp: "2026-01-01T00:00:03Z",
    message: {
      role: "toolResult",
      content: [{ type: "text", text }],
    },
  });
}

function modelChangeEntry(): string {
  return JSON.stringify({
    type: "model_change",
    timestamp: "2026-01-01T00:00:00Z",
    from: "a",
    to: "b",
  });
}

function buildJsonl(...lines: string[]): string {
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("preprocessSessionTranscript", () => {
  // 1. Empty content → returns null
  it("returns null for empty content", () => {
    expect(preprocessSessionTranscript("")).toBeNull();
    expect(preprocessSessionTranscript("   ")).toBeNull();
  });

  // 2. No valid messages (only system/model_change entries) → returns null
  it("returns null when there are no message-type entries", () => {
    const jsonl = buildJsonl(sessionHeader(), modelChangeEntry());
    expect(preprocessSessionTranscript(jsonl)).toBeNull();
  });

  // 3. Basic user + assistant messages → formatted with role prefixes
  it("formats basic user and assistant messages with role prefixes", () => {
    const jsonl = buildJsonl(
      sessionHeader(),
      userMsg("Hello"),
      assistantMsg("Hi there"),
    );
    const result = preprocessSessionTranscript(jsonl);
    expect(result).toBe("user: Hello\nassistant: Hi there");
  });

  // 4. Filters out tool result messages
  it("filters out toolResult messages", () => {
    const jsonl = buildJsonl(
      userMsg("Search for X"),
      assistantToolMsg("Searching", [
        { id: "c1", name: "web_search", arguments: { query: "X" } },
      ]),
      toolResultMsg('{"results":[]}'),
      assistantMsg("Here are the results"),
    );
    const result = preprocessSessionTranscript(jsonl);
    expect(result).not.toContain("toolResult");
    expect(result).not.toContain('{"results":[]}');
    expect(result).toContain("user: Search for X");
    expect(result).toContain("Here are the results");
  });

  // 5. Filters out thinking blocks — assistant with only thinking block, no text
  it("skips assistant messages with no extractable text (only thinking blocks)", () => {
    const jsonl = buildJsonl(
      userMsg("Think about this"),
      JSON.stringify({
        type: "message",
        timestamp: "2026-01-01T00:00:02Z",
        message: {
          role: "assistant",
          content: [{ type: "thinking", text: "internal thought" }],
        },
      }),
    );
    const result = preprocessSessionTranscript(jsonl);
    expect(result).toBe("user: Think about this");
    expect(result).not.toContain("thinking");
    expect(result).not.toContain("internal thought");
  });

  // 6. Strips [message_id:...] line from user messages with Conversation info
  it("strips message_id line from user messages containing Conversation info", () => {
    const rawText =
      "[message_id: msg_abc123]\nConversation info (untrusted metadata): {\"chat_id\":\"oc_xxx\"}\nActual message content";
    const jsonl = buildJsonl(userMsg(rawText));
    const result = preprocessSessionTranscript(jsonl);
    // stripMessageMetadata removes [message_id:...] line and ou_ prefix, but keeps Conversation info line
    expect(result).not.toContain("[message_id:");
    expect(result).toContain("Actual message content");
  });

  // 7. Strips ou_ prefix when Conversation info triggers metadata processing
  it("strips ou_ sender prefix when Conversation info is present", () => {
    const rawText =
      "Conversation info (untrusted metadata): {\"chat_id\":\"oc_xxx\"}\nou_abc123: My real message";
    const jsonl = buildJsonl(userMsg(rawText));
    const result = preprocessSessionTranscript(jsonl);
    expect(result).toContain("ou_abc123:");
    expect(result).toContain("My real message");
  });

  it("leaves ou_ prefix intact when no Conversation info triggers early return", () => {
    const rawText = "ou_abc123: My message without metadata markers";
    const jsonl = buildJsonl(userMsg(rawText));
    const result = preprocessSessionTranscript(jsonl);
    expect(result).toContain("ou_abc123:");
    expect(result).toContain("My message without metadata markers");
  });

  // 8. Skips slash commands
  it("skips messages that start with a slash command", () => {
    const jsonl = buildJsonl(
      userMsg("/new"),
      userMsg("/reset"),
      userMsg("/help"),
      userMsg("Normal message"),
      assistantMsg("Response"),
    );
    const result = preprocessSessionTranscript(jsonl);
    expect(result).not.toContain("/new");
    expect(result).not.toContain("/reset");
    expect(result).not.toContain("/help");
    expect(result).toBe("user: Normal message\nassistant: Response");
  });

  // 9. Skips inter-session provenance messages
  it("skips user messages with inter-session provenance", () => {
    // hasInterSessionUserProvenance checks provenance.kind === "inter_session"
    const jsonl = buildJsonl(
      userMsg("From another session", {
        provenance: { kind: "inter_session", sourceSession: "other-id" },
      }),
      userMsg("From this session"),
      assistantMsg("Reply"),
    );
    const result = preprocessSessionTranscript(jsonl);
    expect(result).not.toContain("From another session");
    expect(result).toContain("user: From this session");
    expect(result).toContain("Reply");
  });

  // 10. Tool call name markers for assistant messages
  it("adds [tool: name] marker for assistant messages with tool calls", () => {
    const jsonl = buildJsonl(
      userMsg("Search"),
      assistantToolMsg("Searching now", [
        { id: "c1", name: "web_search", arguments: { query: "test" } },
      ]),
    );
    const result = preprocessSessionTranscript(jsonl);
    expect(result).toContain("[tool: web_search]");
    expect(result).toContain("Searching now");
  });

  // 11. Multiple tool calls in one assistant message
  it("lists multiple tool names in a single [tool: ...] marker", () => {
    const jsonl = buildJsonl(
      userMsg("Do multiple things"),
      assistantToolMsg("Working on it", [
        { id: "c1", name: "web_search", arguments: { query: "a" } },
        { id: "c2", name: "read_file", arguments: { path: "/x" } },
      ]),
    );
    const result = preprocessSessionTranscript(jsonl);
    expect(result).toContain("[tool: web_search, read_file]");
  });

  // 12. maxMessages cap — takes last N messages
  it("caps output to last maxMessages entries", () => {
    const lines = [sessionHeader()];
    for (let i = 0; i < 5; i++) {
      lines.push(userMsg(`User ${i}`));
      lines.push(assistantMsg(`Assistant ${i}`));
    }
    const jsonl = buildJsonl(...lines);
    // 10 messages total, cap at 2 → last 2
    const result = preprocessSessionTranscript(jsonl, { maxMessages: 2 });
    expect(result).toBe("user: User 4\nassistant: Assistant 4");
  });

  // 13. Default maxMessages (500) includes all messages
  it("includes all messages when count is within default maxMessages", () => {
    const lines = [sessionHeader()];
    for (let i = 0; i < 50; i++) {
      lines.push(userMsg(`User ${i}`));
      lines.push(assistantMsg(`Assistant ${i}`));
    }
    const jsonl = buildJsonl(...lines);
    const result = preprocessSessionTranscript(jsonl);
    const messageLines = result!.split("\n");
    expect(messageLines).toHaveLength(100);
    expect(messageLines[0]).toBe("user: User 0");
    expect(messageLines[99]).toBe("assistant: Assistant 49");
  });

  // 14. Mixed content (valid messages + noise)
  it("extracts only valid messages from mixed content", () => {
    const jsonl = buildJsonl(
      sessionHeader(),
      "this is not json",
      modelChangeEntry(),
      userMsg("Hello"),
      "",
      assistantMsg("World"),
      toolResultMsg("ignored"),
    );
    const result = preprocessSessionTranscript(jsonl);
    expect(result).toBe("user: Hello\nassistant: World");
  });

  // 15. Content as string vs array — both formats extracted correctly
  it("extracts text from both string and array content formats", () => {
    const jsonl = buildJsonl(
      // string content
      userMsg("String content"),
      // array content with text block
      userArrayMsg([{ type: "text", text: "Array content" }]),
      // assistant string content
      assistantMsg("Assistant string"),
      // assistant array content
      JSON.stringify({
        type: "message",
        timestamp: "2026-01-01T00:00:02Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Assistant array" }],
        },
      }),
    );
    const result = preprocessSessionTranscript(jsonl);
    expect(result).toContain("user: String content");
    expect(result).toContain("user: Array content");
    expect(result).toContain("assistant: Assistant string");
    expect(result).toContain("assistant: Assistant array");
  });

  // Additional edge cases

  it("returns null when all messages are filtered out", () => {
    const jsonl = buildJsonl(
      userMsg("/new"),
      userMsg("/reset"),
    );
    expect(preprocessSessionTranscript(jsonl)).toBeNull();
  });

  it("skips entries with no content field", () => {
    const jsonl = buildJsonl(
      JSON.stringify({
        type: "message",
        timestamp: "2026-01-01T00:00:01Z",
        message: { role: "user" },
      }),
      userMsg("Visible"),
    );
    const result = preprocessSessionTranscript(jsonl);
    expect(result).toBe("user: Visible");
  });

  it("handles assistant message with tool calls but no text block", () => {
    const jsonl = buildJsonl(
      userMsg("Do something"),
      JSON.stringify({
        type: "message",
        timestamp: "2026-01-01T00:00:02Z",
        message: {
          role: "assistant",
          content: [
            { type: "toolCall", id: "c1", name: "run_code", arguments: { code: "1+1" } },
          ],
        },
      }),
    );
    // extractTextMessageContent finds no text block → skipped
    const result = preprocessSessionTranscript(jsonl);
    expect(result).toBe("user: Do something");
  });

  it("is synchronous (no promises)", () => {
    const jsonl = buildJsonl(userMsg("Hi"), assistantMsg("Hey"));
    const result = preprocessSessionTranscript(jsonl);
    // result is a string, not a Promise
    expect(typeof result).toBe("string");
    expect(result).not.toBeInstanceOf(Promise);
  });
});

describe("stripMessageMetadata", () => {
  it("returns text unchanged when no Conversation info present", () => {
    const text = "Just a normal message";
    expect(stripMessageMetadata(text)).toBe("Just a normal message");
  });

  it("strips message_id line when Conversation info is present", () => {
    const text =
      "[message_id: msg_123]\nConversation info (untrusted metadata): {}";
    const result = stripMessageMetadata(text);
    expect(result).not.toContain("[message_id:");
    expect(result).toContain("Conversation info");
  });

  it("strips ou_ prefix when it appears at start after message_id removal", () => {
    // After removing [message_id: ...]\n, text starts with ou_abc: → regex matches
    const text =
      "[message_id: msg_123]\nou_abc: Hello";
    // But no "Conversation info" → early return, nothing stripped
    expect(stripMessageMetadata(text)).toBe(text);
  });

  it("does not strip ou_ prefix when Conversation info is present and ou_ is mid-string", () => {
    // After removing [message_id: msg_123]\n, text is "Conversation info...\nou_xyz: ..."
    // ^ou_ regex won't match because string starts with "Conversation"
    const text =
      "[message_id: msg_123]\nConversation info (untrusted metadata): {}\nou_xyz: Content here";
    const result = stripMessageMetadata(text);
    expect(result).not.toContain("[message_id:");
    expect(result).toContain("ou_xyz: Content here");
  });
});
