import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THEME,
  LEGACY_MAP,
  VALID_THEME_NAMES,
  parseThemeSelection,
  resolveColorScheme,
  resolveTheme,
  themeDisplayName,
} from "./theme.ts";

describe("resolveTheme", () => {
  it("returns the theme name directly for all modes", () => {
    expect(resolveTheme("ink-jade", "dark")).toBe("ink-jade");
    expect(resolveTheme("ink-jade", "light")).toBe("ink-jade");
    expect(resolveTheme("ink-jade", "system")).toBe("ink-jade");
    expect(resolveTheme("rice-paper", "light")).toBe("rice-paper");
    expect(resolveTheme("rice-paper", "dark")).toBe("rice-paper");
    expect(resolveTheme("glaze", "dark")).toBe("glaze");
    expect(resolveTheme("glaze", "light")).toBe("glaze");
  });
});

describe("resolveColorScheme", () => {
  it("returns explicit mode when not system", () => {
    expect(resolveColorScheme("ink-jade", "dark")).toBe("dark");
    expect(resolveColorScheme("ink-jade", "light")).toBe("light");
    expect(resolveColorScheme("rice-paper", "light")).toBe("light");
    expect(resolveColorScheme("rice-paper", "dark")).toBe("dark");
    expect(resolveColorScheme("glaze", "dark")).toBe("dark");
    expect(resolveColorScheme("glaze", "light")).toBe("light");
  });

  it("resolves system mode from OS preference", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: true }),
    );
    expect(resolveColorScheme("ink-jade", "system")).toBe("light");
    vi.unstubAllGlobals();

    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: false }),
    );
    expect(resolveColorScheme("ink-jade", "system")).toBe("dark");
    vi.unstubAllGlobals();
  });
});

describe("parseThemeSelection", () => {
  it("returns the default for null/undefined/empty", () => {
    expect(parseThemeSelection(null)).toBe("ink-jade");
    expect(parseThemeSelection(undefined)).toBe("ink-jade");
    expect(parseThemeSelection("")).toBe("ink-jade");
  });

  it("returns valid names as-is", () => {
    expect(parseThemeSelection("ink-jade")).toBe("ink-jade");
    expect(parseThemeSelection("rice-paper")).toBe("rice-paper");
    expect(parseThemeSelection("glaze")).toBe("glaze");
  });

  it("maps legacy names to new themes", () => {
    expect(parseThemeSelection("claw")).toBe("ink-jade");
    expect(parseThemeSelection("knot")).toBe("rice-paper");
    expect(parseThemeSelection("dash")).toBe("glaze");
    expect(parseThemeSelection("fieldmanual")).toBe("rice-paper");
    expect(parseThemeSelection("clawdash")).toBe("glaze");
    expect(parseThemeSelection("minimal")).toBe("ink-jade");
    expect(parseThemeSelection("openknot")).toBe("rice-paper");
    expect(parseThemeSelection("openknot-light")).toBe("rice-paper");
    expect(parseThemeSelection("dash-light")).toBe("glaze");
    expect(parseThemeSelection("dark")).toBe("ink-jade");
    expect(parseThemeSelection("light")).toBe("rice-paper");
  });

  it("returns default for unknown values", () => {
    expect(parseThemeSelection("unknown-theme")).toBe("ink-jade");
  });
});

describe("themeDisplayName", () => {
  it("returns bilingual labels", () => {
    expect(themeDisplayName("ink-jade")).toBe("墨玉 · Ink Jade");
    expect(themeDisplayName("rice-paper")).toBe("宣纸 · Rice Paper");
    expect(themeDisplayName("glaze")).toBe("琉璃 · Glaze");
  });
});

describe("constants", () => {
  it("VALID_THEME_NAMES contains exactly the three themes", () => {
    expect(VALID_THEME_NAMES.has("ink-jade")).toBe(true);
    expect(VALID_THEME_NAMES.has("rice-paper")).toBe(true);
    expect(VALID_THEME_NAMES.has("glaze")).toBe(true);
    expect(VALID_THEME_NAMES.size).toBe(3);
  });

  it("LEGACY_MAP maps all documented legacy names", () => {
    const expectedKeys = [
      "claw",
      "knot",
      "dash",
      "openknot",
      "openknot-light",
      "dash-light",
      "dark",
      "light",
      "fieldmanual",
      "clawdash",
      "minimal",
    ];
    for (const key of expectedKeys) {
      expect(LEGACY_MAP[key]).toBeDefined();
    }
  });

  it("DEFAULT_THEME is ink-jade", () => {
    expect(DEFAULT_THEME).toBe("ink-jade");
  });
});
