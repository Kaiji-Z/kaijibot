import { describe, expect, it, afterEach } from "vitest";
import {
  accumulateToolError,
  consumeToolErrorProfile,
  resetToolErrorAccumulator,
} from "./tool-error-summary.js";

afterEach(() => {
  resetToolErrorAccumulator();
});

describe("error accumulator bridge", () => {
  it("accumulates errors for a session", () => {
    accumulateToolError("sess:a", { toolName: "bash" });
    accumulateToolError("sess:a", { toolName: "write_file" });

    const profile = consumeToolErrorProfile("sess:a");
    expect(profile).toBeDefined();
    expect(profile!.errorCount).toBe(2);
    expect(profile!.failedToolNames).toContain("bash");
    expect(profile!.failedToolNames).toContain("write_file");
    expect(profile!.hasMutatingErrors).toBe(false);
  });

  it("tracks mutating errors", () => {
    accumulateToolError("sess:b", { toolName: "exec", mutatingAction: true });
    const profile = consumeToolErrorProfile("sess:b");
    expect(profile!.hasMutatingErrors).toBe(true);
  });

  it("consume resets the profile (single-consume semantics)", () => {
    accumulateToolError("sess:c", { toolName: "bash" });
    const first = consumeToolErrorProfile("sess:c");
    expect(first!.errorCount).toBe(1);

    const second = consumeToolErrorProfile("sess:c");
    expect(second).toBeUndefined();
  });

  it("returns undefined for unknown session", () => {
    const profile = consumeToolErrorProfile("sess:nonexistent");
    expect(profile).toBeUndefined();
  });

  it("resetToolErrorAccumulator with key removes only that session", () => {
    accumulateToolError("sess:d", { toolName: "bash" });
    accumulateToolError("sess:e", { toolName: "bash" });

    resetToolErrorAccumulator("sess:d");

    expect(consumeToolErrorProfile("sess:d")).toBeUndefined();
    expect(consumeToolErrorProfile("sess:e")!.errorCount).toBe(1);
  });

  it("resetToolErrorAccumulator without key clears all", () => {
    accumulateToolError("sess:f", { toolName: "bash" });
    accumulateToolError("sess:g", { toolName: "bash" });

    resetToolErrorAccumulator();

    expect(consumeToolErrorProfile("sess:f")).toBeUndefined();
    expect(consumeToolErrorProfile("sess:g")).toBeUndefined();
  });

  it("deduplicates tool names in failedToolNames", () => {
    accumulateToolError("sess:h", { toolName: "bash" });
    accumulateToolError("sess:h", { toolName: "bash" });
    accumulateToolError("sess:h", { toolName: "bash" });

    const profile = consumeToolErrorProfile("sess:h");
    expect(profile!.errorCount).toBe(3);
    expect(profile!.failedToolNames).toEqual(["bash"]);
  });
});
