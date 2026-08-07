# ADR-254: 历轮审核 P4 遗留项登记簿 —— 低风险改进清单与技术债跟踪

> **日期**: 2026-08-07
> **状态**: ✅ 已立（2026-08-07 立项；来源：历轮子代理审核 + code_review 中判定为 P4/可选改进、不阻塞的遗留项汇总）。本 ADR 固化「记录不修」项的完整清单与未来触发条件，避免逐轮口头记录丢失
> **编号**: 254
>
> **关联**: [ADR-245](adr-245-babylon9-plugin-access.md)（审核共性规范系列起点）、[ADR-204](adr-204-unit-test-layering-and-hygiene.md)（测试分层——P4 项多为补测建议）
>
> **来源**: 2026-07-10 ~ 2026-08-07 历轮代码审核（约 74 个模块）中对「记录不修 / 降级 P3 / 可选改进」项的归纳。

**决策者**: AtomCode（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

---

## 背景

历轮审核（74 个模块、每轮 code_review 复审）产生了一批被判定为 **P4 / 可选改进 / 记录不修** 的发现。它们共同特征：
- 当前行为正确（无用户可见 bug）
- 修复成本 > 当前收益（改动面大、或引入回归风险）
- 属于「技术债」而非「缺陷」

本 ADR 将其登记为**待排期技术债**，附触发条件，未来任何一轮「技术债清算」或「相关模块重构」时按清单执行。

---

## 遗留项清单

### A 类：P3 级（建议优先排期，改动小、防未来回归）

| # | 模块 | 遗留项 | 触发条件 / 备注 |
|---|------|--------|----------------|
| A1 | camera-state | `resetCameraState()` 硬编码默认值与模块级初始化曾是两份副本 | ✅ **已修**（ADR-254 前置：提取 DEFAULT_CAMERA_STATE 单源） |
| A2 | shortcut-registry | `registerShortcut` Map.set 覆盖无冲突守卫（呼应 Ctrl+Space P1 先例） | ✅ **已修**（跨 id 同绑定 logWarn + 保留先注册者） |
| A3 | load-manager | `inst?.name ?? ''` 注册表查无实例时静默空名 | ✅ **已修**（console.warn 暴露时序异常） |
| A4 | env-persist | 无直接单测（防抖/flush/竞态窗口零覆盖） | ✅ **已修**（env-persist.test.ts 7 用例） |
| A5 | env-bridge | `_middlewares` 无去重/无清理 | ✅ **已修**（registerEnvStateMiddleware 按 name+phase 去重；**无 clearAll 导出**——中间件仅模块顶层注册、无 init 重注册路径，dispose 清空会导致注册表永久为空，与 clearAllEnvCallbacks 同源 P2 回归） |
| A6 | env-impl | 模块级 prev 状态 dispose 不复位 | ✅ **已修**（_prevParticleEnabled/_prevSplash/_prevCustomTexture 复位） |

> A 类 6 项已在 ADR-254 立项当日全部闭环（提交 406ee2f2），此处保留登记以固化「从审核到修」的追溯链。

### B 类：P4 级（可选优化，不阻塞）

| # | 模块 | 遗留项 | 说明 |
|---|------|--------|------|
| B1 | outfit | `applyOutfitVariant` 异常时 `_pendingVariant` 无人消费 | leave 在 finally 必走，仅 pending 丢失；可加消费重试 |
| B2 | env-caustics | `update()` 返回对象（含 cfg）无任何消费者 | 幽灵输出；可改 void 或删返回值 |
| B3 | scene-stage-lights | `PCF` 下拉项硬编码英文未走 `t()` | 同组 hard/soft 均走 t()，仅此项不一致 |
| B4 | perception | `setHeadTrackingEnabled`/`setEyeTrackingEnabled` 全局清 gaze 缓存 | 多模型同屏时非焦点模型 gaze 跳跃；改动面广故未修 |
| B5 | motion-detail-ui | `_playbackSpeed` 双 slider 写入无 reRender 同步 | 菜单栈 LIFO 同开概率低、值均同步 runtime |
| B6 | load-manager | `default` 分支未实现 kind 静默 return null | 可抛 `LibraryLoadError` 让调用方统一 catch |
| B7 | virtual-skirt | dispose `releaseWorldId` 顺序 | 子代理自评 JS 单线程安全、无实际问题 |
| B8 | mirror-debug | `setMirrorResolution` 经 setEnvState 隐式 autoSave | 与显式 triggerAutoSave 风格不一致但等价 |

### C 类：文档/测试缺口（已修卡但可继续完善）

| # | 项 | 说明 |
|---|----|------|
| C1 | load-manager 队列并发 + 反序列化恢复分支 | 现有 load-manager.test.ts 覆盖串行/abort/错误包装；并发排队与反序列化恢复两个分支可扩展 |
| C2 | perception / env-impl 核心编排逻辑直接单测 | `ensureEnvUpdateObserver`/`disposeEnvUpdateObserver` 仅 barrel 间接覆盖 |
| C3 | env-bridge 中间件链（pre/post-facade 顺序）直接单测 | middleware.int.test.ts 存在但可补「去重后注册」断言 |

### D 类：双源分叉治理池（2026-08-07 全面收口 · 已归档）

