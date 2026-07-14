import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  spawnSync: vi.fn(),
  writeTextAtomic: vi.fn(),
  confirm: vi.fn(),
  readFile: vi.fn(),
  chmod: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawnSync: hoisted.spawnSync }));
vi.mock("../infra/json-files.js", () => ({ writeTextAtomic: hoisted.writeTextAtomic }));
vi.mock("@clack/prompts", () => ({
  confirm: hoisted.confirm,
  isCancel: (v: unknown) => v === Symbol.for("clack-cancel") || v === undefined,
}));
vi.mock("node:fs/promises", () => ({
  default: { readFile: hoisted.readFile, chmod: hoisted.chmod },
}));

import type { OutputRuntimeEnv } from "../runtime.js";
import { runAndroidInstall } from "./android-install.js";

type SpawnArgs = readonly string[];

function stdoutResult(stdout: string, status = 0) {
  return { status, stdout, stderr: "", signal: null, pid: 0, output: [stdout, "", ""] };
}

function makeRuntime(captured: {
  logs: string[];
  errors: string[];
  exits: number[];
}): OutputRuntimeEnv {
  return {
    log: (...args: unknown[]) => {
      captured.logs.push(args.map(String).join(" "));
    },
    error: (...args: unknown[]) => {
      captured.errors.push(args.map(String).join(" "));
    },
    exit: (code: number) => {
      captured.exits.push(code);
      throw new Error(`exit ${code}`);
    },
    writeStdout: (v: string) => {
      captured.logs.push(v);
    },
    writeJson: () => {},
  };
}

function defaultSpawnMap(call: { cmd: string; args: SpawnArgs }): {
  status: number;
  stdout: string;
} {
  const { cmd, args } = call;
  if (cmd === "node" && args[0] === "--version") {
    return { status: 0, stdout: "v22.5.0\n" };
  }
  if (cmd === "which") {
    return { status: 0, stdout: `/data/data/com.termux/files/usr/bin/${args[0]}\n` };
  }
  if (cmd === "kaijibot" && args[0] === "--version") {
    return { status: 0, stdout: "kaijibot/1.2.3\n" };
  }
  if (cmd === "npm") {
    return { status: 0, stdout: "" };
  }
  if (cmd === "pm") {
    return { status: 0, stdout: "package:com.termux.boot\npackage:com.termux\n" };
  }
  if (cmd === "getprop") {
    return { status: 0, stdout: "xiaomi\n" };
  }
  return { status: 0, stdout: "" };
}

function setupSpawn(map = defaultSpawnMap) {
  hoisted.spawnSync.mockImplementation((cmd: string, args: SpawnArgs) => {
    const res = map({ cmd, args });
    return stdoutResult(res.stdout, res.status);
  });
}

const ORIGINAL_PLATFORM = process.platform;

