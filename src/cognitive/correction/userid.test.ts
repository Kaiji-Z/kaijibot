import { describe, it, expect } from "vitest";
import { resolveCorrectionUserId } from "./userid.js";

describe("resolveCorrectionUserId", () => {
  it("extracts ou_xxx from feishu direct session key", () => {
    expect(resolveCorrectionUserId("agent:main:feishu:direct:ou_abc123")).toBe("ou_abc123");
  });

  it("extracts ou_xxx from feishu group session key", () => {
    expect(resolveCorrectionUserId("agent:main:feishu:group:oc_xxx:ou_abc123")).toBe("ou_abc123");
  });

  it("strips user: prefix from deliveryTo", () => {
    expect(resolveCorrectionUserId(undefined, "user:ou_abc123")).toBe("ou_abc123");
  });

  it("strips feishu: prefix from deliveryTo", () => {
    expect(resolveCorrectionUserId(undefined, "feishu:ou_abc123")).toBe("ou_abc123");
  });

  it("returns null for both undefined inputs", () => {
    expect(resolveCorrectionUserId()).toBeNull();
    expect(resolveCorrectionUserId(undefined, undefined)).toBeNull();
  });

  it("returns null when tail is 'main'", () => {
    expect(resolveCorrectionUserId("agent:main:feishu:direct:main")).toBeNull();
  });

  it("returns null when tail has no ou_ prefix", () => {
    expect(resolveCorrectionUserId("agent:main:feishu:direct:someuser")).toBeNull();
  });

  it("falls back to parts[1] with ou_ prefix", () => {
    expect(resolveCorrectionUserId("agent:ou_def456:other")).toBe("ou_def456");
  });

  it("prefers deliveryTo over sessionKey", () => {
    expect(resolveCorrectionUserId("agent:main:feishu:direct:ou_first", "user:ou_second")).toBe(
      "ou_second",
    );
  });

  it("resolves 'operator' from deliveryTo for Control UI / TUI sessions", () => {
    expect(resolveCorrectionUserId("agent:main:main", "operator")).toBe("operator");
  });

  it("resolves 'operator' even without sessionKey", () => {
    expect(resolveCorrectionUserId(undefined, "operator")).toBe("operator");
  });
});
