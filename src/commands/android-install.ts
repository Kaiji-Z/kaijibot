import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from "node:child_process";
import { accessSync, constants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeTextAtomic } from "../infra/json-files.js";
import type { OutputRuntimeEnv } from "../runtime.js";
import { theme } from "../terminal/theme.js";

export type AndroidInstallOptions = {
  nonInteractive?: boolean;
};

const REQUIRED_PACKAGES: ReadonlyArray<{ pkg: string; binary: string; required: boolean }> = [
  { pkg: "git", binary: "git", required: true },
  { pkg: "lsof", binary: "lsof", required: true },
  { pkg: "imagemagick", binary: "magick", required: false },
  { pkg: "ffmpeg", binary: "ffmpeg", required: true },
];
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

const BASHRC_AUTOSTART_MARKER = "# >>> kaijibot autostart >>>";
const BASHRC_AUTOSTART_END = "# <<< kaijibot autostart <<<";
const BASHRC_AUTOSTART_BODY = [
  BASHRC_AUTOSTART_MARKER,
  'if ! pgrep -f "kaijibot gateway" > /dev/null 2>&1; then',
  "  termux-wake-lock 2>/dev/null",
  `  kaijibot gateway --port ${GATEWAY_PORT} >> ~/.kaijibot/gateway.log 2>&1 &`,
  '  echo "KaijiBot gateway started (port ' + GATEWAY_PORT + ')"',
  "fi",
  BASHRC_AUTOSTART_END,
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

  await switchTermuxMirror(runtime);
  await ensureTermuxUpToDate(runtime);
  await ensureNode(runtime);
  await ensureRequiredPackages(runtime);
  await ensureKaijiBot(runtime);
  await installSharpWasm32(runtime);
  await writeBootScript(runtime);
  await writeBashrcAutostart(runtime);
  checkTermuxBoot(runtime);
  triggerBatteryDialog(runtime);
  printBatteryHint(runtime);
  await ensureAllowExternalApps(runtime);
  await runOnboard(runtime, opts);
  await startGateway(runtime);
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

/**
 * Locate a binary on PATH. Uses `command -v` via shell (POSIX standard)
 * because `which` is not guaranteed to exist on Termux/Android.
 */
function findBinary(name: string): string {
  const result = spawnSync("sh", ["-c", `command -v "${name}"`], DEFAULT_SPAWN_OPTIONS);
  if (result.status === 0 && typeof result.stdout === "string") {
    const found = result.stdout.trim();
    if (found.length > 0) {
      return found;
    }
  }
  // Fallback: check Termux $PREFIX/bin directly (where pkg installs binaries)
  const prefix = process.env.PREFIX;
  if (prefix) {
    const candidate = path.join(prefix, "bin", name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // pkg installs to $PREFIX/bin — binary not present there
    }
  }
  return "";
}

function parseNodeMajor(versionText: string): number | null {
  const match = /v?(\d+)\./.exec(versionText);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1]!, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

const CHINA_TIMEZONES = new Set([
  "Asia/Shanghai",
  "Asia/Chongqing",
  "Asia/Harbin",
  "Asia/Urumqi",
  "Asia/Kashgar",
  "PRC",
  "CTT",
]);

function isChinaTimezone(): boolean {
  const tz = runText("getprop", ["persist.sys.timezone"]);
  return tz.length > 0 && CHINA_TIMEZONES.has(tz);
}

async function switchTermuxMirror(runtime: OutputRuntimeEnv): Promise<void> {
  if (!isChinaTimezone()) {
    runtime.log(`  ${theme.success("✓")} Termux default mirror (non-China timezone)`);
    return;
  }
  const sourcesPath = path.join(process.env.PREFIX ?? "/data/data/com.termux/files/usr", "etc", "apt", "sources.list");
  runtime.log(`  → Setting Termux mirror to TUNA (China)`);
  await writeTextAtomic(
    sourcesPath,
    "deb https://mirrors.tuna.tsinghua.edu.cn/termux/apt/termux-main/ stable main\n",
    { mode: 0o644 },
  );
}

async function ensureTermuxUpToDate(runtime: OutputRuntimeEnv): Promise<void> {
  runtime.log(`  → Updating Termux packages (this may take a few minutes)...`);
  runPkg(runtime, ["update", "-y"]);
  runPkg(runtime, ["upgrade", "-y"]);
  runtime.log(`  ${theme.success("✓")} Termux packages up to date`);
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
  for (const { pkg, binary, required } of REQUIRED_PACKAGES) {
    const found = findBinary(binary);
    if (found.length > 0) {
      runtime.log(`  ${theme.success("✓")} ${pkg} (${theme.muted(found)})`);
      continue;
    }
    runtime.log(`  ${theme.warn("→")} ${pkg} not found. Installing via pkg...`);
    runPkg(runtime, ["install", "-y", pkg]);
    const recheck = findBinary(binary);
    if (recheck.length === 0) {
      if (required) {
        runtime.error(
          `Failed to install ${pkg}. Please run ${theme.command(`pkg install ${pkg}`)} manually.`,
        );
        runtime.exit(1);
        return;
      }
      runtime.log(
        `  ${theme.warn("⚠")} ${pkg} not fully installed (image features may be limited).`,
      );
      continue;
    }
    runtime.log(`  ${theme.success("✓")} ${pkg} installed`);
  }
}

const PKG_CONFFILE_FLAGS = ["-o", "Dpkg::Options::=--force-confold"];

function runPkg(runtime: OutputRuntimeEnv, args: readonly string[]): void {
  const fullArgs = [...args, ...PKG_CONFFILE_FLAGS];
  const result = spawnSync("apt-get", fullArgs, {
    stdio: "inherit",
    env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
  });
  if (result.error || result.status !== 0) {
    runtime.error(`apt-get ${args.join(" ")} failed.`);
    runtime.exit(1);
  }
}

async function ensureKaijiBot(runtime: OutputRuntimeEnv): Promise<void> {
  const version = runText("kaijibot", ["--version"]);
  if (version.length > 0) {
    runtime.log(`  ${theme.success("✓")} KaijiBot CLI present (${theme.muted(version)})`);
    return;
  }
  runtime.log(`  ${theme.warn("→")} KaijiBot CLI not found. Installing via npm...`);
  const install = run("npm", ["install", "-g", "kaijibot", "--force"], { stdio: "inherit" });
  if (install.error || install.status !== 0) {
    runtime.error(`Failed to install KaijiBot. Run ${theme.command("npm install -g kaijibot --force")} manually.`);
    runtime.exit(1);
    return;
  }
  runtime.log(`  ${theme.success("✓")} KaijiBot installed`);
}

async function installSharpWasm32(runtime: OutputRuntimeEnv): Promise<void> {
  runtime.log(`  ${theme.warn("→")} Installing @img/sharp-wasm32 (image processing)...`);
  const registry = isChinaTimezone() ? ["--registry=https://registry.npmmirror.com"] : [];
  const result = run("npm", ["install", "-g", "@img/sharp-wasm32", "--force", ...registry], { stdio: "inherit" });
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

async function writeBashrcAutostart(runtime: OutputRuntimeEnv): Promise<void> {
  const bashrcPath = path.join(os.homedir(), ".bashrc");
  let existing = "";
  try {
    existing = await fs.readFile(bashrcPath, "utf8");
  } catch {
    existing = "";
  }

  if (existing.includes(BASHRC_AUTOSTART_MARKER)) {
    runtime.log(`  ${theme.success("✓")} .bashrc autostart already configured`);
    return;
  }

  const updated = existing.length === 0 || existing.endsWith("\n")
    ? `${existing}${BASHRC_AUTOSTART_BODY}`
    : `${existing}\n${BASHRC_AUTOSTART_BODY}`;
  await writeTextAtomic(bashrcPath, updated, { mode: 0o644 });
  runtime.log(`  ${theme.success("✓")} .bashrc autostart configured (open Termux = gateway starts)`);
}

function triggerBatteryDialog(runtime: OutputRuntimeEnv): void {
  runtime.log(`  ${theme.warn("→")} Opening battery optimization settings...`);
  const result = spawnSync(
    "am",
    ["start", "-a", "android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS", "-d", "package:com.termux"],
    { stdio: "ignore" },
  );
  if (result.status === 0) {
    runtime.log(`  ${theme.success("✓")} Battery settings opened — tap "Allow"`);
  } else {
    runtime.log(`  ${theme.warn("⚠")} Could not auto-open settings. See manual steps below.`);
  }
}

function printBatteryHint(runtime: OutputRuntimeEnv): void {
  const manufacturer = detectManufacturer();
  const instructions = batteryInstructionsFor(manufacturer);
  runtime.log(`  ${theme.muted(`OEM: ${manufacturer || "unknown"} — if the dialog didn't open, manually:`)}`);
  for (const line of instructions) {
    runtime.log(`    ${line}`);
  }
  runtime.log("");
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

async function runOnboard(runtime: OutputRuntimeEnv, opts: AndroidInstallOptions): Promise<void> {
  runtime.log("");
  runtime.log(theme.heading("Starting onboard wizard..."));
  runtime.log(`  ${theme.muted("Configure your LLM API key and Feishu bot.")}`);

  if (opts.nonInteractive) {
    runtime.log(`  Skipping onboard (--non-interactive). Run ${theme.command("kaijibot onboard")} later.`);
    return;
  }

  const result = run("kaijibot", ["onboard"], { stdio: "inherit" });
  if (result.error || (result.status !== null && result.status !== 0)) {
    runtime.log(`  ${theme.warn("⚠")} onboard exited with an error. Re-run: ${theme.command("kaijibot onboard")}`);
  }
}

async function startGateway(runtime: OutputRuntimeEnv): Promise<void> {
  runtime.log("");
  runtime.log(theme.heading("Starting Gateway..."));

  const existingPid = runText("pgrep", ["-f", "kaijibot"]);
  if (existingPid.length > 0) {
    runtime.log(`  Stopping existing gateway (PID ${existingPid})...`);
    run("bash", ["-c", "pkill -f kaijibot-gateway 2>/dev/null; pkill -f 'kaijibot gateway' 2>/dev/null"]);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    runtime.log(`  ${theme.success("✓")} Stopped old gateway`);
  }

  spawnSync("termux-wake-lock", [], { stdio: "ignore" });
  const logPath = path.join(os.homedir(), ".kaijibot", "gateway.log");
  spawnSync("bash", ["-c", `nohup kaijibot gateway --port ${GATEWAY_PORT} >> "${logPath}" 2>&1 &`], {
    stdio: "ignore",
  });
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const alive = runText("pgrep", ["-f", "kaijibot"]);
  if (alive.length > 0) {
    runtime.log(`  ${theme.success("✓")} Gateway started on port ${GATEWAY_PORT}`);
    runtime.log(`  ${theme.muted("    Logs: tail -f ~/.kaijibot/gateway.log")}`);
  } else {
    runtime.log(`  ${theme.warn("⚠")} Gateway may not have started. Check logs:`);
    runtime.log(`  ${theme.muted("    tail -20 ~/.kaijibot/gateway.log")}`);
    runtime.log(`  ${theme.muted(`    Or start manually: kaijibot gateway --port ${GATEWAY_PORT}`)}`);
  }
}
