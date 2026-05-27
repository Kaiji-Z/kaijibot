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
  it("returns the theme name directly for explicit modes", () => {
    expect(resolveTheme("ink-jade", "dark")).toBe("ink-jade");
    expect(resolveTheme("rice-paper", "light")).toBe("rice-paper");
    expect(resolveTheme("glaze", "dark")).toBe("glaze");
  });

  it("swaps ink-jade ↔ rice-paper under system mode", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: true }),
    );
    expect(resolveTheme("ink-jade", "system")).toBe("rice-paper");
    vi.unstubAllGlobals();

    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: false }),
    );
    expect(resolveTheme("rice-paper", "system")).toBe("ink-jade");
    vi.unstubAllGlobals();
  });

  it("keeps glaze unchanged under system mode", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: true }),
    );
    expect(resolveTheme("glaze", "system")).toBe("glaze");
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

describe("resolveColorScheme", () => {
  it("returns dark for ink-jade and glaze", () => {
    expect(resolveColorScheme("ink-jade")).toBe("dark");
    expect(resolveColorScheme("glaze")).toBe("dark");
  });

  it("returns light for rice-paper", () => {
    expect(resolveColorScheme("rice-paper")).toBe("light");
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
