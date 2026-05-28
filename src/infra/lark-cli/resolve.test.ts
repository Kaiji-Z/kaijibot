import { describe, expect, it } from "vitest";
import { buildLarkCliEnv } from "./env.ts";
import { resolveLarkCliPath, isLarkCliAvailable } from "./resolve.ts";

describe("resolveLarkCliPath", () => {
  it("returns a string when @larksuite/cli is installed", () => {
    const path = resolveLarkCliPath();
    expect(typeof path).toBe("string");
    expect(path!.length).toBeGreaterThan(0);
    expect(path).toContain("run.js");
  });
});

describe("isLarkCliAvailable", () => {
  it("returns true when @larksuite/cli is installed", () => {
    expect(isLarkCliAvailable()).toBe(true);
  });
});

describe("buildLarkCliEnv", () => {
  it("maps feishu config fields to env vars", () => {
    const env = buildLarkCliEnv({
      appId: "cli_test123",
      appSecret: "secret456",
      domain: "feishu.cn",
    });

    expect(env.LARKSUITE_CLI_APP_ID).toBe("cli_test123");
    expect(env.LARKSUITE_CLI_APP_SECRET).toBe("secret456");
    expect(env.LARKSUITE_CLI_BRAND).toBe("feishu");
    expect(env.LARKSUITE_CLI_STRICT_MODE).toBe("bot");
    expect(env.LARKSUITE_CLI_DEFAULT_AS).toBe("bot");
  });

  it("returns only defaults when config is empty", () => {
    const env = buildLarkCliEnv({});

    expect(env.LARKSUITE_CLI_APP_ID).toBeUndefined();
    expect(env.LARKSUITE_CLI_APP_SECRET).toBeUndefined();
    expect(env.LARKSUITE_CLI_BRAND).toBeUndefined();
    expect(env.LARKSUITE_CLI_STRICT_MODE).toBe("bot");
    expect(env.LARKSUITE_CLI_DEFAULT_AS).toBe("bot");
  });

  it("maps larksuite.com domain to 'lark' brand", () => {
    const env = buildLarkCliEnv({ domain: "larksuite.com" });

    expect(env.LARKSUITE_CLI_BRAND).toBe("lark");
  });

  it("does not include undefined/empty fields", () => {
    const env = buildLarkCliEnv({ appId: "", appSecret: undefined });

    expect(env.LARKSUITE_CLI_APP_ID).toBeUndefined();
    expect(env.LARKSUITE_CLI_APP_SECRET).toBeUndefined();
  });
});
