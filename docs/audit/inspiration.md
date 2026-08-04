# 审核灵感清单（触发式提示词）

> 定位：给 AI 的「审什么、怎么审」调度层。不是审核报告（那些在 `audit/*.md`），
> 也不是审核标准（在 AGENTS.md `# 审核代码可用性`）——本文件只回答两件事：
> ① 什么情况该去审核；② 该模块的审核提示词是什么。
> 原则：提示词写「问题模式」不写「具体实例」（实例会变，模式稳定）；范围由 diff 触发，进度由回写自维护。

## 触发条件（什么时候读本文件）

| 触发 | 动作 |
|------|------|
| 用户说「审核 / 审计 / 看看代码质量」但未指定范围 | 读本文件，挑「上次审核」最旧或残留 P1/P2 最多的模块 |
| diff 涉及本文件登记的模块 | 读该模块提示词 → 按 diff 圈定局部范围审核 |
| 用户点名某模块 | 直接读该模块提示词 |
| 用户说「找点活干 / 巡检一下」 | 从上到下扫一遍，报出每模块上次审核距今 + 残留项 |

## 使用方式（给 AI 的说明）

拿到提示词后：按 AGENTS.md 的审核执行流程走查（导入图谱 → 状态读写追踪 → 资源配对 → 心理模拟 → 输出报告），
输出格式沿用 AGENTS.md 审核报告模板。审核完回写该模块「上次审核」区。只报告 + 给精确修复建议（diff 格式、文件:行号），不改代码除非用户要求。

---

## env 持久化桥（env-bridge / env-persist / env-dispatcher）

**触发**：改动 `frontend/src/scene/env/_bridge/` | envState 持久化相关

**提示词**：
- 职责边界：envState 唯一写入入口（setEnvState 中间件链）+ 防抖持久化 + 派发。ADR-138 / ADR-148 / ADR-173 / ADR-176。
- 问题模式（盘问方向，非检查清单）：
  - **skipAutoSave 契约**：true 只跳过 triggerAutoSave、不跳过防抖持久化。逐点盘问所有 `setEnvState(x, true)` 调用点——是否有「临时中间态 500ms 后落盘」或「flush 覆盖 pending 修改」的残留路径。
  - **reactive Proxy 载荷**：传给后端前必须解引用（`{...envState}`），否则 JSON.stringify 对 Proxy 枚举不完整。
  - **类型强转**：`as unknown` 强转处核对 Go 端契约是否漂移（ADR-213 / app.contract.test.ts）。
  - **中间件错误隔离**：单个 middleware 抛异常不应阻断 persist/autoSave。
- 自查锚点：`knowledge/env-bridge.md`、`knowledge/env-dispatcher.md`、buglog「水面关掉后不恢复」「env-state-not-restored」。
- 上次审核：2026-08-04（三模块五维度报告）——残留：`as unknown`（P2）、flush/防抖失败文案不区分（P3）、防抖核心路径无直接测试（P4）；cel 中间态已修（07856c8f + cel-ground-persist.test.ts）。

## 性能监控（performance.ts / performance-env-bridge.ts）

**触发**：改动 `frontend/src/scene/render/performance*.ts` | FPS / 降级相关

**提示词**：
- 职责边界：FPS 监控 + 自动降级 + 快照恢复。bridge 由 scene 注入（ADR-159 P3-A）。
- 问题模式：
  - **快照污染**：applyDegrade 捕获 `_snapshot` 时 bridge 是否已注册？未注册时空对象快照会在恢复时覆盖真实设置——`setPerformanceMode` 路径无 `_bridgeEngine` 守卫，重点盘问这条链。
  - **反馈循环**：降级写 setLightState/setRenderState 是否会触发对方 resetPerformanceSnapshot 反向恢复（`_suppressSnapshotReset` 覆盖是否完整、finally 是否保证复位）。
  - **阈值滞回**：降级/恢复阈值是否区分；renderScale 像素比杠杆与用户设置如何叠加。
  - **峰值校准**：refreshRate 非标准属性读取安全；Phase 2 预热后 ceiling 上限。
- 自查锚点：ADR-159、ADR-118、ADR-151、knowledge 相关卡（如有）。
- 上次审核：2026-08-04（三模块五维度报告）——残留：默认空 bridge 快照污染链（P2，未修）。

## core/state 系列（state.ts + scene/playback/library/ui-state + reactivity.ts）

**触发**：改动 `frontend/src/core/state*.ts` | 全局状态读写

**提示词**：
- 职责边界：ADR-141 拆分后的 5 个 store + envState Proxy。单一写入点原则。
- 问题模式：
  - **幽灵引用**：export let 替换引用 vs 原地 mutate——盘问是否有消费者在替换前捕获旧引用长期持有（ES 活绑定下即时访问安全，捕获后跨调用使用才危险）。
  - **副本防御**：返回数组/Map 的 getter 是否返回副本防外部 mutate（`_recentMotions` 模式）。
  - **Proxy 引用稳定**：reactivity WeakMap 缓存是否保证同一对象返回同一 Proxy；默认值是否被 Proxy 污染（tuple 深拷贝）。
  - **schema 派生**：ENV_STATE_SCHEMA 与 buildDefaultEnvState 是否字段完备（satisfies 编译期兜底是否仍在）。
- 自查锚点：`knowledge/state.md`、`knowledge/config-barrel.md`、ADR-141。
- 上次审核：2026-08-04（三模块五维度报告）——残留：buildDefaultEnvState 体量（P3，ADR-235/237 跟踪）；addRecentMotion 风格（P3，可忽略）；modelRegistry 幽灵引用判为误报。

---

## 维护规则

- 新增模块：按上述结构加一段（职责边界 + 问题模式 + 自查锚点）。问题模式必须是「稳定模式」而非当前实例——实例细节留给 AI 自己读源码确认。
- 每次审核完成：回写该模块「上次审核」——日期 + 结论 + 残留项。残留项清零后删除对应行。
- 问题模式发现过时：以源码 + ADR 为准修正，不静默保留。
