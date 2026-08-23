# 洞察投放人化重构 · 规格(SPEC)

> 本文件是 goal 的自包含规格。goal 执行跨上下文压缩/换会话,以本文件为准。
> 若本文件与 goal 文本冲突,以 goal 文本的判据为准,本文件的机制细节可按停止条件升级裁决。

## 1. 背景:为什么会走偏

原始设计(正确):「用户回复了 → 继续洞察不算打扰;用户一直不回复 → 收敛」。
代码里这套账本(`consecutiveNoResponses`)完整存在,但被四轮互相不知情的
「防沉默」补丁系统性中和:

| 补丁                                     | 位置                                                         | 效果                      |
| ---------------------------------------- | ------------------------------------------------------------ | ------------------------- |
| backoffFactor floor 0.7 + 0.03线性       | src/cognitive/scheduler/gate.ts:272-303                      | 无回复惩罚封顶 ~13%(pAct) |
| compensatorySignal(24h后最高+0.35)       | gate.ts:283-301                                              | 把惩罚反转成加成          |
| reEngageSignal 地板 + shouldReEngage×1.3 | gate.ts:258-264, :321; src/cognitive/persona/lifecycle.ts:44 | 沉默越久越保证再发        |
| dormant lifecycleFactor 0.5(翻倍)        | lifecycle.ts:79                                              | 沉默 14-45 天用户 pNeed×2 |

净效果:最不该被打扰的人获得最高联系优先级;timer 每 0.5-1.5h tick 构成固定骨架。
此外:`resetNoResponseStreak`(src/cognitive/feedback/collector.ts:398)零调用(死代码);
隐式反馈链路(collector.ts:214-219 信号解析)零生产接线,配置项 `implicitFeedback` 标注 Reserved。

**错误不变量**:「系统永远不能停止主动联系」。
**正确不变量**:「用户回复后,系统必须在 ≤1 个周期内恢复主动;用户不回复时,
联系率必须单调收敛到再触达预算」。人类朋友的沉默是条件性的——你一开口他立刻回来;
防沉默的正确机制是"清零即恢复",不是"永远不停"。

## 2. 目标架构:词典序决策(不是乘积序)

账本不是 8 因子之一,它是骨架,数学上不可被对冲:

```
状态:
  U  — 社交账本:连续未获回复的主动消息数(重用 consecutiveNoResponses)
  Q  — 最近回复质量 ∈ {engaged, normal, dismissive}(新,隐式反馈)
  T  — 信任度(现有 trustScore);F — 习得频率(现有 optimalFrequencyHours)

账本转移(完整语义,替换现有三条路径):
  投放成功            → U ← U + 1
  用户任意消息        → U ← 0     (立即清零,接线 resetNoResponseStreak)
  [删除 −1/tick 递减;删除时间惩罚路径,合并为事件开始时惰性转换]

第 1 层 — 硬否决(veto,无概率):
  U ≥ 3 且 T < 0.7 → 沉默    (低信任用户 U ≥ 2)
  活跃时段外 / suppressUntil / totalExchanges < 5 → 沉默(现有安全栏,保留)

第 2 层 — 再触达预算(替代 compensatory + reEngage + dormant 翻倍):
  条件:双方均沉默 > D=10 天 且 U < veto 上限 且 距上次尝试 > R=14 天
  → 以 p_re ≈ 0.3/周 的概率允许一次轻量问候;被忽略则 U+1 回到否决
  渐近联系率:沉默用户 ≈ 每 2-4 周 1 次

第 3 层 — 软调制(仅在硬约束内):
  p_send = base × trigger × momentum × intimacy × g(U)

  g(U) = {1.0, 0.45, 0.12}[min(U,2)],U≥3 走否决   ← 羞耻感等比衰减
  momentum: 用户 0.5h 内活跃→1.3;2h→1.0;1天→0.85;>1天→不走此路径只走预算
  trigger:  persona_change 0.9 / info_scan 强命中 0.7 / timer 0.3
  intimacy: f(T, F) 单调递增 — 越亲密基线联系越勤
```

三个正交单调信号(替换现在纠缠的四因子 timeFactor):
「没被回 → 不好意思再发」= U(硬);「很久没聊 → 有点想念」= 预算(低频有上限);
「你刚好在线 → 顺手说」= momentum(单调递增)。
cadenceGaussian 的非单调+地板结构整体废弃;recoveryFactor 与 minInterval 合并为防双发 guard。

### 参数初始值(标定的起点,Phase 4 允许调,但每轮报告前后数值)

| 参数      | 初始值                                       | 说明                         |
| --------- | -------------------------------------------- | ---------------------------- |
| g(U)      | {1.0, 0.45, 0.12}                            | U=0,1,2 的乘子               |
| veto 阈值 | U≥3(T≥0.7);U≥2(T<0.7)                        | 硬否决                       |
| D / R     | 10 天 / 14 天                                | 再触达:双方沉默期 / 尝试冷却 |
| p_re      | 0.3/周                                       | 再触达概率,封顶              |
| momentum  | 0.5h→1.3, 2h→1.0, 24h→0.85                   | 分段线性                     |
| trigger   | persona_change 0.9, info_scan 0.7, timer 0.3 | 事件驱动 >> 定时             |

## 3. 机制处置表(16 项,执行时逐项对照)

