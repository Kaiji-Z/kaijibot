import { describe, expect, it } from "vitest";
import { __test__ } from "./logger.js";

describe("shouldSkipMutatingLoggingConfigRead", () => {
  it("matches config schema and validate invocations", () => {
    expect(
      __test__.shouldSkipMutatingLoggingConfigRead(["node", "kaijibot", "config", "schema"]),
    ).toBe(true);
    expect(
      __test__.shouldSkipMutatingLoggingConfigRead(["node", "kaijibot", "config", "validate"]),
    ).toBe(true);
  });

  it("handles root flags before config validate", () => {
    expect(
      __test__.shouldSkipMutatingLoggingConfigRead([
        "node",
        "kaijibot",
        "--profile",
        "work",
        "--no-color",
        "config",
        "validate",
        "--json",
      ]),
    ).toBe(true);
  });

  it("does not match other commands", () => {
    expect(
      __test__.shouldSkipMutatingLoggingConfigRead(["node", "kaijibot", "config", "get", "foo"]),
    ).toBe(false);
    expect(__test__.shouldSkipMutatingLoggingConfigRead(["node", "kaijibot", "status"])).toBe(
      false,
    );
  });
});
