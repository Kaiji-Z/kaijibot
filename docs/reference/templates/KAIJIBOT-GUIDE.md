---
title: "KAIJIBOT-GUIDE.md Template"
summary: "KaijiBot configuration reference (auto-injected into every conversation)"
read_when:
  - User asks about configuration
  - Agent needs config guidance
---

# KaijiBot 配置指南

本文件在每次对话中自动加载。用户询问配置时请先查阅本指南。

## 快速配置

> **本指南未列出的配置项** → CLI 用 `kaijibot config schema` 查看完整 schema（类型、默认值、取值范围、描述）。
> Agent 内部可通过 `gateway` 工具的 `config.schema.lookup` action 按路径查询子树。**找不到就查 schema，不要猜。**

| 操作 | 命令 |
|------|------|
| 换模型 | `kaijibot models set "zai/glm-5-turbo"` |
| 认知开关 | `cognitive.enabled` / `cognitive.proactive.enabled` (boolean) |
| 推送频率 | `cognitive.proactive.minIntervalHours` (number, 默认 0.5 小时) |
| 活跃时段 | `cognitive.proactive.activeHours.start` / `.end` / `.timezone`（不设置 = 不限制） |
| 网络搜索 | 环境变量 `EXA_API_KEY` / `TAVILY_API_KEY` |
| 飞书频道 | `channels.feishu.appId` / `channels.feishu.appSecret` |
| API Key | 环境变量 `ZAI_API_KEY` 或 `models.providers.zai.apiKey` |
| 时区 | `agents.defaults.userTimezone` (如 "Asia/Shanghai") |
| 记忆 | `memory.backend` ("builtin" \| "qmd") / `memory.citations` |

## 认知系统

### 总控

- `cognitive.enabled` — 总开关 (default: true)
- `cognitive.proactive.enabled` — 主动推送 (default: true)

### 推送调度

- `cognitive.proactive.minIntervalHours` — 两次推送最小间隔 (default: 0.5, range: 0.5-168)
- `cognitive.proactive.activeHours` — 推送时段限制:
  - `start` — 开始时间 (如 `"09:00"`, 不设置 = 不限制)
  - `end` — 结束时间 (如 `"22:00"`, 不设置 = 不限制)
  - `timezone` — 时区 (default: `"Asia/Shanghai"`)
- `cognitive.proactive.digestMode` — 推送模式 `"realtime"` / `"daily"` / `"weekly"`（预留，当前均按 realtime 行为）

### 画像提取

- `cognitive.persona.autoExtract` — 自动从对话提取用户画像 (default: true)
- `cognitive.persona.extractionModel` — 提取用模型 (不设置 = 使用主模型)
- `cognitive.persona.identityRefreshHours` — 身份记忆刷新间隔 (default: 24, range: 1-720)

### 洞察引擎

- `cognitive.insight.engine` — 引擎版本 `"v1"` / `"v2"` / `"dual"` (default: `"dual"`)
  - `v1`: LLM 直接生成 + 可选 Web 搜索
  - `v2`: 对话碎片收集 → 聚类 → 结晶
  - `dual`: v1 + v2 并行，去重合并（推荐）
- `cognitive.insight.verificationLevel` — 事实验证严格度 `"basic"` / `"strict"` / `"paranoid"` (default: `"basic"`)
- `cognitive.insight.inferenceModel` — 推理用模型 (不设置 = 使用主模型)
- `cognitive.insight.surpriseRatio` — 惊喜模式占比 0-1 (default: 0.8)
- `cognitive.insight.outputLanguage` — 输出语言 (default: `"zh"`, 自动根据画像检测)
- `cognitive.insight.sources.scanIntervalHours` — 信息扫描间隔 (default: 6, range: 1-168)
- `cognitive.insight.sources.webSearchProvider` — Web 搜索提供商
- `cognitive.insight.sources.explicitTopics` — 显式追踪的话题列表

### 技能进化

- `cognitive.evolution.enabled` — 进化引擎开关 (default: true)
- `cognitive.evolution.minComplexity` — 触发建议的最低复杂度 0-1 (default: 0.6)
- `cognitive.evolution.errorComplexityThreshold` — 出错时降低的阈值 0-1 (default: 0.3)
- `cognitive.evolution.cooldownHours` — 建议冷却时间 (default: 24, range: 1-168)
- `cognitive.evolution.maxSuggestionsPerDay` — 每天上限 (default: 3, range: 1-50)
- `cognitive.evolution.clawhubEnabled` — ClawHub 分享 (default: false)
- `cognitive.evolution.clawhubAutoPublish` — 自动发布 (default: false)

### 反馈

- `cognitive.feedback.mechanism` — 反馈方式 `"emoji"` / `"buttons"` / `"text"` (default: `"emoji"`)
- `cognitive.feedback.implicitFeedback` — 收集隐式反馈 (default: true)

## 模型与提供商