| #   | 机制                                          | 处置                                     | 位置                                    |
| --- | --------------------------------------------- | ---------------------------------------- | --------------------------------------- |
| 1   | −1/tick 递减                                  | Kill → 用户消息 U=0                      | proactive-scheduler.ts:861-868          |
| 2   | resetNoResponseStreak 死代码                  | 接线(curator 用户消息路径)               | collector.ts:398; curator.ts:573 附近   |
| 3   | backoff floor 0.7 + 0.03线性                  | Rework → g(U)                            | gate.ts:272-303                         |
| 4   | compensatorySignal                            | Kill → 再触达预算                        | gate.ts:283-301                         |
| 5   | reEngageSignal 地板                           | Kill → 再触达预算                        | gate.ts:258-264                         |
| 6   | shouldReEngage ×1.3                           | Kill → 再触达预算                        | gate.ts:321; lifecycle.ts:44            |
| 7   | dormant factor 0.5                            | Rework → ≥1.5 或并入预算                 | lifecycle.ts:79                         |
| 8   | cadenceGaussian                               | Rework → momentum 单调映射               | gate.ts:247-264                         |
| 9   | recoveryFactor                                | Keep(与 minInterval 合并为防双发 guard)  | gate.ts:266-270                         |
| 10  | 双递增路径 + lastNoResponseAt 去重            | 合并为一条惰性转换                       | proactive-scheduler.ts:712-725, 874-898 |
| 11  | contentStrategy streak≥3 noveltyBoost         | Rework:U≥2 即沉默,strategy 只在 0-1 生效 | content-strategy.ts:57-59               |
| 12  | processNoResponse 的 bandit 惩罚              | Keep                                     | collector.ts:355-379                    |
| 13  | topic/mode/prompt bandits                     | Keep                                     | —                                       |
| 14  | pendingInsightDelivery / awaiting / handshake | Keep(正交投放机制)                       | proactive-scheduler.ts:778-855          |
| 15  | 隐式反馈 Q 信号                               | 接线(Phase 3)                            | collector.ts:214-219 已有解析           |
| 16  | activeHours / suppressUntil / exchanges≥5     | Keep(安全栏)                             | gate.ts:111-128                         |

## 4. 四阶段计划(串行,阶段内可多轮)

**Phase 1 — 账本加固**(gate.ts + proactive-scheduler.ts + curator.ts + lifecycle.ts)
先写仿真测试(对新不变量,对旧代码跑出红)→ 删 #1/#4/#5/#6,#3→g(U),#7→1.5,
#10 合并,接线 #2。改写 gate.test.ts 旧语义用例(逐条注明理由,迁移而非删除覆盖)。

**Phase 2 — 触发优先级**:eventFactor 语义化(#trigger 表),momentum 替换 Gaussian(#8),
recoveryFactor 并入防双发 guard(#9)。

**Phase 3 — 察言观色闭环**:洞察投放后用户的下一条消息 → Q 分类(engaged/normal/dismissive)
→ 更新 topicBandits + intimacy 微调;`implicitFeedback` 配置真实生效(defaults.ts 已默认 true,
schema 五处同步去掉 Reserved 标注)。Q=dismissive 且 U≥1 时可提前触发收敛。

**Phase 4 — 仿真验证 + 标定**:补全 4 剧本 + 2 不变量;参数标定(每轮只动一个参数,
报告前后仿真曲线);regression-flag-diff + live 测试收口。

## 5. 仿真测试设计(human-cadence.sim.test.ts)

纯逻辑离散事件仿真,无 LLM,毫秒级。mock persona 时序,驱动 processEvent/gate:

| 剧本                 | 断言                                              |
| -------------------- | ------------------------------------------------- |
| responsive(每条都回) | 联系率 ≈ F 水平;回复后 ≤1 个 timer 周期恢复主动   |
| sometimes(50% 回复)  | 联系率介于两极,随响应率单调                       |
| ignore-all           | ≤3 条内收敛静默;30 天内再触达 ≤2 次(渐近 ≤1/14天) |
| dormant(长期沉默)    | 30 天联系数 < active 用户(与现状相反)             |

数学不变量(直接单测):

1. 单调性:固定其他状态,U 递增时 p_send 单调不增(旧代码在 U=8+沉默48h 时失败 → 红)
2. 恢复性:任意状态注入一条用户消息后,下一周期 p_send = U=0 水平

## 6. 已知坑(必须遵守)

- **persona 写并发**:调度器快照经 `cognitiveStore.update()` 只合并 feedbackProfile
  (server.impl.ts:1660-1669);新增字段(U 清零路径写的 Q 等)必须走同一合并模式,
  禁止盲 save()。
- **awaiting/pending 交织**:startup sweep(server.impl.ts:1473-1490)与
  AWAITING_CONFIRMATION_TTL;U 递增只在 finalizeDelivery 确认投放后,不得在 pending 重试时重复 +1。
- **prompt cache 稳定性**:从 map/set 组装 payload 前排序确定化。
- **persona schema**:只加可选字段(zod + 手写 schema 同步),不删不改现有字段语义;
  旧数据文件必须无损加载。
- **测试改写政策**:允许按新语义迁移编码旧不变量的用例(gate.test.ts:917-1003 等),
  逐条注明理由,新套件中必须有对应覆盖;禁止删除覆盖来凑绿。
- **live 测试**:本地跑,key 在 ~/.kaijibot/.env;不可用则记录跳过,不阻塞前 5 条判据。
- **配置五处同步**:types.cognitive.ts / defaults.ts / schema.base.generated.ts /
  schema.labels.ts / schema.help.ts(+zod-schema.cognitive.ts)。
- **每轮一个机制点**:先跑判据收集基线 → 改 → 重跑留证据;禁止一轮改多个机制。
