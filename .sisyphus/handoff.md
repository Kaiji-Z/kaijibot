# KaijiBot Project Handoff

> This file preserves full session context for continuing work after a project folder rename.
> New session: read this file first to restore context.

## Project Identity

**KaijiBot** — 基于 OpenClaw 二次开发的主动式智能体。技术传承链：pi-agent-core → OpenClaw → KaijiBot（我们）。

## Current State (as of commit 82706b4e2e)

| Check | Status |
|-------|--------|
| Branch | `simplify` |
| Commits | 17 (on top of upstream) |
| `pnpm tsgo` | 0 errors |
| `pnpm build` | success |
| `pnpm test src/cognitive/` | 112/112 passing |
| Remote push | Not pushed (all local) |

## What Was Done (3 Phases)

### Phase 1: Simplification (9 commits)
- Removed ~85 unused channels/providers (discord, slack, telegram, whatsapp, signal, imessage, matrix, zalo, ollama, fal, google, minimax, etc.)
- Removed iOS/macOS/Android native apps, upstream CI, Docker sandbox
- Removed ~136 dead scripts, ~91 dead npm scripts, ~14 dead dependencies
- Kept: 17 extensions, 25 skills, core engine intact
- Commit range: `1f9b51755f`..`b94f7d9d9d`

### Phase 2: Cognitive Layer (6 commits)
- 38 new files in `src/cognitive/`
- 112 tests across 14 test files
- Full pipeline integration (persona loading, mode classification, system prompt injection, extraction, compaction protection)
- Oracle double-verification passed
- Commit range: `9caebe934d`..`f528637048`

### Phase 3: Rename (1 commit)
- OpenClaw → KaijiBot: 3916 files, ~31000 lines
- Package name = `kaijibot@2026.4.10`
- Commit: `0195c17ce1`

### Phase 4: TS Error Cleanup (1 commit)
- Restored `test/helpers/` directory (113 files)
- Restored `ui/tool-display.json`
- Fixed 150 TS errors: renames, deleted extension refs, type annotations
- Commit: `82706b4e2e`

## Architecture: Cognitive Layer

```
用户消息 → Dispatch 管道 → 认知层 → LLM → 回复
                              │
              ┌───────────────┼───────────────┐
              │               │               │
        PersonaTree      ModeRouter      Scheduler
        (用户认知)       (模式分类)      (主动调度)
              │               │               │
        Feedback         Insight         Trust
        (反馈学习)       (启发引擎)      (信任建立)
```

### Key Design Decisions
- **改核心**（非插件）— 认知层直接插入核心代码
- **平台无关** — 飞书/微信/Web 都是即插即用的通道适配器
- **桥接现有记忆插件** — 不重写，加协调层
- **保留助手功能** — 任务执行 + 思考伙伴双模式
- **启发性为核心** — Agent 是思考伙伴，主动激发用户思考

## Key Files

### Cognitive Layer Core
- `src/cognitive/types.ts` — 核心类型定义
- `src/cognitive/mode-router.ts` — 模式分类器
- `src/cognitive/context-writer.ts` — 管道注入
- `src/cognitive/index.ts` — barrel exports

### Persona Module
- `src/cognitive/persona/store.ts` — JSON 持久化
- `src/cognitive/persona/extractor.ts` — 规则提取（域检测、自我披露、问题识别）
- `src/cognitive/persona/curator.ts` — 合并（加权置信度）+ 修剪
- `src/cognitive/persona/context-builder.ts` — PersonaTree → system prompt

### Feedback Module
- `src/cognitive/feedback/collector.ts` — 显式 + 隐式反馈
- `src/cognitive/feedback/preference-learner.ts` — Thompson Sampling
- `src/cognitive/feedback/trust-calculator.ts` — SARA 框架

