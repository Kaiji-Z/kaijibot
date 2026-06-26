import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from "node:child_process";import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { confirm, isCancel } from "@clack/prompts";
import { writeTextAtomic } from "../infra/json-files.js";
import type { OutputRuntimeEnv } from "../runtime.js";
import { theme } from "../terminal/theme.js";

export type AndroidInstallOptions = {
  nonInteractive?: boolean;
};

const REQUIRED_PACKAGES = ["imagemagick", "ffmpeg"] as const;
const MIN_NODE_MAJOR = 22;
const GATEWAY_PORT = 18789;
const BOOT_SCRIPT_MODE = 0o755;
const PROPS_FILE_MODE = 0o600;

const BOOT_SCRIPT_BODY = [
  "#!/data/data/com.termux/files/usr/bin/bash",
  "termux-wake-lock",
  `kaijibot gateway --port ${GATEWAY_PORT} >> ~/.kaijibot/gateway.log 2>&1 &`,
  "",
].join("\n");

const DEFAULT_SPAWN_OPTIONS: SpawnSyncOptions = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };

export async function runAndroidInstall(
  runtime: OutputRuntimeEnv,
  opts: AndroidInstallOptions = {},
): Promise<void> {
  runtime.log(theme.heading("KaijiBot Android/Termux Setup"));
  runtime.log("");

  if (!isTermux()) {
    runtime.error(
      "This command must be run inside Termux on Android (process.platform must be \"android\" with a Termux PREFIX).",
    );
    runtime.exit(1);
    return;
  }

  await ensureNode(runtime);
  await ensureRequiredPackages(runtime);
  await ensureKaijiBot(runtime);
  await installSharpWasm32(runtime);
  await writeBootScript(runtime);
  checkTermuxBoot(runtime);
  printBatteryOptimization(runtime);
  await ensureAllowExternalApps(runtime);
  await maybeRunOnboard(runtime, opts);
}

function isTermux(): boolean {
  return process.platform === "android" && Boolean(process.env.PREFIX?.includes("com.termux"));
}

function run(cmd: string, args: readonly string[], options: SpawnSyncOptions = {}): SpawnSyncReturns<string | Buffer> {
  return spawnSync(cmd, args as string[], { ...DEFAULT_SPAWN_OPTIONS, ...options });
}

function runText(cmd: string, args: readonly string[], options: SpawnSyncOptions = {}): string {
  const result = run(cmd, args, options);
  if (result.status !== 0 || result.error) {
    return "";
  }
  if (typeof result.stdout === "string") {
    return result.stdout.trim();
  }
  return result.stdout.toString("utf8").trim();
}

function parseNodeMajor(versionText: string): number | null {
  const match = /v?(\d+)\./.exec(versionText);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1]!, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function ensureNode(runtime: OutputRuntimeEnv): Promise<void> {
  const versionText = runText("node", ["--version"]);
  const major = parseNodeMajor(versionText);
  if (major !== null && major >= MIN_NODE_MAJOR) {
    runtime.log(`  ${theme.success("✓")} Node.js ${theme.accent(`v${versionText.replace(/^v/, "")}`)} (>= ${MIN_NODE_MAJOR})`);
    return;
  }

  if (major === null) {
    runtime.log(`  ${theme.warn("→")} Node.js not found. Installing nodejs-lts via pkg...`);
  } else {
    runtime.log(
      `  ${theme.warn("→")} Node.js too old (v${major}). Upgrading to nodejs-lts via pkg...`,
    );
  }

  runPkg(runtime, ["install", "-y", "nodejs-lts"]);
  const refreshed = runText("node", ["--version"]);
  const refreshedMajor = parseNodeMajor(refreshed);
  if (refreshedMajor === null || refreshedMajor < MIN_NODE_MAJOR) {
    runtime.error(
      `Failed to install Node.js ${MIN_NODE_MAJOR}+. Please run ${theme.command("pkg install nodejs-lts")} manually.`,
    );
    runtime.exit(1);
    return;
  }
  runtime.log(`  ${theme.success("✓")} Node.js installed (v${refreshed.replace(/^v/, "")})`);
}

