---
title: "TOOLS.md Template"
summary: "Workspace template for TOOLS.md — environment-specific operational notes"
read_when:
  - Bootstrapping a workspace manually
---

# TOOLS.md — 运行环境备忘

> "我的环境是什么？"

技能文件定义工具**怎么用**。这个文件记录**你的环境 specifics** — 每个部署实例独有的配置和约定。

## 这里放什么

- 飞书/平台配置（App ID、域名、跨租户规则）
- 网络环境（代理、镜像源、可访问性限制）
- 运行时配置（端口、路径、工具链版本）
- 权限操作习惯
- 其他环境相关的备忘

## 模板结构

```markdown
## 飞书环境

- App ID: `cli_xxxxxxxxxxxxx`
- 企业域名: `xxxx.feishu.cn`
- 外部文档域名: （如有）
- 跨租户规则: `is_cross_tenant` 的含义和影响

## 网络环境

- 国内网络限制: （哪些服务无法直连）
- 镜像源: pnpm/npm/gem 等
- 代理配置: （如有）

## 运行时配置

- Node 版本: 22+
- 包管理器: pnpm
- Gateway 端口: 18789
- 配置文件: 通过 `kaijibot config path` 查看实际路径（默认 `~/.kaijibot/kaijibot.json`）
- Workspace: 通过 `kaijibot status` 查看实际路径（默认 `~/.kaijibot/workspace/`）
- Session 数据: `<workspace>/agents/<agentId>/qmd/sessions/*.md`

## 操作习惯

- （权限、部署、运维等个性化约定）
```

## 为什么单独放

技能是通用的，环境是你的。分开管理意味着：
- 更新技能不会丢失你的环境笔记
- 分享技能不会泄露基础设施细节
- 换环境只需改 TOOLS.md

---

这是你的环境备忘单，按需添加。
