# KaijiBot 完整代码地图

> 由 4 个并行探索 agent 生成，覆盖核心引擎、扩展生态、认知层、基础设施四大维度
> 日期：2026-06-03

---

## 一、项目概览

KaijiBot 是一个主动式认知 AI 助手，采用可插拔的 provider/channel 架构。支持任意 LLM provider（35+ 内置），可扩展的消息频道。从 OpenClaw fork 后独立开发，拥有自己的认知层、架构和方向。

| 维度 | 规模 |
|---|---|
| src/ 文件数 | ~6,400 |
| extensions/ | 66 个扩展 |
| scripts/ | ~100+ |
| skills/ | 22 |
| 主要语言 | TypeScript (ESM) |
| 运行时 | Node 22+ / Bun |

---

## 二、核心请求流（消息进 → 回复出）

```
[飞书 WebSocket/HTTP]
  │
  ▼ src/gateway/server.impl.ts:417  startGatewayServer()
  │ 加载: config, secrets, auth, plugins, heartbeat, cron, discovery
  │
  ▼ src/gateway/server-ws-runtime.ts:24  attachGatewayWsHandlers()
  │
  ▼ src/gateway/server-methods/chat.ts:1771  dispatchInboundMessage()
  │ chat.send RPC → ReplyDispatcher（流式回传）
  │
  ▼ src/auto-reply/dispatch.ts:35  dispatchInboundMessage()
  │ → finalizeInboundContext() → dispatchReplyFromConfig()
  │
  ▼ src/auto-reply/reply/get-reply.ts:144  getReplyFromConfig() [641行]
  │ 解析: agentId, workspace, model, session state
  │ 构建: 系统提示词（认知层注入 + 修正注入 + 群组上下文）
  │
  ▼ src/auto-reply/reply/get-reply-run.ts:164  runPreparedReply() [757行]
  │ 构建完整 agent payload, queue policy, 认知上下文
  │
  ▼ src/agents/pi-embedded-runner/run.ts:151  runEmbeddedPiAgent() [1698行]
  │ **核心 LLM 循环**: 模型解析 → 认证轮换 → API 调用 → 工具执行 → 流式推理
  │ 重试/故障转移: rate-limit, billing, context overflow
  │
  ▼ [回复通过 dispatcher → gateway → WebSocket → 飞书用户]
```

---

## 三、模块架构地图

### 3.1 src/gateway/ — 网关层 (356 文件)

| 文件 | 行数 | 职责 |
|---|---|---|
| `server.impl.ts` | 2423 | **主入口**: 加载配置、认证、插件、频道、心跳、cron、UI |
| `server-methods/chat.ts` | 2027 | chat.send/history/abort/inject RPC 处理 |
| `server-ws-runtime.ts` | — | WebSocket handler 挂载 |
| `server/ws-connection.ts` | — | WS 认证、升级、消息分发 |
| `server-chat.ts` | — | agent 生命周期事件 → WS 广播 |
| `cognitive-delivery.ts` | — | 认知层 → userId → session key 路由 |
| `auth.ts` | — | 网关认证 |
| `server-session-key.ts` | — | routing ↔ gateway session key 桥接 |

**关键流程**: `startGatewayServer()` 启动 → 注册 RPC methods → attach WS → 启动 cron/heartbeat → 等待连接

### 3.2 src/auto-reply/ — 回复管线 (76 文件)

| 文件 | 行数 | 职责 |
|---|---|---|
| `dispatch.ts:35` | — | 入口: `dispatchInboundMessage()` |
| `reply/get-reply.ts:144` | 641 | **主编排**: 解析 agent/model/workspace/session/directives/hooks |
| `reply/get-reply-run.ts:164` | 757 | **运行准备**: 系统提示词构建 + 认知注入 + queue policy |
| `reply/agent-runner.runtime.ts` | — | 桥接到 `runEmbeddedPiAgent()` |
| `types.ts:32` | — | `GetReplyOptions` (149行回调钩子) |
| `types.ts:151` | — | `ReplyPayload` (text, mediaUrl, interactive...) |
| `command-detection.ts` | — | 斜杠命令检测 |
| `commands-registry.ts` | — | 命令注册 |

### 3.3 src/agents/ — Agent 系统 (766 文件)

**核心 LLM 循环** (`pi-embedded-runner/`):