async function ensureRequiredPackages(runtime: OutputRuntimeEnv): Promise<void> {
  for (const pkg of REQUIRED_PACKAGES) {
    const which = runText("which", [pkg]);
    if (which.length > 0) {
      runtime.log(`  ${theme.success("✓")} ${pkg} (${theme.muted(which)})`);
      continue;
    }
    runtime.log(`  ${theme.warn("→")} ${pkg} not found. Installing via pkg...`);
    runPkg(runtime, ["install", "-y", pkg]);
    const recheck = runText("which", [pkg]);
    if (recheck.length === 0) {
      runtime.error(
        `Failed to install ${pkg}. Please run ${theme.command(`pkg install ${pkg}`)} manually.`,
      );
      runtime.exit(1);
      return;
    }
    runtime.log(`  ${theme.success("✓")} ${pkg} installed`);
  }
}

function runPkg(runtime: OutputRuntimeEnv, args: readonly string[]): void {
  const result = spawnSync("pkg", args as string[], { stdio: "inherit" });
  if (result.error || result.status !== 0) {
    runtime.error(`pkg ${args.join(" ")} failed.`);
    runtime.exit(1);
  }
}

async function ensureKaijiBot(runtime: OutputRuntimeEnv): Promise<void> {
  const version = runText("kaijibot", ["--version"]);
  if (version.length > 0) {
    runtime.log(`  ${theme.success("✓")} KaijiBot CLI present (${theme.muted(version)})`);
    runtime.log(`  ${theme.muted("    Reinstalling to ensure latest version...")}`);
  } else {
    runtime.log(`  ${theme.warn("→")} KaijiBot CLI not found. Installing globally via npm...`);
  }

  const install = run("npm", ["install", "-g", "kaijibot", "--force"], { stdio: "inherit" });
  if (install.error || install.status !== 0) {
    runtime.error(
      `Failed to install KaijiBot. Please run ${theme.command("npm install -g kaijibot --force")} manually.`,
    );
    runtime.exit(1);
    return;
  }
  const installed = runText("kaijibot", ["--version"]);
  runtime.log(
    installed.length > 0
      ? `  ${theme.success("✓")} KaijiBot installed (${theme.muted(installed)})`
      : `  ${theme.success("✓")} KaijiBot installed`,
  );
}

async function installSharpWasm32(runtime: OutputRuntimeEnv): Promise<void> {
  runtime.log(`  ${theme.warn("→")} Installing @img/sharp-wasm32 (image processing for Android)...`);
  const result = run("npm", ["install", "-g", "@img/sharp-wasm32", "--force"], { stdio: "inherit" });
  if (result.error || result.status !== 0) {
    runtime.log(
      `  ${theme.warn("⚠")} Could not install @img/sharp-wasm32 (image features may be limited). Retry with ${theme.command("npm install -g @img/sharp-wasm32 --force")}.`,
    );
    return;
  }
  runtime.log(`  ${theme.success("✓")} @img/sharp-wasm32 installed`);
}

async function writeBootScript(runtime: OutputRuntimeEnv): Promise<void> {
  const bootDir = path.join(os.homedir(), ".termux", "boot");
  const bootPath = path.join(bootDir, "start-kaijibot.sh");
  await writeTextAtomic(bootPath, BOOT_SCRIPT_BODY, {
    mode: BOOT_SCRIPT_MODE,
    ensureDirMode: 0o755,
  });
  try {
    await fs.chmod(bootPath, BOOT_SCRIPT_MODE);
  } catch {
    // best-effort; writeTextAtomic already attempted chmod
  }
  runtime.log(`  ${theme.success("✓")} Boot script written: ${theme.accent(bootPath)}`);
}

function checkTermuxBoot(runtime: OutputRuntimeEnv): void {
  const listed = runText("pm", ["list", "packages"]);
  if (listed.includes("com.termux.boot")) {
    runtime.log(`  ${theme.success("✓")} Termux:Boot detected`);
    return;
  }

  runtime.log("");
  runtime.log(theme.heading("Termux:Boot not installed"));
  runtime.log(
    `  ${theme.warn("⚠")} Without Termux:Boot the gateway will NOT auto-start on device reboot.`,
  );
  runtime.log(`  Install it from F-Droid: ${theme.command("https://f-droid.org/packages/com.termux.boot/")}`);
  runtime.log(`  Then open it once and tap "Allow" when it requests permissions.`);
  runtime.log("");
}

function detectManufacturer(): string {
  const raw = runText("getprop", ["ro.product.manufacturer"]);
  return raw.toLowerCase();
}

function printBatteryOptimization(runtime: OutputRuntimeEnv): void {
  const manufacturer = detectManufacturer();
  const instructions = batteryInstructionsFor(manufacturer);

  runtime.log("");
  runtime.log(theme.heading("Battery optimization (manual step required)"));
  runtime.log(`  ${theme.warn("⚠")} Android aggressively kills background apps. Disable battery optimization for both Termux and Termux:Boot, or the gateway will be killed.`);
  runtime.log("");
  runtime.log(`  Detected OEM: ${theme.accent(manufacturer || "unknown")}`);
  for (const line of instructions) {
    runtime.log(`    ${line}`);
  }
  runtime.log("");
}

