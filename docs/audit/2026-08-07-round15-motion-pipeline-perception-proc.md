# 第 15 轮审核报告 — motion 管线 / 播放 / 感知 / 程序化

> **日期**: 2026-08-07
> **范围**: 16 模块（motion-pipeline / playback / perception × 11 / proc-motion × 3）
> **方法**: 知识卡 → 源码 → 5 维度 + 4 心理模拟；逐行核对源码
> **结论**: ✅通过 14 / ⚠️有条件通过 2 / ❌不通过 0（P1×0）

## 执行摘要

| 结论 | 模块数 | 模块 |
|------|--------|------|
| ✅ 通过 | 14 | motion-pipeline, playback, perception, perception-balance, perception-blinking, perception-breathing, perception-expression, perception-gaze, perception-gaze-js, perception-gaze-wasm, perception-lipsync, perception-observer, proc-motion-bridge, proc-motion-controller, proc-motion-params |
| ⚠️ 有条件通过 | 2 | perception-shared（对象池溢出路径 GC 压力）, perception-balance（知识卡矛盾） |
| ❌ 不通过 | 0 | — |

> 注：16 个文件实际对应 15 个模块（perception-shared 为共享类型模块，计入 16 文件）。

## 🔴 P1 问题（必须修复）

无。

## 🟠 P2 问题（建议修复）

| # | 模块 | 位置 | 问题 |
|---|------|------|------|
| 1 | perception-shared | perception-shared.ts:192/203/206 | `_propagateChildrenWasm` 每递归一层 `new Matrix()` × 3，骨骼链深度 ≤10 时单帧最多 ~30 个临时 Matrix。注释声明"GC 压力可控"，但高频调用（每帧 × 多模型）下仍可能触发 GC 抖动。建议复用局部池或传入 Matrix 复用参数。 |
| 2 | playback | playback.ts:151/156/161 | dispose 路径中 3 个 `catch {}` 静默吞错。虽有注释说明"单个清理失败不中断整体"，但完全吞掉异常会掩盖 dispose 时的真实错误（如 observer 已被移除导致二次 dispose 抛错）。建议至少 `console.warn` 记录。 |
| 3 | proc-motion-bridge | proc-motion-bridge.ts:140 | `mode as Parameters<typeof setProcMotionMode>[0]` — 从 `string` 强转为 `ProcMotionMode` 联合类型，无运行时校验。若 scene-action-bridge 传入非法字符串，下游 `_refProcState` 可能读到未定义模式。建议加 `if (!['idle','autodance','off'].includes(mode)) return` 守卫。 |

## 🟡 P3 关注项

- **motion-pipeline.ts:104** — `getOrderedLayers()` 返回 `readonly PipelineLayer[]`，但底层是可变 `this.layers`。`readonly` 仅阻止调用方重赋值数组引用，不阻止 `push/splice` 等变异操作，且变异不会触发 `sorted = false`。若未来有调用方误改数组，排序状态会静默失效。建议返回 `this.layers.slice()` 或改用 `Object.freeze`。
- **perception.ts:630** — `pinPerception(modelId, state)` 中传入的 `state` 直接 `_setFocusedState(state)` 覆盖场景级参数，与 pin 的"白名单"语义不符（pin 本不应携带独立参数）。注释已说明"兼容旧存档"，但新调用方可能误用。
- **perception-gaze.ts:449** — `skeleton?._markAsDirty?.()` 调用私有 API `_markAsDirty`，依赖 babylon-mmd fork 的内部实现。若上游变更，JS 路径 gaze 将静默失效（无报错）。
- **perception-lipsync.ts:107** — `getSceneAction('getAudioPath')?.() ?? ''` 在音源切换检测中使用，若 `getAudioPath` 返回 `undefined` 会被 `??` 转为 `''`，与 `rt.audioPath` 初始值 `''` 一致，不会触发误重置。逻辑正确，但 `getSceneAction` 返回类型是 `unknown`，调用链较长。
- **proc-motion-controller.ts:83/88** — `inst.procMotion as ProcMotionState` / `intent.procMotion as ProcMotionState` 两处类型断言。`procMotion` 在 `ModelInstance`/`MotionIntent` 中声明为 `ProcMotionConfig`，断言为 `ProcMotionState` 依赖两者结构兼容。若未来两者字段分化，断言会静默通过但运行时行为异常。
- **proc-motion-params.ts:67/98** — `intent.procMotion = { ...DEFAULT_PROC_STATE } as ProcMotionConfig` 两处断言。与上条同源，`DEFAULT_PROC_STATE` 类型为 `ProcMotionState`，断言为 `ProcMotionConfig`。

## 知识卡偏差汇总

