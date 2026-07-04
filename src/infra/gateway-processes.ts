import { spawnSync } from "node:child_process";
import fsSync from "node:fs";
import { isGatewayArgv, parseProcCmdline } from "./gateway-process-argv.js";
import { findGatewayPidsOnPortSync as findUnixGatewayPidsOnPortSync } from "./restart-stale-pids.js";
import {
  readWindowsListeningPidsOnPortSync,
  readWindowsProcessArgsSync,
} from "./windows-port-pids.js";

export function readGatewayProcessArgsSync(pid: number): string[] | null {
  if (process.platform === "linux" || process.platform === "android") {
    try {
      return parseProcCmdline(fsSync.readFileSync(`/proc/${pid}/cmdline`, "utf8"));
    } catch {
      return null;
    }
  }
  if (process.platform === "darwin") {
    const ps = spawnSync("ps", ["-o", "command=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 1000,
    });
    if (ps.error || ps.status !== 0) {
      return null;
    }
    const command = ps.stdout.trim();
    return command ? command.split(/\s+/) : null;
  }
  if (process.platform === "win32") {
    return readWindowsProcessArgsSync(pid);
  }
  return null;
}

export function signalVerifiedGatewayPidSync(pid: number, signal: "SIGTERM" | "SIGUSR1"): void {
  const args = readGatewayProcessArgsSync(pid);
  if (!args || !isGatewayArgv(args, { allowGatewayBinary: true })) {
    throw new Error(`refusing to signal non-gateway process pid ${pid}`);
  }
  process.kill(pid, signal);
}

export function findVerifiedGatewayListenerPidsOnPortSync(port: number): number[] {
  const rawPids =
    process.platform === "win32"
      ? readWindowsListeningPidsOnPortSync(port)
      : findUnixGatewayPidsOnPortSync(port);

  let pids = Array.from(new Set(rawPids))
    .filter((pid): pid is number => Number.isFinite(pid) && pid > 0 && pid !== process.pid)
    .filter((pid) => {
      const args = readGatewayProcessArgsSync(pid);
      return args != null && isGatewayArgv(args, { allowGatewayBinary: true });
    });

  if (pids.length === 0 && process.platform === "android") {
    pids = findGatewayPidsViaProcScan();
  }

  return pids;
}

function findGatewayPidsViaProcScan(): number[] {
  let entries: string[];
  try {
    entries = fsSync.readdirSync("/proc");
  } catch {
    return [];
  }
  return entries
    .filter((entry) => /^\d+$/.test(entry))
    .map((entry) => Number(entry))
    .filter((pid) => pid > 0 && pid !== process.pid)
    .filter((pid) => {
      const args = readGatewayProcessArgsSync(pid);
      return args != null && isGatewayArgv(args, { allowGatewayBinary: true });
    });
}

export function formatGatewayPidList(pids: number[]): string {
  return pids.join(", ");
}
