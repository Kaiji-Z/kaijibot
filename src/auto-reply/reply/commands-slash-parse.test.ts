import { describe, expect, it } from "vitest";
import { parseSlashCommandOrNull } from "./commands-slash-parse.js";

describe("parseSlashCommandOrNull", () => {
  const opts = { invalidMessage: "invalid command", defaultAction: "show" };

  it("returns null when input does not start with the slash prefix", () => {
    expect(parseSlashCommandOrNull("/other thing", "/config", opts)).toBeNull();
  });

  it("parses action and args on clean word boundary", () => {
    const result = parseSlashCommandOrNull("/config show enabled", "/config", opts);
    expect(result).toEqual({ ok: true, action: "show", args: "enabled" });
  });

  it("returns default action when body is empty", () => {
    const result = parseSlashCommandOrNull("/config", "/config", opts);
    expect(result).toEqual({ ok: true, action: "show", args: "" });
  });

  it("rejects /config-check matching /config (hyphen is not a boundary)", () => {
    expect(parseSlashCommandOrNull("/config-check arg1 arg2", "/config", opts)).toBeNull();
  });

  it("rejects /configfoo matching /config (alpha continuation)", () => {
    expect(parseSlashCommandOrNull("/configfoo", "/config", opts)).toBeNull();
  });

  it("rejects /modelsy matching /models (alpha continuation)", () => {
    expect(parseSlashCommandOrNull("/modelsy", "/models", opts)).toBeNull();
  });

  it("allows colon as boundary (/config:json matches /config)", () => {
    const result = parseSlashCommandOrNull("/config:json", "/config", opts);
    expect(result).toEqual({ ok: true, action: ":json", args: "" });
  });

  it("handles leading whitespace", () => {
    const result = parseSlashCommandOrNull("  /config show ", "/config", opts);
    expect(result).toEqual({ ok: true, action: "show", args: "" });
  });
});
