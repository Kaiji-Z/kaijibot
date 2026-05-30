import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ChildProcess } from "node:child_process";
import { join } from "node:path";

const FAKE_HOME = "/fake/home";
const CONFIG_PATH = join(FAKE_HOME, ".lark-cli", "config.json");

const { mockResolveLarkCliPath, mockExecFileFn, mockFs } = vi.hoisted(() => ({
  mockResolveLarkCliPath: vi.fn<() => string | undefined>(),
  mockExecFileFn: vi.fn<
    (
      file: string,
      args: readonly string[] | null | undefined,
      options: unknown,
      callback: unknown,
    ) => ChildProcess
  >(),
  mockFs: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

vi.mock("./resolve.ts", () => ({
  resolveLarkCliPath: mockResolveLarkCliPath,
}));

vi.mock("node:child_process", () => ({
  execFile: mockExecFileFn,
}));

vi.mock("node:fs", () => ({
  existsSync: mockFs.existsSync,
  readFileSync: mockFs.readFileSync,
  writeFileSync: mockFs.writeFileSync,
}));

vi.mock("node:os", () => ({
  homedir: () => FAKE_HOME,
}));

import {
  registerLarkCliProfiles,
  buildAccountCredentialsList,
} from "./profiles.ts";

function makeMockChild(stdinWrite?: ReturnType<typeof vi.fn>) {
  const write = stdinWrite ?? vi.fn();
  return {
    stdin: { write, end: vi.fn() },
  } as unknown as ChildProcess;
}

function setupSuccessMock() {
  mockExecFileFn.mockImplementation((_file, _args, _opts, cb) => {
    const child = makeMockChild();
    process.nextTick(() => (cb as () => void)());
    return child;
  });
}

function setupErrorMock(errorMessage: string) {
  mockExecFileFn.mockImplementation((_file, _args, _opts, cb) => {
    const child = makeMockChild();
    process.nextTick(
      () =>
        (cb as (err: Error, stdout: string, stderr: string) => void)(
          new Error(errorMessage),
          "",
          errorMessage,
        ),
    );
    return child;
  });
}

describe("buildAccountCredentialsList", () => {
  it("returns empty array when no credentials provided", () => {
    expect(buildAccountCredentialsList({})).toEqual([]);
  });

  it("returns empty array when appId is missing", () => {
    expect(
      buildAccountCredentialsList({
        defaultAppSecret: "secret",
      }),
    ).toEqual([]);
  });

  it("returns empty array when appSecret is missing", () => {
    expect(
      buildAccountCredentialsList({
        defaultAppId: "cli_123",
      }),
    ).toEqual([]);
  });

  it("builds default profile from top-level config", () => {
    const result = buildAccountCredentialsList({
      defaultAppId: "cli_default",
      defaultAppSecret: "secret_default",
      defaultDomain: "feishu.cn",
    });

    expect(result).toEqual([
      {
        name: "default",
        appId: "cli_default",
        appSecret: "secret_default",
        brand: "feishu",
      },
    ]);
  });

  it("infers 'lark' brand from larksuite.com domain", () => {
    const result = buildAccountCredentialsList({
      defaultAppId: "cli_default",
      defaultAppSecret: "secret",
      defaultDomain: "larksuite.com",
    });

    expect(result[0].brand).toBe("lark");
  });

  it("defaults brand to 'feishu' when domain is undefined", () => {
    const result = buildAccountCredentialsList({
      defaultAppId: "cli_default",
      defaultAppSecret: "secret",
    });

    expect(result[0].brand).toBe("feishu");
  });

  it("includes additional accounts keyed by accountId", () => {
    const result = buildAccountCredentialsList({
      defaultAppId: "cli_default",
      defaultAppSecret: "secret_default",
      accounts: {
        cli_extra1: { appId: "cli_extra1", appSecret: "s1" },
        cli_extra2: { appId: "cli_extra2", appSecret: "s2", domain: "larksuite.com" },
      },
    });

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      name: "default",
      appId: "cli_default",
      appSecret: "secret_default",
      brand: "feishu",
    });
    expect(result[1]).toEqual({
      name: "cli_extra1",
      appId: "cli_extra1",
      appSecret: "s1",
      brand: "feishu",
    });
    expect(result[2]).toEqual({
      name: "cli_extra2",
      appId: "cli_extra2",
      appSecret: "s2",
      brand: "lark",
    });
  });

  it("skips accounts missing appId or appSecret", () => {
    const result = buildAccountCredentialsList({
      defaultAppId: "cli_default",
      defaultAppSecret: "secret_default",
      accounts: {
        cli_good: { appId: "cli_good", appSecret: "s" },
        cli_no_id: { appSecret: "s" },
        cli_no_secret: { appId: "cli_no_secret" },
      },
    });

    expect(result).toHaveLength(2);
    expect(result[1].name).toBe("cli_good");
  });

  it("handles empty accounts object", () => {
    const result = buildAccountCredentialsList({
      defaultAppId: "cli_default",
      defaultAppSecret: "secret",
      accounts: {},
    });

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("default");
  });
});

describe("registerLarkCliProfiles", () => {
  beforeEach(() => {
    mockResolveLarkCliPath.mockReturnValue("/path/to/run.js");
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readFileSync.mockReturnValue("{}");
    mockFs.readFileSync.mockClear();
    mockFs.writeFileSync.mockClear();
    mockFs.existsSync.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty result when no accounts provided", async () => {
    const result = await registerLarkCliProfiles([]);
    expect(result).toEqual({ registered: [], failed: [] });
    expect(mockExecFileFn).not.toHaveBeenCalled();
  });

  it("returns empty result when lark-cli is not available", async () => {
    mockResolveLarkCliPath.mockReturnValue(undefined);

    const result = await registerLarkCliProfiles([
      { name: "default", appId: "cli_1", appSecret: "s", brand: "feishu" },
    ]);

    expect(result).toEqual({ registered: [], failed: [] });
    expect(mockExecFileFn).not.toHaveBeenCalled();
  });

  it("registers a single profile successfully", async () => {
    setupSuccessMock();

    const result = await registerLarkCliProfiles([
      { name: "default", appId: "cli_default", appSecret: "secret", brand: "feishu" },
    ]);

    expect(result.registered).toEqual(["default"]);
    expect(result.failed).toEqual([]);

    expect(mockExecFileFn).toHaveBeenCalledWith(
      "node",
      [
        "/path/to/run.js",
        "profile",
        "add",
        "--name",
        "default",
        "--app-id",
        "cli_default",
        "--app-secret-stdin",
        "--brand",
        "feishu",
      ],
      { timeout: 10_000 },
      expect.any(Function),
    );
  });

  it("pipes app secret via stdin", async () => {
    const stdinWrite = vi.fn();
    mockExecFileFn.mockImplementation((_file, _args, _opts, cb) => {
      const child = makeMockChild(stdinWrite);
      process.nextTick(() => (cb as () => void)());
      return child;
    });

    await registerLarkCliProfiles([
      { name: "default", appId: "cli_1", appSecret: "mysecret", brand: "feishu" },
    ]);

    expect(stdinWrite).toHaveBeenCalledWith("mysecret");
  });

  it("registers multiple profiles sequentially", async () => {
    const callOrder: string[] = [];
    mockExecFileFn.mockImplementation((_file, args, _opts, cb) => {
      const resolved = (args ?? []) as string[];
      const nameIdx = resolved.indexOf("--name");
      callOrder.push(resolved[nameIdx + 1]);
      const child = makeMockChild();
      process.nextTick(() => (cb as () => void)());
      return child;
    });

    const result = await registerLarkCliProfiles([
      { name: "default", appId: "cli_1", appSecret: "s1", brand: "feishu" },
      { name: "cli_2", appId: "cli_2", appSecret: "s2", brand: "lark" },
      { name: "cli_3", appId: "cli_3", appSecret: "s3", brand: "feishu" },
    ]);

    expect(result.registered).toEqual(["default", "cli_2", "cli_3"]);
    expect(callOrder).toEqual(["default", "cli_2", "cli_3"]);
  });

  it("treats 'already exists' as success (idempotent restart)", async () => {
    mockExecFileFn.mockImplementation((_file, args, _opts, cb) => {
      const resolved = (args ?? []) as string[];
      const nameIdx = resolved.indexOf("--name");
      const name = resolved[nameIdx + 1];
      const child = makeMockChild();
      if (name === "cli_existing") {
        process.nextTick(
          () =>
            (cb as (err: Error, stdout: string, stderr: string) => void)(
              new Error("exit 1"),
              "",
              "Error: profile already exists",
            ),
        );
      } else {
        process.nextTick(() => (cb as () => void)());
      }
      return child;
    });

    const result = await registerLarkCliProfiles([
      { name: "default", appId: "cli_1", appSecret: "s1", brand: "feishu" },
      { name: "cli_existing", appId: "cli_existing", appSecret: "s2", brand: "feishu" },
    ]);

    expect(result.registered).toEqual(["default", "cli_existing"]);
    expect(result.failed).toEqual([]);
  });

  it("reports failed registrations", async () => {
    mockExecFileFn.mockImplementation((_file, args, _opts, cb) => {
      const resolved = (args ?? []) as string[];
      const nameIdx = resolved.indexOf("--name");
      const name = resolved[nameIdx + 1];
      const child = makeMockChild();
      if (name === "cli_bad") {
        process.nextTick(
          () =>
            (cb as (err: Error, stdout: string, stderr: string) => void)(
              new Error("duplicate"),
              "",
              "duplicate profile",
            ),
        );
      } else {
        process.nextTick(() => (cb as () => void)());
      }
      return child;
    });

    const result = await registerLarkCliProfiles([
      { name: "default", appId: "cli_1", appSecret: "s1", brand: "feishu" },
      { name: "cli_bad", appId: "cli_bad", appSecret: "s2", brand: "feishu" },
    ]);

    expect(result.registered).toEqual(["default"]);
    expect(result.failed).toEqual([{ name: "cli_bad", error: "duplicate profile" }]);
  });

  it("restores user profiles lost during registration", async () => {
    const userConfig = {
      apps: [
        {
          appId: "cli_user_manual",
          appSecret: { source: "keychain", id: "appsecret:cli_user_manual" },
          brand: "feishu",
          users: [{ userOpenId: "ou_123", userName: "TestUser" }],
        },
      ],
    };

    // Config exists before and after profile add
    mockFs.existsSync.mockReturnValue(true);
    // First read: snapshot has user profile. Second read: lark-cli dropped it.
    mockFs.readFileSync
      .mockReturnValueOnce(JSON.stringify(userConfig))
      .mockReturnValueOnce(JSON.stringify({ apps: [] }));

    setupSuccessMock();

    const result = await registerLarkCliProfiles([
      { name: "default", appId: "cli_default", appSecret: "s1", brand: "feishu" },
    ]);

    expect(result.registered).toEqual(["default"]);
    // Should have written config with the user profile restored
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      CONFIG_PATH,
      expect.any(String),
      "utf-8",
    );
    const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
    expect(written.apps).toHaveLength(1);
    expect(written.apps[0].appId).toBe("cli_user_manual");
  });

  it("does not restore managed profiles that were intentionally updated", async () => {
    const beforeConfig = {
      apps: [
        {
          name: "default",
          appId: "cli_old_default",
          appSecret: { source: "keychain", id: "appsecret:cli_old_default" },
          brand: "feishu",
        },
      ],
    };

    mockFs.existsSync.mockReturnValue(true);
    // After profile add, the "default" profile is updated with new appId
    mockFs.readFileSync
      .mockReturnValueOnce(JSON.stringify(beforeConfig))
      .mockReturnValueOnce(
        JSON.stringify({
          apps: [
            {
              name: "default",
              appId: "cli_new_default",
              brand: "feishu",
            },
          ],
        }),
      );

    setupSuccessMock();

    const result = await registerLarkCliProfiles([
      { name: "default", appId: "cli_new_default", appSecret: "s1", brand: "feishu" },
    ]);

    expect(result.registered).toEqual(["default"]);
    // Should NOT have written — no profiles to restore
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it("handles corrupt config.json gracefully", async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync
      .mockReturnValueOnce("not json at all")
      .mockReturnValueOnce("also not json");

    setupSuccessMock();

    const result = await registerLarkCliProfiles([
      { name: "default", appId: "cli_1", appSecret: "s1", brand: "feishu" },
    ]);

    expect(result.registered).toEqual(["default"]);
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it("handles missing config.json gracefully", async () => {
    mockFs.existsSync.mockReturnValue(false);

    setupSuccessMock();

    const result = await registerLarkCliProfiles([
      { name: "default", appId: "cli_1", appSecret: "s1", brand: "feishu" },
    ]);

    expect(result.registered).toEqual(["default"]);
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });
});
