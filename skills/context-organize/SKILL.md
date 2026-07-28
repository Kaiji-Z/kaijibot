---
name: context-organize
description: "整理上下文：审计和优化三层注入上下文（用户自定义文件 + 动态认知数据），消除冗余，精简 token。当用户说'整理上下文'、'上下文太乱了'、'优化上下文'、'精简 prompt'时使用。"
metadata: { "kaijibot": { "emoji": "🔧", "requires": { "bins": [] }, "install": [] } }
---

# Context Organize

审计并优化 KaijiBot 每个 agent turn 注入的上下文，消除冗余，精简 token。

## 两个 CLI 工具

| 命令                                              | 用途                                                  | 需要 LLM？ | 耗时   |
| ------------------------------------------------- | ----------------------------------------------------- | ---------- | ------ |
| `kaijibot context audit [userId] -a [agent]`      | 诊断三层 token + L3 问题 + 跨层冗余；`--fix` 自动修复 | ❌         | 秒级   |
| `kaijibot context trim [file] -a [agent] --apply` | LLM 分析 L2 文件 vs L1/L3 的跨层冗余                  | ✅         | 十秒级 |

**分工**：audit 做确定性诊断+修复（快），trim 做语义分析+建议（慢但精准）。

## When to use

- "整理上下文" / "优化上下文" / "上下文太乱了" / "精简 prompt"
- "AGENTS.md 太长了" / "SOUL.md 需要精简"
- "organize context" / "optimize context" / "trim context"

## How it works

**严格按顺序完成 3 个步骤。**

### Step 1: 全面审计（必做）

```
exec: kaijibot context audit operator -a main
```

**获取的信息**：

- L1/L2/L3 三层 token 预算分布
- L2 每个文件的 token（哪个最大）
- L3 persona/corrections 状态
- 问题诊断：过时 corrections / 低使用率 / 重复 / 跨层冗余

同时用 `read` 工具读取所有 L2 bootstrap 文件（AGENTS.md / SOUL.md / IDENTITY.md / USER.md / TOOLS.md / HEARTBEAT.md / BOOTSTRAP.md），获取完整内容。

**Step 1 检查点：**

```
## Step 1 审计摘要
- L1: ~2700 tok | L2: ~Stok | L3: ~T tok | 总计: ~X tok
- L2 最大文件: AGENTS.md (~1100 tok)
- L3 问题: A 过时 / B 低使用 / C 重复 / D 跨层冗余
- 整理重点: [L2 文件 / L3 数据 / 两者]
```

### Step 2: L2 文件整理（必做）

对 Step 1 发现的较大 L2 文件执行裁剪。

**2a. CLI 跨层分析：**

```
exec: kaijibot context trim AGENTS.md -a main --apply
```

trim 命令会：

1. 读取 AGENTS.md 内容
2. 获取 L1 system prompt 的关键段（Tooling/Safety/Capabilities/Messaging）
3. 获取 L3 persona traits + corrections
4. 用 LLM 对比三层，找出冗余
5. 输出 REMOVE / CONDENSE / KEEP 建议（写到 `.trimmed.md`）

**2b. 审阅建议：**

读取 `.trimmed.md`。对每条建议做判断（你是 agent，比单次 LLM 分析有更强上下文）：

- **REMOVE**：确认不是安全约束/项目命令/用户偏好后才执行
- **CONDENSE**：确认精简版保留关键信息
- **KEEP**：采纳

**安全检查清单（不删这些）：**

- 包含 "never" / "must" / "禁止" / "不要" 的安全约束
- 项目特有命令（如 `pnpm gw:deploy` / `scripts/committer`）
- 用户偏好（语言/风格/习惯）
- SOUL.md 的核心人格特征

**2c. 执行修改：**

用 `edit` 工具逐段修改原文件。每处展示 before/after。

**2d. 清理：**

```
exec: rm AGENTS.md.trimmed.md
```

**Step 2 检查点：**

```
## Step 2 整理摘要
| 文件 | Before | After | 变化 |
| --- | --- | --- | --- |
| AGENTS.md | ~1100 tok | ~650 tok | -41% |
| **L2 总计** | ~S1 | ~S2 | **-X%** |
```

### Step 3: L3 自动修复（必做）

```
exec: kaijibot context audit operator -a main --fix
```

`--fix` 自动执行：

- 删除过时 corrections（>45 天未强化）
- 删除重复 corrections 中 reinforcedCount 较低的那条

如果用户想先预览：

```
exec: kaijibot context audit operator -a main --dry-run
```

**Corrections 手动清理**：`--fix` 只处理确定性问题（过时/重复）。对于"低使用率但未过期"的 corrections，展示给用户确认：

"以下 corrections 从未被引用，是否删除？

1. [general] responded too verbosely
2. [coding] used var instead of const

用户确认后，通过编辑 `~/.kaijibot/cognitive/corrections/{agentId}/{userId}.json` 手动删除。"

**Step 3 检查点：**

```
## Step 3 L3 修复摘要
- --fix 删除: X 条过时 + Y 条重复 = Z 条
- 手动确认: 低使用率 N 条（用户删除 M 条）
- Persona domains: 自动衰减中，不需操作
```

### 最终报告

```
## 🔧 上下文整理完成

| 层级 | Before | After | 变化 |
| --- | --- | --- | --- |
| L1 硬编码 | ~2700 | ~2700 | 不变 |
| L2 用户文件 | ~S1 | ~S2 | -X% |
| L3 认知数据 | ~T1 | ~T2 | -Y% |
| **总计** | ~X1 | ~X2 | **-Z%** |
```

## 判断标准

对每段内容问：

1. **模型已知？** → 删（通用工具描述/语言能力/常见模式）
2. **跨层重复？** → 留一处（L1 已有/L3 已有/另一文件已有）
3. **驱动行为？** → 留（项目命令/安全约束/用户偏好）

## Notes

- audit 是确定性计算（查日期 + Jaccard + 关键词匹配），秒级返回
- trim 需要 LLM（语义判断"模型是否已知"），十秒级
- trim 的 `--apply` 写到 `.trimmed.md`，不覆盖原文件
- audit `--fix` 只删 L3 数据（corrections），不改 L2 文件
- L2 文件修改用 edit 工具，由 agent 审阅后执行
- MEMORY.md 深度整理交给 memory-organize skill
- 可以重复运行，幂等安全
