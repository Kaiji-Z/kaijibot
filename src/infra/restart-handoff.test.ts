import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureEnv } from "../test-utils/env.js";
import { withTempDirSync } from "../test-helpers/temp-dir.js";
import {
  type GatewayRestartHandoff,
  clearGatewayRestartHandoffSync,
  formatGatewayRestartHandoffDiagnostic,
  readGatewayRestartHandoffSync,
  writeGatewayRestartHandoffSync,
  GATEWAY_SUPERVISOR_RESTART_HANDOFF_FILENAME,
} from "./restart-handoff.js";

let tempDir: string | undefined;

function withHandoffStateDir<T>(run: (env: NodeJS.ProcessEnv) => T): T {
  const envSnapshot = captureEnv(["KAIJIBOT_STATE_DIR"]);
  try {
    return withTempDirSync({ prefix: "kaijibot-handoff-" }, (dir) => {
      tempDir = dir;
      process.env.KAIJIBOT_STATE_DIR = dir;
      return run(process.env);
    });
  } finally {
    envSnapshot.restore();
    tempDir = undefined;
  }
}

afterEach(() => {
  // Safety net: clear handoff file if temp dir is set
  if (tempDir) {
    try {
      const filePath = path.join(tempDir, GATEWAY_SUPERVISOR_RESTART_HANDOFF_FILENAME);
      fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
  }
});

describe("restart-handoff write + read round-trip", () => {
  it("writes handoff with all fields and reads it back", () => {
    withHandoffStateDir((env) => {
      const now = Date.now();
      const written = writeGatewayRestartHandoffSync({
        env,
        pid: 12345,
        processInstanceId: "inst-abc",
        reason: "manual restart",
        source: "operator-restart",
        restartKind: "full-process",
        supervisorMode: "systemd",
        ttlMs: 30_000,
        createdAt: now,
      });

      expect(written).not.toBeNull();
      expect(written!.kind).toBe("gateway-supervisor-restart-handoff");
      expect(written!.version).toBe(1);
      expect(written!.pid).toBe(12345);
      expect(written!.processInstanceId).toBe("inst-abc");
      expect(written!.reason).toBe("manual restart");
      expect(written!.source).toBe("operator-restart");
      expect(written!.restartKind).toBe("full-process");
      expect(written!.supervisorMode).toBe("systemd");
      expect(written!.createdAt).toBe(now);
      expect(written!.expiresAt).toBe(now + 30_000);
      expect(written!.intentId).toBeTruthy();

      const read = readGatewayRestartHandoffSync(env, now + 1000);
      expect(read).not.toBeNull();
      expect(read!.pid).toBe(12345);
      expect(read!.source).toBe("operator-restart");
      expect(read!.restartKind).toBe("full-process");
      expect(read!.supervisorMode).toBe("systemd");
    });
  });
});

describe("restart-handoff TTL expiry", () => {
  it("returns null when now is past expiresAt", () => {
    withHandoffStateDir((env) => {
      const now = Date.now();
      writeGatewayRestartHandoffSync({
        env,
        pid: 99999,
        restartKind: "full-process",
        ttlMs: 5000,
        createdAt: now,
      });

      // Before expiry: should be readable
      const before = readGatewayRestartHandoffSync(env, now + 4000);
      expect(before).not.toBeNull();

      // After expiry: should return null
      const after = readGatewayRestartHandoffSync(env, now + 6000);
      expect(after).toBeNull();
    });
  });
});

describe("restart-handoff invalid JSON", () => {
  it("returns null for garbage content in handoff file", () => {
    withHandoffStateDir((env) => {
      const handoffPath = path.join(
        env.KAIJIBOT_STATE_DIR!,
        GATEWAY_SUPERVISOR_RESTART_HANDOFF_FILENAME,
      );
      fs.mkdirSync(path.dirname(handoffPath), { recursive: true });
      fs.writeFileSync(handoffPath, "this is not json {{{}}}", "utf8");

      const result = readGatewayRestartHandoffSync(env);
      expect(result).toBeNull();
    });
  });
});

describe("restart-handoff missing file", () => {
  it("returns null when no handoff file exists", () => {
    withHandoffStateDir((env) => {
      const result = readGatewayRestartHandoffSync(env);
      expect(result).toBeNull();
    });
  });
});

describe("restart-handoff clearHandoff", () => {
  it("writes then clears, read returns null", () => {
    withHandoffStateDir((env) => {
      const now = Date.now();
      const written = writeGatewayRestartHandoffSync({
        env,
        pid: 54321,
        restartKind: "update-process",
        createdAt: now,
      });
      expect(written).not.toBeNull();

      clearGatewayRestartHandoffSync(env);

      const result = readGatewayRestartHandoffSync(env, now + 100);
      expect(result).toBeNull();
    });
  });
});

describe("formatGatewayRestartHandoffDiagnostic", () => {
  it("contains restartKind, source, and pid", () => {
    const handoff: GatewayRestartHandoff = {
      kind: "gateway-supervisor-restart-handoff",
      version: 1,
      intentId: "test-intent-id",
      pid: 7777,
      createdAt: 1_000_000,
      expiresAt: 1_060_000,
      source: "config-write",
      restartKind: "full-process",
      supervisorMode: "launchd",
    };

    const diagnostic = formatGatewayRestartHandoffDiagnostic(handoff, 1_030_000);
    expect(diagnostic).toContain("full-process");
    expect(diagnostic).toContain("config-write");
    expect(diagnostic).toContain("pid=7777");
    expect(diagnostic).toContain("launchd");
  });
});

describe("restart-handoff source inference", () => {
  it("infers source=gateway-update from reason=update.run", () => {
    withHandoffStateDir((env) => {
      const now = Date.now();
      const written = writeGatewayRestartHandoffSync({
        env,
        pid: 11111,
        reason: "update.run",
        restartKind: "update-process",
        createdAt: now,
      });
      expect(written).not.toBeNull();
      expect(written!.source).toBe("gateway-update");

      const read = readGatewayRestartHandoffSync(env, now + 100);
      expect(read).not.toBeNull();
      expect(read!.source).toBe("gateway-update");
    });
  });

  it("infers source=unknown when no source and no reason", () => {
    withHandoffStateDir((env) => {
      const now = Date.now();
      const written = writeGatewayRestartHandoffSync({
        env,
        pid: 22222,
        restartKind: "full-process",
        createdAt: now,
      });
      expect(written).not.toBeNull();
      expect(written!.source).toBe("unknown");
    });
  });

  it("infers source=signal from reason=sigusr1", () => {
    withHandoffStateDir((env) => {
      const now = Date.now();
      const written = writeGatewayRestartHandoffSync({
        env,
        pid: 33333,
        reason: "sigusr1",
        restartKind: "full-process",
        createdAt: now,
      });
      expect(written).not.toBeNull();
      expect(written!.source).toBe("signal");
    });
  });

  it("infers source=plugin-change from reason containing plugin", () => {
    withHandoffStateDir((env) => {
      const now = Date.now();
      const written = writeGatewayRestartHandoffSync({
        env,
        pid: 44444,
        reason: "plugin-reload-requested",
        restartKind: "full-process",
        createdAt: now,
      });
      expect(written).not.toBeNull();
      expect(written!.source).toBe("plugin-change");
    });
  });
});
