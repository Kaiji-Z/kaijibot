# KaijiBot 记忆系统架构

> 最后更新: 2026-06-02 (v2026.6.2-1)

## 全局概览

记忆系统由 **6 个子系统** 组成，分三层自动/手动维护：

```
用户对话
  |
  +-- 会话结束 (/new /reset) --> Layer 1: 生成+存储 (自动)
  |                                LLM 摘要 -> topic 文件 + MEMORY.md + registry.json
  |
  +-- 每日凌晨 3 点 ------------> Layer 2: 自动整合 (cron)
  |                                扫描会话 -> LLM 提取 -> 认知存储 + MEMORY.md
  |
  +-- 用户说"整理记忆" --------> Layer 3: 手动整理 (memory-organize skill)
  |                                全量扫描 + memory_tidy (LLM 全权驱动)
  |
  +-- Agent 主动保存 -----------> memory_save (随时)
  |                                Jaccard 去重 -> topic 文件 + inline section
  |
  +-- Agent 犯错 ---------------> 纠错自进化 (实时)
  |                                双路径检测 -> CorrectionStore -> 系统提示注入
  |
  +-- 认知洞察 -----------------> ProactiveScheduler (定时)
                                   画像+碎片 -> LLM -> 飞书消息
```

---

## 一、数据存储层

记忆物理上存放在 `~/.kaijibot/` 下的多个位置：

| 位置                                  | 内容                             | 格式                                      |
| ------------------------------------- | -------------------------------- | ----------------------------------------- |
| `MEMORY.md`                           | 长期记忆入口，**8KB 预算**       | Markdown（inline sections + topic 指针）  |
| `memory/topics/*.md`                  | 主题文件（每个主题一个文件）     | YAML frontmatter + `## Title (date)` 条目 |
| `memory/topics/registry.json`         | 主题注册表（名称、描述、条目数） | JSON                                      |
| `memory/topics/archive/`              | 归档的旧主题文件                 | 同 topic 文件格式                         |
| `memory/YYYY-MM-DD.md`                | 每日会话摘要                     | YAML frontmatter + Markdown               |
| `cognitive/corrections/{userId}.json` | 纠错记录（每用户）               | JSON                                      |
| `cognitive/persona/{userId}.json`     | 用户画像（TypedInsights）        | JSON                                      |

### MEMORY.md 结构（8KB 以内）

```markdown
# Long-Term Memory

## ⚡ Core Memory

- 2026-06-02: 用户偏好简洁回复风格
- 2026-06-01: 用户使用 macOS + VSCode

## 🔥 Active Context

- 2026-06-02: 正在重构记忆系统

## Topic Pointers

- feishu -> memory/topics/feishu.md
- philosophy -> memory/topics/philosophy.md

## Promoted From Short-Term Memory (2026-06-01)

<!-- kaijibot-memory-promotion:abc123 -->

- snippet [score=0.85 recalls=3 avg=0.72 source=...]
```

**8KB 预算由 `rebalanceIndex()` 强制执行**，3 步驱逐策略：

1. 从最后一个 inline section 底部删行
2. 把整个 inline section 重定位到 topic 文件
3. 从末尾删除最旧的 topic 指针

### Topic 文件格式

```markdown
---
subject: feishu
created: 2026-06-01
updated: 2026-06-02
entries: 3
---

## 飞书搜索 API 踩坑 (2026-06-02)

is_cross_tenant 在 search API 的 result_meta 里...

## 另一条记忆 (2026-06-01)

- **Type**: core

内容...
```

`TopicEntry` 有 `title`、`date`、`content`、`importance`、`source`、`type` 字段。所有文件通过**原子写入**（写 tmp -> rename）保证不会出现半写文件。

### Topic 注册表格式 (`registry.json`)

```json
{
  "version": 1,
  "topics": {
    "feishu": {
      "name": "feishu",
      "description": "飞书 API 使用经验和配置相关记忆",
      "entryCount": 12,
      "lastUpdated": "2026-06-02",
      "createdAt": "2026-05-01"
    }
  }
}
```

### 关键类型定义

```typescript
// TopicEntry (extensions/memory-core/src/topic-types.ts)
interface TopicEntry {
  title: string;
  date: string; // YYYY-MM-DD
  content: string;
  importance?: "high" | "normal" | "low";
  source?: string; // "session-compact" | "memory-save" | ...
  type?: MemoryType; // "core" | "active" | "user" | "feedback" | "project" | "reference"
}

// TidyOperation (extensions/memory-core/src/tools.memory-tidy.ts)
type TidyOperation =
  | { op: "merge_topics"; from: string; into: string; reason: string }
  | { op: "rename_topic"; from: string; to: string; reason: string }
  | {
      op: "dedup_entries";
      topic: string;
      keepIndex: number;
      absorbIndices: number[];
      reason: string;
    }
  | { op: "archive_topic"; topic: string; reason: string }
  | { op: "clean_inline"; section: string; removeLineIndices: number[]; reason: string };

// CorrectionRecord (src/cognitive/correction/types.ts)
type CorrectionRecord = {
  id: string;
  domain: string;
  trigger: string;
  mistake: string;
  correction: string;
  provenance: "self" | "user" | "consolidation";
  reinforcedCount: number;
  createdAt: number;
  lastReinforced: number;
};
```