| 文件 | 职责 |
|---|---|
| `run.ts:151` | **runEmbeddedPiAgent()** — 1698行主循环 |
| `run/attempt.ts` | 单次 LLM API 调用 |
| `run/auth-controller.ts` | 认证 profile 轮换 |
| `run/failover-policy.ts` | 重试/故障转移决策 |
| `run/payloads.ts` | 组装 LLM 请求 payload |
| `run/setup.ts` | `resolveEffectiveRuntimeModel()` |

**工具系统**:

| 文件 | 职责 |
|---|---|
| `kaijibot-tools.ts:58` | **createKaijiBotTools()** — 25+ 工具注册 |
| `pi-tools.ts:233` | **createKaijiBotCodingTools()** — 工具策略+schema 适配 |
| `tool-policy.ts` | per-session 工具 allow/deny |
| `tools/*.ts` | 各工具实现 (sessions, cron, gateway, cognitive, etc.) |

**模型系统**:

| 文件 | 职责 |
|---|---|
| `model-selection.ts` | provider/model 解析 |
| `model-catalog.ts` | 模型目录 + provider 支持矩阵 |
| `model-fallback.ts` | fallback 链 |
| `auth-profiles.ts` | 认证 profile store (round-robin, cooldown) |
| `defaults.ts` | `DEFAULT_PROVIDER`, `DEFAULT_MODEL` |

**其他**:

| 文件 | 职责 |
|---|---|
| `agent-scope.ts` | `resolveSessionAgentId()`, workspace 解析 |
| `system-prompt.ts` | 系统提示词组装 |
| `compaction.ts` | 上下文窗口压缩 |
| `subagent-registry.ts` | 子 agent 生命周期管理 |

### 3.4 src/config/ — 配置系统 (243 文件)

| 文件 | 职责 |
|---|---|
| `io.ts` | `loadConfig()`, `readConfigFileSnapshot()`, `writeConfigFile()` |
| `types.kaijibot.ts:34` | **KaijiBotConfig** (178行): auth, env, secrets, agents, bindings, session, channels, models, plugins, tools, cognitive, memory, hooks, cron, mcp, skills, soul, gateway, browser, cli, logging, diagnostics |
| `sessions/types.ts:106` | **SessionEntry** (346行, 60+字段) |
| `defaults.ts` | 默认值 |
| `schema.ts` / `validation.ts` | 校验 |

**配置加载管线**: 读取 JSON5 → `$include` 解析 → `${ENV}` 替换 → validate → 运行时默认值

### 3.5 src/routing/ — 路由系统 (11 文件)

| 文件 | 行数 | 职责 |
|---|---|---|
| `session-key.ts:120` | — | `buildAgentMainSessionKey()` — `agent:<agentId>:main` |
| `session-key.ts:129` | — | `buildAgentPeerSessionKey()` — DM scope 路由 |
| `resolve-route.ts:632` | 836 | **主路由函数**: peer → parent → wildcard → guild → team → account → channel → default |

**Session Key 格式**:
```
agent:<agentId>:<scope>
例: agent:main:main
    agent:main:feishu:direct:ou_abc123
    agent:main:feishu:group:oc_abc123
    agent:main:cron:task:run:uuid
    agent:main:main:thread:tid
```

### 3.6 src/sessions/ — 会话管理 (18 文件)

| 文件 | 职责 |
|---|---|
| `session-key-utils.ts:28` | `parseAgentSessionKey()` — 解析 agent key |
| `input-provenance.ts` | 输入来源追踪 |
| `send-policy.ts` | 发送策略 (allow/deny) |

---

## 四、认知层架构 (src/cognitive/) — KaijiBot 独有

```
                    ┌─────────────────────────────────────┐
                    │         事件源 (Event Sources)        │
                    │  timer / persona_change / info_scan   │
                    │  evolution_scan / heartbeat           │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │     ProactiveScheduler               │
                    │  (src/cognitive/scheduler/)           │
                    │  PRISM cost-sensitive gate            │
                    │  SIRI: Search → Identify → Resolve    │
                    └──────────────┬──────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
   ┌──────────▼──────────┐ ┌──────▼──────┐ ┌─────────▼─────────┐
   │   Insight Pipeline   │ │  Evolution  │ │    Correction      │
   │ (src/cognitive/      │ │ Pipeline    │ │ Pipeline           │
   │  insight/)           │ │ (evolution/)│ │ (correction/)      │
   │                      │ │             │ │                    │
   │ 知识模式: LLM 生成    │ │ hard-trigger│ │ 双路检测:           │
   │  → 对比去重 → 自精炼  │ │ ≥3 tool调用  │ │ agent自报 +        │
   │  → LLM验证 → 新鲜度   │ │ → agent决定 │ │ 会话后LLM提取      │
   │                      │ │ → 技能草稿  │ │ → Jaccard去重      │
   │ 模式模式: 行为片段聚类│ │ → 生命周期  │ │ → 系统提示词注入    │
   │  → LLM 行为洞察      │ │             │ │                    │
   └──────────┬──────────┘ └──────┬──────┘ └─────────┬─────────┘
              │                    │                    │
              └────────────────────┼────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │       PersonaStore                    │
                    │  (src/cognitive/persona/)             │
                    │  TypedInsight (6类)                   │
                    │  domain_knowledge, behavioral_pattern │
                    │  stated_preference, tool_config       │
                    │  contextual_fact, goal_or_aspiration  │
                    │  InterestPhase 生命周期               │
                    │  分类感知半衰期衰减                    │
                    └──────────────────────────────────────┘
```

