# KaijiBot Simplify — 精简版个人 AI 助手

> 基于 [KaijiBot](https://github.com/kaijibot/kaijibot) 的精简 Fork，面向国内 Windows 用户，预配置飞书频道 + Z.AI (智谱 GLM) 模型。

## 这是什么

KaijiBot 是一个开源的个人 AI 助手平台。本项目是其精简发行版：

- **保留核心引擎** — Agent 运行循环、插件系统、会话管理、配置系统全部完整
- **飞书频道** — 唯一的消息频道，通过飞书机器人收发消息
- **Z.AI (智谱)** — 默认 LLM 提供商（GLM-5.1 等），同时保留 OpenAI 兼容层
- **上游兼容** — 插件系统、技能系统、数据格式（`~/.kaijibot/`）完全兼容原版 KaijiBot，可随时安装上游新插件/技能

## 精简内容

| 保留 | 移除 |
|------|------|
| 16 个扩展（飞书、Z.AI、OpenAI、浏览器、记忆等） | ~85 个不用的频道和 LLM 提供商 |
| 21 个国内可用的技能 | 32 个国内不可用的技能 |
| CLI + Web API（Gateway） | macOS/iOS/Android 原生应用 |
| 完整的插件系统和技能系统 | 上游 CI、Docker 沙箱、部署配置 |

## 快速开始

### 前置要求

- Node.js 22+（推荐 24）
- pnpm
- Z.AI API Key（[获取地址](https://open.bigmodel.cn/)）
- 飞书机器人（[创建指南](https://open.feishu.cn/)）

### 安装与构建

```bash
git clone <你的仓库地址>
cd kaijibot
pnpm install
pnpm build
```

### 配置

1. 设置 Z.AI API Key：

```bash
# 环境变量（推荐）
export ZAI_API_KEY="your-api-key"

# 或通过配置文件设置默认模型
kaijibot config set agents.defaults.model '{"primary":"zai/glm-5.1"}' --strict-json
```

2. 配置飞书频道（参照飞书扩展文档）：

```bash
kaijibot config set channels.feishu.appId "your-app-id"
kaijibot config set channels.feishu.appSecret "your-app-secret"
```

### 运行

```bash
# 启动 Gateway
kaijibot gateway --port 18789 --verbose

# 或使用 pnpm
pnpm kaijibot gateway --port 18789 --verbose
```

## 从原版 KaijiBot 迁移

如果你已经在另一台电脑上使用 KaijiBot，迁移步骤：

1. 复制 `~/.kaijibot/` 目录到新电脑
2. 修改频道配置（从原频道改为飞书）
3. 修改模型配置（从原模型改为 `zai/glm-5.1`）
4. 启动 Gateway — 会话历史、记忆、技能设置自动兼容

## 同步上游

```bash
git remote add upstream https://gitee.com/kaiji1126/kaijibot
git fetch upstream
git merge upstream/main
```

核心代码（`src/`）完全兼容，合并冲突极少。

## 保留的扩展

### LLM 提供商
- **zai** — Z.AI 智谱（GLM-5.1、GLM-5、GLM-4.7 等）
- **openai** — OpenAI 兼容层

### 消息频道
- **feishu** — 飞书机器人

### 核心能力
- **browser** — 浏览器自动化
- **memory-core / memory-lancedb / memory-wiki** — 记忆系统
- **speech-core / talk-voice** — 语音能力
- **media-understanding-core** — 媒体理解
- **image-generation-core** — 图片生成
- **diffs / llm-task / device-pair / webhooks / shared** — 工具类

## 保留的技能

github, gh-issues, weather, summarize, coding-agent, mcporter, skill-creator, session-logs, healthcheck, notion, obsidian, canvas, nano-pdf, taskflow, taskflow-inbox-triage, clawhub, video-frames, gifgrep, node-connect, blogwatcher, sherpa-onnx-tts

需要更多技能？从 ClawHub 安装：`kaijibot skills install <skill-name>`

## 技术栈

- TypeScript (ESM) + pnpm monorepo
- Vitest 测试框架
- tsdown 构建
- Gateway: WebSocket + HTTP 服务器

## 许可证

MIT — 与上游 KaijiBot 相同。

## 致谢

基于 [KaijiBot](https://github.com/kaijibot/kaijibot) 项目，由 Peter Steinberger 及社区开发。
