---
summary: "KaijiBot 微信 (WeChat / iLink Bot) 频道接入指南"
read_when:
  - 你想在微信里跟 KaijiBot 对话
title: "WeChat / 微信"
---

# WeChat / 微信

KaijiBot 通过 **iLink Bot** 协议接入微信，作为一等频道与飞书同等深度支持。

## 能力

- 二维码扫码登录（个人微信号）
- 长轮询接收消息（私聊 + 群聊）
- AES-128-ECB 加密的 CDN 媒体（图片/语音/视频）
- 自动 silk-wasm 语音编解码
- 主动洞察推送（与飞书一致的 PRISM 门控体验）

## 接入步骤

```bash
# 1. 确保 KaijiBot 已安装且 LLM API Key 已配置（运行 kaijibot onboard 完成）

# 2. 登录微信
kaijibot channels login --channel wechat

# 这会弹出二维码，用手机微信扫码确认登录

# 3. 启动 gateway
kaijibot gateway --port 18789
```

登录成功后，向你的微信机器人账号发消息即可开始对话。

## 配置

微信频道通过 `kaijibot config set` 配置：

```bash
# 启用/禁用（默认启用当且仅当已登录）
kaijibot config set channels.wechat.enabled true

# 自定义 iLink Bot 服务地址（默认使用公共服务）
kaijibot config set channels.wechat.api.baseUrl "https://your-ilink-bot-server"
```

## 故障排除

| 问题           | 解决方案                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------- |
| 扫码后无响应   | 检查 `kaijibot channels login --channel wechat` 是否报错；查看 gateway 日志的 `[wechat]` 行 |
| 群消息不响应   | 群聊默认需要 @机器人，配置 `channels.wechat.replyOnGroupMentionOnly: false` 可改变行为      |
| 语音消息听不懂 | 确保 `silk-wasm` 已安装（`pnpm install` 后自动）                                            |
| 图片发不出去   | iLink Bot CDN 偶有限速，等几分钟重试                                                        |

## 与飞书的差异

| 维度     | 飞书                    | 微信                        |
| -------- | ----------------------- | --------------------------- |
| 协议     | WebSocket 长连接        | 长轮询 + iLink Bot          |
| 登录     | 扫码创建机器人（10 秒） | 扫码登录个人微信号（30 秒） |
| 媒体加密 | 平台原生                | AES-128-ECB（自动处理）     |
| 富文本   | 原生支持                | 受限（受微信本身限制）      |
| 推荐场景 | 工作/团队               | 个人/国内日常               |

## 相关文档

- 频道总览：[Channels](/channels/index)
- 飞书接入：[Feishu](/channels/feishu)
- 群聊行为：[Groups](/channels/groups)
- 故障排除通用指南：[Channel troubleshooting](/channels/troubleshooting)
