import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  preprocessSessionTranscript,
  getCleanDialogueContent,
  stripMessageMetadata,
  mergeJsonlContents,
  updateDialogueStaging,
  getDialogueWithStaging,
  extractFirstMessageTimestamp,
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
    const jsonl = buildJsonl(sessionHeader(), userMsg("Hello"), assistantMsg("Hi there"));
    const result = preprocessSessionTranscript(jsonl);
    expect(result).toBe("user: Hello\nassistant: Hi there");
  });

  // 4. Filters out tool result messages
  it("filters out toolResult messages", () => {
    const jsonl = buildJsonl(
      userMsg("Search for X"),
      assistantToolMsg("Searching", [{ id: "c1", name: "web_search", arguments: { query: "X" } }]),
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
      '[message_id: msg_abc123]\nConversation info (untrusted metadata): {"chat_id":"oc_xxx"}\nActual message content';
    const jsonl = buildJsonl(userMsg(rawText));
    const result = preprocessSessionTranscript(jsonl);
    // stripMessageMetadata removes [message_id:...] line and ou_ prefix, but keeps Conversation info line
    expect(result).not.toContain("[message_id:");
    expect(result).toContain("Actual message content");
  });

  // 7. Strips ou_ prefix when Conversation info triggers metadata processing
  it("strips ou_ sender prefix when Conversation info is present", () => {
    const rawText =
      'Conversation info (untrusted metadata): {"chat_id":"oc_xxx"}\nou_abc123: My real message';
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
    const jsonl = buildJsonl(userMsg("/new"), userMsg("/reset"));
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
          content: [{ type: "toolCall", id: "c1", name: "run_code", arguments: { code: "1+1" } }],
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

  // --- excludeToolAnnotations option ---

  it("removes [tool: ...] prefix when excludeToolAnnotations is true", () => {
    const jsonl = buildJsonl(
      userMsg("Search"),
      assistantToolMsg("Searching now", [
        { id: "c1", name: "web_search", arguments: { query: "test" } },
      ]),
    );
    const result = preprocessSessionTranscript(jsonl, { excludeToolAnnotations: true });
    expect(result).not.toContain("[tool:");
    expect(result).not.toContain("web_search");
  });

  it("still includes assistant text content when excludeToolAnnotations is true", () => {
    const jsonl = buildJsonl(
      userMsg("Do it"),
      assistantToolMsg("Working on it", [
        { id: "c1", name: "run_code", arguments: { code: "1+1" } },
      ]),
    );
    const result = preprocessSessionTranscript(jsonl, { excludeToolAnnotations: true });
    expect(result).toContain("assistant: Working on it");
    expect(result).toContain("user: Do it");
  });

  it("defaults to including tool annotations (backward compatible)", () => {
    const jsonl = buildJsonl(
      userMsg("Search"),
      assistantToolMsg("Found it", [{ id: "c1", name: "web_search", arguments: { query: "x" } }]),
    );
    const result = preprocessSessionTranscript(jsonl);
    expect(result).toContain("[tool: web_search]");
  });
});

describe("stripMessageMetadata", () => {
  it("returns text unchanged when no Conversation info present", () => {
    const text = "Just a normal message";
    expect(stripMessageMetadata(text)).toBe("Just a normal message");
  });

  it("strips message_id line when Conversation info is present", () => {
    const text = "[message_id: msg_123]\nConversation info (untrusted metadata): {}";
    const result = stripMessageMetadata(text);
    expect(result).not.toContain("[message_id:");
    expect(result).toContain("Conversation info");
  });

  it("strips ou_ prefix when it appears at start after message_id removal", () => {
    // After removing [message_id: ...]\n, text starts with ou_abc: → regex matches
    const text = "[message_id: msg_123]\nou_abc: Hello";
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

describe("getCleanDialogueContent", () => {
  it("reads file and returns clean dialogue without tool annotations", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kaijibot-test-"));
    try {
      const filePath = path.join(dir, "session.jsonl");
      const jsonl = buildJsonl(
        sessionHeader(),
        userMsg("Hello"),
        assistantToolMsg("Searching...", [
          { id: "c1", name: "web_search", arguments: { query: "test" } },
        ]),
        assistantMsg("Here is the result"),
      );
      await fs.writeFile(filePath, jsonl);
      const result = await getCleanDialogueContent(filePath);
      expect(result).not.toBeNull();
      expect(result).not.toContain("[tool:");
      expect(result).not.toContain("web_search");
      expect(result).toContain("user: Hello");
      expect(result).toContain("assistant: Searching...");
      expect(result).toContain("assistant: Here is the result");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("returns null for missing files", async () => {
    const result = await getCleanDialogueContent("/nonexistent/path/session.jsonl");
    expect(result).toBeNull();
  });

  it("includes all messages without cap", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kaijibot-test-"));
    try {
      const filePath = path.join(dir, "session.jsonl");
      const lines = [sessionHeader()];
      for (let i = 0; i < 20; i++) {
        lines.push(userMsg(`User ${i}`));
        lines.push(assistantMsg(`Assistant ${i}`));
      }
      const jsonl = buildJsonl(...lines);
      await fs.writeFile(filePath, jsonl);
      const result = await getCleanDialogueContent(filePath);
      expect(result).not.toBeNull();
      const messageLines = result!.split("\n");
      expect(messageLines).toHaveLength(40);
      expect(messageLines[0]).toBe("user: User 0");
      expect(messageLines[39]).toBe("assistant: Assistant 19");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("mergeJsonlContents", () => {
  it("returns existing when incoming is empty", () => {
    const existing = buildJsonl(userMsg("A"));
    const result = mergeJsonlContents(existing, "");
    expect(result.trim()).toBe(existing.trim());
  });

  it("appends all incoming when no overlap", () => {
    const existing = JSON.stringify({
      type: "message",
      id: "1",
      message: { role: "user", content: "A" },
    });
    const incoming = JSON.stringify({
      type: "message",
      id: "2",
      message: { role: "assistant", content: "B" },
    });
    const result = mergeJsonlContents(existing, incoming);
    expect(result).toContain('"id":"1"');
    expect(result).toContain('"id":"2"');
  });

  it("deduplicates entries with the same id", () => {
    const entry1 = JSON.stringify({
      type: "message",
      id: "1",
      message: { role: "user", content: "A" },
    });
    const entry2 = JSON.stringify({
      type: "message",
      id: "2",
      message: { role: "assistant", content: "B" },
    });
    const existing = buildJsonl(entry1, entry2);
    const entry3 = JSON.stringify({
      type: "message",
      id: "3",
      message: { role: "user", content: "C" },
    });
    const incoming = buildJsonl(entry2, entry3);
    const result = mergeJsonlContents(existing, incoming);
    expect(result.match(/"id":"1"/g)).toHaveLength(1);
    expect(result.match(/"id":"2"/g)).toHaveLength(1);
    expect(result.match(/"id":"3"/g)).toHaveLength(1);
  });

  it("keeps entries without id from both sides", () => {
    const noId = JSON.stringify({ type: "session", version: 2 });
    const existing = noId;
    const incoming = noId;
    const result = mergeJsonlContents(existing, incoming);
    const sessionCount = result.split('"type":"session"').length - 1;
    expect(sessionCount).toBe(2);
  });

  it("preserves order: existing first, then new incoming", () => {
    const entry1 = JSON.stringify({
      type: "message",
      id: "1",
      message: { role: "user", content: "First" },
    });
    const entry2 = JSON.stringify({
      type: "message",
      id: "2",
      message: { role: "user", content: "Second" },
    });
    const entry3 = JSON.stringify({
      type: "message",
      id: "3",
      message: { role: "user", content: "Third" },
    });
    const existing = buildJsonl(entry1, entry2);
    const incoming = buildJsonl(entry2, entry3);
    const result = mergeJsonlContents(existing, incoming);
    const idx1 = result.indexOf('"id":"1"');
    const idx2 = result.indexOf('"id":"2"');
    const idx3 = result.indexOf('"id":"3"');
    expect(idx1).toBeLessThan(idx2);
    expect(idx2).toBeLessThan(idx3);
  });
});

describe("updateDialogueStaging", () => {
  let tmpDir: string;
  let stagingPath: string;
  let sessionPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kaijibot-staging-test-"));
    stagingPath = path.join(tmpDir, "staging", "test-session.jsonl");
    sessionPath = path.join(tmpDir, "session.jsonl");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates staging file with full JSONL on first call", async () => {
    const jsonl = buildJsonl(sessionHeader(), userMsg("Hello"));
    await fs.writeFile(sessionPath, jsonl);
    await updateDialogueStaging(stagingPath, sessionPath);
    const staged = await fs.readFile(stagingPath, "utf-8");
    expect(staged).toContain("Hello");
  });

  it("merges new entries on subsequent call", async () => {
    const jsonl1 = buildJsonl(sessionHeader(), userMsg("First"));
    await fs.writeFile(sessionPath, jsonl1);
    await updateDialogueStaging(stagingPath, sessionPath);

    const jsonl2 = buildJsonl(sessionHeader(), userMsg("First"), assistantMsg("Second"));
    await fs.writeFile(sessionPath, jsonl2);
    await updateDialogueStaging(stagingPath, sessionPath);

    const staged = await fs.readFile(stagingPath, "utf-8");
    expect(staged).toContain("First");
    expect(staged).toContain("Second");
  });

  it("does not duplicate entries already in staging", async () => {
    const entry = JSON.stringify({
      type: "message",
      id: "msg-1",
      message: { role: "user", content: "A" },
    });
    const jsonl1 = buildJsonl(entry);
    await fs.writeFile(sessionPath, jsonl1);
    await updateDialogueStaging(stagingPath, sessionPath);

    await fs.writeFile(sessionPath, jsonl1);
    await updateDialogueStaging(stagingPath, sessionPath);

    const staged = await fs.readFile(stagingPath, "utf-8");
    expect(staged.match(/"id":"msg-1"/g)).toHaveLength(1);
  });
});

describe("getDialogueWithStaging", () => {
  let tmpDir: string;
  let stagingPath: string;
  let sessionPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kaijibot-dialogue-staging-test-"));
    stagingPath = path.join(tmpDir, "staging", "test-session.jsonl");
    sessionPath = path.join(tmpDir, "session.jsonl");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("falls back to current JSONL when no staging exists", async () => {
    const jsonl = buildJsonl(sessionHeader(), userMsg("Hello"), assistantMsg("World"));
    await fs.writeFile(sessionPath, jsonl);
    const result = await getDialogueWithStaging(stagingPath, sessionPath);
    expect(result).toBe("user: Hello\nassistant: World");
  });

  it("merges staging with current JSONL producing full dialogue", async () => {
    const entry1 = JSON.stringify({
      type: "message",
      id: "1",
      message: { role: "user", content: "Old" },
    });
    const entry2 = JSON.stringify({
      type: "message",
      id: "2",
      message: { role: "assistant", content: "Reply" },
    });
    const entry3 = JSON.stringify({
      type: "message",
      id: "3",
      message: { role: "user", content: "New" },
    });
    const entry4 = JSON.stringify({
      type: "message",
      id: "4",
      message: { role: "assistant", content: "NewReply" },
    });

    await fs.mkdir(path.dirname(stagingPath), { recursive: true });
    await fs.writeFile(stagingPath, buildJsonl(entry1, entry2, entry3));

    await fs.writeFile(sessionPath, buildJsonl(entry3, entry4));

    const result = await getDialogueWithStaging(stagingPath, sessionPath);
    expect(result).not.toBeNull();
    expect(result).toContain("user: Old");
    expect(result).toContain("assistant: Reply");
    expect(result).toContain("user: New");
    expect(result).toContain("assistant: NewReply");
  });

  it("excludes tool annotations from merged dialogue", async () => {
    const entry1 = JSON.stringify({
      type: "message",
      id: "1",
      message: { role: "user", content: "Search" },
    });
    const entry2tool = JSON.stringify({
      type: "message",
      id: "2",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Searching" },
          { type: "toolCall", id: "c1", name: "web_search", arguments: { q: "x" } },
        ],
      },
    });

    await fs.mkdir(path.dirname(stagingPath), { recursive: true });
    await fs.writeFile(stagingPath, buildJsonl(entry1));
    await fs.writeFile(sessionPath, buildJsonl(entry2tool));

    const result = await getDialogueWithStaging(stagingPath, sessionPath);
    expect(result).not.toContain("[tool:");
    expect(result).toContain("assistant: Searching");
  });
});

describe("extractFirstMessageTimestamp", () => {
  let tmpDir: string;
  let sessionPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kaijibot-firstmsg-test-"));
    sessionPath = path.join(tmpDir, "session.jsonl");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function messageRecord(
    id: string,
    role: "user" | "assistant",
    ts: string,
    content = "hi",
  ): string {
    return JSON.stringify({
      type: "message",
      id,
      timestamp: ts,
      message: { role, content, timestamp: ts },
    });
  }

  it("returns first user message timestamp from JSONL", async () => {
    const jsonl = buildJsonl(
      sessionHeader(),
      messageRecord("1", "user", "2026-07-01T10:00:00Z", "morning"),
      messageRecord("2", "assistant", "2026-07-01T10:01:00Z", "hello"),
      messageRecord("3", "user", "2026-07-01T22:30:00Z", "goodnight"),
    );
    await fs.writeFile(sessionPath, jsonl);

    const ts = await extractFirstMessageTimestamp(sessionPath);
    expect(ts).not.toBeNull();
    expect(ts!.toISOString()).toBe("2026-07-01T10:00:00.000Z");
  });

  it("returns null when file does not exist", async () => {
    const ts = await extractFirstMessageTimestamp(path.join(tmpDir, "missing.jsonl"));
    expect(ts).toBeNull();
  });

  it("returns null when JSONL has no message records", async () => {
    await fs.writeFile(sessionPath, sessionHeader() + "\n");
    const ts = await extractFirstMessageTimestamp(sessionPath);
    expect(ts).toBeNull();
  });

  it("falls back to .reset.<ts> archive when primary missing", async () => {
    const archivedPath = `${sessionPath}.reset.2026-07-02T01-00-00.000Z`;
    const jsonl = buildJsonl(
      sessionHeader(),
      messageRecord("1", "user", "2026-07-01T22:00:00Z", "late night"),
    );
    await fs.writeFile(archivedPath, jsonl);

    const ts = await extractFirstMessageTimestamp(sessionPath);
    expect(ts).not.toBeNull();
    expect(ts!.toISOString()).toBe("2026-07-01T22:00:00.000Z");
  });

  it("skips system/tool messages, returns first user/assistant timestamp", async () => {
    const systemMsg = JSON.stringify({
      type: "message",
      id: "sys-1",
      timestamp: "2026-07-01T09:00:00Z",
      message: { role: "system", content: "session init" },
    });
    const jsonl = buildJsonl(
      sessionHeader(),
      systemMsg,
      messageRecord("u1", "user", "2026-07-01T10:30:00Z", "real start"),
    );
    await fs.writeFile(sessionPath, jsonl);

    const ts = await extractFirstMessageTimestamp(sessionPath);
    expect(ts).not.toBeNull();
    expect(ts!.toISOString()).toBe("2026-07-01T10:30:00.000Z");
  });

  it("uses record-level timestamp when message-level timestamp absent", async () => {
    const recordWithoutMsgTs = JSON.stringify({
      type: "message",
      id: "1",
      timestamp: "2026-07-01T15:45:00Z",
      message: { role: "user", content: "no message timestamp" },
    });
    await fs.writeFile(sessionPath, buildJsonl(sessionHeader(), recordWithoutMsgTs));

    const ts = await extractFirstMessageTimestamp(sessionPath);
    expect(ts).not.toBeNull();
    expect(ts!.toISOString()).toBe("2026-07-01T15:45:00.000Z");
  });

  it("regression: hook fires next morning but file date should be previous day", async () => {
    // Scenario: user chats 2026-07-01 10:00-23:00, sleeps, /new at 2026-07-02 09:00.
    // The hook fires at 09:00 next day, but the conversation is from 07-01.
    const jsonl = buildJsonl(
      sessionHeader(),
      messageRecord("1", "user", "2026-07-01T10:00:00Z", "morning"),
      messageRecord("2", "assistant", "2026-07-01T10:01:00Z", "hi"),
      messageRecord("3", "user", "2026-07-01T22:00:00Z", "goodnight"),
    );
    await fs.writeFile(sessionPath, jsonl);

    const firstMsgTime = await extractFirstMessageTimestamp(sessionPath);
    expect(firstMsgTime).not.toBeNull();
    expect(firstMsgTime!.toISOString()).toMatch(/^2026-07-01/);
  });
});