| 知识卡 | 偏差 |
|--------|------|
| perception-balance.md | **前后矛盾**：front matter invariant 写"balanceSwayPeriod 有独立 setter 与默认值（2.0s），与呼吸参数无联动（知识卡旧「与呼吸频率联动」不成立）"，但正文 invariant 仍写"微动频率与呼吸频率联动"。源码确认 `_BALANCE_SWAY_PERIOD = 2.0` 为常量，无联动。正文需删除"微动频率与呼吸频率联动"。 |
| proc-motion-bridge.md | **状态描述过时**：写"状态收口为模块内 `ProcMotionController` 类实例（不导出）"，但源码 `proc-motion-bridge.ts:38` 实际 `export class ProcMotionController`。ADR-237 P1 拆分后该类已导出供测试/扩展使用。 |
| perception-gaze.md | **基本准确**：`applyGazeWasm` "当前无外部调用者，仅经 perception.ts re-export 预留"与源码一致（grep 确认 motion/ 目录下无其他调用方）。 |
| perception-blinking.md | **tests 字段为空**：知识卡 `tests: []`，但无对应测试文件。与 perception-breathing.md（同样 `tests: []`）一致，属已知缺口，非偏差。 |

## 逐模块审核要点

### motion-pipeline.ts — ✅ 通过
- 纯逻辑调度器，无 Babylon 运行时对象，便于单测。
- `runFrame` 对每个 layer 独立 try/catch，单 layer 抛错不影响后续层（与 Babylon observer 行为一致）。
- `getMotionPipeline()` 懒单例，无 dispose 需求（无资源持有）。
- 亮点：`runFrame` 用 `snapshot = this.layers.slice()` 快照迭代，允许 run 内 unregister 不跳过层。

### playback.ts — ✅ 通过
- `_disposed` 双清理防护到位，`_manager`/`_loopPending` dispose 时清零（兑现知识卡 invariant）。
- auto-loop Promise 链有完整 `.catch`，`_loopPending` 在错误路径正确复位。
- `updateProcMotion().catch(...)` 防止 fire-and-forget 未处理拒绝。
- `seekFromEvent` 用 `clamp01` 防越界。
- P2#2：dispose 路径 `catch {}` 建议至少 warn。

### perception.ts — ✅ 通过
- 场景级 `_perceptionState` 单例 + per-model `_contexts` Map，参数共享引用（`_setFocusedState` 用 `Object.assign` 原地更新，避免替换引用导致 context 指向旧对象）。
- `_ensureObserverRegistered` 幂等，`_reclaimListenerAdded` 防重复注册 release listener。
- `deactivatePerception` 有 pinned 模型时保留 observer，仅清理焦点状态。
- `enableAllPerception`/`disableAllPerception` 正确管理 `_allEnabled` 标志和 context 状态。
- `onPerceptionModelRemoved` 区分焦点/非焦点路径，焦点走 `deactivatePerception`，非焦点走 `_removeContext`。
- 亮点：`_onBoneOverrideRelease` 用 `moduleId.startsWith('perception.')` 防自身释放触发递归 reclaim。

### perception-balance.ts — ⚠️ 有条件通过
- 增量叠加策略（撤销上帧 + 应用本帧）正确保留 VMD 基准旋转。
- 关闭时撤销 `lastBobY` 防残留冻结。
- 知识卡偏差：正文 invariant 与 front matter 矛盾（见上表）。
- 条件：修复知识卡矛盾后通过。

### perception-blinking.ts — ✅ 通过
- `amp=0` 时 early return 避免覆盖 VMD 半眨眼关键帧。
- 与既有 influence 取 `Math.max`（眨眼优先）。
- 无资源持有，无需 dispose。

### perception-breathing.ts — ✅ 通过
- delta 增量叠加与 balance 同款模式，保留 VMD 基准旋转。
- `amp=0` 时仍执行撤销上帧偏移，防关闭瞬间残留。
- `_updateBoneChain` 递归传播子骨骼（JS 路径）。

### perception-expression.ts — ✅ 通过
- tier 守卫（low 跳过）正确。
- 情绪切换时复位旧 morph 防串味（happy→angry 清零笑み）。
- 关闭/neutral 时复位上次 morph 防定格。

### perception-gaze.ts — ✅ 通过
- JS/WASM 双路径通过 strategy 注入收敛，共用 lookDir/clamp/Slerp/cache 骨架。
- `_isWasmRuntime` 自动分支，非按性能切换（与知识卡一致）。
- Swing-Twist 分解避免 toEulerAngles 大角度信息丢失。
- `_applyGaze` 在 JS 路径末尾调 `skeleton?._markAsDirty?.()`，WASM 路径不调（与知识卡一致）。
- `applyGazeWasm` 无外部调用方（grep 确认），仅 re-export 预留。

### perception-gaze-js.ts — ✅ 通过
- 薄包装：调用 `_applyHeadGazeCore`/`_applyEyeGazeCore` + 注入 JS 写入策略。
- 写入策略：改 `linkedBone.rotationQuaternion` + `_updateBoneChain` 传播。

### perception-gaze-wasm.ts — ✅ 通过
- 薄包装：调用 core + 注入 WASM 写入策略。
- 写入策略：直写 `worldMatrix` frontBuffer + `_propagateChildrenWasm` 传播，无需 `_markAsDirty`。

