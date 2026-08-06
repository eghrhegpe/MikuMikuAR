# 第 12 轮审核报告 — env 状态链 / 动作模块化覆盖 / core 关键设施 / AI 子模块

> **日期**: 2026-08-06
> **范围**: 35 模块（env 状态链 9、动作模块化覆盖 8、core 关键设施 10、AI 子模块+动作支撑 8）
> **方法**: 4 子代理并行，知识卡 → 源码 → 5 维度 + 4 心理模拟；逐行核对源码，非照抄知识卡
> **结论**: 35 模块中 ✅通过 19 / ⚠️有条件通过 14 / ❌不通过 2（P1×3）

---

## 执行摘要

| 结论 | 模块数 | 模块 |
|------|--------|------|
| ✅ 通过 | 19 | env-state-schema、env-dispatcher、env-gravity、env-ground-spec、env-ground、motion-module-types、body-posture、bone-override-store、locale、load-refresh-registry、resource-warning-sink、orbit-state、ui-keyboard-nav、ai-intent-dispatcher、ai-scene-snapshot、ai-sse、chat-store、character-bible、lipsync-bridge |
| ⚠️ 有条件通过 | 14 | env-bridge、env-persist、env-collision、env-time-of-day、module-base、registry、riding-model、mmd-adapter、runtime-mode、shortcut-registry、feedback、wails-bindings、feet-adjustment、footstep |
| ❌ 不通过 | 2 | foot-modules、hand-modules（P1 共享帧钩子互斥） |

## 🔴 P1 问题（必须修复）

> **修复状态（2026-08-06）**：P1#1、P1#2 已修复并补回归测试，见下方「✅ 已修复」标注。

| # | 模块 | 位置 | 问题 | 影响 |
|---|------|------|------|------|
| 1 | foot-modules | `foot-modules.ts:26` + `module-base.ts:227-233` | 左右脚共享同一 `_footFrameHooks`（按 modelId 键控），`createEnsureActive` 的 `has(modelId)` 幂等检查误判：先启用左脚注册钩子，再启用右脚时 `has('m1')` 为 true 直接 return → **右脚位置偏移帧钩子永不注册**（旋转仍生效） | 左右脚同时启用时，后启用一侧 footPosX/Y/Z 静默失效 |
| 2 | hand-modules | `hand-modules.ts:52` + `module-base.ts:227-233` | 左右手共享 `_handFrameHooks`，同源 bug：后启用一侧手臂位置偏移帧钩子永不注册 | 左右手同时启用时，后启用一侧 handPosX/Y/Z 静默失效 |
| 3 | feet-adjustment | `feet-adjustment.ts:364-446` | 引擎本体零直接测试：知识卡所列 `feet-adjustment.test.ts` 仅测 `motion-algos/feet-adjustment-math.solveFootTarget`，未覆盖 `startFeetAdjustment`/`_adjustFoot`/IK 重解/WASM 分支/落地事件接线 | IK 引擎 + WASM/JS 分支 + 落地检测零守护 |

> 注：P1#1/#2 被两张知识卡（motion-modules-feet.md / hand-symmetry.md 当作「不变量」固化，需一并修正。

### ✅ 已修复（2026-08-06）

- **P1#1/#2（foot/hand 共享帧钩子互斥）**：将 `_footFrameHooks`/`_handFrameHooks` 从模块级共享改为**每侧独立**（移入 `createFootModuleFactory`/`createHandModuleFactory` 闭包内），左右脚/左右手各持一个按 modelId 键控的 manager，`has(modelId)` 不再互相误判。同步修正两张知识卡的不变量描述。新增回归测试 `motion-modules-registry.side-hooks.test.ts`（3 用例：左右脚/左右手同时启用各注册钩子且各写对侧骨骼、禁用一侧不影响另一侧）。
- **P1#3（feet-adjustment 引擎零测试）**：新增 `feet-adjustment.engine.test.ts`（8 用例），覆盖 start/stop 生命周期与幂等、JS 模式 IK 重解（ikSolver.solve）、WASM 模式 resolver 重解、跳跃阈值跳过、手动覆盖跳过、bone override 跳过、落地事件接线。同步更新 `motion-feet-adjustment.md` 的 tests 字段。

## 🟠 P2 问题（建议修复）

> **修复状态（2026-08-06）**：以下 #1/#2/#4/#6/#8/#9 已修复，见「✅ 已修复」标注；#3/#5/#7/#10/#11 已修复，见「✅ 已修复（第二批）」标注。

