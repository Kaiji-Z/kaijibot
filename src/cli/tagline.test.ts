import { beforeEach, describe, expect, it } from "vitest";
import { initCliI18n } from "./i18n/translate.js";
import { activeTaglines, getDefaultTagline, pickTagline } from "./tagline.js";

describe("tagline (locale-aware)", () => {
  beforeEach(() => {
    initCliI18n({ locale: "en" });
  });

  describe("getDefaultTagline", () => {
    it("returns English tagline under en locale", () => {
      expect(getDefaultTagline()).toBe("Cognition-driven, proactive thinking.");
    });

    it("returns Chinese tagline under zh-CN locale", () => {
      initCliI18n({ locale: "zh-CN" });
      expect(getDefaultTagline()).toBe("认知驱动，主动思考。");
    });
  });

  describe("pickTagline", () => {
    it("returns empty string when mode is off", () => {
      expect(pickTagline({ mode: "off" })).toBe("");
    });

    it("returns locale-specific default tagline when mode is default", () => {
      expect(pickTagline({ mode: "default" })).toBe("Cognition-driven, proactive thinking.");
      initCliI18n({ locale: "zh-CN" });
      expect(pickTagline({ mode: "default" })).toBe("认知驱动，主动思考。");
    });

    it("honors KAIJIBOT_TAGLINE_INDEX in random mode (en)", () => {
      const value = pickTagline({
        mode: "random",
        env: { KAIJIBOT_TAGLINE_INDEX: "0" } as NodeJS.ProcessEnv,
      });
      expect(value.length).toBeGreaterThan(0);
      // Index 0 = first philosophical entry, never the default tagline.
      expect(value).not.toBe(getDefaultTagline());
      // Index 0 is English "True intelligence..." under en locale.
      expect(value).toContain("True intelligence");
    });

    it("honors KAIJIBOT_TAGLINE_INDEX in random mode (zh-CN)", () => {
      initCliI18n({ locale: "zh-CN" });
      const value = pickTagline({
        mode: "random",
        env: { KAIJIBOT_TAGLINE_INDEX: "0" } as NodeJS.ProcessEnv,
      });
      expect(value).toContain("真正的智能");
    });

    it("locale switch is observable without re-import", () => {
      initCliI18n({ locale: "en" });
      const en = pickTagline({ mode: "random", env: { KAIJIBOT_TAGLINE_INDEX: "1" } });
      initCliI18n({ locale: "zh-CN" });
      const zh = pickTagline({ mode: "random", env: { KAIJIBOT_TAGLINE_INDEX: "1" } });
      expect(en).toContain("Every conversation");
      expect(zh).toContain("每一次对话");
    });
  });

  describe("activeTaglines", () => {
    it("returns only the 30 philosophical taglines outside any holiday window", () => {
      // Use a mid-year date that avoids every holiday in the rule set.
      // Holiday taglines only appear on their actual holiday — the
      // evergreen pool is the 30 philosophical entries.
      const pool = activeTaglines({
        now: () => new Date(Date.UTC(2026, 5, 15)), // 2026-06-15
      });
      expect(pool.length).toBe(30);
    });

    it("filters down to holidays + philosophical on Christmas", () => {
      const pool = activeTaglines({
        now: () => new Date(Date.UTC(2026, 11, 25)), // 2026-12-25
      });
      // Every philosophical tagline is active, plus only Christmas.
      // So 30 philosophical + 1 holiday = 31 active.
      expect(pool.length).toBe(31);
    });

    it("reflects locale switch", () => {
      initCliI18n({ locale: "en" });
      const enPool = activeTaglines({ now: () => new Date(Date.UTC(2026, 5, 15)) });
      initCliI18n({ locale: "zh-CN" });
      const zhPool = activeTaglines({ now: () => new Date(Date.UTC(2026, 5, 15)) });
      expect(enPool[0]).toContain("True intelligence");
      expect(zhPool[0]).toContain("真正的智能");
      expect(enPool.length).toBe(zhPool.length);
    });
  });
});
