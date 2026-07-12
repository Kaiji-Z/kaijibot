import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatCliBannerLine } from "./banner.js";
import { initCliI18n } from "./i18n/translate.js";

const readCliBannerTaglineModeMock = vi.hoisted(() => vi.fn());

vi.mock("./banner-config-lite.js", () => ({
  parseTaglineMode: (value: unknown) =>
    value === "random" || value === "default" || value === "off" ? value : undefined,
  readCliBannerTaglineMode: readCliBannerTaglineModeMock,
}));

beforeEach(() => {
  readCliBannerTaglineModeMock.mockReset();
  readCliBannerTaglineModeMock.mockReturnValue(undefined);
  // Banner tests should not depend on the operator's LANG. Pin to en so the
  // assertions are stable across dev environments.
  initCliI18n({ locale: "en" });
});

describe("formatCliBannerLine", () => {
  it("hides tagline text when cli.banner.taglineMode is off", () => {
    readCliBannerTaglineModeMock.mockReturnValue("off");

    const line = formatCliBannerLine("2026.3.7", {
      commit: "abc1234",
      richTty: false,
    });

    expect(line).toBe("👾 KaijiBot 2026.3.7 (abc1234)");
  });

  it("uses default English tagline under en locale", () => {
    readCliBannerTaglineModeMock.mockReturnValue("default");

    const line = formatCliBannerLine("2026.3.7", {
      commit: "abc1234",
      richTty: false,
    });

    expect(line).toBe("👾 KaijiBot 2026.3.7 (abc1234) — Cognition-driven, proactive thinking.");
  });

  it("uses default Chinese tagline under zh-CN locale", () => {
    readCliBannerTaglineModeMock.mockReturnValue("default");
    initCliI18n({ locale: "zh-CN" });

    const line = formatCliBannerLine("2026.3.7", {
      commit: "abc1234",
      richTty: false,
    });

    expect(line).toBe("👾 KaijiBot 2026.3.7 (abc1234) — 认知驱动，主动思考。");
  });

  it("prefers explicit tagline mode over config", () => {
    readCliBannerTaglineModeMock.mockReturnValue("off");

    const line = formatCliBannerLine("2026.3.7", {
      commit: "abc1234",
      richTty: false,
      mode: "default",
    });

    expect(line).toBe("👾 KaijiBot 2026.3.7 (abc1234) — Cognition-driven, proactive thinking.");
  });
});
