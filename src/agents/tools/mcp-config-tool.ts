import { Type } from "@sinclair/typebox";
import {
  listConfiguredMcpServers,
  setConfiguredMcpServer,
  unsetConfiguredMcpServer,
} from "../../config/mcp-config.js";
import { isRecord } from "../../utils.js";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";
import { isKaijiBotOwnerOnlyCoreToolName } from "./owner-only-tools.js";

const MCP_CONFIG_ACTIONS = ["list", "show", "set", "unset"] as const;

// NOTE: Flattened object schema without anyOf/oneOf/allOf — required for
// compatibility with OpenAI and Claude Vertex AI tool schema validation.
// The `action` discriminator determines which fields are relevant at runtime.
const McpConfigToolSchema = Type.Object({
  action: stringEnum(MCP_CONFIG_ACTIONS),
  /** Server name (required for show/set/unset). */
  name: Type.Optional(Type.String()),
  /**
   * JSON string describing the MCP server config (required for set).
   * Must be a JSON object with fields like: command, args, env, url, transport, headers.
   */
  server: Type.Optional(Type.String()),
});

export function createMcpConfigTool(): AnyAgentTool {
  return {
    label: "MCP Config",
    name: "mcp_config",
    ownerOnly: isKaijiBotOwnerOnlyCoreToolName("mcp_config"),
    description: `List, inspect, add, or remove MCP server configurations. When the user asks to connect, set up, add, configure, or remove an MCP server/tool, use this tool. Actions: "list" all servers, "show" one server's config by name, "set" a server (provide name + JSON server config), "unset" a server by name. Config changes take effect on the next agent turn. Example: action="set", name="context7", server='{"command":"npx","args":["-y","@context7/mcp"]}'`,
    parameters: McpConfigToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      if (action === "list") {
        const result = await listConfiguredMcpServers();
        if (!result.ok) {
          return jsonResult({ ok: false, error: result.error });
        }
        const names = Object.keys(result.mcpServers).toSorted();
        if (names.length === 0) {
          return jsonResult({
            ok: true,
            message: "No MCP servers configured.",
            mcpServers: {},
          });
        }
        return jsonResult({
          ok: true,
          mcpServers: result.mcpServers,
          count: names.length,
        });
      }

      const name = readStringParam(params, "name", { required: true });

      if (action === "show") {
        const result = await listConfiguredMcpServers();
        if (!result.ok) {
          return jsonResult({ ok: false, error: result.error });
        }
        const server = result.mcpServers[name];
        if (!server) {
          return jsonResult({ ok: false, error: `No MCP server named "${name}".` });
        }
        return jsonResult({ ok: true, name, server });
      }

      if (action === "set") {
        const raw = readStringParam(params, "server", { required: true });
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return jsonResult({ ok: false, error: "server must be valid JSON." });
        }
        if (!isRecord(parsed)) {
          return jsonResult({
            ok: false,
            error: "server must be a JSON object, e.g. {\"command\":\"npx\",\"args\":[\"-y\",\"@context7/mcp\"]}",
          });
        }
        const result = await setConfiguredMcpServer({ name, server: parsed });
        if (!result.ok) {
          return jsonResult({ ok: false, error: result.error });
        }
        return jsonResult({
          ok: true,
          message: `MCP server "${name}" saved to ${result.path}.`,
          name,
          server: result.mcpServers[name],
        });
      }

      if (action === "unset") {
        const result = await unsetConfiguredMcpServer({ name });
        if (!result.ok) {
          return jsonResult({ ok: false, error: result.error });
        }
        if (!result.removed) {
          return jsonResult({
            ok: false,
            error: `No MCP server named "${name}" to remove.`,
          });
        }
        return jsonResult({
          ok: true,
          message: `MCP server "${name}" removed from ${result.path}.`,
        });
      }

      throw new Error(`Unknown action: ${action}`);
    },
  };
}
