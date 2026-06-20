import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

const LIVE = process.env.KAIJIBOT_LIVE_TEST === "1";
const TMP = path.join(process.cwd(), ".tmp-live-wiki-test");
const ZAI_API_KEY = process.env.ZAI_API_KEY;

const describeOrSkip = LIVE && ZAI_API_KEY ? describe : describe.skip;

describeOrSkip("Knowledge Wiki — Live E2E (real LLM)", () => {
  beforeEach(async () => {
    await rm(TMP, { recursive: true, force: true });
    await mkdir(path.join(TMP, "workspace", "docs"), { recursive: true });
  });

  afterEach(async () => {
    await rm(TMP, { recursive: true, force: true });
  });

  it("ingests a real document and produces valid wiki pages", async () => {
    const fixtureContent = `# Rust 分布式追踪系统架构设计

## 技术选型
我们选择 Rust 作为主要开发语言，因为它提供了零成本抽象和内存安全保证。
性能方面，延迟目标是端到端低于 100ms。

追踪方案使用 eBPF 在内核态采集数据，避免了用户态探针的性能开销。

## 核心组件
- Collector: Rust 实现的数据收集器，负责聚合 trace 数据
- Storage: 使用 ClickHouse 存时序数据
- UI: React 前端展示调用链路

## 结论
Rust + eBPF 的组合在性能和安全性上都满足了需求。
`;

    await writeFile(
      path.join(TMP, "workspace", "docs", "architecture.md"),
      fixtureContent,
      "utf8",
    );

    const { initializeWikiVault } = await import("./vault.js");
    const { resolveWikiConfig } = await import("./config.js");
    const { ingestAll } = await import("./ingest.js");
    const { queryWiki } = await import("./query.js");
    const { lintWiki } = await import("./lint.js");

    const vaultRoot = path.join(TMP, "wiki");
    const config = resolveWikiConfig(undefined);
    await initializeWikiVault(vaultRoot);

    const { createStandaloneGenerateText } = await import(
      "kaijibot/plugin-sdk/generate-text"
    );

    let generateText;
    try {
      const { readFileSync } = await import("node:fs");
      const os = await import("node:os");
      const cfgPath = path.join(os.homedir(), ".kaijibot", "kaijibot.json");
      const rawCfg = JSON.parse(readFileSync(cfgPath, "utf8"));
      generateText = await createStandaloneGenerateText(rawCfg, { maxTokens: 4000, timeout: 120_000 });
    } catch {
      generateText = await createStandaloneGenerateText({
        agents: { defaults: { model: "zai/glm-5-turbo" } },
        providers: { zai: { apiKey: ZAI_API_KEY! } },
      } as never, { maxTokens: 4000, timeout: 120_000 });
    }

    const result = await ingestAll(
      path.join(TMP, "workspace"),
      vaultRoot,
      generateText,
      config,
    );

    expect(result.errors).toHaveLength(0);
    expect(result.ingested.length).toBe(1);

    const ingested = result.ingested[0]!;
    expect(ingested.claimsAdded).toBeGreaterThan(0);
    expect(ingested.entityPages.length).toBeGreaterThan(0);
    expect(ingested.summaryPage).toContain("summaries/");

    const summaryContent = await readFile(
      path.join(vaultRoot, ingested.summaryPage),
      "utf8",
    );
    expect(summaryContent).toContain("pageType: summary");
    expect(summaryContent.length).toBeGreaterThan(50);

    const indexContent = await readFile(
      path.join(vaultRoot, "index.md"),
      "utf8",
    );
    expect(indexContent).toContain("summaries/");

    const logContent = await readFile(
      path.join(vaultRoot, "log.md"),
      "utf8",
    );
    expect(logContent).toContain("ingest");
    expect(logContent).toContain("architecture.md");

    const queryResult = await queryWiki(vaultRoot, "Rust");
    expect(queryResult.matchedPages.length).toBeGreaterThan(0);

    const rustMatch = queryResult.matchedPages.find(
      (m) => m.title.toLowerCase().includes("rust"),
    );
    expect(rustMatch).toBeDefined();

    const lintReport = await lintWiki(vaultRoot);
    expect(lintReport.totalPages).toBeGreaterThan(0);
    expect(lintReport.totalClaims).toBeGreaterThan(0);
  }, 180000);
});
