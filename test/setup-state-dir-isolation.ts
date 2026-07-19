import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.KAIJIBOT_STATE_DIR && !process.env.KAIJIBOT_CONFIG_PATH) {
  const tempStateDir = mkdtempSync(join(tmpdir(), "kaijibot-vitest-"));
  process.env.KAIJIBOT_STATE_DIR = tempStateDir;
}