---

## 二、Layer 1: 生成+存储（自动，会话结束时）

**触发**: `/new`、`/reset`、上下文压缩后

**代码路径**: `src/hooks/bundled/session-memory/handler.ts`

```
会话结束
  |
  +-- 1. 读取 JSONL 会话文件
  |     transcript.ts -> 过滤 user/assistant 消息 -> 去除飞书元数据
  |     (97.5% 是系统元数据，过滤后只留 2.5% 有效内容)
  |
  +-- 2. LLM 结构化摘要 (summary.ts)
  |     createStandaloneGenerateText() -> 单次 LLM 调用
  |     输出 16+ 字段的 JSON: summary, topicSlug, memoryType,
  |     decisions, followups, topics, participants...
  |     注入 existingTopics（从 registry.json）引导路由到已有 topic
  |
  +-- 3. 写每日文件 (memory/YYYY-MM-DD.md)
  |     YAML frontmatter + 结构化 Markdown
  |
  +-- 4. 路由到 Topic 文件
  |     topicManager.appendEntry(topicSlug, entry)
  |     -> 原子写入 memory/topics/{topicSlug}.md
  |     -> indexManager.updateSection() 更新 MEMORY.md 指针
  |     -> registry.upsertTopic() 更新注册表
  |
  +-- 5. Inline Section 注入
  |     memoryType 映射:
  |       core/user/feedback/reference -> ⚡ Core Memory
  |       active/project              -> 🔥 Active Context
  |     摘要前 100 字符 + decisions 写入对应 section
  |     -> indexManager.rebalanceIndex() 确保 <= 8KB
  |
  +-- 6. 纠错提取 (correction/extractor.ts)
        hasCorrectionSignals() -> 60 个正则预筛
        -> 命中后 LLM 提取 {domain, trigger, mistake, correction}
        -> CorrectionStore.addOrReinforce()
```

**Jaccard 去重**: `memory_save` 写入前对所有 topic 内已有 entry 做 Jaccard >= 0.8 相似度检查。命中时通过 LLM 决策（append/replace/merge），不是简单跳过。

---

## 三、Layer 2: 自动整合（每日凌晨 3 点 Cron）

**代码路径**: `extensions/memory-core/src/consolidation*.ts`

**Gateway 注册**: `src/gateway/server.impl.ts` (lines 1620-1934) 用 `croner` Cron 调度

```
每日凌晨 3 点
  |
  +-- resolveConsolidationWorkspaces() -> 按 workspace 分组
  |
  +-- runConsolidationAllAgents()
        |
        +-- per agent + per user:
              |
              +-- SCAN: 列出最近 7 天未处理的会话文件
              |
              +-- EXTRACT: LLM 批量提取 (每批 <= 16K 字符)
              |   -> ExtractedItem { category, content, confidence, evidence, domain }
              |   -> 只提取 4 类: domain_knowledge, behavioral_pattern,
              |                   stated_preference, goal_or_aspiration
              |
              +-- DEDUP: Jaccard >= 0.7 同类别去重，保留高置信度
              |
              +-- RESOLVE: 相似度 0.3-0.7 同类别视为矛盾，保留高置信度
              |
              +-- ROUTE: routeToStores() 分发到多个存储
                    |
                    +-- PersonaStore    <- domain_knowledge, stated_preference, goal_or_aspiration
                    +-- FragmentStore   <- behavioral_pattern
                    +-- CorrectionStore <- confidence >= 0.9 且含纠错关键词
                    +-- MEMORY.md       <- confidence >= 0.7 (behavioral >= 0.8)
                    |     category -> section 映射:
                    |       domain_knowledge/stated_preference/behavioral_pattern -> ⚡ Core Memory
                    |       goal_or_aspiration -> 🔥 Active Context
                    +-- Daily file      <- 所有条目摘要
```

---

## 四、Layer 3: 手动整理（用户说"整理记忆"时）

**代码路径**: `extensions/memory-core/src/tools.memory-tidy.ts`

