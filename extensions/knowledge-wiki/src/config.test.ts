import { describe, expect, it } from "vitest";
import {
  resolveWikiConfig,
  resolveDefaultWikiVaultPath,
  resolveAgentVaultRoot,
  resolveEffectiveVaultRoot,
  DEFAULT_WIKI_ENABLED,
  DEFAULT_WIKI_CRON,
  DEFAULT_SCAN_EXTENSIONS,
  DEFAULT_EXCLUDE_DIRS,
  DEFAULT_EXCLUDE_PATTERNS,
  DEFAULT_WIKI_MAX_FILE_SIZE,
  DEFAULT_WIKI_MIN_CONFIDENCE,
  DEFAULT_WIKI_MAX_CLAIMS,
} from "./config.js";

describe("resolveWikiConfig", () => {
  it("returns defaults for undefined config", () => {
    const config = resolveWikiConfig(undefined);
    expect(config.enabled).toBe(DEFAULT_WIKI_ENABLED);
    expect(config.cron).toBe(DEFAULT_WIKI_CRON);
    expect(config.scan.extensions).toEqual([...DEFAULT_SCAN_EXTENSIONS]);
    expect(config.scan.excludeDirs).toEqual([...DEFAULT_EXCLUDE_DIRS]);
    expect(config.scan.excludePatterns).toEqual([...DEFAULT_EXCLUDE_PATTERNS]);
    expect(config.scan.maxFileSize).toBe(DEFAULT_WIKI_MAX_FILE_SIZE);
    expect(config.scan.includeMemoryCurated).toBe(true);
    expect(config.extraction.minConfidence).toBe(DEFAULT_WIKI_MIN_CONFIDENCE);
    expect(config.extraction.maxClaimsPerPage).toBe(DEFAULT_WIKI_MAX_CLAIMS);
  });

  it("respects enabled flag", () => {
    const config = resolveWikiConfig({ enabled: true });
    expect(config.enabled).toBe(true);
  });

  it("respects custom cron", () => {
    const config = resolveWikiConfig({ cron: "0 3 * * *" });
    expect(config.cron).toBe("0 3 * * *");
  });

  it("respects custom vault path override", () => {
    const config = resolveWikiConfig({ vault: { path: "/custom/vault" } });
    expect(config.vault.path).toBe("/custom/vault");
  });

  it("expands ~ in vault path override", () => {
    const config = resolveWikiConfig(
      { vault: { path: "~/my-wiki" } },
      { homedir: "/home/test" },
    );
    expect(config.vault.path).toBe("/home/test/my-wiki");
  });

  it("vault.path defaults to empty string (derive from workspace)", () => {
    const config = resolveWikiConfig(undefined);
    expect(config.vault.path).toBe("");
  });

  it("respects custom scan extensions", () => {
    const config = resolveWikiConfig({
      scan: { extensions: [".org", ".adoc"] },
    });
    expect(config.scan.extensions).toEqual([".org", ".adoc"]);
  });

  it("respects custom excludeDirs", () => {
    const config = resolveWikiConfig({
      scan: { excludeDirs: ["secret-dir"] },
    });
    expect(config.scan.excludeDirs).toContain("secret-dir");
  });

  it("respects custom excludePatterns", () => {
    const config = resolveWikiConfig({
      scan: { excludePatterns: ["draft/.*"] },
    });
    expect(config.scan.excludePatterns).toContain("draft/.*");
  });

  it("respects maxFileSize override", () => {
    const config = resolveWikiConfig({
      scan: { maxFileSize: 500000 },
    });
    expect(config.scan.maxFileSize).toBe(500000);
  });

  it("respects includeMemoryCurated=false", () => {
    const config = resolveWikiConfig({
      scan: { includeMemoryCurated: false },
    });
    expect(config.scan.includeMemoryCurated).toBe(false);
  });

  it("respects extraction config", () => {
    const config = resolveWikiConfig({
      extraction: { minConfidence: 0.8, maxClaimsPerPage: 10 },
    });
    expect(config.extraction.minConfidence).toBe(0.8);
    expect(config.extraction.maxClaimsPerPage).toBe(10);
  });

  it("default vault path includes workspace/wiki", () => {
    const vaultPath = resolveDefaultWikiVaultPath("/home/test");
    expect(vaultPath).toContain("workspace");
    expect(vaultPath).toContain("wiki");
  });
});

describe("resolveAgentVaultRoot", () => {
  it("derives vault from workspace directory", () => {
    const vault = resolveAgentVaultRoot("/home/user/.kaijibot/workspace");
    expect(vault).toBe("/home/user/.kaijibot/workspace/wiki");
  });

  it("derives different vaults for different agent workspaces", () => {
    const main = resolveAgentVaultRoot("/home/user/.kaijibot/workspace");
    const ops = resolveAgentVaultRoot("/home/user/.kaijibot/workspace-ops");
    expect(main).toBe("/home/user/.kaijibot/workspace/wiki");
    expect(ops).toBe("/home/user/.kaijibot/workspace-ops/wiki");
    expect(main).not.toBe(ops);
  });
});

describe("resolveEffectiveVaultRoot", () => {
  it("uses config vault.path override when set", () => {
    const config = resolveWikiConfig({ vault: { path: "/custom/vault" } });
    const vault = resolveEffectiveVaultRoot(config, "/some/workspace");
    expect(vault).toBe("/custom/vault");
  });

  it("derives from workspace when vault.path is empty", () => {
    const config = resolveWikiConfig(undefined);
    const vault = resolveEffectiveVaultRoot(config, "/home/user/.kaijibot/workspace");
    expect(vault).toBe("/home/user/.kaijibot/workspace/wiki");
  });

  it("falls back to default when workspaceDir is undefined", () => {
    const config = resolveWikiConfig(undefined);
    const vault = resolveEffectiveVaultRoot(config, undefined);
    expect(vault).toContain("workspace");
    expect(vault).toContain("wiki");
  });

  it("provides isolation: different workspaces get different vaults", () => {
    const config = resolveWikiConfig(undefined);
    const main = resolveEffectiveVaultRoot(config, "/data/.kaijibot/workspace");
    const ops = resolveEffectiveVaultRoot(config, "/data/.kaijibot/workspace-ops");
    expect(main).not.toBe(ops);
  });
});
