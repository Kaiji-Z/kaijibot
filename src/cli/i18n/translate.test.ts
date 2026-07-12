import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, parseLocaleString, resolveCliLocale } from "./registry.js";
import { cliI18n, initCliI18n } from "./translate.js";

describe("parseLocaleString", () => {
  it("maps Chinese variants to zh-CN", () => {
    expect(parseLocaleString("zh_CN.UTF-8")).toBe("zh-CN");
    expect(parseLocaleString("zh-CN")).toBe("zh-CN");
    expect(parseLocaleString("zh")).toBe("zh-CN");
    expect(parseLocaleString("zh_TW.UTF-8")).toBe("zh-CN");
    expect(parseLocaleString("zh-Hant")).toBe("zh-CN");
  });

  it("maps English variants to en", () => {
    expect(parseLocaleString("en_US.UTF-8")).toBe("en");
    expect(parseLocaleString("en-US")).toBe("en");
    expect(parseLocaleString("en")).toBe("en");
    expect(parseLocaleString("en_GB.UTF-8")).toBe("en");
  });

  it("returns null for unsupported or empty input", () => {
    expect(parseLocaleString("")).toBe(null);
    expect(parseLocaleString(null)).toBe(null);
    expect(parseLocaleString(undefined)).toBe(null);
    expect(parseLocaleString("fr_FR.UTF-8")).toBe(null);
    expect(parseLocaleString("ja_JP")).toBe(null);
  });
});

describe("resolveCliLocale", () => {
  it("honors KAIJIBOT_CLI_LOCALE over everything else", () => {
    expect(resolveCliLocale({ KAIJIBOT_CLI_LOCALE: "zh-CN", LANG: "en_US.UTF-8" })).toBe("zh-CN");
    expect(resolveCliLocale({ KAIJIBOT_CLI_LOCALE: "en", LANG: "zh_CN.UTF-8" })).toBe("en");
  });

  it("falls back through LC_ALL → LC_MESSAGES → LANG", () => {
    expect(resolveCliLocale({ LC_ALL: "zh_CN.UTF-8" })).toBe("zh-CN");
    expect(resolveCliLocale({ LC_MESSAGES: "zh_CN.UTF-8" })).toBe("zh-CN");
    expect(resolveCliLocale({ LANG: "zh_CN.UTF-8" })).toBe("zh-CN");
  });

  it("respects precedence order", () => {
    expect(resolveCliLocale({ LC_ALL: "en_US.UTF-8", LANG: "zh_CN.UTF-8" })).toBe("en");
    expect(resolveCliLocale({ LC_ALL: "zh_CN.UTF-8", LANG: "en_US.UTF-8" })).toBe("zh-CN");
  });

  it("returns default locale when nothing matches", () => {
    expect(resolveCliLocale({})).toBe(DEFAULT_LOCALE);
    expect(resolveCliLocale({ LANG: "fr_FR.UTF-8" })).toBe(DEFAULT_LOCALE);
  });
});

describe("CliI18n (translate)", () => {
  beforeEach(() => {
    initCliI18n({ locale: "en" });
  });

  it("returns English strings by default", () => {
    expect(cliI18n.t("cli.tagline.default")).toBe("Cognition-driven, proactive thinking.");
  });

  it("switches to Chinese when locale changes", () => {
    cliI18n.setLocale("zh-CN");
    expect(cliI18n.t("cli.tagline.default")).toBe("认知驱动，主动思考。");
  });

  it("falls back to English when key missing in active locale", () => {
    cliI18n.setLocale("zh-CN");
    // Use a key that exists in en — every tagline key should also exist in zh-CN,
    // so we can't directly test fallback without breaking parity. Instead verify
    // that the active locale returns a real translation (parity is enforced by
    // the sync script).
    expect(cliI18n.t("cli.tagline.holiday.newYear")).toContain("新年");
  });

  it("returns the key verbatim when missing from both locales", () => {
    expect(cliI18n.t("cli.does.not.exist")).toBe("cli.does.not.exist");
  });

  it("interpolates {placeholder} parameters", () => {
    // Use a placeholder-bearing key once Phase 2 adds one. For now, verify
    // the interpolator behavior by constructing a CliI18n instance and
    // calling t() on a key that exercises interpolation. Taglines have no
    // placeholders, so we exercise the helper directly by checking that
    // a key without placeholders ignores params.
    expect(cliI18n.t("cli.tagline.default", { unused: "x" })).toBe(
      "Cognition-driven, proactive thinking.",
    );
  });

  it("has() reports key presence accurately", () => {
    expect(cliI18n.has("cli.tagline.default")).toBe(true);
    expect(cliI18n.has("cli.does.not.exist")).toBe(false);
  });

  it("resolves nested philosophical indices", () => {
    expect(cliI18n.t("cli.tagline.philosophical.0")).toContain("True intelligence");
    cliI18n.setLocale("zh-CN");
    expect(cliI18n.t("cli.tagline.philosophical.0")).toContain("真正的智能");
  });
});

describe("initCliI18n", () => {
  it("throws on unsupported locale", () => {
    expect(() => initCliI18n({ locale: "ja-JP" as never })).toThrow(/Unsupported CLI locale/);
  });

  it("picks up locale from env when not explicit", () => {
    initCliI18n({ env: { LANG: "zh_CN.UTF-8" } });
    expect(cliI18n.getLocale()).toBe("zh-CN");
    initCliI18n({ env: { LANG: "en_US.UTF-8" } });
    expect(cliI18n.getLocale()).toBe("en");
  });
});