| # | 模块 | 位置 | 问题 |
|---|------|------|------|
| 1 | registry | `registry.ts:52-54` | `unregisterModule` 仅删注册表条目，不清理已 claim 的 ownedBones 与帧钩子 → 插件模块注销后骨骼所有权永久占用 + 帧钩子泄漏 |
| 2 | registry | `registry.ts:310-322` | `applyMotionModulesToModel` 无 try/catch，某模块 enable/setParam 抛错 → 后续模块全部不应用 |
| 3 | registry | `registry.ts:261-299` | `setTargetModel` 对新模型每模块先 enable 再逐参数 setParam，重复触发 bake + 多次 autosave |
| 4 | bone-override | `bone-override.ts:791-793` | `_runFrameHooks` 遍历 `_frameHooks.slice()` 无 try/catch，单模块钩子抛错中断整帧回调（跳过覆盖应用/IK 恢复/WASM 重解） |
| 5 | env-collision | `env-collision.ts:12-28` | `setCollisionEnabled`/`setBodyCollisionEnabled` 只写 envState + autosave，**无任何物理生效点**；`applyGroundCollision` 只读 `groundCollisionEnabled`，两字段是「只存不生效」死状态（ADR-212 已登记未落地） |
| 6 | env-time-of-day | `env-time-of-day.ts:104,112` | `startTimeOfDay` 幂等守卫在预设动画期间（`_timeOfDayPaused=true`）失效 → 重复注册 scene tick 回调并覆盖 `_unregisterTimeOfDay` 不释放旧回调 → 回调泄漏 + envSunAngle 每帧双倍递增 |
| 7 | mmd-adapter | `mmd-adapter.ts:210-249` | `solveIkNative`/`applyWindForceToModelRigidBodiesNative` 无直接单测（仅被 wind-physics-state.test mock 间接覆盖） |
| 8 | runtime-mode | `runtime-mode.ts:35-38` | `loadPersistedRuntimeMode` 的 `JSON.parse(raw)` 无 try/catch，localStorage 损坏 JSON 抛错冒泡中断 bootstrap |
| 9 | feedback | `feedback.ts:43,55` | 直接调 `showErrorToast`/`showInfoToast` 无 try/catch；toast.ts 在无 document 环境抛 ReferenceError，与 resource-warning-sink 的防御不一致 |
| 10 | footstep | `footstep.ts:128-157` | 本模块零测试（footstep-detect.test.ts 只测纯函数 detectFootLanding），合成音色与地面映射逻辑无守护 |
| 11 | module-base | `module-base.ts:119-133` | `setParam` 自动启用时直接 `cur.enabled = true` 改状态，未走 `setModuleEnabled`/独立 autosave |

### ✅ 已修复（2026-08-06）

- **#1 unregisterModule 清理**：store 新增 `getModelsOwningModule(moduleId)`，unregisterModule 先对每个持有该模块骨骼的模型 `createModule(id, modelId)?.disable()`（onDisable 注销帧钩子 + releaseOwnedBones），再删注册表条目。补回归测试（init.test.ts）。
- **#2 applyMotionModulesToModel 异常隔离**：每模块 try/catch，单模块失败不阻断其余。
- **#4 _runFrameHooks 异常隔离**：每帧钩子 try/catch + console.warn，单模块异常不中断整帧回调。
- **#6 startTimeOfDay 幂等**：守卫改为以 `_unregisterTimeOfDay` 为准（而非 `timeOfDayActive && !_timeOfDayPaused`），根治预设动画期间重复注册泄漏。
- **#8 runtime-mode JSON.parse**：`loadPersistedRuntimeMode`/`persistRuntimeMode` 包 try/catch 降级 null。
- **#9 toast 无 document 防御**：根因修在 `toast.ts` 的 `showToast` 入口（`typeof document === 'undefined'` 时降级日志返回），惠及所有调用方（feedback/resource-warning-sink），比逐调用方打补丁更通用。

### ✅ 已修复（第二批，2026-08-06）

