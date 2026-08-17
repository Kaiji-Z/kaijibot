import fsp, { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDefaultRedactPatterns,
  redactSensitiveText,
  resolveLoggingRedactionFieldsFromRaw,
} from "./redact.js";

const defaults = getDefaultRedactPatterns();

describe("redactSensitiveText", () => {
  it("masks env assignments while keeping the key", () => {
    const input = "OPENAI_API_KEY=sk-1234567890abcdef";
    const output = redactSensitiveText(input, {
      mode: "tools",
      patterns: defaults,
    });
    expect(output).toBe("OPENAI_API_KEY=sk-123…cdef");
  });

  it("masks CLI flags", () => {
    const input = "curl --token abcdef1234567890ghij https://api.test";
    const output = redactSensitiveText(input, {
      mode: "tools",
      patterns: defaults,
    });
    expect(output).toBe("curl --token abcdef…ghij https://api.test");
  });

  it("masks JSON fields", () => {
    const input = '{"token":"abcdef1234567890ghij"}';
    const output = redactSensitiveText(input, {
      mode: "tools",
      patterns: defaults,
    });
    expect(output).toBe('{"token":"abcdef…ghij"}');
  });

  it("masks bearer tokens", () => {
    const input = "Authorization: Bearer abcdef1234567890ghij";
    const output = redactSensitiveText(input, {
      mode: "tools",
      patterns: defaults,
    });
    expect(output).toBe("Authorization: Bearer abcdef…ghij");
  });

  it("masks Telegram-style tokens", () => {
    const input = "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef";
    const output = redactSensitiveText(input, {
      mode: "tools",
      patterns: defaults,
    });
    expect(output).toBe("123456…cdef");
  });

  it("masks Telegram Bot API URL tokens", () => {
    const input =
      "GET https://api.telegram.org/bot123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef/getMe HTTP/1.1";
    const output = redactSensitiveText(input, {
      mode: "tools",
      patterns: defaults,
    });
    expect(output).toBe("GET https://api.telegram.org/bot123456…cdef/getMe HTTP/1.1");
  });

  it("redacts short tokens fully", () => {
    const input = "TOKEN=shortvalue";
    const output = redactSensitiveText(input, {
      mode: "tools",
      patterns: defaults,
    });
    expect(output).toBe("TOKEN=***");
  });

  it("redacts private key blocks", () => {
    const input = [
      "-----BEGIN PRIVATE KEY-----",
      "ABCDEF1234567890",
      "ZYXWVUT987654321",
      "-----END PRIVATE KEY-----",
    ].join("\n");
    const output = redactSensitiveText(input, {
      mode: "tools",
      patterns: defaults,
    });
    expect(output).toBe(
      ["-----BEGIN PRIVATE KEY-----", "…redacted…", "-----END PRIVATE KEY-----"].join("\n"),
    );
  });

  it("honors custom patterns with flags", () => {
    const input = "token=abcdef1234567890ghij";
    const output = redactSensitiveText(input, {
      mode: "tools",
      patterns: ["/token=([A-Za-z0-9]+)/i"],
    });
    expect(output).toBe("token=abcdef…ghij");
  });

  it("ignores unsafe nested-repetition custom patterns", () => {
    const input = `${"a".repeat(28)}!`;
    const output = redactSensitiveText(input, {
      mode: "tools",
      patterns: ["(a+)+$"],
    });
    expect(output).toBe(input);
  });

  it("redacts large payloads with bounded regex passes", () => {
    const input = `${"x".repeat(40_000)} OPENAI_API_KEY=sk-1234567890abcdef ${"y".repeat(40_000)}`;
    const output = redactSensitiveText(input, {
      mode: "tools",
      patterns: defaults,
    });
    expect(output).toContain("OPENAI_API_KEY=sk-123…cdef");
  });

  it("skips redaction when mode is off", () => {
    const input = "OPENAI_API_KEY=sk-1234567890abcdef";
    const output = redactSensitiveText(input, {
      mode: "off",
      patterns: defaults,
    });
    expect(output).toBe(input);
  });
});

describe("resolveLoggingRedactionFieldsFromRaw", () => {
  it("returns empty fields for config without a logging section", () => {
    expect(resolveLoggingRedactionFieldsFromRaw("{}")).toEqual({});
    expect(resolveLoggingRedactionFieldsFromRaw('{"agents":{}}')).toEqual({});
  });

  it("reads redactSensitive and redactPatterns when configured", () => {
    expect(
      resolveLoggingRedactionFieldsFromRaw(
        '{"logging":{"redactSensitive":"off","redactPatterns":["secret-\\\\d+"]}}',
      ),
    ).toEqual({ redactSensitive: "off", redactPatterns: ["secret-\\d+"] });
  });

  it("rejects malformed field shapes so callers fall back to full config loading", () => {
    expect(resolveLoggingRedactionFieldsFromRaw('{"logging":{"redactSensitive":3}}')).toBeNull();
    expect(
      resolveLoggingRedactionFieldsFromRaw('{"logging":{"redactPatterns":"nope"}}'),
    ).toBeNull();
    expect(
      resolveLoggingRedactionFieldsFromRaw('{"logging":{"redactPatterns":["ok",7]}}'),
    ).toBeNull();
  });

  it("rejects JSON5-style payloads instead of misreading them", () => {
    expect(resolveLoggingRedactionFieldsFromRaw("{ // comment\n}")).toBeNull();
  });
});

describe("redactSensitiveText config fast path", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("honors logging.redactSensitive=off read from the raw config file", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "redact-fast-"));
    const configPath = path.join(dir, "kaijibot.json");
    await fsp.writeFile(configPath, JSON.stringify({ logging: { redactSensitive: "off" } }));
    vi.stubEnv("KAIJIBOT_CONFIG_PATH", configPath);
    const input = "OPENAI_API_KEY=sk-1234567890abcdef";
    expect(redactSensitiveText(input)).toBe(input);
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it("applies custom logging.redactPatterns from the raw config file", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "redact-fast-"));
    const configPath = path.join(dir, "kaijibot.json");
    await fsp.writeFile(
      configPath,
      JSON.stringify({ logging: { redactPatterns: ["internal-[a-z]{4}-token"] } }),
    );
    vi.stubEnv("KAIJIBOT_CONFIG_PATH", configPath);
    const output = redactSensitiveText("leak internal-abcd-token now");
    expect(output).toBe("leak intern…oken now");
    await fsp.rm(dir, { recursive: true, force: true });
  });
});
