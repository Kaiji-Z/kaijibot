import fs from "node:fs";
import path from "node:path";
import { ensureDirectory, logVerboseCopy, resolveBuildCopyContext } from "./lib/copy-assets.ts";

const context = resolveBuildCopyContext(import.meta.url);

const srcDir = path.join(context.projectRoot, "src", "cli", "soul-presets");
const distDir = path.join(context.projectRoot, "dist", "soul-presets");

function copySoulPresets() {
  if (!fs.existsSync(srcDir)) {
    console.warn(`${context.prefix} Source directory not found:`, srcDir);
    return;
  }

  ensureDirectory(distDir);

  const entries = fs.readdirSync(srcDir).filter((f) => f.endsWith(".md"));
  let copiedCount = 0;

  for (const file of entries) {
    const src = path.join(srcDir, file);
    const dest = path.join(distDir, file);
    fs.copyFileSync(src, dest);
    copiedCount += 1;
    logVerboseCopy(context, `Copied ${file}`);
  }

  console.log(`${context.prefix} Copied ${copiedCount} soul preset files.`);
}

copySoulPresets();