### Insight Module
- `src/cognitive/insight/engine.ts` — 3 策略：跨领域 / 待答问题 / 深度领域
- `src/cognitive/insight/cross-domain-mapper.ts` — 8 域邻接图
- `src/cognitive/insight/serendipity-scorer.ts` — 相关性 × 意外度 × 新颖度
- `src/cognitive/insight/verification/pipeline.ts` — basic/strict/paranoid 验证

### Scheduler Module
- `src/cognitive/scheduler/proactive-scheduler.ts` — 主调度器
- `src/cognitive/scheduler/gate.ts` — 5 重门控
- `src/cognitive/scheduler/event-sources/` — timer, persona-change, info-scan

### Pipeline Integration Points (modified existing files)
- `src/auto-reply/reply/get-reply-run.ts` — 每条消息加载 persona + 分类模式
- `src/agents/pi-embedded-runner/run/attempt.ts` — 每次对话后提取 persona
- `src/agents/compaction.ts` — 压缩摘要保留认知信息
- `src/agents/system-prompt.ts` — cognitive-persona.md 加入 context files
- `src/gateway/server.impl.ts` — Gateway 启动时启动 ProactiveScheduler

### Config
- `src/config/types.kaijibot.ts` — KaijiBotConfig (含 cognitive 字段)
- `src/config/types.cognitive.ts` — CognitiveConfig
- `src/config/zod-schema.cognitive.ts` — CognitiveSchema
- `src/config/zod-schema.ts` — 集成 CognitiveSchema
- `src/config/defaults.ts` — applyCognitiveDefaults
- `src/config/materialize.ts` — wired applyCognitiveDefaults

### Planning Docs
- `.sisyphus/plans/cognitive-layer-plan.md` — 完整架构计划（568 行）

### Tests (14 files)
- `src/cognitive/mode-router.test.ts`
- `src/cognitive/persona/store.test.ts`
- `src/cognitive/persona/curator.test.ts`
- `src/cognitive/persona/preference-learner.test.ts`
- `src/cognitive/feedback/preference-learner.test.ts`
- `src/cognitive/feedback/trust-calculator.test.ts`
- `src/cognitive/insight/engine.test.ts`
- `src/cognitive/insight/cross-domain-mapper.test.ts`
- `src/cognitive/insight/serendipity-scorer.test.ts`
- `src/cognitive/insight/verification/pipeline.test.ts`
- `src/cognitive/scheduler/gate.test.ts`
- `src/cognitive/scheduler/proactive-scheduler.test.ts`
- `src/cognitive/scheduler/event-sources/timer-source.test.ts`
- `src/cognitive/scheduler/event-sources/persona-change-source.test.ts`

## Remaining Tasks

1. **推送到远程** — `git push -u origin simplify`
2. **升级提取器** — 接 LLM 做深度 persona 提取（替换规则引擎）
3. **升级启发引擎** — 接 web search + LLM 生成真实洞察（替换模板）
4. **注册反馈工具** — 封装为飞书 extension plugin tool
5. **对接主动推送 delivery** — 通过 heartbeat 通道发送启发消息（当前 `onInsightReady` 是 no-op）
6. **扩展跨域映射** — 从 8 个硬编码域扩展为动态 + 语义嵌入

## User Constraints (from conversation)

- "扩展都不砍，技能都不砍" — 保留所有扩展和技能
- "飞书这个你作为一个备用的记录，我希望他是一个即插即用的东西，而不是直接让项目和他绑定无法分离"
- "自己实施自己测试自己修复，全自动化进行，不要询问我任何"
- 汽车人 = 变形金刚里的汽车人（从车变形为机器人）— 不过用户后来说这个形容太中二，改为"Pi → OpenClaw → KaijiBot，站在前人肩膀上的渐进式进化"

## Upstream Sync

```bash
git remote add upstream https://gitee.com/kaiji1126/kaijibot
git fetch upstream
git merge upstream/main
```
Core code (`src/`) fully compatible; merge conflicts rare.
