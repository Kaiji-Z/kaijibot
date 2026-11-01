import { describe, expect, it } from "vitest";
import { KaijiBotSchema } from "./zod-schema.js";

describe("browser.proxy config flag", () => {
  it("stays absent when the section is absent (runtime resolves to disabled)", () => {
    const parsed = KaijiBotSchema.parse({ browser: { enabled: true } });
    expect(parsed.browser?.proxy).toBeUndefined();
  });

  it("accepts a sparse section (runtime resolves enabled=false)", () => {
    const parsed = KaijiBotSchema.parse({ browser: { proxy: {} } });
    expect(parsed.browser?.proxy?.enabled).toBeUndefined();
  });

  it("preserves explicit values", () => {
    const parsed = KaijiBotSchema.parse({ browser: { proxy: { enabled: true } } });
    expect(parsed.browser?.proxy?.enabled).toBe(true);
  });

  it("rejects unknown keys", () => {
    expect(() => KaijiBotSchema.parse({ browser: { proxy: { unknownKey: true } } })).toThrow();
  });
});
