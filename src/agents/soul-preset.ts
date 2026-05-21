import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SoulPreset } from "../config/types.soul.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Build copies presets to dist/soul-presets/ (not dist/agents/soul-presets/),
// so we need to go up one level from __dirname (dist/agents/) to reach dist/soul-presets/.
const PRESETS_DIR = join(__dirname, "..", "soul-presets");

export function loadSoulPresetContent(preset: SoulPreset): string {
  const filePath = join(PRESETS_DIR, `${preset}.md`);
  return readFileSync(filePath, "utf-8");
}