- **#3 setTargetModel 单次 setState**：`setTargetModel` 对新模型每模块改走 `mod.setState({ id, enabled, params })` 单次调用（1 次 bake、0 次 autosave），替代 enable + N×setParam 的 N+1 次 bake + N 次 autosave。与 applyModuleSnapshot 同模式。
- **#5 env-collision 死状态接线**：`applyGroundCollision` 改为 `if (envState.collisionEnabled && envState.groundCollisionEnabled)`，collisionEnabled 作为总开关门控地面碰撞（总开关关闭时地面碰撞一并禁用）；env-collision.ts 补字段语义注释（collisionEnabled/groundCollisionEnabled 已接线，bodyCollisionEnabled 为预留字段）。补回归测试（ground-collision.test.ts「总开关关闭时地面碰撞一并禁用」）。
- **#7 mmd-adapter 补单测**：`mmd-adapter.native.test.ts` 补 `solveIkNative`（5 用例：正常透传/usePhysics/缺导出警告一次/哨兵 -1 不调/ptr 缺失）与 `applyWindForceToModelRigidBodiesNative`（4 用例：正常/缺导出警告一次/ptr 缺失/len<=0）直接单测。
- **#10 footstep 补单测**：新增 `footstep.test.ts`（18 用例），覆盖 resolveGroundSfxKind 地面映射（water/terrain/grass/wood/default + 优先级）、start/stop 生命周期（回调注册/降级检测/缓存清空）、落地回调音色触发（开关门控/音量归一化钳制/左右声像/无相机回退）、合成缓存惰性生成与复用。同步更新 motion-footstep.md 的 tests 字段。
- **#11 module-base setParam 自动启用持久化**：`setParam` 自动启用改走 `setModuleEnabled`（触发 autosave 落盘 enabled），替代直接 `cur.enabled = true` 改状态（不落盘，重启后自动启用丢失）。补回归测试（param.test.ts「自动启用并持久化 / 已启用不重复写」）。

## 🟡 P3 关注项（持续改进）

| 模块 | 问题 |
|------|------|
| env-bridge | `applyEnvStateFacade` 直接写 `state.groundReflectionQuality`（setEnvState 之外状态直写，副作用不可追踪）；cel 激活期间用户改 env 字段会重新持久化临时态 |
| env-time-of-day | `applyEnvPresetObject`/`syncEnvSunAngle` 未钳制 [-15,90]，破坏「envSunAngle 始终钳制」不变量（对比 setEnvSunAngle 有钳制，不一致） |
| registry | `_fallbackModuleStates` 无 intent 时第二状态源永不清理，与 `intent.motionModules` 双源 |
| body-posture | `_centerBoneCache`/`_ikBoneCache` per-model 缓存模型删除后不清理 |
| riding-model | 整模块零直接测试（autoPedal 钩子注册/注销、`_ridingFeet` 认领）；`_ridingFeet` 禁用/删除后不清理 |
| hand-modules | `_driveArm` IK 路径无直接单测 |
| shortcut-registry | 知识卡声称「重复注册报错」「可注销」，实际 `_shortcuts.set` 静默覆盖、无公共 unregister API |
| sse | `signal.aborted` 仅在循环顶部检查，abort 发生在 `await reader.read()` 挂起期间需等流结束（依赖消费者 abort fetch 兜底） |
| footstep | 落地回调内 `getAudioContext()` 无 try/catch，AudioContext 创建抛错会向上传播破坏整帧运动管线 |
| wails-bindings | `export *` 透传 40+ 未代理原始函数，若业务从 wails-bindings 导入会绕过 resolveBackend（已核实当前业务均经 ./backend，风险潜在） |

## 跨模块模式问题

1. **🔴 共享帧钩子管理器按 modelId 键控导致左右侧模块互斥**（foot-modules.ts:26 / hand-modules.ts:52 + module-base.ts:227-233）——`createEnsureActive` 的 `has(modelId)` 幂等检查无法区分左右脚/左右手两个模块，后启用一侧位置偏移帧钩子永不注册。本次审核最严重发现，且被两张知识卡当作不变量固化。
2. **🟠 帧钩子/模块应用无异常隔离**：`_runFrameHooks`（bone-override.ts:791）与 `applyMotionModulesToModel`（registry.ts:310）均无 try/catch，单模块异常中断整帧/整批。
3. **🟠 unregisterModule 不清理运行时资源**（registry.ts:52）：ownedBones + 帧钩子泄漏。
4. **🟡 各模块 per-model 缓存模型删除后不清理**（`_centerBoneCache`/`_ikBoneCache`/`_armIkCache`/`_ridingFeet`/`_fallbackModuleStates`），内存随模型增删累积。
5. **🟡 运动模块测试缺口集中**：feet-adjustment.ts 与 footstep.ts 两个核心运动引擎本体均零直接测试，仅其纯数学/纯判定叶子（solveFootTarget、detectFootLanding）有测试。
6. **🟡 无 document 环境防御不一致**：resource-warning-sink 包 try/catch 降级，feedback.ts 直接调 toast 无防御。
6. **🟡 一次性 dev 警告模式重复 5 次**（mmd-adapter.ts:110/162/209/268/320 的 `_xxxMissingWarned`），可抽公共 helper 豁免。

