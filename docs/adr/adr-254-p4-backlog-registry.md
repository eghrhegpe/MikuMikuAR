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

### D 类：双源分叉治理池（系统性同类债，根因与 ADR-232 同根）

> 以下项目并非独立 P4 缺陷，而是「同一枚举 / 词表 / 常量在多处各自维护、未收敛为单一事实源」的系统性根因债。状态词双源（gen-docs-index ↔ _lib/adr-status-categories）即最新暴露的一处。治理结构参考 ADR-232 §2.2「词表单一事实源」：抽共享模块 + 断言守护，成批收口。

| # | 文档 / 模块 | 双源实例 | 处置状态 |
|---|------------|---------|---------|
| D1 | scripts/gen-docs-index.mjs ↔ scripts/_lib/adr-status-categories.mjs | ADR 状态词双源：`已立` 漏词（index 自硬正则、lib 也未收） | ✅ **已修**（82a42d6e 消费端止血 + ecc6f509 根治：lib completed 补「已立」、新增 classifyStatus 唯一分类入口、gen-docs-index 删硬编码接共享模块；check 与 index 同函数，adr-019/043/044/133/149 分叉消解，验证 check/health 一致 226/13/11/0、unknown=0） |
| D2 | ADR-095 | 路径归一化两套实现 + 7 处手写边界判定 | ⏳ 待排期 |
| D3 | ADR-119 | 缩略图 key 双源字符串拼接（写/读各拼一次） | ⏳ 待排期 |
| D4 | ADR-093 | 导航 `map-route` 与 `inline-push` 两套写法未统一 | ⏳ 待排期 |
| D5 | ADR-022 | 同名两套 `ENV_PRESETS`（`env-lighting` vs `env-preset-levels`） | ⏳ 待排期 |
| D6 | docs/audit/2026-08-06-round12 | `registry._fallbackModuleStates` 与 `intent.motionModules` 双源 | ⏳ 待排期 |
| D7 | docs/audit/2026-08-06-round11 | `transform-gizmo` 拖拽中 detach/attach 视觉与持久化分叉 | ⏳ 待排期 |

> 联邦已有专门巡查官 `scripts/check-doc-drift.mjs`（文档漂移检查器，pre-push 红线），双源问题是已知系统性风险。D 类债务统一按「抽共享单源 + 断言守护」范式批量交给其他 AI 收口，不在此逐条救火。

---

## 决策

1. **A 类为「已修」状态**：全部在 ADR-254 当日闭环，作为审核→修复→固化的范本记录。
2. **B 类为「待排期」**：不设截止，触发条件为「相关模块下一次重构 / 技术债清算轮」。
3. **C 类为「持续完善」**：随对应模块补测需求自然推进，不单独派单。
4. 本 ADR 不新增任何架构约束，仅作**技术债登记簿**——后续审核报告中的「记录不修」项应在本 ADR 追加行，避免逐轮口头记录丢失。
5. **D 类为「系统性双源分叉治理池」**：根因与 ADR-232 同根（多份定义未收敛为单一事实源）。统一按「抽共享单源 + 断言守护」范式批量收口；D1 状态词双源根治已完成（ecc6f509），D2~D7 待排期。

---

## 执行记录

- 2026-08-07：立 ADR；A 类 6 项闭环（提交 406ee2f2）；B/C 类登记待排期。
- 2026-08-07：新增 D 类双源分叉治理池（D1~D7）；D1 状态词双源消费端止血已提交（82a42d6e），根治（lib 补词 + gen 接共享模块）派其他 AI。
- 2026-08-07：D1 根治闭环（ecc6f509）：`STATUS_CATEGORIES.completed` 补「已立」、新增 `classifyStatus` 唯一分类入口 + `BUCKET_TO_CATEGORY`/`DISPLAY_BUCKET_ORDER`；gen-docs-index 删硬编码 `ADR_BUCKETS` 接共享模块；check-adr-status/check-adr-health 改用共享函数。check 与 index 同函数后 adr-019/043/044/133/149 分叉全部消解（统一归已归档），验证 check/health 一致 226/13/11/0、unknown=0、test:scripts 216 全过。
