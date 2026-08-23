# 洞察投放人化重构 · 参数标定报告(Phase 4 收口)

## 参数前后对照

| 机制                | 旧值                                           | 新值                                                                              | 位置                                |
| ------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------- |
| 无回复惩罚          | 线性 `1−0.03·n`,floor 0.7(pAct 最多降 ~13%)    | `LEDGER_DECAY = {1.0, 0.45, 0.12}`(g(U) 等比)                                     | gate.ts                             |
| 账本硬否决          | 无                                             | U≥3(T≥0.7)/ U≥2(T<0.7)                                                            | gate.ts                             |
| 补偿信号            | 沉默>24h 最高 +0.35(反转惩罚)                  | **删除**(由预算通道取代)                                                          | gate.ts(已删)                       |
| re-engage 地板/加成 | 对数地板 + ×1.3                                | **删除**(由预算通道取代)                                                          | gate.ts/lifecycle.ts(已删)          |
| dormant 频率因子    | 0.5(pNeed×2,轰炸)                              | 1.5(pNeed÷1.5,收敛)                                                               | lifecycle.ts                        |
| cadence 高斯        | 峰值@6h 非单调+地板                            | momentum 单调映射 {0.5h→1.3, 2h→1.0, 24h→0.85, >24h→0}                            | gate.ts                             |
| 事件权重            | timer 0.7 / info_scan 0.8 / persona_change 0.9 | timer **0.3** / info_scan **0.7** / persona_change 0.9                            | gate.ts                             |
| 账本递减            | 用户活跃 −1/tick + 2×间隔时间惩罚双路径        | 单一惰性转换;用户消息**立即清零**(curator 接线)                                   | proactive-scheduler.ts / curator.ts |
| 交付间隔            | 仅 minIntervalHours 冷却(0.5h 生产默认)        | f(F) 快慢道:回复→minInterval;未回→max(minInterval, optimalFrequencyHours)         | proactive-scheduler.ts              |
| 再触达              | 无(高斯地板+补偿无限唤回)                      | 预算通道:D=10d 双沉默 / R=14d 冷却 / P=0.6 / U<cap                                | re-engagement.ts                    |
| 隐式反馈            | 信号解析已接线但无洞察归因,开关 Reserved       | +Q 分类(engaged/normal/dismissive)→洞察域 bandits±0.5/0.4 + 频率微调;开关真实生效 | collector.ts / attempt.ts           |

## 仿真曲线对照(30 天,同剧本)

| 剧本                      | 旧代码                    | 新代码           | 断言                              |
| ------------------------- | ------------------------- | ---------------- | --------------------------------- |
| responsive 联系数         | 高但恢复慢                | ~180(快道)       | ≥12 ✓                             |
| responsive 回复后恢复窗口 | 63.5h ✗                   | ≤8h ✓            | ≤8h                               |
| sometimes 联系数          | 14(< ignore-all,**倒挂**) | 严格介于两者之间 | ignore < sometimes < responsive ✓ |
| ignore-all 联系数         | 28(永不收敛)              | ≤3 后静默        | ≤3 ✓                              |
| ignore-all 30 天再触达    | 持续                      | ≤2               | ✓                                 |
| dormant 联系数            | **90(每天 3 条)**         | 1–3(预算通道)    | <responsive ✓                     |
| M 单调性(不复活)          | 违反(0→0.268 回升)        | 成立             | ✓                                 |

## 判据核验

1. ✅ `pnpm test src/cognitive/scheduler/human-cadence.sim.test.ts` 6/6;红→绿证据 .goal/evidence/round1-red-old-code.txt
2. ✅ 剧本断言全部在套件内通过
3. ✅ `grep compensatorySignal|reEngageSignal|shouldReEngage` 生产代码 0 残留;resetNoResponseStreak 由 curator.mergeExtraction 生产调用(有单测)
4. ✅ classifyResponseQuality + applyInsightReplyAttribution + implicitFeedback 开关(attempt.ts),8 个新单测
5. ✅ pnpm tsgo ✓ / pnpm check(0 err 0 warn)✓ / pnpm test src/cognitive/ 1424/1424 ✓ / regression-flag-diff src/cognitive/scheduler 0 回归
6. ✅ insight-live-quality 复跑 4/4 通过(首跑 2 失败为 LLM 判定方差,复跑证实;记录于 .goal/evidence/live-run1-variance.txt)

## 遗留说明

- gate EVENT_FACTORS 调低后 timer 事件 pAct 边缘通过(~0.32 vs τ=0.3)——如需调整在 Phase 4 标定框架内单参数改动
- 既有 skipIf(CI) 套件的多处 flaky 已修复(roll 依赖、awaiting 清偿缺失、fixture 时间戳),pipeline 两文件 + insight-improvements 连续 8× 稳定

## 迭代 2 · 每日自持 + 去节拍器化(运营者裁决:1-2 条/天,拒绝定时感)

新增机制(delivery-pacing.ts):

- 每日预算: maxDailyInsights(默认 2)/UTC 日,`dailySendAnchorDay`+`dailySendCount` 自滚动重置;pending 重试同受约束;送达点 bumpDailySend
- 随机风险门槛: 替代确定性间隔下限(下限=节拍器根因)。1h 绝对底线 → hazard=(elapsed-1)/targetGap 线性爬升至 1;targetGap=F(已回复)/2F(未回复);seeded roll 每事件独立
- 对话时刻豁免: persona_change + 用户 2h 内活跃 → 跳过 hazard(仍受底线+预算)
- 预算通道豁免域新鲜度: 重触达问候不再被数周前的域疲劳窗口卡死(修复真实缺陷)

30 天仿真(responsive,UTC 日口径):

- 每日分布 0/1/2 混合,日均 1.77,超 2 条日子=0(硬不变量)
- 相邻间隔均值 13.4h、σ=4.9、min 4h(对话突发)max 24h——非节拍器
- 迁移: sim 恢复窗口 8h→28h(日内自持语义);pipeline 周期 1h→25h(每日签到用户建模);resolve 增加 bypassDomainDedup 选项
- 新单测 11 项(delivery-pacing.test.ts);1435/1435 全绿,check 0/0,flag-diff 0 回归
