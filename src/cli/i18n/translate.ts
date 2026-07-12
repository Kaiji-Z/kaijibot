import { en } from "./locales/en.js";
import { zhCN } from "./locales/zh-CN.js";
import { DEFAULT_LOCALE, isSupportedCliLocale, resolveCliLocale } from "./registry.js";
import type { CliLocale, InterpolationParams, TranslationMap } from "./types.js";

export { resolveCliLocale } from "./registry.js";

export interface CliI18nOptions {
  /** Explicit locale override; bypasses env resolution. */
  locale?: CliLocale;
  /** Env to read when `locale` is not provided. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

const LOCALE_BUNDLES: Record<CliLocale, TranslationMap> = {
  en,
  "zh-CN": zhCN,
};

/**
 * Resolve a dot-path key against a nested {@link TranslationMap}.
 * Returns `undefined` if any segment is missing.
 */
function resolveKey(map: TranslationMap, key: string): string | undefined {
  if (key.length === 0) {
    return undefined;
  }
  const segments = key.split(".");
  let cursor: TranslationMap = map;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (typeof segment !== "string" || !(segment in cursor)) {
      return undefined;
    }
    const value: string | TranslationMap = cursor[segment];
    if (i === segments.length - 1) {
      return typeof value === "string" ? value : undefined;
    }
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
    cursor = value;
  }
  return undefined;
}

/**
 * Replace `{name}` placeholders in the template with values from `params`.
 * Missing parameters are left as-is so breakages are visible during tests.
 */
function interpolate(template: string, params?: InterpolationParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * CLI i18n manager. Holds the active locale and serves translations from
 * eagerly-loaded bundles. Eager loading is fine here: we ship only two
 * small bundles, and CLI processes are short-lived.
 *
 * Tests must construct a fresh instance or call {@link initCliI18n} with an
 * explicit locale rather than mutating the global singleton mid-test.
 */
export class CliI18n {
  private locale: CliLocale;

  constructor(options: CliI18nOptions = {}) {
    if (options.locale) {
      this.locale = options.locale;
    } else {
      this.locale = resolveCliLocale(options.env);
    }
  }

  getLocale(): CliLocale {
    return this.locale;
  }

  setLocale(locale: CliLocale): void {
    this.locale = locale;
  }

  /** Look up a key and fall back to English, then to the literal key. */
  t(key: string, params?: InterpolationParams): string {
    const fromActive = resolveKey(LOCALE_BUNDLES[this.locale], key);
    if (fromActive !== undefined) {
      return interpolate(fromActive, params);
    }
    if (this.locale !== DEFAULT_LOCALE) {
      const fromFallback = resolveKey(LOCALE_BUNDLES[DEFAULT_LOCALE], key);
      if (fromFallback !== undefined) {
        return interpolate(fromFallback, params);
      }
    }
    // Returning the key makes missing translations obvious during dev
    // without throwing — the CLI should never crash because of i18n.
    return key;
  }

  /** True when a translation exists for `key` in the active locale. */
  has(key: string): boolean {
    return resolveKey(LOCALE_BUNDLES[this.locale], key) !== undefined;
  }
}

/**
 * Global CLI i18n singleton. Initialized lazily on first access to pick up
 * the resolved locale. Call {@link initCliI18n} at process entry to make
 * resolution deterministic.
 */
export const cliI18n: CliI18n = new CliI18n();

/**
 * Initialize the global CLI i18n singleton. Safe to call multiple times;
 * later calls replace the locale. CLI entry points should call this before
 * producing any user-facing output.
 */
export function initCliI18n(options: CliI18nOptions = {}): void {
  if (options.locale) {
    if (!isSupportedCliLocale(options.locale)) {
      throw new Error(`Unsupported CLI locale: ${String(options.locale)}`);
    }
    cliI18n.setLocale(options.locale);
    return;
  }
  cliI18n.setLocale(resolveCliLocale(options.env));
}

/** Convenience accessor mirroring `cliI18n.getLocale()`. */
export function getCliLocale(): CliLocale {
  return cliI18n.getLocale();
}

/** Shortcut for `cliI18n.t(...)`. Use this at call sites for brevity. */
export function t(key: string, params?: InterpolationParams): string {
  return cliI18n.t(key, params);
}
