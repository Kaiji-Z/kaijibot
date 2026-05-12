---
title: "TOOLS.md Template"
summary: "Workspace template for TOOLS.md — environment-specific operational notes"
read_when:
  - Bootstrapping a workspace manually
---

# TOOLS.md — Runtime Environment Notes

> "What does my environment look like?"

Skill files define **how to use** tools. This file records **your environment specifics** — configurations and conventions unique to each deployment instance.

## What Goes Here

- Feishu/platform configuration (App ID, domain, cross-tenant rules)
- Network environment (proxies, mirror registries, accessibility restrictions)
- Runtime configuration (ports, paths, toolchain versions)
- Permission and operational conventions
- Other environment-related notes

## Template Structure

```markdown
## Feishu Environment

- App ID: `cli_xxxxxxxxxxxxx`
- Enterprise domain: `xxxx.feishu.cn`
- External document domain: (if applicable)
- Cross-tenant rules: meaning and impact of `is_cross_tenant`

## Network Environment

- Regional network restrictions: (which services cannot be accessed directly)
- Mirror registries: pnpm/npm/gem etc.
- Proxy configuration: (if applicable)

## Runtime Configuration

- Node version: 22+
- Package manager: pnpm
- Gateway port: 18789
- Config file: check actual path via `kaijibot config path` (default `~/.kaijibot/kaijibot.json`)
- Workspace: check actual path via `kaijibot status` (default `~/.kaijibot/workspace/`)
- Session data: `~/.kaijibot/agents/<agentId>/sessions/*.jsonl`

## Operational Conventions

- (Personalized rules for permissions, deployment, ops, etc.)
```

## Why Keep It Separate

Skills are universal; your environment is yours. Managing them separately means:
- Updating skills won't lose your environment notes
- Sharing skills won't leak infrastructure details
- Switching environments only requires changing TOOLS.md

---

This is your environment cheat sheet. Add to it as needed.
