import { execFile } from "node:child_process";
import { resolveLarkCliPath } from "./resolve.ts";

export interface HealthCheckResult {
  ok: boolean;
  version?: string;
  error?: string;
}

const HEALTH_TIMEOUT_MS = 5000;

/**
 * Run `lark-cli --version` to verify the binary works.
 * Timeout: 5 seconds.
 */
export async function healthCheck(): Promise<HealthCheckResult> {
  const binPath = resolveLarkCliPath();

  if (!binPath) {
    return { ok: false, error: "lark-cli not found" };
  }

  return new Promise<HealthCheckResult>((resolve) => {
    execFile(
      "node",
      [binPath, "--version"],
      { timeout: HEALTH_TIMEOUT_MS },
      (error, stdout, stderr) => {
        if (error) {
          resolve({
            ok: false,
            error: stderr?.trim() || error.message,
          });
          return;
        }

        const version = stdout.trim();
        resolve({ ok: true, version });
      },
    );
  });
}