**关键子系统**:

| 子系统 | 路径 | 核心功能 |
|---|---|---|
| **Persona** | `src/cognitive/persona/` | TypedInsight 存储, LLM 提取器, 动态领域发现, 兴趣生命周期 |
| **Insight** | `src/cognitive/insight/` | 知识/模式双模式, 对比去重, 自精炼循环, LLM-as-judge 验证 |
| **Evolution** | `src/cognitive/evolution/` | 硬触发检测, agent 决策, LLM 技能草稿, 生命周期管理, ClawHub 发布 |
| **Correction** | `src/cognitive/correction/` | 双路检测, CorrectionStore (Jaccard 去重), 系统提示词注入 (top 15) |
| **Scheduler** | `src/cognitive/scheduler/` | PRISM 成本敏感门, SIRI 循环, 5 类事件源 |
| **Feedback** | `src/cognitive/feedback/` | Thompson Sampling 偏好学习, 信任/亲和力计算 |
| **Mode Router** | `src/cognitive/mode-router.ts` | 轮次分类: task/insight/hybrid/proactive |
| **Context Writer** | `src/cognitive/context-writer.ts` | 系统提示词注入: 认知模式 + 修正列表 + 演化提示 |

---

## 五、扩展生态系统 (extensions/) — 66 个扩展

### 5.1 按类型分类

**频道 (1)**:
- `feishu` — 唯一消息频道, 102 src .ts 文件, 最大扩展

**LLM Provider (~35)**:
| 分类 | 扩展 |
|---|---|
| **默认** | `zai` (智谱 GLM), `openai` (43 文件, 最丰富的 provider 契约) |
| **国内** | `deepseek`, `qwen`, `kimi-coding`, `minimax`, `qianfan`, `stepfun`, `volcengine`, `byteplus`, `moonshot`, `xiaomi`, `alibaba` |
| **国际** | `anthropic`, `google`, `mistral`, `perplexity`, `groq`, `nvidia`, `huggingface`, `xai` |
| **聚合/网关** | `openrouter`, `litellm`, `together`, `fireworks`, `cloudflare-ai-gateway`, `vercel-ai-gateway` |
| **Copilot/代理** | `github-copilot` (禁用), `copilot-proxy` (禁用) |
| **自部署** | `ollama`, `lmstudio`, `sglang`, `vllm` |
| **开发工具** | `opencode` (禁用), `opencode-go` (禁用), `kilocode` (禁用), `openshell`, `open-prose` |
| **其他** | `arcee`, `chutes`, `venice`, `vydra`, `microsoft-foundry`, `runway` |

**内存 (3)**:
- `memory-core` — 核心内存引擎, 71 src .ts, 记忆整合, embedding, QMD
- `memory-lancedb` — LanceDB 向量内存
- `memory-wiki` — Obsidian/wiki 内存

**搜索/浏览器 (3)**:
- `exa` — web search
- `tavily` — web search + extract
- `browser` — Playwright 浏览器自动化, 161 src .ts (最大扩展)

**媒体/语音 (3)**: `microsoft` (TTS), `talk-voice` (语音选择), `runway` (视频生成)

**工具 (6)**: `diffs`, `llm-task`, `device-pair`, `webhooks`, `openshell`, `shared`

### 5.2 Plugin SDK 边界

**位置**: `src/plugin-sdk/` (353 文件)
**子路径**: 237 个 SDK 入口 (`scripts/lib/plugin-sdk-entry-points.json`)

