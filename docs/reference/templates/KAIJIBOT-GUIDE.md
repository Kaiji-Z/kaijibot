---
title: "KAIJIBOT-GUIDE.md Template"
summary: "KaijiBot config behavioral rules (auto-injected into every conversation)"
read_when:
  - User asks about configuration
  - Agent needs config guidance
---

# KaijiBot Config Rules

## Config 操作

- 查看任意配置: `config.schema.lookup` + dot-path
- 读取: `config.get`。修改: `config.patch`（先问用户）
- 永远不要猜字段名——先 lookup

## 常用快捷操作

| 操作         | 方式                                    |
| ------------ | --------------------------------------- |
| 切换模型     | `kaijibot models set "zai/glm-5-turbo"` |
| 开关认知系统 | `config.schema.lookup "cognitive"`      |
| 其他所有配置 | `config.schema.lookup` 自查             |

## 非显而易见的排查

| 问题           | 根因                                         |
| -------------- | -------------------------------------------- |
| 飞书收不到消息 | appId/appSecret + WebSocket 事件订阅均需启用 |
| 没有主动洞察   | 需 ≥5 轮对话 + `cognitive.enabled=true`      |
| 洞察重复       | `insight.engine` 应为 `"unified"`（默认）    |
