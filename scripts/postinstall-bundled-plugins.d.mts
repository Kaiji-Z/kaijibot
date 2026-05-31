/**
 * Type declarations for postinstall-bundled-plugins.mjs exports used in tests.
 *
 * The source file is ESM JavaScript (no TypeScript), so these hand-written
 * declarations are necessary for tsgo to pass.
 */

/**
 * Install lark-cli skills (~28 lark-* SKILL.md files) to ~/.agents/skills/.
 *
 * Uses dependency injection via `params` for testability.
 */
export function installLarkCliSkills(params?: Record<string, unknown>): void;

/**
 * Strip global npm config flags from the environment object to prevent
 * nested npm calls from being affected by the parent's global install context.
 */
export function createNestedNpmInstallEnv(
  env?: Record<string, string | undefined>,
): Record<string, string | undefined>;