**注册 API** (`KaijiBotPluginApi` — 25+ 方法):
- 工具: `registerTool()`, `registerToolFactory()`
- LLM: `registerProvider()`
- 频道: `registerChannel()`
- 媒体: `registerSpeechProvider()`, `registerImageGenerationProvider()`, `registerVideoGenerationProvider()`, `registerMusicGenerationProvider()`
- 搜索: `registerWebFetchProvider()`, `registerWebSearchProvider()`
- 内存: `registerMemoryCapability()`, `registerMemoryEmbeddingProvider()`
- 生命周期: `registerHook()`, `on()` (20+ hook 名)
- 网关: `registerHttpRoute()`, `registerGatewayMethod()`
- CLI: `registerCli()`, `registerCommand()`

**扩展内部模式**:
- `api.ts` — 轻量导出
- `runtime-api.ts` — 懒加载运行时
- `index.ts` — 调用 `definePluginEntry()` 或 `defineSingleProviderPluginEntry()`

### 5.3 Plugin Manifest (`kaijibot.plugin.json`)

```json
{
  "id": "zai",
  "enabledByDefault": true,
  "providers": ["zai"],
  "providerAuthEnvVars": { "zai": ["ZAI_API_KEY"] },
  "providerAuthChoices": [{ "provider", "method", "choiceId", ... }],
  "kind": "memory",
  "contracts": { "mediaUnderstandingProviders": ["zai"] },
  "configSchema": { ... }
}
```

### 5.4 Contract 生态

| Contract | Providers |
|---|---|
| webSearch | exa, google, minimax, moonshot, ollama, perplexity, tavily, xai |
| mediaUnderstanding | anthropic, google, groq, minimax, mistral, moonshot, openai, openrouter, qwen, zai |
| imageGeneration | google, minimax, openai, vydra |
| videoGeneration | alibaba, byteplus, google, minimax, openai, qwen, runway, together, venice, xai |
| speech | microsoft, minimax, openai, vydra |

---

## 六、基础设施

### 6.1 构建系统

| 命令 | 用途 |
|---|---|
| `pnpm build` | tsdown 构建 |
| `pnpm tsgo` | TypeScript 类型检查 |
| `pnpm check` | tsgo + oxlint + boundary |
| `pnpm test` | vitest (70% 覆盖率阈值) |
| `pnpm gw:deploy` | 构建 + 重启网关 (tmux session `gw`) |

### 6.2 CLI 命令

通过 `kaijibot` 命令访问:
- `gateway` — 启动网关
- `tui` — TUI 界面 (10K LOC)
- `config` — 配置管理
- `hooks` — hook 管理
- `migrate` — OpenClaw → KaijiBot 迁移

### 6.3 Docker

| 端口 | 用途 |
|---|---|
| 18789 | 网关 |
| 18790 | Bridge |

### 6.4 Session Key 路由

```
agent:<agentId>:<scope>

scope 类型:
  main                          — 主会话
  feishu:direct:<ou_xxx>        — 飞书 DM
  feishu:group:<oc_xxx>         — 飞书群聊
  cron:task:run:<uuid>          — Cron 任务
  subagent:<parent>:<child>     — 子 agent
  main:thread:<tid>             — 线程
```

路由优先级 (resolve-route.ts):
peer → parent → wildcard → guild+roles → guild → team → account → channel → default

---

## 七、三层记忆架构

| 层级 | 触发 | 机制 | 读取方式 |
|---|---|---|---|
| **Layer 1** | `/new` `/reset` | session-memory hook → LLM 摘要 → 路由到 topic | `preprocessSessionTranscript()` ✅ |
| **Layer 2** | 每日 03:00 | consolidation cron → LLM 提取 → Jaccard 去重 → 路由到认知存储 | `preprocessSessionTranscript()` (via deps.readSessionFile) ✅ |
| **Layer 3** | 用户说"整理记忆" | memory-organize skill → `read_session_transcript` 工具 → memory_tidy | `preprocessSessionTranscript()` (via read_session_transcript 工具) ✅ |

---

## 八、关键依赖图

```
src/config/ ← 被所有模块加载
    ↑
src/routing/ ← gateway 使用，解析 agentId + sessionKey
    ↑
src/sessions/ ← session key 解析, 生命周期事件
    ↑
src/auto-reply/ ← 回复管线: dispatch → getReply → runPrepared → agent-runner
    ↑
src/agents/ ← embedded PI runner, 工具系统, 模型选择
    ↑
src/gateway/ ← HTTP/WS 服务器, 串联一切
    ↑
extensions/ ← 插件系统, 通过 Plugin SDK 边界隔离
    ↑
src/cognitive/ ← 认知层, KaijiBot 独有, 可通过 cognitive.enabled:false 禁用
```
