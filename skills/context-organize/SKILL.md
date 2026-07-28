---
name: context-organize
description: "整理上下文：审计和优化三层注入上下文（用户自定义文件 + 动态认知数据），消除冗余，精简 token。当用户说'整理上下文'、'上下文太乱了'、'优化上下文'、'精简 prompt'时使用。"
metadata: { "kaijibot": { "emoji": "🔧", "requires": { "bins": [] }, "install": [] } }
---

# Context Organize

审计并优化 KaijiBot 每个 agent turn 注入的上下文，消除冗余，精简 token 预算，保留高信号密度信息。

## 三层上下文

| 层级              | 来源                                                 | 能否整理    | 工具                                                         |
| ----------------- | ---------------------------------------------------- | ----------- | ------------------------------------------------------------ |
| **L2 用户自定义** | workspace 文件（AGENTS.md / SOUL.md / MEMORY.md 等） | ✅ 直接编辑 | `kaijibot context trim` 诊断 + `edit` 工具修改               |
| **L3 动态提取**   | 认知存储（persona / corrections）                    | ⚠️ 间接清理 | `kaijibot context show` 查看 + `kaijibot context audit` 诊断 |

L1 硬编码（system-prompt.ts）不在本 skill 范围内。

## When to use

- "整理上下文" / "优化上下文" / "上下文太乱了" / "精简 prompt"
- "AGENTS.md 太长了" / "SOUL.md 需要精简"
- "organize context" / "optimize context" / "trim context"

## 三个 CLI 工具

本 skill 依赖三个 CLI 命令。通过 `exec` 工具调用：

| 命令                                              | 用途                 | 输出                                            |
| ------------------------------------------------- | -------------------- | ----------------------------------------------- |
| `kaijibot context show [userId] -a [agent]`       | 查看 L3 认知状态     | persona 概要 + corrections 列表                 |
| `kaijibot context audit [userId] -a [agent]`      | 审计 L3 健康度       | 过时/低使用率/重复 corrections + 过期 domains   |
| `kaijibot context trim [file] -a [agent] --apply` | LLM 分析 L2 文件冗余 | REMOVE/CONDENSE/KEEP 建议（写到 `.trimmed.md`） |

**userId 获取**：当前用户的 cognitive userId 可从 session context 获取（通常是 `operator` 或 `ou_xxx`）。如果不确定，先跑 `kaijibot context show -a main` 列出所有用户。

## How it works

**必须严格按顺序完成所有 4 个步骤。** 每个步骤完成后输出检查点。

### Step 1: 全面诊断（必做）

**1a. L3 状态（CLI）：**

```
exec: kaijibot context show operator -a main
```

记录输出中的：

- persona domains 数量和 active domains
- corrections 总数和各条目的 usageCount / ageDays

**1b. L3 问题（CLI）：**

```
exec: kaijibot context audit operator -a main
```

记录输出中的：

- stale corrections（>45 天）
- unused corrections（usage=0）
- duplicate corrections（Jaccard > 0.6）
- stale persona domains（>60 天）

**1c. L2 文件清单（read）：**

逐个读取 workspace 根目录下的 bootstrap 文件，记录每个文件的字符数和 token 估算（中文 × 1.5 + ASCII × 0.25）：

| 文件         | 读取方式                                                      |
| ------------ | ------------------------------------------------------------- |
| AGENTS.md    | `read` 工具                                                   |
| SOUL.md      | `read` 工具                                                   |
| IDENTITY.md  | `read` 工具                                                   |
| USER.md      | `read` 工具                                                   |
| TOOLS.md     | `read` 工具                                                   |
| MEMORY.md    | `read` 工具（仅统计大小，深度整理交给 memory-organize skill） |
| HEARTBEAT.md | `read` 工具                                                   |
| BOOTSTRAP.md | `read` 工具                                                   |

不存在的文件跳过。

**Step 1 检查点（必须输出后才能继续）：**

