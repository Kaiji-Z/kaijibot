import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeJsonAtomic } from "../../infra/json-files.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("cognitive/evolution/effectiveness");

/**
 * Maximum baseline samples kept per domain. Older values are discarded.
 */
const MAX_BASELINE_SAMPLES = 5;

/**
 * Shape of a single skill-use observation. `delta` is positive when the skill
 * reduced tool calls relative to the domain baseline (i.e. the skill helped).
 */
export type SkillUseSample = {
  skillName: string;
  domain: string;
  toolCount: number;
  baselineAtUse: number | null;
  delta: number;
  timestamp: number;
};

/**
 * Serialized persistence shape.
 */
type EffectivenessData = {
  baselines: Record<string, number[]>;
  samples: SkillUseSample[];
};

/**
 * Effectiveness signal returned to consumers.
 * - `avgDelta > 0` → skill reduced tool calls on average (helpful)
 * - `avgDelta <= 0` → skill did not reduce tool calls
 * - `sampleCount === 0` → no data for this skill
 */
export type EffectivenessSignal = {
  avgDelta: number;
  sampleCount: number;
};

const EFFECTIVENESS_FILE = join("cognitive", "evolution", "effectiveness.json");

/**
 * Tracks whether skills actually reduce tool-call complexity for subsequent
 * similar tasks. Maintains a rolling baseline (last 5 values, median) per
 * domain and records skill-use samples with the delta against that baseline.
 *
 * The public mutation/query methods are synchronous so they can be called
 * from synchronous post-turn hooks. Persistence is fire-and-forget via
 * `writeJsonAtomic` — the in-memory state is authoritative during the
 * process lifetime and lazily loaded from disk on first access.
 */
export class EffectivenessStore {
  private readonly baselines = new Map<string, number[]>();
  private samples: SkillUseSample[] = [];
  private loaded = false;

  constructor(private readonly configDir: string) {}

  private filePath(): string {
    return join(this.configDir, EFFECTIVENESS_FILE);
  }

  /**
   * Synchronously load from disk on first access. Subsequent calls are no-ops.
   * Uses sync fs because the public API is synchronous.
   */
  private ensureLoaded(): void {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    const path = this.filePath();
    if (!existsSync(path)) {
      return;
    }
    try {
      const raw = readFileSync(path, "utf-8");
      const data = JSON.parse(raw) as Partial<EffectivenessData>;
      if (data.baselines && typeof data.baselines === "object") {
        for (const [domain, values] of Object.entries(data.baselines)) {
          if (Array.isArray(values)) {
            this.baselines.set(
              domain,
              values.filter((v) => typeof v === "number"),
            );
          }
        }
      }
      if (Array.isArray(data.samples)) {
        this.samples = data.samples.filter(isValidSample);
      }
    } catch (err) {
      log.debug("failed to load effectiveness data", { error: String(err) });
    }
  }

  /**
   * Fire-and-forget persistence of the full current state.
   */
  private persist(): void {
    const data: EffectivenessData = {
      baselines: Object.fromEntries(this.baselines),
      samples: this.samples,
    };
    void writeJsonAtomic(this.filePath(), data).catch((err) => {
      log.debug("failed to persist effectiveness data", { error: String(err) });
    });
  }

  /**
   * Record a baseline tool-count observation for a domain.
   * Keeps the last {@link MAX_BASELINE_SAMPLES} values.
   */
  recordBaseline(domain: string, toolCount: number): void {
    this.ensureLoaded();
    const key = domain.toLowerCase().trim();
    const list = this.baselines.get(key) ?? [];
    list.push(toolCount);
    while (list.length > MAX_BASELINE_SAMPLES) {
      list.shift();
    }
    this.baselines.set(key, list);
    this.persist();
  }

  /**
   * Get the median baseline tool-count for a domain, or `null` if no data.
   */
  getBaselineMedian(domain: string): number | null {
    this.ensureLoaded();
    const key = domain.toLowerCase().trim();
    const list = this.baselines.get(key);
    if (!list || list.length === 0) {
      return null;
    }
    return median(list);
  }

  /**
   * Record a skill-use observation. The delta is computed against the current
   * domain baseline median (positive = skill reduced tool calls).
   */
  recordSkillUse(skillName: string, domain: string, toolCount: number): void {
    this.ensureLoaded();
    const baseline = this.getBaselineMedian(domain);
    const delta = baseline !== null ? baseline - toolCount : 0;
    this.samples.push({
      skillName,
      domain: domain.toLowerCase().trim(),
      toolCount,
      baselineAtUse: baseline,
      delta,
      timestamp: Date.now(),
    });
    this.persist();
  }

  /**
   * Get the effectiveness signal for a skill: average delta and sample count.
   * Returns `{ avgDelta: 0, sampleCount: 0 }` for skills with no data.
   */
  getEffectivenessSignal(skillName: string): EffectivenessSignal {
    this.ensureLoaded();
    const relevant = this.samples.filter((s) => s.skillName === skillName);
    if (relevant.length === 0) {
      return { avgDelta: 0, sampleCount: 0 };
    }
    const sum = relevant.reduce((acc, s) => acc + s.delta, 0);
    return { avgDelta: sum / relevant.length, sampleCount: relevant.length };
  }
}

/**
 * Compute the median of a list of numbers.
 * For even-length lists, returns the average of the two middle values.
 */
function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function isValidSample(value: unknown): value is SkillUseSample {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.skillName === "string" &&
    typeof obj.domain === "string" &&
    typeof obj.toolCount === "number" &&
    typeof obj.delta === "number" &&
    typeof obj.timestamp === "number"
  );
}
