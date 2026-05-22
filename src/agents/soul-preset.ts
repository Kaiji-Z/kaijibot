import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SoulPreset } from "../config/types.soul.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// tsdown bundles to dist/ root, so __dirname may be dist/ (not dist/agents/).
// Try sibling "soul-presets" first (bundle in dist/), then parent-relative (src/agents/).
const PRESETS_DIR = existsSync(join(__dirname, "soul-presets"))
  ? join(__dirname, "soul-presets")
  : join(__dirname, "..", "soul-presets");

export function loadSoulPresetContent(preset: SoulPreset): string {
  const filePath = join(PRESETS_DIR, `${preset}.md`);
  return readFileSync(filePath, "utf-8");
}
