import { afterEach, describe, expect, it, vi } from "vitest";
import { importFreshModule } from "../../test/helpers/import-fresh.js";

type LoggerModule = typeof import("./logger.js");

const originalGetBuiltinModule = (
  process as NodeJS.Process & { getBuiltinModule?: (id: string) => unknown }
).getBuiltinModule;

async function importBrowserSafeLogger(params?: {
  resolvePreferredKaijiBotTmpDir?: ReturnType<typeof vi.fn>;
}): Promise<{
  module: LoggerModule;
  resolvePreferredKaijiBotTmpDir: ReturnType<typeof vi.fn>;
}> {
  const resolvePreferredKaijiBotTmpDir =
    params?.resolvePreferredKaijiBotTmpDir ??
    vi.fn(() => {
      throw new Error("resolvePreferredKaijiBotTmpDir should not run during browser-safe import");
    });

  vi.doMock("../infra/tmp-kaijibot-dir.js", async () => {
    const actual = await vi.importActual<typeof import("../infra/tmp-kaijibot-dir.js")>(
      "../infra/tmp-kaijibot-dir.js",
    );
    return {
      ...actual,
      resolvePreferredKaijiBotTmpDir,
    };
  });

  Object.defineProperty(process, "getBuiltinModule", {
    configurable: true,
    value: undefined,
  });

  const module = await importFreshModule<LoggerModule>(
    import.meta.url,
    "./logger.js?scope=browser-safe",
  );
  return { module, resolvePreferredKaijiBotTmpDir };
}

describe("logging/logger browser-safe import", () => {
  afterEach(() => {
    vi.doUnmock("../infra/tmp-kaijibot-dir.js");
    Object.defineProperty(process, "getBuiltinModule", {
      configurable: true,
      value: originalGetBuiltinModule,
    });
  });

  it("does not resolve the preferred temp dir at import time when node fs is unavailable", async () => {
    const { module, resolvePreferredKaijiBotTmpDir } = await importBrowserSafeLogger();

    expect(resolvePreferredKaijiBotTmpDir).not.toHaveBeenCalled();
    expect(module.DEFAULT_LOG_DIR).toBe("/tmp/kaijibot");
    expect(module.DEFAULT_LOG_FILE).toBe("/tmp/kaijibot/kaijibot.log");
  });

  it("disables file logging when imported in a browser-like environment", async () => {
    const { module, resolvePreferredKaijiBotTmpDir } = await importBrowserSafeLogger();

    expect(module.getResolvedLoggerSettings()).toMatchObject({
      level: "silent",
      file: "/tmp/kaijibot/kaijibot.log",
    });
    expect(module.isFileLogLevelEnabled("info")).toBe(false);
    expect(() => module.getLogger().info("browser-safe")).not.toThrow();
    expect(resolvePreferredKaijiBotTmpDir).not.toHaveBeenCalled();
  });
});
