---
name: context-organize
description: "整理上下文：审计和优化三层注入上下文（用户自定义文件 + 动态认知数据），消除冗余，精简 token。当用户说'整理上下文'、'上下文太乱了'、'优化上下文'、'精简 prompt'时使用。"
metadata: { "kaijibot": { "emoji": "🔧", "requires": { "bins": [] }, "install": [] } }
---

# Context Organize

审计并优化 KaijiBot 每个 agent turn 注入的三层上下文，消除冗余内容，精简 token 预算，保留高信号密度信息。

## 三层上下文架构

| 层级              | 来源                        | 示例                                                                                             | 本 skill 能否修改     |
| ----------------- | --------------------------- | ------------------------------------------------------------------------------------------------ | --------------------- |
| **L1 硬编码**     | 系统代码 `system-prompt.ts` | Capabilities / Tooling / Safety                                                                  | ❌ 不可改（需改代码） |
| **L2 用户自定义** | workspace 文件              | AGENTS.md / SOUL.md / MEMORY.md / IDENTITY.md / USER.md / TOOLS.md / HEARTBEAT.md / BOOTSTRAP.md | ✅ 直接编辑文件       |
| **L3 动态提取**   | 认知存储                    | persona (domains/insights) / corrections / evolution                                             | ⚠️ 通过工具间接清理   |

**本 skill 覆盖 L2 + L3**。L1 是系统代码，不在 skill 范围内。

## When to use (trigger phrases)

Use this skill immediately when the user asks any of:

- "整理上下文" / "优化上下文"
- "上下文太乱了" / "精简上下文"
- "AGENTS.md 太长了" / "SOUL.md 需要精简"
- "organize context" / "optimize context" / "trim context"
- "context is bloated" / "prompt too long"

## 第一性原理（判断标准）

对每一段内容，问三个问题：

1. **模型已经知道吗？** — 通用工具描述、语言能力、常见编码模式、目录结构 → **删除**
2. **与其他内容重复吗？** — 同一规则在 AGENTS.md 和 TOOLS.md 都写了 → **保留一处**
3. **驱动行为吗？** — 项目特有规则、用户偏好、与默认不同的约定 → **保留**

只有第 3 个回答"是"的内容才值得占用 token。

## How it works

**必须严格按顺序完成所有 4 个步骤。** 每个步骤完成后有检查点。

### Step 1: 上下文诊断（必做）

**1a. 读取所有 workspace bootstrap 文件：**

逐个读取以下文件（workspace 根目录下）：

- `AGENTS.md` — 项目规则
- `SOUL.md` — 人格定义
- `IDENTITY.md` — 身份信息
- `USER.md` — 用户信息
- `TOOLS.md` — 工具指南
- `MEMORY.md` — 长期记忆（如果需要深度整理 MEMORY.md，使用 memory-organize skill）
- `HEARTBEAT.md` — 心跳任务
- `BOOTSTRAP.md` — 启动引导

不存在的文件跳过。

**1b. 统计每个文件的字符数和估算 token：**

token 估算公式：中文字符 × 1.5 + ASCII 字符 × 0.25。

输出诊断表：

```
## 上下文诊断

| 文件 | 字符数 | 估算 token | 状态 |
| --- | --- | --- | --- |
| AGENTS.md | 3500 | ~1100 | ⚠️ 含模型已知内容 |
| SOUL.md | 800 | ~250 | ✅ 精简 |
| MEMORY.md | 6000 | ~2000 | ⚠️ 超预算（8KB limit）|
| ... | ... | ... | ... |
| **L2 总计** | **12000** | **~4000** | |
```

**1c. 识别问题：**

对每个文件的内容，识别以下问题类别：

- 🔴 **模型已知**：通用工具描述、语言能力、常见模式（LLM 从工具定义已知）
- 🟡 **冗余重复**：同一信息在多个文件中重复出现
- 🟡 **过于冗长**：可以用 1-2 行替代的长段落
- 🟢 **保留**：项目特有规则、用户偏好、与默认不同的约定

**Step 1 检查点：**

```
## Step 1 诊断摘要
- 扫描文件：N 个（其中 M 个存在）
- L2 总 token：~T
- 问题：A 条模型已知 / B 条冗余 / C 条冗长
- 预估可节省：~S token（X%）
```

**进入 Step 2。**

### Step 2: 整理 L2 用户自定义文件（必做）

**逐个文件、逐段分析并修改。**

对每个有问题的文件，按以下流程操作：

**2a. 分析：**

读取文件全文。对每个段落/section，判断：

- **REMOVE**（删除）：模型已知的通用内容。判断标准——如果删掉这段，agent 的行为会退化吗？如果不会（因为它从工具定义或其他 system prompt 段已知），就删除。
  - 例子：`"Conversational AI — Natural Chinese and English conversations"` → 删除（LLM 本质就是对话 AI）
  - 例子：`"Use cron for scheduling"` → 删除（Tooling 段已说）
  - 例子：`"This project uses TypeScript"` → 删除（agent 能从代码文件自行发现）

- **CONDENSE**（精简）：冗长描述可以缩短。
  - 例子：10 行的工具使用说明 → 2 行关键规则
  - 例子：详细的代码风格说明 → 1 行 `使用 oxlint 风格，4 空格缩进`
  - 例子：冗长的目录结构描述 → 删除（agent 能用 exec/read 自行发现）

- **KEEP**（保留）：项目特有规则、用户偏好、关键约束。
  - 例子：`"不要在飞书消息里发流式回复"` → 保留（KaijiBot 特有约束）
  - 例子：`"用户偏好中文回复"` → 保留（用户偏好）
  - 例子：`"部署用 pnpm gw:deploy"` → 保留（项目特有命令）

