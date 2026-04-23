import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { Fragment, FragmentCluster, FragmentStoreFile } from "./fragment-types.js";
import { isFragmentExpired, computeFragmentDecay } from "./fragment-types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("cognitive/fragment-store");
const FRAGMENTS_DIR = "cognitive/fragments";

export class FragmentStore {
  constructor(private readonly configDir: string) {}

  private cache = new Map<string, { fragments: Fragment[]; loadedAt: number }>();
  private static CACHE_TTL_MS = 60_000;

  private filePath(userId: string): string {
    return join(this.configDir, FRAGMENTS_DIR, `${userId}.json`);
  }

  private pruneAndDecay(fragments: Fragment[]): Fragment[] {
    const now = Date.now();
    return fragments
      .filter(f => !isFragmentExpired(f, now))
      .map(f => ({ ...f, strength: computeFragmentDecay(f, now) }));
  }

  async load(userId: string): Promise<Fragment[]> {
    const cached = this.cache.get(userId);
    if (cached && Date.now() - cached.loadedAt < FragmentStore.CACHE_TTL_MS) {
      return this.pruneAndDecay(cached.fragments);
    }

    const path = this.filePath(userId);
    if (!existsSync(path)) return [];

    try {
      const raw = await readFile(path, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        (parsed as Record<string, unknown>).version !== 1 ||
        !Array.isArray((parsed as Record<string, unknown>).fragments)
      ) {
        return [];
      }
      const fragments = this.pruneAndDecay((parsed as FragmentStoreFile).fragments);
      this.cache.set(userId, { fragments: (parsed as FragmentStoreFile).fragments, loadedAt: Date.now() });
      return fragments;
    } catch (err) {
      log.warn("Failed to load fragments", { userId, error: String(err) });
      return [];
    }
  }

  async save(userId: string, fragments: Fragment[]): Promise<void> {
    const dir = join(this.configDir, FRAGMENTS_DIR);
    await mkdir(dir, { recursive: true });
    const targetPath = this.filePath(userId);
    const tmpPath = join(tmpdir(), `kaijibot-fragments-${randomUUID()}.json`);
    const payload: FragmentStoreFile = { version: 1, fragments };
    await writeFile(tmpPath, JSON.stringify(payload, null, 2), "utf-8");
    await rename(tmpPath, targetPath);
    this.cache.set(userId, { fragments, loadedAt: Date.now() });
  }

  async addFragment(userId: string, fragment: Fragment): Promise<Fragment[]> {
    const existing = await this.load(userId);
    const domainKey = (domains: string[]) => [...domains].sort().join(",");
    const dupIdx = existing.findIndex(f =>
      f.structuralTag === fragment.structuralTag && domainKey(f.domains) === domainKey(fragment.domains)
    );
    if (dupIdx >= 0) {
      const dup = existing[dupIdx];
      if (fragment.strength > dup.strength) {
        existing[dupIdx] = {
          ...fragment,
          evidence: dup.evidence.length >= fragment.evidence.length ? dup.evidence : fragment.evidence,
        };
      } else {
        existing[dupIdx] = {
          ...dup,
          evidence: dup.evidence.length >= fragment.evidence.length ? dup.evidence : fragment.evidence,
        };
      }
    } else {
      existing.push(fragment);
    }
    await this.save(userId, existing);
    return existing;
  }

  async findClusters(userId: string): Promise<FragmentCluster[]> {
    const fragments = await this.load(userId);
    if (fragments.length === 0) return [];

    // Union-find for domain-overlap clustering
    const parent = new Map<string, string>();
    const fragmentDomains = new Map<string, Set<string>>();

    const find = (id: string): string => {
      let root = id;
      while (parent.get(root) !== root) {
        const p = parent.get(root)!;
        parent.set(root, parent.get(p) ?? p);
        root = p;
      }
      return root;
    };

    const union = (a: string, b: string): void => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };

    // Pre-filter: build domain → fragment IDs index for overlap detection
    const domainToFragments = new Map<string, string[]>();
    for (const f of fragments) {
      parent.set(f.id, f.id);
      const domains = new Set(f.domains);
      fragmentDomains.set(f.id, domains);
      for (const d of f.domains) {
        const list = domainToFragments.get(d);
        if (list) list.push(f.id);
        else domainToFragments.set(d, [f.id]);
      }
    }

    // Union fragments sharing ≥1 domain
    for (const [_domain, ids] of domainToFragments) {
      for (let i = 1; i < ids.length; i++) {
        union(ids[0], ids[i]);
      }
    }

    // Group by root
    const groups = new Map<string, string[]>();
    for (const f of fragments) {
      const root = find(f.id);
      const group = groups.get(root);
      if (group) group.push(f.id);
      else groups.set(root, [f.id]);
    }

    const fragmentMap = new Map(fragments.map(f => [f.id, f]));
    const clusters: FragmentCluster[] = [];

    for (const [_root, ids] of groups) {
      const groupFragments = ids.map(id => fragmentMap.get(id)!);
      const allDomains = new Set<string>();
      let tensionCount = 0;
      let strengthSum = 0;

      for (const f of groupFragments) {
        for (const d of f.domains) allDomains.add(d);
        if (f.kind === "unresolved_tension" || f.kind === "contradictory_positions") {
          tensionCount++;
        }
        strengthSum += f.strength;
      }

      const avgStrength = strengthSum / groupFragments.length;

      // Pre-filter: ≥2 fragments AND (≥2 domains OR ≥1 tension fragment) AND avg strength ≥ 0.3
      if (groupFragments.length < 2) continue;
      if (allDomains.size < 2 && tensionCount < 1) continue;
      if (avgStrength < 0.3) continue;

      clusters.push({
        id: randomUUID(),
        fragmentIds: ids,
        domains: [...allDomains],
        structuralPattern: [...new Set(groupFragments.map(f => f.kind))].join("+"),
        averageStrength: avgStrength,
        createdAt: Date.now(),
      });
    }

    clusters.sort((a, b) => (b.averageStrength * b.fragmentIds.length) - (a.averageStrength * a.fragmentIds.length));
    return clusters;
  }

  async removeFragment(userId: string, fragmentId: string): Promise<void> {
    const fragments = await this.load(userId);
    const filtered = fragments.filter(f => f.id !== fragmentId);
    await this.save(userId, filtered);
  }

  async touchFragment(userId: string, fragmentId: string): Promise<void> {
    const fragments = await this.load(userId);
    const target = fragments.find(f => f.id === fragmentId);
    if (target) {
      target.strength = Math.min(1.0, target.strength + 0.1);
      await this.save(userId, fragments);
    }
  }
}