function setPlatform(platform: string) {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

function setPrefix(prefix: string | undefined) {
  if (prefix === undefined) {
    delete process.env.PREFIX;
  } else {
    process.env.PREFIX = prefix;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  setPlatform("android");
  setPrefix("/data/data/com.termux/files/usr");
  hoisted.writeTextAtomic.mockResolvedValue(undefined);
  hoisted.chmod.mockResolvedValue(undefined);
  hoisted.readFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
  hoisted.confirm.mockResolvedValue(false);
});

afterEach(() => {
  setPlatform(ORIGINAL_PLATFORM);
  setPrefix(undefined);
});

describe("runAndroidInstall - non-Termux guard", () => {
  it("exits with code 1 when platform is not android", async () => {
    setPlatform("linux");
    const captured = { logs: [] as string[], errors: [] as string[], exits: [] as number[] };
    const runtime = makeRuntime(captured);

    await expect(runAndroidInstall(runtime, {})).rejects.toThrow("exit 1");

    expect(captured.exits).toEqual([1]);
    expect(captured.errors[0]).toMatch(/must be run inside Termux on Android/i);
    expect(hoisted.spawnSync).not.toHaveBeenCalled();
  });

  it("exits when PREFIX is missing even on android platform", async () => {
    setPrefix(undefined);
    const captured = { logs: [] as string[], errors: [] as string[], exits: [] as number[] };
    const runtime = makeRuntime(captured);

    await expect(runAndroidInstall(runtime, {})).rejects.toThrow("exit 1");

    expect(captured.exits).toEqual([1]);
  });
});

describe("runAndroidInstall - full happy path", () => {
  it("runs all 10 steps and writes the boot script", async () => {
    setupSpawn();
    hoisted.confirm.mockResolvedValue(true);
    const captured = { logs: [] as string[], errors: [] as string[], exits: [] as number[] };
    const runtime = makeRuntime(captured);

    await runAndroidInstall(runtime, {});

    expect(captured.exits).toEqual([]);
    const calls = hoisted.spawnSync.mock.calls as unknown as [string, SpawnArgs][];
    const cmds = calls.map(([c, a]) => `${c} ${(a ?? []).join(" ")}`);
    expect(cmds.some((c) => c.startsWith("node --version"))).toBe(true);
    expect(cmds.some((c) => c.startsWith("which imagemagick"))).toBe(true);
    expect(cmds.some((c) => c.startsWith("which ffmpeg"))).toBe(true);
    expect(cmds.some((c) => c.startsWith("kaijibot --version"))).toBe(true);
    expect(cmds.some((c) => c.startsWith("npm install -g kaijibot"))).toBe(true);
    expect(cmds.some((c) => c.includes("@img/sharp-wasm32"))).toBe(true);
    expect(cmds.some((c) => c.startsWith("pm list packages"))).toBe(true);
    expect(cmds.some((c) => c.startsWith("getprop ro.product.manufacturer"))).toBe(true);
    expect(cmds.some((c) => c.startsWith("kaijibot onboard"))).toBe(true);

    const bootWrite = hoisted.writeTextAtomic.mock.calls.find((call: unknown) => {
      const [p] = call as [string];
      return p.endsWith("start-kaijibot.sh");
    });
    expect(bootWrite).toBeDefined();
    const [, bootContent, bootOpts] = bootWrite as [string, string, { mode: number }];
    expect(bootContent).toContain("#!/data/data/com.termux/files/usr/bin/bash");
    expect(bootContent).toContain("termux-wake-lock");
    expect(bootContent).toContain("kaijibot gateway --port 18789");
    expect(bootOpts.mode).toBe(0o755);
  });

  it("skips onboard launch when confirm is cancelled", async () => {
    setupSpawn();
    hoisted.confirm.mockResolvedValue(false);
    const captured = { logs: [] as string[], errors: [] as string[], exits: [] as number[] };
    const runtime = makeRuntime(captured);

    await runAndroidInstall(runtime, {});

    const calls = hoisted.spawnSync.mock.calls as unknown as [string, SpawnArgs][];
    expect(calls.some(([c, a]) => c === "kaijibot" && a?.[0] === "onboard")).toBe(false);
  });

  it("skips onboard prompt entirely in non-interactive mode", async () => {
    setupSpawn();
    const captured = { logs: [] as string[], errors: [] as string[], exits: [] as number[] };
    const runtime = makeRuntime(captured);

    await runAndroidInstall(runtime, { nonInteractive: true });

    expect(hoisted.confirm).not.toHaveBeenCalled();
    const calls = hoisted.spawnSync.mock.calls as unknown as [string, SpawnArgs][];
    expect(calls.some(([c, a]) => c === "kaijibot" && a?.[0] === "onboard")).toBe(false);
  });
});

describe("runAndroidInstall - node version handling", () => {
  it("installs nodejs-lts when node is missing", async () => {
    let nodeCall = 0;
    setupSpawn(({ cmd, args }) => {
      if (cmd === "node" && args[0] === "--version") {
        nodeCall += 1;
        return nodeCall === 1 ? { status: 1, stdout: "" } : { status: 0, stdout: "v22.10.0\n" };
      }
      return defaultSpawnMap({ cmd, args });
    });
    const captured = { logs: [] as string[], errors: [] as string[], exits: [] as number[] };

    await runAndroidInstall(makeRuntime(captured), {});

    const calls = hoisted.spawnSync.mock.calls as unknown as [string, SpawnArgs][];
    expect(calls.some(([c, a]) => c === "pkg" && a?.includes("nodejs-lts"))).toBe(true);
    expect(captured.exits).toEqual([]);
  });

  it("upgrades node when version is below 22", async () => {
    let nodeCall = 0;
    setupSpawn(({ cmd, args }) => {
      if (cmd === "node" && args[0] === "--version") {
        nodeCall += 1;
        return nodeCall === 1
          ? { status: 0, stdout: "v18.0.0\n" }
          : { status: 0, stdout: "v22.0.0\n" };
      }
      return defaultSpawnMap({ cmd, args });
    });
    const captured = { logs: [] as string[], errors: [] as string[], exits: [] as number[] };

    await runAndroidInstall(makeRuntime(captured), {});

    const calls = hoisted.spawnSync.mock.calls as unknown as [string, SpawnArgs][];
    expect(calls.some(([c, a]) => c === "pkg" && a?.includes("nodejs-lts"))).toBe(true);
  });
});

describe("runAndroidInstall - required packages", () => {
  it("installs a missing required package", async () => {
    const ffmpegChecks: boolean[] = [false, true];
    let ffmpegIndex = 0;
    setupSpawn(({ cmd, args }) => {
      if (cmd === "which" && args[0] === "ffmpeg") {
        const present = ffmpegChecks[ffmpegIndex] ?? true;
        ffmpegIndex += 1;
        return present
          ? { status: 0, stdout: "/data/data/com.termux/files/usr/bin/ffmpeg\n" }
          : { status: 1, stdout: "" };
      }
      return defaultSpawnMap({ cmd, args });
    });
    const captured = { logs: [] as string[], errors: [] as string[], exits: [] as number[] };

    await runAndroidInstall(makeRuntime(captured), {});

    const calls = hoisted.spawnSync.mock.calls as unknown as [string, SpawnArgs][];
    expect(calls.some(([c, a]) => c === "pkg" && a?.includes("ffmpeg"))).toBe(true);
    expect(captured.exits).toEqual([]);
  });
});

describe("runAndroidInstall - Termux:Boot detection", () => {
  it("warns when Termux:Boot is not installed", async () => {
    setupSpawn(({ cmd, args }) => {
      if (cmd === "pm" && args[0] === "list") {
        return { status: 0, stdout: "package:com.termux\n" };
      }
      return defaultSpawnMap({ cmd, args });
    });
    const captured = { logs: [] as string[], errors: [] as string[], exits: [] as number[] };

    await runAndroidInstall(makeRuntime(captured), {});

    expect(captured.logs.some((l) => /Termux:Boot not installed/i.test(l))).toBe(true);
  });

  it("confirms when Termux:Boot is present", async () => {
    setupSpawn();
    const captured = { logs: [] as string[], errors: [] as string[], exits: [] as number[] };

    await runAndroidInstall(makeRuntime(captured), {});

    expect(captured.logs.some((l) => /Termux:Boot detected/i.test(l))).toBe(true);
  });
});

describe("runAndroidInstall - OEM battery instructions", () => {
  async function runWithOem(oem: string): Promise<string[]> {
    setupSpawn(({ cmd, args }) => {
      if (cmd === "getprop") {
        return { status: 0, stdout: `${oem}\n` };
      }
      return defaultSpawnMap({ cmd, args });
    });
    const captured = { logs: [] as string[], errors: [] as string[], exits: [] as number[] };
    await runAndroidInstall(makeRuntime(captured), {});
    return captured.logs;
  }

  it("shows xiaomi-specific instructions", async () => {
    const logs = await runWithOem("xiaomi");
    expect(logs.some((l) => /Battery saver → No restrictions/.test(l))).toBe(true);
    expect(logs.some((l) => /Autostart/i.test(l))).toBe(true);
  });

  it("shows samsung-specific instructions", async () => {
    const logs = await runWithOem("samsung");
    expect(logs.some((l) => /Battery → Unrestricted/.test(l))).toBe(true);
  });

  it("shows huawei-specific instructions", async () => {
    const logs = await runWithOem("huawei");
    expect(logs.some((l) => /App launch/.test(l))).toBe(true);
  });

  it("shows vivo-specific instructions", async () => {
    const logs = await runWithOem("vivo");
    expect(logs.some((l) => /Background Power Consumption/.test(l))).toBe(true);
  });

  it("shows oppo-specific instructions", async () => {
    const logs = await runWithOem("oppo");
    expect(logs.some((l) => /App battery management/.test(l))).toBe(true);
  });

  it("shows google/pixel-specific instructions", async () => {
    const logs = await runWithOem("google");
    expect(logs.some((l) => /Adaptive Battery/.test(l))).toBe(true);
  });

  it("falls back to default instructions for unknown OEM", async () => {
    const logs = await runWithOem("unknownbrand");
    expect(logs.some((l) => /autostart.*app launch/i.test(l))).toBe(true);
  });
});

describe("runAndroidInstall - allow-external-apps", () => {
  it("appends allow-external-apps when not present", async () => {
    hoisted.readFile.mockResolvedValue("# existing config\n");
    setupSpawn();
    const captured = { logs: [] as string[], errors: [] as string[], exits: [] as number[] };

    await runAndroidInstall(makeRuntime(captured), {});

    const propsWrite = hoisted.writeTextAtomic.mock.calls.find((call: unknown) => {
      const [p] = call as [string];
      return p.endsWith("termux.properties");
    });
    expect(propsWrite).toBeDefined();
    const [, content] = propsWrite as [string, string];
    expect(content).toContain("allow-external-apps=true");
    expect(content).toContain("# existing config");
  });

  it("does not rewrite when already set", async () => {
    hoisted.readFile.mockResolvedValue("allow-external-apps=true\n");
    setupSpawn();
    const captured = { logs: [] as string[], errors: [] as string[], exits: [] as number[] };

    await runAndroidInstall(makeRuntime(captured), {});

    const propsWrite = hoisted.writeTextAtomic.mock.calls.find((call: unknown) => {
      const [p] = call as [string];
      return p.endsWith("termux.properties");
    });
    expect(propsWrite).toBeUndefined();
    expect(captured.logs.some((l) => /already set/i.test(l))).toBe(true);
  });
});