function batteryInstructionsFor(manufacturer: string): string[] {
  switch (manufacturer) {
    case "xiaomi":
    case "redmi":
      return [
        "Settings → Apps → Termux → Battery saver → No restrictions",
        "Settings → Apps → Termux:Boot → Battery saver → No restrictions",
        "Enable auto-start for both apps: Settings → Permissions → Autostart",
      ];
    case "samsung":
      return [
        "Settings → Apps → Termux → Battery → Unrestricted",
        "Settings → Apps → Termux:Boot → Battery → Unrestricted",
        "Disable \"Put unused apps to sleep\": Settings → Battery → App power management",
      ];
    case "huawei":
    case "honor":
      return [
        "Settings → Battery → App launch → Termux → Manage manually → enable all toggles",
        "Settings → Battery → App launch → Termux:Boot → Manage manually → enable all toggles",
        "Settings → Apps → Termux → Power usage details → Launch → Manage manually",
      ];
    case "vivo":
      return [
        "Settings → Battery → Background Power Consumption Manage → Termux → allow",
        "i Manager → App Manager → Autostart → enable Termux and Termux:Boot",
        "Settings → Battery → High background consumption apps → remove Termux",
      ];
    case "oppo":
    case "oneplus":
    case "realme":
      return [
        "Settings → Battery → Termux → App battery management → Allow auto-launch + Background",
        "Settings → Battery → Termux:Boot → App battery management → Allow auto-launch + Background",
        "Security Center → Privacy permissions → Startup manager → enable both apps",
      ];
    case "google":
    case "pixel":
      return [
        "Settings → Apps → Termux → Battery → Unrestricted",
        "Settings → Apps → Termux:Boot → Battery → Unrestricted",
        "Settings → Battery → Adaptive Battery → toggle off for testing if needed",
      ];
    default:
      return [
        "Settings → Apps → Termux → Battery → Unrestricted / Don't optimize",
        "Settings → Apps → Termux:Boot → Battery → Unrestricted / Don't optimize",
        "If your OEM has a separate \"autostart\" or \"app launch\" menu, enable both apps there.",
      ];
  }
}

async function ensureAllowExternalApps(runtime: OutputRuntimeEnv): Promise<void> {
  const propsPath = path.join(os.homedir(), ".termux", "termux.properties");
  let existing = "";
  try {
    existing = await fs.readFile(propsPath, "utf8");
  } catch {
    existing = "";
  }

  if (/^\s*allow-external-apps\s*=\s*true\s*$/m.test(existing)) {
    runtime.log(`  ${theme.success("✓")} allow-external-apps=true already set`);
    return;
  }

  const appended = existing.length === 0 || existing.endsWith("\n")
    ? `${existing}allow-external-apps=true\n`
    : `${existing}\nallow-external-apps=true\n`;
  await writeTextAtomic(propsPath, appended, { mode: PROPS_FILE_MODE, ensureDirMode: 0o700 });
  runtime.log(`  ${theme.success("✓")} allow-external-apps=true appended to ${theme.accent(propsPath)}`);
  runtime.log(
    `  ${theme.muted("    Reload with: ")}${theme.command("termux-reload-settings")}`,
  );
}

async function maybeRunOnboard(runtime: OutputRuntimeEnv, opts: AndroidInstallOptions): Promise<void> {
  runtime.log("");
  runtime.log(theme.heading("Setup complete!"));
  runtime.log(`  Next: configure your LLM provider and Feishu bot via ${theme.command("kaijibot onboard")}.`);
  runtime.log("");

  if (opts.nonInteractive) {
    runtime.log(`Skipping onboard prompt (non-interactive). Run ${theme.command("kaijibot onboard")} when ready.`);
    return;
  }

  const answer = await confirm({
    message: "Run kaijibot onboard now to configure providers and channels?",
    initialValue: true,
  });
  if (isCancel(answer) || !answer) {
    runtime.log(`You can run ${theme.command("kaijibot onboard")} later.`);
    return;
  }

  const result = run("kaijibot", ["onboard"], { stdio: "inherit" });
  if (result.error || (result.status !== null && result.status !== 0)) {
    runtime.error(`kaijibot onboard exited with an error. You can re-run it manually.`);
  }
}