```
## Step 1 诊断摘要

### L3 认知状态
- Persona: N domains（M active），trust=X.XX
- Corrections: N 条（avg age Nd，usage avg X）

### L3 问题
- 过时: X 条 | 低使用率: Y 条 | 重复: Z 对 | 过期 domains: W 个

### L2 文件
| 文件 | 字符 | ~token | 状态 |
| --- | --- | --- | --- |
| AGENTS.md | 3500 | ~1100 | ⚠️ 待分析 |
| SOUL.md | 800 | ~250 | ✅ |
| ... | ... | ... | ... |
| **L2 总计** | **T** | **~S** | |

### MEMORY.md
- 大小: X bytes / 8KB 预算 = Y%
- 状态: ✅ 预算内 / ⚠️ 超预算（建议运行"整理记忆"）
```

**进入 Step 2。**

### Step 2: L2 文件整理（必做）

对每个 Step 1c 中标记为 ⚠️ 或较大的文件，执行裁剪。

**2a. CLI 裁剪分析：**

对每个需要整理的文件，调用 CLI 获取 LLM 建议：

```
exec: kaijibot context trim AGENTS.md -a main --apply
```

这会在 workspace 下生成 `AGENTS.md.trimmed.md`，内容是 LLM 的 REMOVE/CONDENSE/KEEP 分析报告。

**2b. 审阅建议：**

读取 `.trimmed.md` 文件。对每条建议做人工判断（你是 agent，你有比单次 LLM 分析更强的上下文理解）：

- **REMOVE 建议**：确认该内容确实是模型已知的通用信息。**安全检查**：
  - 包含 "never" / "must" / "禁止" / "不要" 的安全约束 → **不删**
  - 项目特有命令（如 `pnpm gw:deploy`）→ **不删**
  - 用户偏好（语言/风格/习惯）→ **不删**
  - 通过后才执行删除

- **CONDENSE 建议**：确认精简后的版本保留了关键信息。如果有信息丢失风险 → **保留原文**

- **KEEP 建议**：直接采纳

**2c. 执行修改：**

用 `edit` 工具逐段修改原文件（不用 .trimmed.md 覆盖）。每处修改前展示 before/after 对比。

**2d. 清理临时文件：**

修改完成后，删除 `.trimmed.md` 文件：

```
exec: rm AGENTS.md.trimmed.md
```

**文件整理优先级：**

| 文件                  | 重点删什么                             | 重点留什么                   |
| --------------------- | -------------------------------------- | ---------------------------- |
| AGENTS.md             | 通用工具说明、目录结构、依赖列表       | 安全约束、项目命令、架构边界 |
| SOUL.md               | 冗长的人格解释                         | 核心人格特征、用户设定       |
| TOOLS.md              | 工具的通用用法（agent 从 schema 已知） | 非显然的工具组合技巧         |
| IDENTITY.md / USER.md | 通用身份说明                           | 用户姓名、偏好、关键事实     |
| HEARTBEAT.md          | 过期的任务、心跳机制说明               | 当前活跃任务                 |
| BOOTSTRAP.md          | 通用启动流程                           | 项目特有初始化命令           |

**MEMORY.md 特殊处理**：不在此步整理 MEMORY.md 内容。如果 Step 1 显示超 8KB，在最终报告里建议用户运行"整理记忆"（memory-organize skill）。

**Step 2 检查点：**

```
## Step 2 整理摘要

| 文件 | Before | After | 变化 |
| --- | --- | --- | --- |
| AGENTS.md | ~1100 tok | ~650 tok | -41% |
| TOOLS.md | ~400 tok | ~150 tok | -62% |
| ... | ... | ... | ... |
| **L2 总计** | ~S1 tok | ~S2 tok | **-X%** |

修改详情：
- 删除 N 条模型已知内容
- 精简 M 条冗长描述
- 保留 K 条关键规则
```

**进入 Step 3。**

### Step 3: L3 清理建议（必做）

基于 Step 1b 的 audit 结果，给出清理建议。**不自动删除——列出问题让用户确认。**

**3a. Corrections 清理建议：**

从 Step 1b 的 audit 结果中整理：

