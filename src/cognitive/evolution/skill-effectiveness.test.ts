import { describe, it, expect } from "vitest";
import { EffectivenessStore } from "./skill-effectiveness.js";

describe("EffectivenessStore", () => {
  it("records baseline tool counts per domain", () => {
    const store = new EffectivenessStore("/tmp/test-eff-" + Date.now());
    store.recordBaseline("feishu", 8);
    store.recordBaseline("feishu", 6);
    expect(store.getBaselineMedian("feishu")).toBe(7);
  });

  it("records skill-use samples with delta", () => {
    const store = new EffectivenessStore("/tmp/test-eff2-" + Date.now());
    store.recordBaseline("feishu", 10);
    store.recordSkillUse("meeting-archive", "feishu", 4);
    const signal = store.getEffectivenessSignal("meeting-archive");
    expect(signal.sampleCount).toBe(1);
    expect(signal.avgDelta).toBe(6); // baseline 10 - actual 4 = delta 6 (positive = helpful)
  });

  it("returns empty signal for unknown skill", () => {
    const store = new EffectivenessStore("/tmp/test-eff3-" + Date.now());
    const signal = store.getEffectivenessSignal("unknown");
    expect(signal.sampleCount).toBe(0);
  });
});
