import os from "node:os";
import path from "node:path";
import { buildPluginConfigSchema, z, type KaijiBotPluginConfigSchema } from "../api.js";

// === Config Types ===

export type WikiConfig = {
  enabled: boolean;
  cron: string;
  vault: {
    path: string;
  };
  scan: {
    extensions: readonly string[];
    excludeDirs: readonly string[];
    excludePatterns: readonly string[];
    maxFileSize: number;
    includeMemoryCurated: boolean;
  };
  extraction: {
    minConfidence: number;
    maxClaimsPerPage: number;
  };
};

export type KnowledgeWikiPluginConfig = WikiConfig;

// === Defaults ===

export const DEFAULT_WIKI_ENABLED = true;
export const DEFAULT_WIKI_CRON = "0 */6 * * *";
export const DEFAULT_WIKI_MAX_FILE_SIZE = 1_048_576; // 1MB
export const DEFAULT_WIKI_MIN_CONFIDENCE = 0.5;
export const DEFAULT_WIKI_MAX_CLAIMS = 20;

export const DEFAULT_SCAN_EXTENSIONS = [".md", ".txt", ".rst"] as const;
export const DEFAULT_EXCLUDE_DIRS = [
  ".git", "node_modules", ".kaijibot", "wiki", "sessions",
  ".pnpm-store", ".venv", "venv", "dist", "build",
  "skills", ".agents",
] as const;
export const DEFAULT_EXCLUDE_PATTERNS = [
  "memory/\\d{4}-\\d{2}-\\d{2}\\.md$",
  "memory/dialogues/",
  "^(AGENTS|HEARTBEAT|IDENTITY|SOUL|TOOLS|USER|MEMORY|BOOTSTRAP|KAIJIBOT-GUIDE)\\.md$",
  "^main/",
] as const;

// === Path Resolution ===

function expandHomePath(inputPath: string, homedir: string): string {
  if (inputPath.startsWith("~/")) {
    return path.join(homedir, inputPath.slice(2));
  }
  return inputPath;
}

export function resolveDefaultWikiVaultPath(homedir = os.homedir()): string {
  return path.join(homedir, ".kaijibot", "workspace", "wiki");
}

export function resolveAgentVaultRoot(workspaceDir: string): string {
  return path.join(workspaceDir, "wiki");
}

export function resolveEffectiveVaultRoot(
  config: WikiConfig,
  workspaceDir: string | undefined,
): string {
  if (config.vault.path) {
    return config.vault.path;
  }
  if (!workspaceDir) {
    return resolveDefaultWikiVaultPath();
  }
  return resolveAgentVaultRoot(workspaceDir);
}

// === Config Schema (Zod) ===

const WikiConfigSource = z.strictObject({
  enabled: z.boolean().optional(),
  cron: z.string().optional(),
  vault: z.strictObject({
    path: z.string().optional(),
  }).optional(),
  scan: z.strictObject({
    extensions: z.array(z.string()).optional(),
    excludeDirs: z.array(z.string()).optional(),
    excludePatterns: z.array(z.string()).optional(),
    maxFileSize: z.number().int().positive().optional(),
    includeMemoryCurated: z.boolean().optional(),
  }).optional(),
  extraction: z.strictObject({
    minConfidence: z.number().min(0).max(1).optional(),
    maxClaimsPerPage: z.number().int().positive().optional(),
  }).optional(),
});

type WikiConfigInput = z.infer<typeof WikiConfigSource>;

// === Config Resolver ===

export function resolveWikiConfig(
  config: WikiConfigInput | undefined,
  options?: { homedir?: string },
): WikiConfig {
  const homedir = options?.homedir ?? os.homedir();
  const parsed = config ? WikiConfigSource.safeParse(config) : null;
  const safeConfig = parsed?.success ? parsed.data : (config ?? {});

  return {
    enabled: safeConfig.enabled ?? DEFAULT_WIKI_ENABLED,
    cron: safeConfig.cron ?? DEFAULT_WIKI_CRON,
    vault: {
      path: safeConfig.vault?.path
        ? expandHomePath(safeConfig.vault.path, homedir)
        : "",
    },
    scan: {
      extensions: safeConfig.scan?.extensions ?? [...DEFAULT_SCAN_EXTENSIONS],
      excludeDirs: safeConfig.scan?.excludeDirs ?? [...DEFAULT_EXCLUDE_DIRS],
      excludePatterns: safeConfig.scan?.excludePatterns ?? [...DEFAULT_EXCLUDE_PATTERNS],
      maxFileSize: safeConfig.scan?.maxFileSize ?? DEFAULT_WIKI_MAX_FILE_SIZE,
      includeMemoryCurated: safeConfig.scan?.includeMemoryCurated ?? true,
    },
    extraction: {
      minConfidence: safeConfig.extraction?.minConfidence ?? DEFAULT_WIKI_MIN_CONFIDENCE,
      maxClaimsPerPage: safeConfig.extraction?.maxClaimsPerPage ?? DEFAULT_WIKI_MAX_CLAIMS,
    },
  };
}

// === Plugin Config Schema (for kaijibot.plugin.json) ===

export const knowledgeWikiConfigSchema: KaijiBotPluginConfigSchema = buildPluginConfigSchema(
  WikiConfigSource,
  {
    safeParse(value: unknown) {
      if (value === undefined) {
        return { success: true, data: resolveWikiConfig(undefined) };
      }
      const result = WikiConfigSource.safeParse(value);
      if (result.success) {
        return { success: true, data: resolveWikiConfig(result.data) };
      }
      return {
        success: false,
        error: {
          issues: result.error.issues.map((issue) => ({
            path: issue.path.filter((segment): segment is string | number => {
              const kind = typeof segment;
              return kind === "string" || kind === "number";
            }),
            message: issue.message,
          })),
        },
      };
    },
  },
);

// === Resolved type alias for internal use ===

export type ResolvedWikiConfig = WikiConfig;