```
## Corrections 清理建议

### 过时（>45 天未强化）— N 条
1. [git] forgot to pull before push — 52d ago
   建议: 如果这个错误不再犯，可以删除
2. [feishu] wrong doc format — 48d ago
   建议: 保留（仍可能犯）

### 低使用率（usage=0, reinforced≤1）— N 条
1. [general] responded too verbosely — never referenced
   建议: 删除（从未被注入后引用）

### 重复（Jaccard > 0.6）— N 对
1. [git] "forgot pull" vs [git] "didn't pull first" — sim=0.75
   建议: 合并保留 reinforcedCount 更高的那条
```

**问用户**："以上 N 条 corrections 建议清理，你要删除/合并哪些？"

等用户回复后，根据用户选择：

- 如果用户确认删除某条：目前没有直接的 agent tool 删除单条 correction。记录建议，告知用户可以通过编辑 `~/.kaijibot/cognitive/corrections/{agentId}/{userId}.json` 手动删除对应条目。
- 如果用户确认合并：同样记录建议，告知手动操作方式。

**3b. Persona domains 状态：**

从 Step 1a 的 show 结果中检查：

```
## Persona Domains 状态
- LLM systems: depth=8, 2d ago, stable ✅
- TypeScript: depth=6, 5d ago, stable ✅
- philosophy: depth=3, 60d ago, declining ⚠️
  建议: 自然衰减即可，不需手动操作
```

persona domains 由认知层自动维护（half-life 衰减），不需要手动清理。

**Step 3 检查点：**

```
## Step 3 L3 清理摘要
- Corrections: X 条建议清理（用户确认删除 Y 条）
- 重复 corrections: Z 对建议合并（用户确认合并 W 对）
- Persona domains: N active, M declining（自动衰减中）
```

**进入 Step 4。**

### Step 4: 验证与报告（必做）

**4a. L2 最终统计：**

重新读取所有修改过的文件，统计最终字符和 token。

**4b. L3 最终状态（CLI）：**

```
exec: kaijibot context show operator -a main
```

确认 L3 状态与 Step 1 一致（L3 数据在这轮整理中不应有变化，除非用户在 Step 3 确认了 corrections 删除）。

**4c. 输出最终报告：**

```
## 🔧 上下文整理完成

### L2 用户文件
| 文件 | Before | After | 节省 |
| --- | --- | --- | --- |
| AGENTS.md | ~1100 tok | ~650 tok | -41% |
| ... | ... | ... | ... |
| **L2 总计** | ~S1 tok | ~S2 tok | **-X%** |

### L3 认知状态
- Persona: N domains, trust=X.XX
- Corrections: N active（清理了 M 条）

### 整理详情
- 🗑️ 删除 N 条模型已知/冗余内容
- ✂️ 精简 M 条冗长描述
- ✅ 保留 K 条关键规则
- 📝 Corrections: 建议清理 X 条，用户确认 Y 条

### 建议
- 定期运行 `kaijibot context audit` 监控 L3 健康度
- [如果 MEMORY.md 超预算] 运行"整理记忆"深度整理 MEMORY.md
- [如果 corrections 较多] 定期检查 `~/.kaijibot/cognitive/corrections/` 手动清理过时条目
```

## 判断标准（第一性原理）

对每一段内容，问三个问题：

1. **模型已经知道吗？** — 通用工具描述、语言能力、常见模式 → **删除**
2. **与其他内容重复吗？** — 同一规则在多处出现 → **保留一处**
3. **驱动行为吗？** — 项目特有规则、用户偏好、安全约束 → **保留**

只有第 3 个"是"才值得占用 token。

## Notes

- `kaijibot context trim` 的 `--apply` 生成 `.trimmed.md` 建议文件，不会覆盖原文件
- 整理后 agent 行为应该不变或更好（高信号密度 = 高注意力效率）
- 不确定是否该删的内容，保留（宁可多花 token 也不要丢信息）
- 可以重复运行，幂等安全
- MEMORY.md 深度整理由 memory-organize skill 负责
- Corrections 没有直接的 agent tool 删除单条——Step 3 只给建议，用户手动操作
- Persona domains 自动衰减，不需要手动清理
