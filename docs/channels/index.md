---
summary: "KaijiBot 支持的聊天频道"
read_when:
  - 你想了解 KaijiBot 支持哪些聊天平台
title: "Chat Channels"
---

# Chat Channels

KaijiBot 主通过飞书（Feishu/Lark）与用户交互，微信（WeChat / iLink Bot）作为一等频道同等深度支持。两个一等频道均通过 WebSocket / 长连接接收消息和事件，支持私聊和群聊。

## 支持的频道（一等）

- [飞书 / Feishu](/channels/feishu) — 飞书/Lark 机器人，通过 WebSocket 连接（内置插件）。支持私聊、群聊、富文本消息、事件订阅。**推荐**：向导支持扫码自动创建机器人。
- [微信 / WeChat](/channels/wechat) — WeChat (iLink Bot) 机器人，二维码扫码登录、长轮询接收消息、AES-128-ECB 加密 CDN 媒体。运行 `kaijibot channels login --channel wechat` 接入。

## 上游频道（仅供参考，未深度测试）

以下 16 个频道继承自上游 OpenClaw 项目，**KaijiBot 中代码保留但未深度测试**，定位为参考。页面保留供高级用户探索：

- BlueBubbles, Discord, Google Chat, iMessage, IRC, LINE, Matrix, Mattermost, Microsoft Teams, Nextcloud Talk, Nostr, QQ Bot, Signal, Slack, Synology Chat, Telegram, Tlion, Twitch, WhatsApp, Zalo

如需生产级使用这些频道，建议参考 [OpenClaw 上游项目](https://github.com/openclaw/openclaw) 或自行测试。

## 相关文档

- 群聊行为：[Groups](/channels/groups)
- 安全与权限：[Security](/gateway/security)
- 故障排除：[Channel troubleshooting](/channels/troubleshooting)
- 模型提供商：[Model Providers](/providers/models)
