import { describe, expect, it } from "vitest";
import {
  isKaijiBotOwnerOnlyCoreToolName,
  KAIJIBOT_OWNER_ONLY_CORE_TOOL_NAMES,
} from "./tools/owner-only-tools.js";

describe("createKaijiBotTools owner authorization", () => {
  it("marks owner-only core tool names", () => {
    expect(KAIJIBOT_OWNER_ONLY_CORE_TOOL_NAMES).toEqual(["cron", "gateway", "mcp_config", "nodes"]);
    expect(isKaijiBotOwnerOnlyCoreToolName("cron")).toBe(true);
    expect(isKaijiBotOwnerOnlyCoreToolName("gateway")).toBe(true);
    expect(isKaijiBotOwnerOnlyCoreToolName("mcp_config")).toBe(true);
    expect(isKaijiBotOwnerOnlyCoreToolName("nodes")).toBe(true);
  });

  it("keeps canvas non-owner-only", () => {
    expect(isKaijiBotOwnerOnlyCoreToolName("canvas")).toBe(false);
  });
});