## 知识卡偏差汇总（已发现待修）

| 知识卡 | 偏差 |
|--------|------|
| motion-modules-feet.md / hand-symmetry.md | 声称左右脚/左右手共享 `_xxxFrameHooks Map（按 modelId 注册一次）——**固化了 P1 bug，应改为按 (modelId, moduleId) 键控 |
| motion-modules-registry.md | 正文「对外 API」描述 `class MotionModuleRegistry`，实际为独立函数 + `registerModule(id, meta, priority, factory)`，无 class |
| motion-modules-body-posture.md / riding-model.md | 声称 `class BodyPostureModule`/`class RidingModelModule`，实际为工厂函数 |
| motion-modules-feet.md | 「feet-adjustment(order=5)」把 feet-adjustment 描述为帧钩子 order，实际它是独立引擎 stage；`FRAME_HOOK_ORDER.BODY_POSITION=5` 是 body-posture センター 钩子 |
| runtime-mode.md | 严重过时：描述 desktop/browser 检测，实际为 MPR/COI/SAB 徽标；无 enum；消费方不符 |
| mmd-adapter.md | 声称 getStreamAudio 仍依赖私有 `_audio`，实际已用公开 `player.audio` getter |
| env-gravity.md / env-time-of-day.md | 声称「被 env.ts 门面 re-export」，实际在 scene.ts:817/820 |
| env-time-of-day.md | 不变量「envSunAngle 始终钳制 [-15,90]」过强，applyEnvPresetObject/syncEnvSunAngle 未钳制 |
| env-state-schema.md | 「envBrightness（ADR-132）」字段已迁移为 globalBrightness（ADR-210） |
| locale.md / shortcut-registry.md | `tests: []` 实际有 locale.detect.test.ts / shortcut-registry.test.ts |
| ai-* 6 张卡 | `tests: []` 过期，intent-dispatcher/scene-snapshot/sse/chat-store/character-bible/dialogue-* 均有测试且覆盖良好 |
| lipsync-bridge.md | 不变量「口型参数 [-1,1]」实际钳制为 clamp01 → [0,1] |
| ai-scene-snapshot.md | 不变量「≤2048 字符预算」代码未强制截断（仅设计预算） |
| wails-bindings.md | 「106 个代理」实为 110 个 |

## 测试覆盖两极分化

- **覆盖充分**：env-state-schema（ADR-243 type/default 互锁）、env-gravity（gravity-sun.int.test）、env-time-of-day（presets.int.test 覆盖第二预设取消第一预设）、env-ground-spec（contract.test）、bone-override-store（M3-M9 全不变量）、motion-modules-registry（conflict/create/disable/ik/init/param/snapshot 7 文件）、ai 子模块（intent-dispatcher/scene-snapshot/sse/chat-store/character-bible 全路径）、lipsync-bridge、ui-keyboard-nav、resource-warning-sink。
- **零覆盖：foot-modules 帧钩子、hand-modules 帧钩子、riding-model 整模块、feet-adjustment 引擎本体、footstep 合成音色、env-collision、env-persist 直接测试、unregisterModule 清理、clearAllModulesForModel 帧钩子清理。

## 改进优先级建议

### ✅ 已完成（2026-08-06）
1. `module-base.ts` 帧钩子管理器改为每侧独立（foot/hand 各持独立 `_xxxFrameHooks`），根治左右侧位置偏移静默失效 + 补回归测试
2. 补 `feet-adjustment.ts` 引擎本体单测（IK 重解 / WASM-JS 分支 / 落地事件 / 手动覆盖跳过）
3. 修正 motion-modules-feet.md / hand-symmetry.md 知识卡（移除「共享 Map」不变量描述）

### 📋 短期改进（P2，11 项）
优先资源生命周期类：registry unregister 清理、bone-override 帧钩子 try/catch、env-time-of-day startTimeOfDay 幂等、footstep 回调 try/catch；其次健壮性：runtime-mode JSON.parse、feedback toast 防御、env-collision 死状态（ADR-212 落地）。

### 🔧 持续改进（P3）
补 riding/hand/foot 帧钩子测试；修正 15 张知识卡偏差（tests 字段、门面 re-export 位置、钳制不变量、工厂函数 vs class）。