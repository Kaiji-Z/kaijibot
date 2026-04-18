import { afterEach, describe, expect, it, vi } from "vitest";

const mockListServers = vi.fn();
const mockSetServer = vi.fn();
const mockUnsetServer = vi.fn();

vi.mock("../../config/mcp-config.js", () => ({
  listConfiguredMcpServers: (...args: unknown[]) => mockListServers(...args),
  setConfiguredMcpServer: (...args: unknown[]) => mockSetServer(...args),
  unsetConfiguredMcpServer: (...args: unknown[]) => mockUnsetServer(...args),
}));

import { createMcpConfigTool } from "./mcp-config-tool.js";

function extractText(result: { content?: unknown[] }): string {
  return (result.content?.[0] as { text?: string } | undefined)?.text ?? "";
}

const SERVERS = {
  context7: { command: "npx", args: ["-y", "@context7/mcp"] },
  github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: "x" } },
};

describe("createMcpConfigTool", () => {
  const tool = createMcpConfigTool();

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("list action", () => {
    it("returns mcpServers when config is valid", async () => {
      mockListServers.mockResolvedValue({ ok: true, path: "/cfg.json", config: {}, mcpServers: SERVERS });
      const result = await tool.execute("t1", { action: "list" });
      const parsed = JSON.parse(extractText(result));
      expect(parsed.ok).toBe(true);
      expect(parsed.count).toBe(2);
      expect(parsed.mcpServers.context7).toEqual(SERVERS.context7);
    });

    it("returns empty message when no servers configured", async () => {
      mockListServers.mockResolvedValue({ ok: true, path: "/cfg.json", config: {}, mcpServers: {} });
      const result = await tool.execute("t2", { action: "list" });
      const parsed = JSON.parse(extractText(result));
      expect(parsed.ok).toBe(true);
      expect(parsed.message).toContain("No MCP servers");
    });

    it("returns error when config is invalid", async () => {
      mockListServers.mockResolvedValue({ ok: false, path: "/cfg.json", error: "read error" });
      const result = await tool.execute("t3", { action: "list" });
      const parsed = JSON.parse(extractText(result));
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toBe("read error");
    });
  });

  describe("show action", () => {
    it("returns server when found", async () => {
      mockListServers.mockResolvedValue({ ok: true, path: "/cfg.json", config: {}, mcpServers: SERVERS });
      const result = await tool.execute("t4", { action: "show", name: "context7" });
      const parsed = JSON.parse(extractText(result));
      expect(parsed.ok).toBe(true);
      expect(parsed.name).toBe("context7");
      expect(parsed.server).toEqual(SERVERS.context7);
    });

    it("returns error when not found", async () => {
      mockListServers.mockResolvedValue({ ok: true, path: "/cfg.json", config: {}, mcpServers: SERVERS });
      const result = await tool.execute("t5", { action: "show", name: "nonexistent" });
      const parsed = JSON.parse(extractText(result));
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain("nonexistent");
    });
  });

  describe("set action", () => {
    it("parses JSON server config and calls setConfiguredMcpServer", async () => {
      const serverJson = JSON.stringify(SERVERS.context7);
      mockSetServer.mockResolvedValue({ ok: true, path: "/cfg.json", config: {}, mcpServers: { context7: SERVERS.context7 } });
      const result = await tool.execute("t6", { action: "set", name: "context7", server: serverJson });
      const parsed = JSON.parse(extractText(result));
      expect(parsed.ok).toBe(true);
      expect(parsed.name).toBe("context7");
      expect(parsed.message).toContain("saved");
      expect(mockSetServer).toHaveBeenCalledWith({ name: "context7", server: SERVERS.context7 });
    });

    it("rejects invalid JSON", async () => {
      const result = await tool.execute("t7", { action: "set", name: "x", server: "not json" });
      const parsed = JSON.parse(extractText(result));
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain("valid JSON");
    });

    it("rejects non-object JSON", async () => {
      const result = await tool.execute("t8", { action: "set", name: "x", server: '"a string"' });
      const parsed = JSON.parse(extractText(result));
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain("JSON object");
    });

    it("returns error when setConfiguredMcpServer fails", async () => {
      mockSetServer.mockResolvedValue({ ok: false, path: "/cfg.json", error: "write error" });
      const result = await tool.execute("t9", { action: "set", name: "x", server: '{"command":"npx"}' });
      const parsed = JSON.parse(extractText(result));
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toBe("write error");
    });
  });

  describe("unset action", () => {
    it("returns success when removed", async () => {
      mockUnsetServer.mockResolvedValue({ ok: true, path: "/cfg.json", config: {}, mcpServers: {}, removed: true });
      const result = await tool.execute("t10", { action: "unset", name: "context7" });
      const parsed = JSON.parse(extractText(result));
      expect(parsed.ok).toBe(true);
      expect(parsed.message).toContain("removed");
    });

    it("returns error when server not found", async () => {
      mockUnsetServer.mockResolvedValue({ ok: true, path: "/cfg.json", config: {}, mcpServers: {}, removed: undefined });
      const result = await tool.execute("t11", { action: "unset", name: "nonexistent" });
      const parsed = JSON.parse(extractText(result));
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain("nonexistent");
    });

    it("returns error when unsetConfiguredMcpServer fails", async () => {
      mockUnsetServer.mockResolvedValue({ ok: false, path: "/cfg.json", error: "fail" });
      const result = await tool.execute("t12", { action: "unset", name: "x" });
      const parsed = JSON.parse(extractText(result));
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toBe("fail");
    });
  });

  it("throws on unknown action", async () => {
    await expect(tool.execute("t13", { action: "delete" })).rejects.toThrow("Unknown action");
  });

  it("throws when required params missing for show", async () => {
    await expect(tool.execute("t14", { action: "show" })).rejects.toThrow();
  });

  it("throws when required params missing for set", async () => {
    await expect(tool.execute("t15", { action: "set" })).rejects.toThrow();
  });

  it("throws when required params missing for unset", async () => {
    await expect(tool.execute("t16", { action: "unset" })).rejects.toThrow();
  });
});