```
memory_tidy({ dryRun?, focus? })
  |
  +-- deps.generateText 可用?
        |
        +-- YES -> LLM 模式 (runLLMTidy)
        |     |
        |     +-- gatherTopicSummaries()  <- 所有 topic（每 topic 最多 5 条，截断 300 字符）
        |     +-- indexManager.readIndex() <- MEMORY.md inline sections
        |     +-- registry.getDescriptionList() <- 注册表描述
        |     |
        |     +-- buildLLMPrompt() -> LLM 返回 TidyOperation[] JSON
        |     |
        |     +-- parseLLMResponse() -> 解析 JSON（支持 markdown fence 剥离）
        |     |
        |     +-- validateOperations() -> 验证每个操作：
        |           merge_topics: 两边都存在, from ≠ into
        |           rename_topic: from 存在, to 是合法 kebab-case <=30字符, to 不存在
        |           dedup_entries: topic 存在, 索引在范围内
        |           archive_topic: topic 存在
        |           clean_inline: section 存在, 行索引在范围内
        |     |
        |     +-- 按序执行 (validated ops sorted by type):
        |           1. dedup_entries   -> TopicManager.mergeEntries()
        |           2. merge_topics    -> 追加 entries + 删除 from + 更新 index
        |           3. rename_topic    -> 原子写入新文件 + 删除旧 + 更新 index
        |           4. archive_topic   -> mv 到 archive/ + 从 index 移除
        |           5. clean_inline    -> 按索引删除 inline 行
        |
        +-- NO / LLM 出错 -> Jaccard 退行模式 (runJaccardFallback)
              |
              +-- Entry dedup (Union-Find, Jaccard >= 0.85)
              |     对每个 topic 的 entries 建 Union-Find
              |     合并相似组，保留最新条目
              |
              +-- Inline dedup (阈值 0.8)
              |     within-section: deduplicateLines()
              |     cross-topic: filterLinesAgainstTopics()
              |
              +-- Archive (>90 天未更新)
              |     mv 到 memory/topics/archive/
              |
              +-- Rebalance (8KB 预算)
              |
  +-- Always: registry.syncFromDisk() + indexManager.rebalanceIndex(8192)
```

---

## 五、纠错自进化

**代码路径**: `src/cognitive/correction/`

三条来源汇入同一个 `CorrectionStore`：

| 来源       | 触发                                 | provenance        |
| ---------- | ------------------------------------ | ----------------- |
| Agent 自报 | Agent 调用 `record_correction` 工具  | `"self"`          |
| 会话后提取 | `/new` `/reset` -> regex 预筛 -> LLM | `"user"`          |
| 整合路由   | consolidation 检测到高置信度纠错证据 | `"consolidation"` |

**去重逻辑**: `Jaccard >= 0.6` + 同 domain -> `reinforcedCount++`（强化而非重复创建）

**系统提示注入**: 每次对话开始时，`context-writer.ts` 加载 `listActive()` -> 按 `reinforcedCount` 排序 -> 取 top 15 -> 格式化为 `## Known Corrections` 注入系统提示。**Agent 每一轮都能看到历史纠错，避免重复犯错。**

**持久化**: `~/.kaijibot/cognitive/corrections/{userId}.json`，每用户最多 50 条，TTL 90 天。

---

## 六、认知洞察（ProactiveScheduler）

**代码路径**: `src/cognitive/scheduler/` + `src/cognitive/insight/`

Gateway bootstrap (lines 1390-1619) 创建 `ProactiveScheduler`：

```
事件源 (timer / persona_change / info_scan)
  |
  +-- ProactiveScheduler.processEvent(userId, event)
        |
        +-- PRISM 门控: pNeed x pAccept vs 成本阈值
        |
        +-- 搜索洞察机会:
        |     +-- scanCrossDomain: 1-hop/2-hop 域连接 + semanticDistance fallback
        |     +-- scanDomainDepth: 深度 >= 3 的域 + 域冷却 + 饥饿加成
        |     +-- scanExploration: 三模式路由 (timestamp % 100)
        |           roll < 50%  -> pattern 模式 (对话碎片 -> 行为洞察)
        |           roll < 90%  -> surprise 模式 (知识 + web 搜索)
        |           roll < 100% -> extend 模式 (用户域 + LLM)
        |
        +-- identify(): domain cooldown + type cooldown + starvation boost
        |
        +-- resolve(): 尝试候选（epsilon-greedy 可能提升探索候选）
              |
              +-- 知识模式: LLM 生成 -> self-refine (critique->rewrite, <= 3 次)
              |             -> verify (LLM-as-judge) -> freshness check
              +-- 模式模式: 碎片聚类 -> LLM 行为洞察 (partial verify)
              +-- 延伸模式: 用户域 -> LLM 深度建议
                    |
                    +-- resolveCognitiveDeliveryTarget()
                          -> deliverOutboundPayloads()
                          -> 用户收到飞书消息
```

---

## 去重机制汇总

