import { vi } from "vitest";
import { installChromeUserDataDirHooks } from "./chrome-user-data-dir.test-harness.js";

const chromeUserDataDir = { dir: "/tmp/kaijibot" };
installChromeUserDataDirHooks(chromeUserDataDir);

vi.mock("./chrome.js", () => ({
  isChromeCdpReady: vi.fn(async () => true),
  isChromeReachable: vi.fn(async () => true),
  launchKaijiBotChrome: vi.fn(async () => {
    throw new Error("unexpected launch");
  }),
  resolveKaijiBotUserDataDir: vi.fn(() => chromeUserDataDir.dir),
  stopKaijiBotChrome: vi.fn(async () => {}),
}));
