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
  it("maps domain to brand and sets bot defaults", () => {
    const env = buildLarkCliEnv({ domain: "feishu.cn" });

    expect(env.LARKSUITE_CLI_BRAND).toBe("feishu");
    expect(env.LARKSUITE_CLI_STRICT_MODE).toBe("bot");
    expect(env.LARKSUITE_CLI_DEFAULT_AS).toBe("bot");
  });

  it("returns only defaults when config is empty", () => {
    const env = buildLarkCliEnv({});

    expect(env.LARKSUITE_CLI_BRAND).toBeUndefined();
    expect(env.LARKSUITE_CLI_STRICT_MODE).toBe("bot");
    expect(env.LARKSUITE_CLI_DEFAULT_AS).toBe("bot");
  });

  it("maps larksuite.com domain to 'lark' brand", () => {
    const env = buildLarkCliEnv({ domain: "larksuite.com" });

    expect(env.LARKSUITE_CLI_BRAND).toBe("lark");
  });

  it("never sets credential env vars", () => {
    const env = buildLarkCliEnv({ domain: "feishu.cn" });

    expect(
      Object.keys(env).some((k) => k.includes("APP_ID") || k.includes("APP_SECRET")),
    ).toBe(false);
  });
});
