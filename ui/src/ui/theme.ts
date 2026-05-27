/**
 * Theme system for "涌" (Surge) UI.
 *
 * Three self-contained themes:
 * - ink-jade: Dark theme (墨玉), deep ink with mint+amber accents
 * - rice-paper: Light theme (宣纸), warm paper-white with jade accents
 * - glaze: Translucent theme (琉璃), glass-morphic with purple tints
 */

/** Valid theme identifiers */
export type ThemeName = "ink-jade" | "rice-paper" | "glaze";

/** Resolved theme — same as ThemeName (each theme is self-contained) */
export type ResolvedTheme = ThemeName;

/** Theme mode — kept for compatibility but themes define their own lightness */
export type ThemeMode = "system" | "light" | "dark";

/** Set of valid theme names for quick lookup */
export const VALID_THEME_NAMES: ReadonlySet<string> = new Set<string>([
  "ink-jade",
  "rice-paper",
  "glaze",
]);

/**
 * Legacy theme name → new theme name mapping.
 * Ensures users with old stored settings migrate seamlessly.
 */
export const LEGACY_MAP: Readonly<Record<string, ThemeName>> = {
  // Old OpenClaw family names
  claw: "ink-jade",
  knot: "rice-paper",
  dash: "glaze",
  // Old resolved names
  openknot: "rice-paper",
  "openknot-light": "rice-paper",
  "dash-light": "glaze",
  dark: "ink-jade",
  light: "rice-paper",
  // Even older legacy names
  fieldmanual: "rice-paper",
  clawdash: "glaze",
  minimal: "ink-jade",
};

/** Default theme for new users */
export const DEFAULT_THEME: ThemeName = "ink-jade";

/**
 * Parse a stored theme selection, handling legacy values.
 * Returns a valid ThemeName, defaulting to ink-jade.
 */
export function parseThemeSelection(
  raw: string | null | undefined,
): ThemeName {
  if (!raw) return DEFAULT_THEME;
  if (VALID_THEME_NAMES.has(raw)) return raw as ThemeName;
  const mapped = LEGACY_MAP[raw];
  if (mapped) return mapped;
  return DEFAULT_THEME;
}

/**
 * Resolve a theme name + mode to the final CSS data-theme value.
 * Since each theme is self-contained (ink-jade=dark, rice-paper=light, glaze=translucent),
 * the mode parameter is mostly ignored except for "system" mode.
 *
 * For "system" mode: returns rice-paper if user prefers light, ink-jade for dark.
 */
export function resolveTheme(
  name: ThemeName,
  mode: ThemeMode,
): ResolvedTheme {
  if (mode === "system") {
    const prefersLight = globalThis.matchMedia?.(
      "(prefers-color-scheme: light)",
    )?.matches;
    if (prefersLight && name === "ink-jade") return "rice-paper";
    if (!prefersLight && name === "rice-paper") return "ink-jade";
    // glaze stays glaze regardless of system preference
  }
  return name;
}

/**
 * Resolve theme mode to "light" or "dark" for color-scheme CSS property.
 */
export function resolveColorScheme(theme: ThemeName): "light" | "dark" {
  switch (theme) {
    case "rice-paper":
      return "light";
    case "ink-jade":
    case "glaze":
      return "dark";
  }
}

/**
 * Get display label for a theme.
 */
export function themeDisplayName(name: ThemeName): string {
  switch (name) {
    case "ink-jade":
      return "墨玉 · Ink Jade";
    case "rice-paper":
      return "宣纸 · Rice Paper";
    case "glaze":
      return "琉璃 · Glaze";
  }
}