> 本类于 2026-08-07 追加 D1~D7，原仅基于 ADR/audit 文本登记、未以当前源码核实。**同日经两路核查全部闭环**：
> - **D1（mjs 侧）由其他 AI 根治**：ecc6f509 —— `STATUS_CATEGORIES.completed` 补「已立」、新增 `classifyStatus` 唯一分类入口、gen-docs-index 删硬编码 `ADR_BUCKETS` 接共享模块；check/health 改用共享函数，adr-019/043/044/133/149 分叉消解（check/health 一致 226/13/11/0、unknown=0）。
> - **D2~D7（非 mjs 侧）经当前 `frontend/src` 源码核验，对应治理 ADR 均已落地，原双源已消除或收敛为有意设计——属误登（过期文档登记），已从待办移除，仅留追溯锚点。**
>
> **校准结论：非 mjs 侧当前 0 项真实双源债；mjs 侧 D1 已根治。D 类治理池整体归档；联邦双源风险由 `scripts/check-doc-drift.mjs`（pre-push 红线）持续守护。**

| # | 文档 / 模块 | 原登记双源 | 源码核验结论（2026-08-07） | 处置 |
|---|------------|-----------|--------------------------|------|
| D1 | gen-docs-index.mjs ↔ _lib/adr-status-categories.mjs | ADR 状态词双源：`已立` 漏词 | ✅ **已根治**（其他 AI，ecc6f509）：抽 `classifyStatus` 单源 + gen 接共享模块，5 处分叉消解 | 已闭环 |
| D2 | ADR-095 | 路径归一化两套 + 7 处手写边界 | ✅ 已消除：`normalizePath` 已删，仅剩 `normPath` 单源；ADR-095「已完成」批次 5；grep 零命中 | 误登·移除 |
| D3 | ADR-119 | 缩略图 key 双源拼接 | ✅ 已消除：抽 `thumbnail-key` 单模块，library-core.ts:195「杜绝双源拼接反弹」；ADR-119 已落地 | 误登·移除 |
| D4 | ADR-093 | 导航 `map-route`/`inline-push` 两套 | ✅ 已消除：菜单统一声明式 Schema（ADR-093 已完成），`map-route`/`inline-push` 字面零命中 | 误登·移除 |
| D5 | ADR-022 | 同名两套 `ENV_PRESETS` | ✅ 已消除：`ENV_PRESETS` 不存在，分化为 `TIME_OF_DAY_PRESETS`(env-lighting)+`SCENE_PRESETS`(env-preset-levels)；ADR-022「已实现」 | 误登·移除 |
| D6 | audit round12 | `_fallbackModuleStates`↔`intent.motionModules` | ✅ 已收敛为有意 fallback 分治：registry.ts:98-130 + [doc:adr-121] 单 mutate 入口 | 误登·移除 |
| D7 | audit round11 | transform-gizmo detach/attach 分叉 | ✅ 已修复：transform-gizmo.ts 大量 `[fix P2]` 拖拽中 detach flush 回写 | 误登·移除 |

---

## 决策

1. **A 类为「已修」状态**：全部在 ADR-254 当日闭环，作为审核→修复→固化的范本记录。
2. **B 类为「待排期」**：不设截止，触发条件为「相关模块下一次重构 / 技术债清算轮」。
3. **C 类为「持续完善」**：随对应模块补测需求自然推进，不单独派单。
4. 本 ADR 不新增任何架构约束，仅作**技术债登记簿**——后续审核报告中的「记录不修」项应在本 ADR 追加行，避免逐轮口头记录丢失。
5. **D 类「双源分叉治理池」已于 2026-08-07 全面收口归档**：D1（mjs）由其他 AI 根治（ecc6f509）；D2~D7 经当前 `frontend/src` 源码核验均为误登（对应 ADR-095/119/093/022 已落地 + [fix P2]/[doc:adr-121] 收敛），已从待办移除。非 mjs 侧真实双源债归零；联邦双源风险由 `scripts/check-doc-drift.mjs` 在 pre-push 红线持续守护。

---

## 执行记录

- 2026-08-07：立 ADR；A 类 6 项闭环（提交 406ee2f2）；B/C 类登记待排期。
- 2026-08-07：新增 D 类双源分叉治理池（D1~D7）；D1 状态词双源消费端止血已提交（82a42d6e），根治（lib 补词 + gen 接共享模块）派其他 AI。
- 2026-08-07：D1 根治闭环（ecc6f509）：`STATUS_CATEGORIES.completed` 补「已立」、新增 `classifyStatus` 唯一分类入口 + `BUCKET_TO_CATEGORY`/`DISPLAY_BUCKET_ORDER`；gen-docs-index 删硬编码 `ADR_BUCKETS` 接共享模块；check-adr-status/check-adr-health 改用共享函数。check 与 index 同函数后 adr-019/043/044/133/149 分叉全部消解（统一归已归档），验证 check/health 一致 226/13/11/0、unknown=0、test:scripts 216 全过。
- 2026-08-07：D2~D7 源码核验——非 mjs 侧 6 项原登记双源均经 `frontend/src` 核实为误登（ADR-095/119/093/022 已落地 + [fix P2]/[doc:adr-121] 收敛），已从待办移除；结合 D1 已由其他 AI 根治（ecc6f509），D 类整体归档。