- 主模型: `agents.defaults.model` (default: `"zai/glm-5-turbo"`)
- 添加提供商: `models.providers.<name>.apiKey` + `.baseUrl`
- 可用提供商: zai (智谱GLM), openai, ollama, lmstudio, anthropic, google, deepseek 等 62+ 个扩展
- 别名: `agents.defaults.models` 中设置 alias 映射短名到完整 model ID
- 备用模型: `agents.defaults.model` 可设为 `{ primary: "zai/glm-5-turbo", fallbacks: ["openai/gpt-4o"] }`
- 上下文窗口: 默认 200K tokens

## 记忆系统

- `memory.backend` — 存储后端:
  - `"builtin"` (默认) — 内置文件存储，开箱即用
  - `"qmd"` — 外部 QMD 工具，高性能索引
- `memory.citations` — `"auto"` | `"on"` | `"off"` — 是否在回复中标注记忆来源
- 记忆位置: `~/.kaijibot/workspace/memory/` (每日日志) + `MEMORY.md` (长期精华, 4KB 预算)
- 梦境系统: 默认关闭（`memory.dreaming.enabled: false`）；启用后默认独立存储（不污染每日记忆文件），每天凌晨 3 点执行

## 插件与技能

- 查看已安装技能: `kaijibot skills list`
- 安装技能: `kaijibot skills install <name>`
- 插件管理: `kaijibot plugins list` / `kaijibot plugins enable <name>`
- 技能市场: 从 ClawHub 安装第三方技能

## MCP 服务器管理

使用 `mcp_config` 工具可编程管理 MCP 服务器：

| 操作 | 说明 |
|------|------|
| `list` | 列出所有已配置的 MCP 服务器 |
| `show` | 查看单个服务器详情 |
| `set` | 添加或更新服务器（需提供 name 和 JSON 配置字符串） |
| `unset` | 移除指定服务器 |

## 飞书频道

1. open.feishu.cn 创建企业自建应用
2. 获取 App ID 和 App Secret
3. `kaijibot config set channels.feishu.appId "cli_xxx"`
4. `kaijibot config set channels.feishu.appSecret "xxx"`
5. 启用 WebSocket 事件订阅 (无需公网回调)
6. 所需权限: 消息收发、通讯录、日历读写

## 常用命令

| 命令 | 说明 |
|------|------|
| `kaijibot gateway run` | 启动网关 |
| `kaijibot gateway status` | 网关状态 + 健康检查 |
| `kaijibot config get <path>` | 查看配置 |
| `kaijibot config set <path> <value>` | 设置配置 |
| `kaijibot config schema` | 查看完整 schema（**找不到配置项时首选**） |
| `kaijibot models list` | 列出可用模型 |
| `kaijibot models set <model>` | 切换模型 |
| `kaijibot plugins list` | 查看插件 |
| `kaijibot skills list` | 查看技能 |
| `kaijibot status` | 系统状态 |

## 环境变量

| 变量 | 用途 |
|------|------|
| `ZAI_API_KEY` | 智谱 GLM API Key |
| `EXA_API_KEY` | Exa 语义搜索 |
| `TAVILY_API_KEY` | Tavily AI 搜索 |
| `KAIJIBOT_GATEWAY_PORT` | 网关端口 (default: 18789) |
| `KAIJIBOT_GATEWAY_TOKEN` | 网关认证 token |
| `KAIJIBOT_HOME` | 数据目录 (default: ~/.kaijibot) |

## Agent 操作规范

- 用户问"怎么配置 X" → 先查本指南
- **指南里找不到 → 通过 `gateway` 工具调用 `config.schema.lookup` action 查 schema 细节（类型、默认值、范围、描述），不要凭猜测回答**
- 读取当前值 → `gateway` 工具 `config.get` action
- 修改配置 → `gateway` 工具 `config.patch` action（先征求用户同意！）
- **未经用户明确许可不得修改配置**

## 常见故障排除

| 问题 | 排查 |
|------|------|
| 飞书收不到消息 | 检查 appId/appSecret 是否正确，确认 WebSocket 事件订阅已启用 |
| 模型调用失败 | 检查 `ZAI_API_KEY` 是否设置，用 `kaijibot models status` 查看当前模型 |
| 主动洞察没推送 | 检查 `cognitive.enabled` 和 `cognitive.proactive.enabled` 是否为 true；需要至少 5 轮对话 |
| 凌晨被打扰 | 设置 `cognitive.proactive.activeHours.start` 和 `.end`（如 `"09:00"` - `"22:00"`） |
| 推送太频繁/太稀疏 | 调整 `cognitive.proactive.minIntervalHours`（默认 0.5 小时） |
| 推送内容重复 | 检查 `cognitive.insight.engine` 是否为 `"dual"`（v2 碎片结晶提供多样性） |
| 搜索不工作 | 检查 `EXA_API_KEY` 或 `TAVILY_API_KEY` 是否设置 |
| 网关启动失败 | 用 `kaijibot gateway status` 查看，检查端口是否被占用 |