| 去重场景                       | 方法                      | 阈值     | 代码位置                   |
| ------------------------------ | ------------------------- | -------- | -------------------------- |
| `memory_save` 写入             | Jaccard (tokenize)        | >= 0.8   | `tools.memory-save.ts`     |
| `memory_tidy` Jaccard fallback | Union-Find + Jaccard      | >= 0.85  | `tools.memory-tidy.ts`     |
| `memory_tidy` inline dedup     | Jaccard (stripDatePrefix) | >= 0.8   | `tools.memory-tidy.ts`     |
| Consolidation 去重             | Jaccard (same category)   | >= 0.7   | `consolidation-extract.ts` |
| CorrectionStore 去重           | Jaccard (same domain)     | >= 0.6   | `correction/store.ts`      |
| MEMORY.md inline 去重          | Jaccard (first 60 chars)  | >= 0.8   | `consolidation-route.ts`   |
| `memory_tidy` LLM 模式         | LLM 语义判断              | LLM 决定 | `tools.memory-tidy.ts`     |

---

## 关键常量

| 常量                                  | 值         | 含义                                |
| ------------------------------------- | ---------- | ----------------------------------- |
| `REBALANCE_BUDGET_BYTES`              | 8192       | MEMORY.md 硬限制                    |
| `DEDUP_THRESHOLD`                     | 0.85       | memory_tidy entry 去重              |
| `INLINE_DEDUP_THRESHOLD`              | 0.8        | inline section 去重                 |
| `ARCHIVE_THRESHOLD_DAYS`              | 90         | 超过 90 天自动归档                  |
| `MAX_CORRECTIONS_PER_USER`            | 50         | 纠错记录上限                        |
| `DEFAULT_CORRECTION_TTL_DAYS`         | 90         | 纠错记录过期                        |
| Consolidation lookback                | 7 天       | 回溯窗口                            |
| Consolidation batch size              | 16000 字符 | 每批 LLM 输入上限                   |
| Consolidation confidence (inline)     | >= 0.7     | 写入 inline section 门槛            |
| Consolidation confidence (behavioral) | >= 0.8     | behavioral_pattern 写入 inline 门槛 |
| Consolidation confidence (correction) | >= 0.9     | 路由到 CorrectionStore 门槛         |
| Correction Jaccard threshold          | 0.6        | 纠错去重 + 强化判定                 |
| Pattern mode ratio                    | 0.5 (50%)  | 洞察三模式路由权重                  |
| Epsilon-greedy                        | 0.2 (20%)  | 探索候选提升概率                    |

---

## 关键代码文件索引

| 文件                                                  | 职责                                  |
| ----------------------------------------------------- | ------------------------------------- |
| `src/hooks/bundled/session-memory/handler.ts`         | 会话结束后的完整记忆生成流水线        |
| `src/hooks/bundled/session-memory/summary.ts`         | LLM 结构化摘要生成                    |
| `src/hooks/bundled/session-memory/transcript.ts`      | JSONL 会话文件读取 + 飞书元数据过滤   |
| `extensions/memory-core/src/tools.memory-save.ts`     | Agent 主动保存记忆工具                |
| `extensions/memory-core/src/tools.memory-tidy.ts`     | LLM 全权驱动的记忆整理工具            |
| `extensions/memory-core/src/topic-manager.ts`         | Topic 文件 CRUD（原子写入）           |
| `extensions/memory-core/src/topic-types.ts`           | Topic 文件格式、解析、序列化          |
| `extensions/memory-core/src/topic-registry.ts`        | Topic 注册表（名称、描述、统计）      |
| `extensions/memory-core/src/memory-index.ts`          | MEMORY.md 读写、8KB rebalance         |
| `extensions/memory-core/src/semantic-merge.ts`        | Token grouping + Union-Find 合并      |
| `extensions/memory-core/src/consolidation.ts`         | 整合 Cron 主编排器                    |
| `extensions/memory-core/src/consolidation-extract.ts` | LLM 提取 + Jaccard 去重 + 冲突解决    |
| `extensions/memory-core/src/consolidation-route.ts`   | 提取结果路由到多个存储                |
| `src/cognitive/correction/store.ts`                   | 纠错存储（Jaccard 去重 + 强化）       |
| `src/cognitive/correction/extractor.ts`               | 纠错提取（60 正则预筛 + LLM）         |
| `src/cognitive/correction/injector.ts`                | 纠错系统提示注入                      |
| `src/cognitive/context-writer.ts`                     | 认知模式提示构建（含纠错注入）        |
| `src/gateway/server.impl.ts`                          | Gateway bootstrap（Cron + Scheduler） |
| `src/gateway/cognitive-delivery.ts`                   | 洞察投递路由（userId -> session key） |
| `src/plugin-sdk/generate-text.ts`                     | Plugin SDK seam（LLM 调用接口）       |
| `skills/memory-organize/SKILL.md`                     | 整理记忆技能说明                      |
