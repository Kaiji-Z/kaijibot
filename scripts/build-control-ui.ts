import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const viteBin = path.resolve(repoRoot, "node_modules", ".bin", "vite");
const result = spawnSync(process.execPath, [viteBin, "build"], {
  cwd: path.resolve(repoRoot, "ui"),
  stdio: "inherit",
  env: process.env,
});

const indexPath = path.resolve(repoRoot, "dist", "control-ui", "index.html");

if (existsSync(indexPath)) {
  console.log("[build-control-ui] Control UI built successfully.");
  process.exit(0);
}

console.error("[build-control-ui] Build failed — index.html not found.");
process.exit(result.status ?? 1);
