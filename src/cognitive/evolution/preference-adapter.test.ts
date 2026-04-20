import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvolutionPreferenceAdapter } from "./preference-adapter.js";

let tempDir: string;
let adapter: EvolutionPreferenceAdapter;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "kaijibot-pref-test-"));
  adapter = new EvolutionPreferenceAdapter(tempDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("EvolutionPreferenceAdapter", () => {
  it("accept increases alpha for domain", async () => {
    await adapter.recordResponse("user-1", "feishu-wiki", "accepted");
    const bandit = await adapter.getRawBandit("user-1", "feishu-wiki");
    expect(bandit).toBeDefined();
    expect(bandit!.alpha).toBe(3); // prior(2) + 1
    expect(bandit!.beta).toBe(1);  // prior unchanged
  });

  it("reject increases beta for domain", async () => {
    await adapter.recordResponse("user-1", "code-review", "rejected");
    const bandit = await adapter.getRawBandit("user-1", "code-review");
    expect(bandit).toBeDefined();
    expect(bandit!.alpha).toBe(2); // prior unchanged
    expect(bandit!.beta).toBe(2);  // prior(1) + 1
  });

  it("modified counts as partial acceptance (alpha + 0.5)", async () => {
    await adapter.recordResponse("user-1", "analytics", "modified");
    const bandit = await adapter.getRawBandit("user-1", "analytics");
    expect(bandit).toBeDefined();
    expect(bandit!.alpha).toBe(2.5); // prior(2) + 0.5
    expect(bandit!.beta).toBe(1);    // prior unchanged
  });

  it("domain with no history returns prior (~0.67)", async () => {
    const rate = await adapter.getDomainAcceptanceRate("user-1", "unknown-domain");
    // Prior mean = 2/(2+1) = 0.667; sampled value should be close
    // With no data the sample is from Beta(2,1) which has mean 0.667
    // Allow wide range since it's a random sample
    expect(rate).toBeGreaterThan(0.1);
    expect(rate).toBeLessThanOrEqual(1);
  });

  it("domain with all rejections returns low score", async () => {
    // Record many rejections to push beta high
    for (let i = 0; i < 20; i++) {
      await adapter.recordResponse("user-1", "bad-domain", "rejected");
    }
    const rate = await adapter.getDomainAcceptanceRate("user-1", "bad-domain");
    // Beta(2, 21) has mean ~0.087, sample should be low
    expect(rate).toBeLessThan(0.25);
  });

  it("getTopDomains returns sorted by sampled score", async () => {
    // Create two domains with different acceptance patterns
    for (let i = 0; i < 10; i++) {
      await adapter.recordResponse("user-1", "good-domain", "accepted");
    }
    for (let i = 0; i < 10; i++) {
      await adapter.recordResponse("user-1", "bad-domain", "rejected");
    }
    const top = await adapter.getTopDomains("user-1", 2);
    expect(top).toHaveLength(2);
    // good-domain should score higher than bad-domain (probabilistically)
    // good: Beta(12, 1) mean ~0.92; bad: Beta(2, 11) mean ~0.15
    expect(top[0].domain).toBe("good-domain");
  });

  it("persists across instances (write then new adapter reads)", async () => {
    await adapter.recordResponse("user-1", "feishu-wiki", "accepted");
    await adapter.recordResponse("user-1", "feishu-wiki", "accepted");

    // Create a new adapter instance pointing to same dir
    const adapter2 = new EvolutionPreferenceAdapter(tempDir);
    const bandit = await adapter2.getRawBandit("user-1", "feishu-wiki");
    expect(bandit).toBeDefined();
    expect(bandit!.alpha).toBe(4); // prior(2) + 1 + 1
    expect(bandit!.beta).toBe(1);
  });
});
