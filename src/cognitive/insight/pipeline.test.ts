import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Fragment, FragmentCluster } from "./fragment-types.js";
import { createDefaultFragment } from "./fragment-types.js";
import { FragmentStore } from "./fragment-store.js";
import { createPipelineDeps } from "./pipeline.js";
import type { PipelineDeps } from "./pipeline.js";

// ─── Helpers ───

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "pipeline-test-"));
}

function makeFragment(overrides: Partial<Fragment> & Pick<Fragment, "userId">): Fragment {
  return createDefaultFragment({
    kind: "assumption",
    evidence: "test evidence",
    domains: ["testing", "cognition"],
    structuralTag: "test-tag",
    ...overrides,
  });
}

// ─── Tests ───

describe("createPipelineDeps", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns correct shape with all required keys", () => {
    const deps = createPipelineDeps(tmpDir);

    expect(deps).toHaveProperty("collector");
    expect(deps).toHaveProperty("loadFragments");
    expect(deps).toHaveProperty("addFragment");
    expect(deps).toHaveProperty("findClusters");

    expect(typeof deps.loadFragments).toBe("function");
    expect(typeof deps.addFragment).toBe("function");
    expect(typeof deps.findClusters).toBe("function");
    expect(typeof deps.collector).toBe("object");
    expect(typeof deps.collector.complete).toBe("function");
    expect(typeof deps.collector.prepareModel).toBe("function");
  });

  it("creates an internal FragmentStore when none is provided", async () => {
    const deps = createPipelineDeps(tmpDir);
    const fragment = makeFragment({ userId: "user-1" });

    const result = await deps.addFragment("user-1", fragment);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(fragment.id);

    const loaded = await deps.loadFragments("user-1");
    expect(loaded).toHaveLength(1);
    expect(loaded[0].structuralTag).toBe("test-tag");
  });

  it("uses the provided external FragmentStore", async () => {
    const store = new FragmentStore(tmpDir);
    const deps = createPipelineDeps(tmpDir, store);

    const fragment = makeFragment({ userId: "user-ext" });
    await deps.addFragment("user-ext", fragment);

    // Verify through the store directly — same instance used
    const direct = await store.load("user-ext");
    expect(direct).toHaveLength(1);
    expect(direct[0].id).toBe(fragment.id);
  });

  it("delegates loadFragments to the FragmentStore", async () => {
    const deps = createPipelineDeps(tmpDir);

    // No fragments yet → empty array
    const empty = await deps.loadFragments("user-empty");
    expect(empty).toEqual([]);

    // Add and reload
    const fragment = makeFragment({ userId: "user-empty" });
    await deps.addFragment("user-empty", fragment);

    const loaded = await deps.loadFragments("user-empty");
    expect(loaded).toHaveLength(1);
  });

  it("delegates addFragment with dedup by structuralTag + domains", async () => {
    const deps = createPipelineDeps(tmpDir);
    const userId = "user-dedup";

    const f1 = makeFragment({ userId, structuralTag: "dup-tag", strength: 0.3 });
    const f2 = makeFragment({ userId, structuralTag: "dup-tag", strength: 0.7 });

    await deps.addFragment(userId, f1);
    const result = await deps.addFragment(userId, f2);

    // Same structuralTag + domains → dedup, keeps stronger
    expect(result).toHaveLength(1);
    expect(result[0].strength).toBeGreaterThanOrEqual(0.5);
  });

  it("delegates findClusters to the FragmentStore", async () => {
    const deps = createPipelineDeps(tmpDir);
    const userId = "user-cluster";

    // Need ≥2 fragments sharing ≥1 domain, ≥2 domains total
    const f1 = makeFragment({ userId, domains: ["domain-a", "domain-b"], strength: 0.6 });
    const f2 = makeFragment({ userId, domains: ["domain-a", "domain-c"], strength: 0.7 });

    await deps.addFragment(userId, f1);
    await deps.addFragment(userId, f2);

    const clusters: FragmentCluster[] = await deps.findClusters(userId);
    expect(clusters.length).toBeGreaterThanOrEqual(1);

    const cluster = clusters[0];
    expect(cluster.fragmentIds).toHaveLength(2);
    expect(cluster.domains).toContain("domain-a");
    expect(cluster.averageStrength).toBeGreaterThan(0);
  });

  it("returns empty clusters when insufficient fragments", async () => {
    const deps = createPipelineDeps(tmpDir);

    // Single fragment → no clusters possible
    const f = makeFragment({ userId: "user-sparse", strength: 0.8 });
    await deps.addFragment("user-sparse", f);

    const clusters = await deps.findClusters("user-sparse");
    expect(clusters).toEqual([]);
  });
});
