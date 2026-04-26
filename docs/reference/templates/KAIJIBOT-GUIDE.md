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

| 操作 | 命令 |
|------|------|
| 换模型 | `kaijibot config set agents.defaults.model "zai/glm-5-turbo"` |
| 认知开关 | `cognitive.enabled` / `cognitive.proactive.enabled` (boolean) |
| 推送频率 | `cognitive.proactive.minIntervalHours` (number, 默认 4) |
| 活跃时段 | `cognitive.proactive.activeHours.start` / `.end` / `.timezone` |
| 网络搜索 | `tools.web.search.enabled` + 环境变量 `EXA_API_KEY` / `TAVILY_API_KEY` |
| 飞书频道 | `channels.feishu.appId` / `channels.feishu.appSecret` |
| API Key | 环境变量 `ZAI_API_KEY` 或 `models.providers.zai.apiKey` |
| 时区 | `agents.defaults.userTimezone` (如 "Asia/Shanghai") |
| 记忆 | `memory.backend` ("memory" \| "lancedb" \| "wiki") / `memory.citations` |

## 认知系统

- `cognitive.enabled` — 总开关 (default: true)
- `cognitive.proactive.enabled` — 主动推送 (default: true)
- `cognitive.proactive.minIntervalHours` — 最小间隔 (default: 4)
- `cognitive.proactive.activeHours` — `{ start: "08:00", end: "22:00", timezone: "Asia/Shanghai" }`
- `cognitive.persona.extractionMode` — "dual" (规则+LLM) | "rule" | "llm"
- `cognitive.insight.maxPerDay` — 每日洞察上限 (default: 3)
- `cognitive.feedback.trustInitial` — 初始信任度 (default: 0.2)

## 模型与提供商

- 主模型: `agents.defaults.model`
- 添加提供商: `models.providers.<name>.apiKey` + `.baseUrl`
- 可用提供商: zai (智谱GLM), openai, ollama, lmstudio
- 别名: `agents.defaults.models` 中设置 alias 映射短名到完整 model ID
- 备用模型: `agents.defaults.model` 可设为 `{ primary: "zai/glm-5-turbo", fallbacks: ["openai/gpt-4o"] }`

## 记忆系统

- `memory.backend` — 存储后端:
  - `"builtin"` (默认) — 内置文件存储，开箱即用
  - `"lancedb"` — LanceDB 向量库，支持语义搜索
  - `"qmd"` — 外部 QMD 工具，高性能索引
- `memory.citations` — `"auto"` | `"on"` | `"off"` — 是否在回复中标注记忆来源
- 记忆位置: `~/.kaijibot/workspace/memory/` (每日日志) + `MEMORY.md` (长期精华)

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

- `kaijibot gateway start|stop|restart|status` — 网关管理
- `kaijibot config get <path>` — 查看配置
- `kaijibot config set <path> <value>` — 设置配置
- `kaijibot config schema` — 查看完整 schema

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
- 需要更多 schema 细节 → 用 `config.schema.lookup(path)` 工具查询（你自己调用，不是让用户调用）
- 读取当前值 → `config.get`
- 修改配置 → `config.patch`（先征求用户同意！）
- **未经用户明确许可不得修改配置**

## 常见故障排除

| 问题 | 排查 |
|------|------|
| 飞书收不到消息 | 检查 appId/appSecret 是否正确，确认 WebSocket 事件订阅已启用 |
| 模型调用失败 | 检查 `ZAI_API_KEY` 是否设置，用 `/status` 查看当前模型 |
| 主动洞察没推送 | 检查 `cognitive.enabled` 和 `cognitive.proactive.enabled` 是否为 true |
| 推送太频繁/太稀疏 | 调整 `cognitive.proactive.minIntervalHours`（默认 4 小时） |
| 搜索不工作 | 检查 `EXA_API_KEY` 或 `TAVILY_API_KEY` 是否设置 |
| 网关启动失败 | 用 `kaijibot gateway status` 查看，检查端口是否被占用 |
