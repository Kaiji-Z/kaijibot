import { describe, expect, it } from "vitest";
import { resolveKindleConfig, resolveKindleConfigSafe } from "./config.js";

describe("KINDLE_PORTAL_CONFIG_SCHEMA", () => {
  it("applies all defaults when given empty object", () => {
    const cfg = resolveKindleConfig({});
    expect(cfg.enabled).toBe(false);
    expect(cfg.refreshIntervalSeconds).toBe(15);
    expect(cfg.mapRefreshSeconds).toBe(300);
    expect(cfg.scope).toBe("last-active");
    expect(cfg.showWiki).toBe(true);
    expect(cfg.maxDomains).toBe(20);
    expect(cfg.pngWidth).toBe(758);
    expect(cfg.accessToken).toBeUndefined();
    expect(cfg.userId).toBeUndefined();
  });

  it("applies all defaults when given undefined", () => {
    const cfg = resolveKindleConfig(undefined);
    expect(cfg.enabled).toBe(false);
    expect(cfg.scope).toBe("last-active");
  });

  it("preserves explicitly provided values", () => {
    const cfg = resolveKindleConfig({
      enabled: true,
      accessToken: "s3cret",
      refreshIntervalSeconds: 30,
      scope: "specific-user",
      userId: "ou_abc",
      showWiki: false,
      maxDomains: 25,
      pngWidth: 1072,
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.accessToken).toBe("s3cret");
    expect(cfg.refreshIntervalSeconds).toBe(30);
    expect(cfg.scope).toBe("specific-user");
    expect(cfg.userId).toBe("ou_abc");
    expect(cfg.showWiki).toBe(false);
    expect(cfg.maxDomains).toBe(25);
    expect(cfg.pngWidth).toBe(1072);
  });

  it("rejects refreshIntervalSeconds below 15 (e-ink floor)", () => {
    expect(() => resolveKindleConfig({ refreshIntervalSeconds: 3 })).toThrow();
    expect(() => resolveKindleConfig({ refreshIntervalSeconds: 14 })).toThrow();
  });

  it("accepts refreshIntervalSeconds of exactly 15", () => {
    expect(() => resolveKindleConfig({ refreshIntervalSeconds: 15 })).not.toThrow();
  });

  it("rejects mapRefreshSeconds below 60", () => {
    expect(() => resolveKindleConfig({ mapRefreshSeconds: 30 })).toThrow();
  });

  it("rejects invalid scope enum", () => {
    expect(() => resolveKindleConfig({ scope: "bogus" })).toThrow();
  });

  it("rejects maxDomains below 5", () => {
    expect(() => resolveKindleConfig({ maxDomains: 4 })).toThrow();
  });

  it("rejects maxDomains above 50", () => {
    expect(() => resolveKindleConfig({ maxDomains: 51 })).toThrow();
  });

  it("rejects pngWidth out of range", () => {
    expect(() => resolveKindleConfig({ pngWidth: 399 })).toThrow();
    expect(() => resolveKindleConfig({ pngWidth: 1073 })).toThrow();
  });

  it("rejects unknown top-level keys (strict mode)", () => {
    expect(() => resolveKindleConfig({ unknownKey: true })).toThrow();
  });

  it("rejects non-string accessToken", () => {
    expect(() => resolveKindleConfig({ accessToken: 123 })).toThrow();
  });

  it("accepts empty string accessToken as LAN-open", () => {
    const cfg = resolveKindleConfig({ accessToken: "" });
    expect(cfg.accessToken).toBeUndefined();
  });

  it("accepts whitespace-only accessToken as LAN-open", () => {
    const cfg = resolveKindleConfig({ accessToken: "   " });
    expect(cfg.accessToken).toBeUndefined();
  });

  it("preserves non-empty accessToken", () => {
    const cfg = resolveKindleConfig({ accessToken: "s3cret" });
    expect(cfg.accessToken).toBe("s3cret");
  });

  it("trims accessToken whitespace", () => {
    const cfg = resolveKindleConfig({ accessToken: "  s3cret  " });
    expect(cfg.accessToken).toBe("s3cret");
  });
});

describe("resolveKindleConfigSafe", () => {
  it("returns parsed config on valid input", () => {
    const cfg = resolveKindleConfigSafe({ enabled: true });
    expect(cfg?.enabled).toBe(true);
  });

  it("returns undefined and calls onError on invalid input", () => {
    const issues: unknown[] = [];
    const cfg = resolveKindleConfigSafe({ refreshIntervalSeconds: 1 }, (i) => issues.push(i));
    expect(cfg).toBeUndefined();
    expect(issues).toHaveLength(1);
  });

  it("returns undefined without throwing when onError omitted", () => {
    expect(() => resolveKindleConfigSafe({ refreshIntervalSeconds: 1 })).not.toThrow();
  });
});
