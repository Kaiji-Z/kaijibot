import { z } from "../api.js";
import { buildPluginConfigSchema, type KaijiBotPluginConfigSchema } from "../api.js";

/**
 * Zod source schema for Kindle Portal plugin config.
 * All fields optional at input boundary; defaults applied by resolver.
 */
export const KINDLE_PORTAL_CONFIG_SOURCE = z.strictObject({
  /**
   * Deprecated no-op. The gateway-level `plugins.entries.kindle-portal.enabled`
   * is the only switch that matters. This field is kept in the schema so
   * existing configs that still carry it do not fail strict validation.
   */
  enabled: z.boolean().optional(),
  /**
   * Optional shared secret for non-loopback requests.
   * Empty string and undefined are equivalent (LAN-open, no token required).
   */
  accessToken: z.string().trim().optional(),
  refreshIntervalSeconds: z.number().int().min(15).optional(),
  mapRefreshSeconds: z.number().int().min(60).optional(),
  scope: z.enum(["last-active", "all-users", "specific-user"]).optional(),
  userId: z.string().trim().min(1).optional(),
  showWiki: z.boolean().optional(),
  maxDomains: z.number().int().min(5).max(50).optional(),
  pngWidth: z.number().int().min(400).max(1072).optional(),
});

/**
 * Default values applied when a key is absent.
 */
export const KINDLE_PORTAL_DEFAULTS = {
  enabled: false,
  refreshIntervalSeconds: 15,
  mapRefreshSeconds: 300,
  scope: "last-active",
  showWiki: true,
  maxDomains: 20,
  pngWidth: 758,
} as const;

export type KindleConfig = {
  readonly enabled: boolean;
  readonly accessToken?: string;
  readonly refreshIntervalSeconds: number;
  readonly mapRefreshSeconds: number;
  readonly scope: "last-active" | "all-users" | "specific-user";
  readonly userId?: string;
  readonly showWiki: boolean;
  readonly maxDomains: number;
  readonly pngWidth: number;
};

type KindleConfigInput = z.infer<typeof KINDLE_PORTAL_CONFIG_SOURCE>;

export type NormalizedConfigIssue = { path: (string | number)[]; message: string };

/**
 * Validate input and apply defaults. Throws z.ZodError on invalid values.
 */
export function resolveKindleConfig(pluginConfig: unknown): KindleConfig {
  const parsed = pluginConfig === undefined ? undefined : KINDLE_PORTAL_CONFIG_SOURCE.parse(pluginConfig);
  return applyDefaults(parsed);
}

/**
 * Safe variant — never throws. Returns undefined on parse failure and
 * invokes onError with normalized issues.
 */
export function resolveKindleConfigSafe(
  pluginConfig: unknown,
  onError?: (issues: NormalizedConfigIssue[]) => void,
): KindleConfig | undefined {
  if (pluginConfig === undefined) {
    return applyDefaults(undefined);
  }
  const result = KINDLE_PORTAL_CONFIG_SOURCE.safeParse(pluginConfig);
  if (result.success) {
    return applyDefaults(result.data);
  }
  onError?.(normalizeIssues(result.error.issues));
  return undefined;
}

function applyDefaults(input: KindleConfigInput | undefined): KindleConfig {
  const rawToken = input?.accessToken;
  return {
    enabled: input?.enabled ?? KINDLE_PORTAL_DEFAULTS.enabled,
    accessToken: rawToken && rawToken.length > 0 ? rawToken : undefined,
    refreshIntervalSeconds: input?.refreshIntervalSeconds ?? KINDLE_PORTAL_DEFAULTS.refreshIntervalSeconds,
    mapRefreshSeconds: input?.mapRefreshSeconds ?? KINDLE_PORTAL_DEFAULTS.mapRefreshSeconds,
    scope: input?.scope ?? KINDLE_PORTAL_DEFAULTS.scope,
    userId: input?.userId,
    showWiki: input?.showWiki ?? KINDLE_PORTAL_DEFAULTS.showWiki,
    maxDomains: input?.maxDomains ?? KINDLE_PORTAL_DEFAULTS.maxDomains,
    pngWidth: input?.pngWidth ?? KINDLE_PORTAL_DEFAULTS.pngWidth,
  };
}

function normalizeIssues(issues: Iterable<{ path: PropertyKey[]; message: string }>): NormalizedConfigIssue[] {
  const out: NormalizedConfigIssue[] = [];
  for (const issue of issues) {
    out.push({
      path: issue.path.filter(
        (segment): segment is string | number => typeof segment === "string" || typeof segment === "number",
      ),
      message: issue.message,
    });
  }
  return out;
}

/**
 * Plugin-facing config schema (consumed by definePluginEntry).
 * Wraps the zod source schema and normalizes safeParse issues to match
 * the KaijiBotPluginConfigSchema contract (string|number paths only).
 */
export const KINDLE_PORTAL_CONFIG_SCHEMA: KaijiBotPluginConfigSchema = buildPluginConfigSchema(
  KINDLE_PORTAL_CONFIG_SOURCE,
  {
    safeParse(value: unknown) {
      if (value === undefined) {
        return { success: true, data: applyDefaults(undefined) };
      }
      const result = KINDLE_PORTAL_CONFIG_SOURCE.safeParse(value);
      if (result.success) {
        return { success: true, data: applyDefaults(result.data) };
      }
      return {
        success: false,
        error: { issues: normalizeIssues(result.error.issues) },
      };
    },
  },
);
