---
name: context-organize
description: "整理和优化 KaijiBot 的上下文 token 预算。审计三层注入（L1 硬编码 / L2 用户文件 / L3 认知数据），找出跨层冗余，精简 L2 文件，清理过期 L3 数据。当用户说'整理上下文'、'上下文太乱了'、'优化上下文'、'精简 prompt'、'AGENTS.md 太长'、'token 太多了'、'context audit'、'organize context'、'trim context' 时使用。即使用户没有明确说'上下文'，只要提到某个 workspace 文件（AGENTS/SOUL/USER/TOOLS）需要精简或优化，也应使用此 skill。"
metadata: { "kaijibot": { "emoji": "🔧", "requires": { "bins": [] }, "install": [] } }
---

# Context Organize

KaijiBot 每个 agent turn 注入三层上下文：L1 硬编码（system-prompt.ts）、L2 用户文件（AGENTS.md 等 7 个 bootstrap 文件）、L3 认知数据（persona + corrections）。随着使用积累，L2 文件膨胀、L3 数据过期，token 预算被无效内容占据，模型注意力被稀释。

这个 skill 通过审计 → 精简 → 验证三步，把 token 预算还给真正驱动行为的内容。

## 三步流程

### Step 1: 审计

```
exec: kaijibot context audit operator -a main
```

audit 是确定性计算（查日期 + Jaccard 相似度 + 关键词匹配），秒级返回。输出包含：

- L1/L2/L3 三层 token 分布
- L2 每个文件的 token 占比
- L3 问题诊断：过时 corrections、低使用率、重复、跨层冗余

读完后向用户汇报审计摘要：总 token、最大 L2 文件、L3 问题。

### Step 2: 精简 L2 文件

对 audit 发现的所有超过 ~300 token 的 L2 文件逐个分析并精简。

**可整理的文件**：AGENTS.md · SOUL.md · IDENTITY.md · USER.md · TOOLS.md · HEARTBEAT.md

**不可整理的文件**：MEMORY.md。它由 consolidation 系统（每日 cron 自动提取知识 + 路由到 persona/fragment/correction + 8KB 预算自动平衡）独立管理。LLM trim 不理解 consolidation 的路由规则，会误删核心记忆。CLI 层面已硬保护（`trim MEMORY.md` 会被拒绝），你也不要用 edit 工具手动改它。

对每个待整理的文件，执行 trim 分析：

```
exec: kaijibot context trim <文件名> -a main --apply
```

trim 会读取文件内容 + L1 system prompt 关键段 + L3 persona/corrections，用 LLM 对比三层后输出 REMOVE / CONDENSE / KEEP 建议（写到 `.trimmed.md`）。

读取建议后，你是最终决策者——你有完整的对话上下文，比单次 LLM 分析判断更准：

- **REMOVE**：确认该内容确实是模型已知的通用知识、L1 已覆盖的规则、或 L3 已固化的认知。安全约束（"never"/"禁止"）、项目特有命令（`pnpm gw:deploy`）、用户偏好——这些驱动行为的内容必须保留
- **CONDENSE**：确认精简版保留了关键语义。有些文件写得啰嗦但信息密度低，压缩后反而更容易被模型注意到
- **KEEP**：采纳

用 `edit` 工具逐段修改原文件，每处展示 before/after 让用户确认。改完后删除 `.trimmed.md` 临时文件。

**判断原则**：对每段内容问三个问题——
1. 模型本来就知道？（通用工具描述、语言能力、常见编程模式）→ 删
2. 跨层重复？（L1 system prompt 已有 / L3 persona 已固化 / 另一个 L2 文件已覆盖）→ 留信息密度最高的那处
3. 驱动特定行为？（项目命令、安全红线、用户习惯、平台特性）→ 留

### Step 3: 清理 L3 + 验证

```
exec: kaijibot context audit operator -a main --fix
```

`--fix` 删除过时 corrections（>45 天未强化）和重复 corrections。这是确定性操作，安全执行。

如果 audit 报告了"低使用率但未过期"的 corrections，列出来让用户决定是否手动删除（通过编辑 `~/.kaijibot/cognitive/corrections/{agentId}/{userId}.json`）。

最后再次运行 `audit`（不带 --fix）确认最终 token 分布，对比 Step 1 的数据向用户汇报变化。
