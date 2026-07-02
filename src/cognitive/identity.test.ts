import { describe, it, expect } from "vitest";
import { OPERATOR_USER_ID, resolveOperatorSenderId } from "./identity.js";

describe("resolveOperatorSenderId", () => {
  it("maps Control UI client id to operator", () => {
    expect(resolveOperatorSenderId("kaijibot-control-ui")).toBe(OPERATOR_USER_ID);
  });

  it("maps TUI client id to operator", () => {
    expect(resolveOperatorSenderId("kaijibot-tui")).toBe(OPERATOR_USER_ID);
  });

  it("returns undefined for feishu user id", () => {
    expect(resolveOperatorSenderId("ou_abc123")).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(resolveOperatorSenderId(undefined)).toBeUndefined();
  });

  it("returns undefined for null input", () => {
    expect(resolveOperatorSenderId(null)).toBeUndefined();
  });

  it("returns undefined for 'main'", () => {
    expect(resolveOperatorSenderId("main")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(resolveOperatorSenderId("")).toBeUndefined();
  });

  it("exports OPERATOR_USER_ID as 'operator'", () => {
    expect(OPERATOR_USER_ID).toBe("operator");
  });
});
