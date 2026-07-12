import type { CliLocale } from "./types.js";

/**
 * English is always loaded synchronously and acts as the fallback when a
 * key is missing from the active locale. Keeping the default stable avoids
 * lazy-load machinery for a two-locale surface.
 */
export const DEFAULT_LOCALE: CliLocale = "en";

export const SUPPORTED_LOCALES: readonly CliLocale[] = ["en", "zh-CN"];

const ZH_PATTERN = /^zh/i;

/**
 * Map a raw locale string (from `LANG`, `LC_ALL`, `Intl`, etc.) to a
 * supported CLI locale. Anything that does not look like Chinese falls
 * back to English.
 */
export function parseLocaleString(raw: string | null | undefined): CliLocale | null {
  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }
  // POSIX locale strings look like `zh_CN.UTF-8`; BCP-47 looks like `zh-CN`.
  // We only care whether the primary language is Chinese — the region is
  // currently collapsed (zh-TW / zh-HK roll into zh-CN; can be split later
  // without touching call sites).
  const stripped = raw.trim().split(".")[0].replace(/_/g, "-").toLowerCase();
  if (ZH_PATTERN.test(stripped)) {
    return "zh-CN";
  }
  if (stripped === "en" || stripped.startsWith("en-")) {
    return "en";
  }
  return null;
}

export function isSupportedCliLocale(value: unknown): value is CliLocale {
  return value === "en" || value === "zh-CN";
}

/**
 * Resolve the CLI locale from environment variables. Resolution order:
 *
 * 1. `KAIJIBOT_CLI_LOCALE` — explicit operator override (highest priority).
 * 2. `LC_ALL`
 * 3. `LC_MESSAGES`
 * 4. `LANG`
 * 5. `Intl.DateTimeFormat().resolvedOptions().locale` (Node ≥ 13)
 * 6. {@link DEFAULT_LOCALE}
 *
 * The function is pure: it takes the env explicitly so tests can drive it
 * without touching global state.
 */
export function resolveCliLocale(env: NodeJS.ProcessEnv | undefined = process.env): CliLocale {
  const candidates = [env?.KAIJIBOT_CLI_LOCALE, env?.LC_ALL, env?.LC_MESSAGES, env?.LANG];
  for (const candidate of candidates) {
    const parsed = parseLocaleString(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }
  try {
    const intlLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    const parsed = parseLocaleString(intlLocale);
    if (parsed !== null) {
      return parsed;
    }
  } catch {
    // Intl may be unavailable in stripped-down runtimes; fall through.
  }
  return DEFAULT_LOCALE;
}
