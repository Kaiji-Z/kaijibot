/**
 * CLI internationalization types.
 *
 * The CLI ships two locales: English (source of truth) and Chinese (zh-CN).
 * Locale resolution happens once at process start via {@link resolveCliLocale}
 * and may be overridden in tests through `initCliI18n({ locale })`.
 */
export type CliLocale = "en" | "zh-CN";

/**
 * Nested map of dot-path keys to localized strings.
 * Mirrors the shape used by `ui/src/i18n/lib/types.ts` so tooling and
 * developer intuition transfer between the two surfaces.
 */
export type TranslationMap = { [key: string]: string | TranslationMap };

/** Parameters for `{placeholder}` interpolation in `t()` calls. */
export type InterpolationParams = Record<string, string | number>;