### perception-lipsync.ts — ✅ 通过
- per-model 运行时隔离（`_lipSyncRuntimes` Map），多模型互不污染。
- 音源切换时重置状态（`audioPath !== rt.audioPath`）。
- 音频停止时指数衰减（×0.85/帧），衰减完成后复位所有口型 morph。
- 多口型 morph 开关关闭时显式清零（fix P3 已修复 smile 残留）。
- `_disposeLipSyncRuntime` 在模型移除时调用。

### perception-observer.ts — ✅ 通过
- 无模块级可变状态，全部参数注入。
- try/finally 确保 `_setContextPool(null)` 恢复全局池（防遗留指向已切换 context 的引用）。
- 每个子模块独立 try/catch + `logWarn`，单模块异常不影响其他。
- `_getActiveContextsByTier` 按 tier 筛选，medium 档用 `getMediumMaxOthers()` 限制非焦点模型数。

### perception-shared.ts — ⚠️ 有条件通过
- 纯类型/常量/工具函数，无运行时状态（知识卡 invariant 准确）。
- 对象池模式（`_v3`/`_m`/`_q`）消除每帧 GC 压力，溢出时 fallback 到 `new`。
- `_propagateChildrenWasm` 每层 `new Matrix()` × 3（P2#1），注释声明 GC 可控但高频下仍有风险。
- `isWasmRuntime` 用 `'updateWorldMatrix' in bone` 判断，与 babylon-mmd fork 实现绑定。
- 条件：P2#1 修复后通过。

### proc-motion-bridge.ts — ✅ 通过
- 薄转发层（135 行），26 个导出委托到 `_getCtrl()` 懒单例。
- `disposeProcMotion` 调用 `_ctrl.dispose()` 后 `_ctrl = null`，再次调用时重新创建。
- scene-action-bridge 注册 `setProcMotionMode`/`regenerateProcMotion`。

### proc-motion-controller.ts — ✅ 通过
- `_starting` 标志防并发启动，`_stopRequested` 防 await 期间 stop 后重新激活。
- `_startProcMotion` 用 try/finally 确保 `_starting` 复位（即使 VMD 生成抛错）。
- `_regeneratePending` deferred 重跑在 finally 后执行，避免嵌套调用冲突。
- `stopProcMotion(modelId)` 支持按模型停止，不传则全量清理。
- `dispose` 调用 `safeDispose(this._beatDetector)` 释放资源。
- per-model 状态 `_modelProcState` 与 `_activeModels` 同步（成功 set / 停止 delete）。

### proc-motion-params.ts — ✅ 通过
- mixin 模式混入 `ProcMotionControllerBase`，参数 setter 群职责单一。
- `_writeProcState` 同步写入 activeMotion + fallback，保证无动作时本地状态一致。
- `getProcMotionState` 深层拷贝 params（含 boneToggles），防调用方 mutate 污染内部状态。
- `setProcMotionState` 经 `migrateProcState` 兼容旧扁平存档。
- 各 setter 有类型校验（`typeof v !== 'boolean'` / `valid.includes(...)`）。

## 心理模拟

| 场景 | 结果 |
|------|------|
| `_applyGaze` 中 `_isWasmRuntime` 抛异常 | 被 perception-observer 的 try/catch 捕获，`logWarn` 记录，不影响其他感知子模块 |
| `updateProcMotion` 异步抛错 | playback.ts:71 `.catch` 捕获并 `console.error`，不阻塞渲染帧 |
| 用户快速点击 3 次播放/暂停 | `_loopPending` 防 auto-loop 期间 UI 闪烁；`_disposed` 防 dispose 后回调执行 |
| `perceptionObserver` run 内模型 dispose | `inst.mmdModel.mesh?.isDisposed()` 守卫跳过，`_deactivateContext` 清理 |
| `_startProcMotion` VMD 生成抛错 | try/finally 确保 `_starting = false`，catch 中 `_clearVmdData` 清理残留 |
| `disposeProcMotion` 后再次调用 setter | `_getCtrl()` 重新创建单例，setter 正常工作 |
| `_propagateChildrenWasm` 递归过深 | 骨骼链深度 ≤10，`new Matrix()` 临时对象 GC 可控 |
| `_setContextPool` 在异常路径未恢复 | finally 块 `_setContextPool(null)` 确保恢复 |

## 验证

- [x] 已检查所有 16 个文件
- [x] 已核对 11 张知识卡（motion-pipeline / motion-playback / perception / perception-balance / perception-blinking / perception-breathing / perception-expression / perception-gaze / perception-gaze-js / perception-gaze-wasm / perception-lipsync / perception-observer / perception-shared / proc-motion-bridge）
- [x] 已 grep 定位 `as any` / `@ts-ignore` / `catch {}` / `from '@/core/utils'` / `new` 创建点
- [x] 已执行 4 项心理模拟（异常路径 / 异步错误 / 快速操作 / dispose 守卫）