import type { PersonaTree } from "./types.js";

/**
 * Two cognitive locales only. The cognitive layer treats "mixed" language
 * users as Chinese-primary (matches the engine's original design before
 * this module existed).
 */
export type CognitiveLocale = "zh" | "en";

/**
 * A string that exists in parallel Chinese and English forms. Prompt
 * constants that must adapt to the user's locale use this shape so that
 * callers can pick the right variant without branching at every site.
 */
export type LocalizableString = { zh: string; en: string };

/** Default locale when no signal is available (matches legacy behavior). */
export const DEFAULT_COGNITIVE_LOCALE: CognitiveLocale = "zh";

/**
 * Resolve the cognitive locale from a persona tree. Falls back to
 * {@link DEFAULT_COGNITIVE_LOCALE} when the persona carries no language
 * signal or when the signal is "mixed" — the cognitive engine was
 * originally designed Chinese-primary and "mixed" indicates a user who
 * accepts Chinese output fine.
 *
 * This function was previously inlined in `insight/llm-engine.ts`. It
 * lives here so every prompt builder can resolve locale uniformly.
 */
export function detectCognitiveLocale(persona: PersonaTree | undefined | null): CognitiveLocale {
  if (!persona) {
    return DEFAULT_COGNITIVE_LOCALE;
  }
  const lang =
    persona.identity?.primaryLanguage ?? persona.identity?.communicationStyle?.preferredLanguage;
  if (lang === "en") {
    return "en";
  }
  // "zh", "mixed", undefined, or any other value → Chinese.
  // "mixed" is mapped to "zh" because the engine's prompt assets default
  // to Chinese and "mixed" users accept Chinese output.
  return "zh";
}

/**
 * Return the locale-appropriate variant of a {@link LocalizableString}.
 * Use this at every prompt-assembly site that reads from a constant pool.
 */
export function pickLocalized(input: LocalizableString, locale: CognitiveLocale): string {
  return locale === "en" ? input.en : input.zh;
}

/**
 * Build a localizable string from its two variants. Exists so prompt
 * tables have a concise, self-documenting constructor.
 */
export function L(zh: string, en: string): LocalizableString {
  return { zh, en };
}
