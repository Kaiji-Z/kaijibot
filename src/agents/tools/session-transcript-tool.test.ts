import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSessionTranscriptTool } from "./session-transcript-tool.js";

// ---------------------------------------------------------------------------
// Helpers to build JSONL fixtures inline
// ---------------------------------------------------------------------------

function userMsg(text: string): string {
  return JSON.stringify({
    type: "message",
    timestamp: "2026-01-01T00:00:01Z",
    message: { role: "user", content: text },
  });
}

function assistantMsg(text: string): string {
  return JSON.stringify({
    type: "message",
    timestamp: "2026-01-01T00:00:02Z",
    message: { role: "assistant", content: text },
  });
}

function assistantToolMsg(text: string, tools: Array<{ name: string }>): string {
  return JSON.stringify({
    type: "message",
    timestamp: "2026-01-01T00:00:02Z",
    message: {
      role: "assistant",
      content: [
        { type: "text", text },
        ...tools.map((t) => ({
          type: "toolCall",
          id: "call_1",
          name: t.name,
          arguments: {},
        })),
      ],
    },
  });
}

function sessionHeader(): string {
  return JSON.stringify({
    type: "session",
    version: 2,
    id: "test-session",
    timestamp: "2026-01-01T00:00:00Z",
    cwd: "/test",
  });
}

function userMsgWithMetadata(text: string): string {
  return JSON.stringify({
    type: "message",
    timestamp: "2026-01-01T00:00:01Z",
    message: {
      role: "user",
      content: `Conversation info (untrusted metadata): {"sender":{}}\n[message_id: msg_123]\nou_abc123: ${text}`,
    },
  });
}

function makeJsonl(...lines: string[]): string {
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createSessionTranscriptTool", () => {
  const tool = createSessionTranscriptTool();
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "session-transcript-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function writeJsonlFile(content: string): Promise<string> {
    const filePath = path.join(tmpDir, "session.jsonl");
    await fs.writeFile(filePath, content, "utf-8");
    return filePath;
  }

  function parseResult(raw: unknown): Record<string, unknown> {
    if (raw && typeof raw === "object" && "details" in raw) {
      return (raw as { details: Record<string, unknown> }).details;
    }
    return raw as Record<string, unknown>;
  }

  it("has correct tool name", () => {
    expect(tool.name).toBe("read_session_transcript");
  });

  it("returns empty for file with only session headers", async () => {
    const filePath = await writeJsonlFile(makeJsonl(sessionHeader()));
    const raw = await tool.execute("tc_0", { transcriptPath: filePath });
    const result = parseResult(raw);
    expect(result.status).toBe("empty");
    expect(result.messageCount).toBe(0);
  });

  it("returns ok with preprocessed content for valid transcript", async () => {
    const filePath = await writeJsonlFile(
      makeJsonl(sessionHeader(), userMsg("hello"), assistantMsg("world")),
    );
    const raw = await tool.execute("tc_0", { transcriptPath: filePath });
    const result = parseResult(raw);
    expect(result.status).toBe("ok");
    expect(result.messageCount).toBe(2);
    expect(result.content).toContain("user: hello");
    expect(result.content).toContain("assistant: world");
  });

  it("respects maxMessages parameter", async () => {
    const lines = [sessionHeader()];
    for (let i = 0; i < 10; i++) {
      lines.push(userMsg(`msg-${i}`));
      lines.push(assistantMsg(`reply-${i}`));
    }
    const filePath = await writeJsonlFile(makeJsonl(...lines));
    const raw = await tool.execute("tc_0", { transcriptPath: filePath, maxMessages: 3 });
    const result = parseResult(raw);
    expect(result.status).toBe("ok");
    expect(result.messageCount).toBe(3);
    // Should contain the LAST 3 messages
    expect(result.content).toContain("msg-9");
    expect(result.content).not.toContain("msg-0");
  });

  it("returns not_found for nonexistent file", async () => {
    const badPath = path.join(tmpDir, "nonexistent.jsonl");
    const raw = await tool.execute("tc_0", { transcriptPath: badPath });
    const result = parseResult(raw);
    expect(result.status).toBe("not_found");
    expect(result.path).toBe(badPath);
  });

  it("returns error for missing transcriptPath", async () => {
    const raw = await tool.execute("tc_0", {});
    const result = parseResult(raw);
    expect(result.status).toBe("error");
    expect(result.error).toContain("transcriptPath is required");
  });

  it("returns empty for empty file", async () => {
    const filePath = await writeJsonlFile("");
    const raw = await tool.execute("tc_0", { transcriptPath: filePath });
    const result = parseResult(raw);
    expect(result.status).toBe("empty");
  });

  it("extracts tool names from assistant toolCall blocks", async () => {
    const filePath = await writeJsonlFile(
      makeJsonl(
        userMsg("check weather"),
        assistantToolMsg("Let me look that up", [{ name: "web_search" }, { name: "read_file" }]),
      ),
    );
    const raw = await tool.execute("tc_0", { transcriptPath: filePath });
    const result = parseResult(raw);
    expect(result.status).toBe("ok");
    expect(result.content).toContain("[tool: web_search, read_file]");
  });

  it("strips metadata from user messages", async () => {
    const filePath = await writeJsonlFile(makeJsonl(userMsgWithMetadata("actual message")));
    const raw = await tool.execute("tc_0", { transcriptPath: filePath });
    const result = parseResult(raw);
    expect(result.status).toBe("ok");
    expect(result.content).toContain("actual message");
    expect(result.content).not.toContain("ou_abc123:");
    expect(result.content).not.toContain("Conversation info");
  });

  it("skips slash commands", async () => {
    const filePath = await writeJsonlFile(makeJsonl(userMsg("/new"), userMsg("hello")));
    const raw = await tool.execute("tc_0", { transcriptPath: filePath });
    const result = parseResult(raw);
    expect(result.status).toBe("ok");
    expect(result.content).toContain("user: hello");
    expect(result.content).not.toContain("/new");
  });

  it("handles mixed valid and invalid JSON lines", async () => {
    const filePath = await writeJsonlFile(
      makeJsonl("not-json", sessionHeader(), userMsg("hello"), "", assistantMsg("world")),
    );
    const raw = await tool.execute("tc_0", { transcriptPath: filePath });
    const result = parseResult(raw);
    expect(result.status).toBe("ok");
    expect(result.content).toContain("user: hello");
    expect(result.content).toContain("assistant: world");
  });

  it("schema has transcriptPath required and maxMessages optional", () => {
    const schema = tool.parameters as Record<string, unknown>;
    const props = (schema as { properties?: Record<string, unknown> }).properties;
    expect(props).toHaveProperty("transcriptPath");
    expect(props).toHaveProperty("maxMessages");
    // maxMessages should be optional (not in required array)
    const required = (schema as { required?: string[] }).required;
    expect(required).toContain("transcriptPath");
    expect(required).not.toContain("maxMessages");
  });
});
