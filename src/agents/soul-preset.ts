import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SoulPreset } from "../config/types.soul.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRESETS_DIR = join(__dirname, "soul-presets");

export function loadSoulPresetContent(preset: SoulPreset): string {
  const filePath = join(PRESETS_DIR, `${preset}.md`);
  return readFileSync(filePath, "utf-8");
}
