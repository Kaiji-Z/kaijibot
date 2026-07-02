import { describe, it, expect } from "vitest";
import { resolveCorrectionUserId } from "./userid.js";

describe("resolveCorrectionUserId", () => {
  it("extracts ou_xxx from feishu direct session key", () => {
    expect(resolveCorrectionUserId("agent:main:feishu:direct:ou_abc123")).toBe("ou_abc123");
  });

  it("extracts ou_xxx from feishu group session key with :sender:", () => {
    expect(resolveCorrectionUserId("agent:main:feishu:group:oc_xxx:sender:ou_abc123")).toBe(
      "ou_abc123",
    );
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

  it("resolves operator when tail is 'main'", () => {
    expect(resolveCorrectionUserId("agent:main:feishu:direct:main")).toBe("operator");
  });

  it("resolves non-ou_ tail as userId (channel-agnostic)", () => {
    expect(resolveCorrectionUserId("agent:main:feishu:direct:someuser")).toBe("someuser");
  });

  it("uses tail as userId for agent:xxx:other format", () => {
    expect(resolveCorrectionUserId("agent:ou_def456:other")).toBe("other");
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