**2b. 修改文件：**

使用 `edit` 工具直接修改文件。每处修改：

- 先展示 before/after 对比
- 然后执行 edit
- 记录修改的字符差

**关键约束：**

- **不要删除安全相关规则** — 任何包含 "never" / "must" / "禁止" 的安全约束，保留
- **不要删除用户偏好** — 用户的个人偏好（语言、风格、习惯），保留
- **不要删除项目特有命令** — 如 `pnpm gw:deploy`、`scripts/committer` 等，保留
- **SOUL.md 特别注意** — 人格定义是用户精心设定的，只精简冗长解释，不改变人格核心
- **MEMORY.md 不在此步整理** — MEMORY.md 有专门的 memory-organize skill。如果 MEMORY.md 超预算，建议用户运行"整理记忆"

**2c. 修改后验证：**

修改完每个文件后，重新读取确认格式正确（markdown 结构完整，没有断裂的 section）。

**Step 2 检查点：**

```
## Step 2 整理摘要
- 修改文件：N 个
- 删除段落：X 条（模型已知/冗余）
- 精简段落：Y 条
- 保留段落：Z 条
- 节省 token：~S（从 T1 降到 T2，降 X%）
```

**进入 Step 3。**

### Step 3: 清理 L3 动态认知数据（可选）

**仅在 Step 1 诊断发现 L3 有问题时执行。**

**3a. Corrections 清理：**

通过 exec 调用 CLI 审计 corrections：

```
exec: kaijibot context audit operator -a main
```

识别：

- **过时 corrections**（>45 天未强化）：列出，询问用户是否删除
- **低使用率 corrections**（usageCount=0, reinforcedCount≤1）：列出，建议删除
- **重复 corrections**（Jaccard > 0.6）：列出，建议合并

**不要自动删除 corrections** — 列出问题项，让用户确认。Corrections 是用户花时间纠正 agent 的成果，删除需要用户同意。

**3b. Persona domains 检查：**

检查 persona domains 里是否有：

- 长期未提及的 domains（>60 天）：可能在 Step 2 被精简后不再需要
- 但不要主动删除——domain 信息是认知层自动维护的，会通过 half-life 自然衰减

**Step 3 检查点（如果执行了）：**

```
## Step 3 L3 清理摘要
- 过时 corrections：X 条（建议删除 Y 条，用户确认删除 Z 条）
- 低使用率 corrections：X 条（建议删除 Y 条）
- 重复 corrections：X 对（建议合并 Y 对）
- Persona domains 检查：N 个活跃 / M 个 stale
```

**进入 Step 4。**

### Step 4: 验证与报告（必做）

**4a. 重新统计：**

重新读取所有修改过的文件，统计最终字符数和 token 估算。

**4b. 对比报告：**

```
## 上下文整理完成

| 文件 | Before | After | 节省 |
| --- | --- | --- | --- |
| AGENTS.md | 3500 chars / ~1100 tok | 2100 chars / ~650 tok | -40% |
| SOUL.md | 800 chars / ~250 tok | 750 chars / ~230 tok | -8% |
| ... | ... | ... | ... |
| **L2 总计** | **12000 chars / ~4000 tok** | **7500 chars / ~2400 tok** | **-37%** |

### 修改详情
- 删除 X 条模型已知内容
- 精简 Y 条冗长描述
- 保留 Z 条关键规则

### L3 状态
- Corrections: X active（Y 条建议清理）
- Persona domains: N active

### 建议
- 定期运行 `kaijibot context audit` 监控上下文健康
- MEMORY.md 如果超 8KB，运行"整理记忆"
```

## 文件整理细则

### AGENTS.md

- **删除**：通用工具说明（agent 从工具定义已知）、目录结构（agent 能 exec ls 发现）、依赖列表（agent 能读 package.json 发现）
- **精简**：冗长的编码规范（指向 .editorconfig / oxlint 配置即可）
- **保留**：项目特有命令（pnpm gw:deploy 等）、安全约束（never/must 类）、架构边界规则

### SOUL.md

- **删除**：对人格特征的冗长解释（"这意味着你会..."的段落）
- **精简**：重复的性格描述（同一特质用不同方式说了多遍）
- **保留**：核心人格定义、用户设定的人格特征

### IDENTITY.md / USER.md

- **删除**：通用身份说明（"你是一个 AI 助手"）
- **精简**：过长的背景描述
- **保留**：用户姓名、偏好、关键事实

### TOOLS.md

- **删除**：工具的通用用法（agent 从工具 schema 已知参数和用法）
- **精简**：冗长的工具组合示例
- **保留**：非显然的工具组合技巧、工具的特殊限制

### HEARTBEAT.md

- **删除**：心跳机制的说明（agent 从 system prompt 已知）
- **精简**：过期的任务（已完成或不再需要的）
- **保留**：当前活跃的定时任务

### BOOTSTRAP.md

- **删除**：通用的启动流程说明
- **精简**：过长的项目初始化步骤
- **保留**：项目特有的初始化命令

## Notes

- 整理后 agent 的行为应该不变或更好（因为高信号密度提升了注意力效率）
- 如果不确定某段内容是否该删，保留它（宁可多花 token 也不要丢信息）
- 可以重复运行，幂等安全
- 每次 system-prompt.ts 更新后，建议重新整理（可能有新的冗余）
- MEMORY.md 的深度整理由 memory-organize skill 负责，本 skill 只做 light check
