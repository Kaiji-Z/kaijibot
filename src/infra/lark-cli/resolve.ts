import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";

let cachedPath: string | undefined | null = null;

/**
 * Resolve the lark-cli binary path.
 *
 * The @larksuite/cli package has no main/exports — it ships a Go binary
 * behind a Node wrapper at `scripts/run.js`. Resolution strategy:
 *
 * 1. Try `require.resolve("@larksuite/cli/scripts/run.js")` — the Node wrapper
 * 2. Fall back to `lark-cli` in $PATH via `which`
 *
 * Result is cached after the first call. Returns `undefined` if not available.
 */
export function resolveLarkCliPath(): string | undefined {
  if (cachedPath !== null) {
    return cachedPath;
  }

  // Strategy 1: resolve via require.resolve
  try {
    const runJs = require.resolve("@larksuite/cli/scripts/run.js");
    cachedPath = runJs;
    return runJs;
  } catch {
    // Package not installed or not resolvable
  }

  // Strategy 2: check $PATH for the bin symlink (cross-platform)
  try {
    const isWin = process.platform === "win32";
    const cmd = isWin ? "where lark-cli" : "which lark-cli";
    const result = execSync(cmd, { encoding: "utf-8", timeout: 3000 }).trim();
    if (result) {
      cachedPath = result.split("\n")[0].trim();
      return cachedPath;
    }
  } catch {
    // Not in PATH
  }

  cachedPath = undefined;
  return undefined;
}

/**
 * Check if lark-cli is available (binary can be resolved).
 */
export function isLarkCliAvailable(): boolean {
  return resolveLarkCliPath() !== undefined;
}

/**
 * Derive the `node_modules/.bin` directory containing the lark-cli symlink.
 * Returns `undefined` if lark-cli is not installed or `.bin` doesn't exist.
 */
export function resolveLarkCliBinDir(): string | undefined {
  const binPath = resolveLarkCliPath();
  if (!binPath) {
    return undefined;
  }
  let dir = dirname(binPath);
  while (dir !== dirname(dir)) {
    if (basename(dir) === "node_modules") {
      const binDir = join(dir, ".bin");
      return existsSync(binDir) ? binDir : undefined;
    }
    dir = dirname(dir);
  }
  return undefined;
}
