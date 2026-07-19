# ADR-146: 函数级重复摸排与收敛（第二波）

- **状态**: 立项
- **日期**: 2026-07-19
- **相关**: ADR-143（P1 之外剩余项）、ADR-139（ObserverRegistry）、ADR-140（DragSliderController）、ADR-142（withLoadingStatus）、ADR-138（env-dispatcher）、ADR-096（通用 Helper 收敛）、ADR-101（通用逻辑第二波收敛）、ADR-105（AbortSignal 传递规范）、ADR-116（bone override UI）、ADR-129（per-motion UI）

## 背景与问题

2026-07-19 同日进行的「函数级重复摸排」第二轮，覆盖 **UI builder、状态同步、资源释放、motionModule 工厂** 四大维度。ADR-143 已收敛 4 项（持久化 catch、loadManager signal、cs-row 孤岛、魔法数值），本 ADR 收录 ADR-143 范围之外的剩余可统一项。

### 与既有 ADR 的边界

| 既有 ADR | 已覆盖主题 | 本 ADR 是否重复 |
|----------|------------|------------------|
| ADR-139 | Observer 生命周期（env 子系统已统一） | 否，仅补 camera.ts 5 处裸 add 与菜单 DOM 事件未走封装的散点 |
| ADR-140 | 滑块拖拽/键盘（DragSliderController） | 否，本 ADR 不涉及滑块控制器 |
| ADR-142 | setStatus 状态机（withLoadingStatus） | 否，本 ADR 的 safeCall 不替代 withLoadingStatus |
| ADR-143 主题 3 | env-bridge 4 处持久化 catch | 否，本 ADR 主题 2 处理全局散点 ≥25 处 try/catch+logWarn |
| ADR-143 主题 6 | 3 处 cs-row/toggle-row 孤岛 | 否，本 ADR 主题 1 处理 preset-chip 20 处手写、主题 9 处理 model-material.ts 行内 toggle |
| ADR-143 主题 7 | 魔法数值与 SCENE_EVENTS | 否，无重叠 |
| ADR-138 | env-dispatcher 解循环 | 否，本 ADR 主题 14 收敛 envState 散落写入点是 dispatcher 之上的 setter 层 |
| ADR-116/129 | bone override UI 重设计、per-motion UI | 否，本 ADR 主题 12-13 收敛 motionModule 工厂模板，不动 UI 结构 |

### 摸排发现总览

| 维度 | 已统一（无需动） | 本 ADR 收敛候选 |
|------|------------------|------------------|
| UI builder | `addSliderRow` / `addToggleRow` / `addColorSliderRow` / `addVector3SliderRow` / `addModeSlider` / `addCollapsible` / `slideRow` 全部走 `ui-helpers` barrel | preset-chip 20 处手写、行内 toggle 3 处、6 处直接 import 子模块 |
| 状态同步 | `setEnvState` 已是唯一入口；`_syncWaterUniforms` 派生逻辑多不强抽 | env-water preset 4 行 setFloat 重复、envState 直接写入点 5 处 |
| 资源释放 | `ObserverHandle` / `addDisposableListener` 已存在 | 60-80 处 `if(x){x.dispose();x=null;}` 模板、5 处裸 `Observable.add`、菜单层 addEventListener |
| motionModule 工厂 | `createModuleBase` / `createFrameHookManager` / `registry` 已抽取 | 6 处工厂末尾 5 行 spread、6 处 registerXxx、6 处 bake 头部 4 行守卫 |
| 错误处理 | logger.ts 提供 `logInfo`/`logWarn`/`logError` | ≥25 处内联 `try/catch+logWarn` 与 `.catch(err=>logWarn(...))` |
| Wails binding | `@/core/wails-bindings` 已统一 | 无 |

---

## 决策

按 ROI 分 P1 / P2 / P3 三组收敛，全部复用已有设施或新增轻量 helper，不引入新抽象层。

### 组 A — P1（高收益、低风险，5 项）

#### 主题 1：preset-chip 20 处手写 → 扩展 addPresetChip

| 项 | 内容 |
|----|------|
| 涉及文件（按手写密度） | `menus/motion-pose-levels.ts`（5 处 chip）、`menus/model-detail.ts`（3 处 chip + 行内布局）、`menus/motion-popup.ts`（3 处 chip）、`menus/motion-override-levels.ts`（2 处 chip，含 danger）、`menus/resource-detail-helpers.ts`（2 处 chip）、`menus/scene-stage-lights.ts`（1 处 icon chip）、`menus/scene-render-presets.ts`（1 处 chip）、`menus/motion-gaze-levels.ts`（1 处 chip）、`menus/menu.ts:949-957`（chips 分支等价于 `buildPresetChipGroup`） |
| 差异维度 | active 处理（`+ (cond ? ' active' : '')` vs `classList.toggle`）、stopPropagation（行内嵌按钮需防冒泡，公共未做）、icon 支持、variant（default/danger/badge）、title 属性、margin-left/marginTop 内联 style、i18n 硬编码（`model-detail.ts:776` 内联中文 `✓ 已显示:`） |
| 豁免 | `menus/env-preset-levels.ts:142`（外部库返回元素，className 重写是特殊场景，保留） |
| 统一动作 | 扩展 `core/ui-collapsible.ts:175` `addPresetChip(container, label, active, onClick, opts?)` 的 opts：新增 `icon?: string`、`variant?: 'default'\|'danger'\|'badge'`、`title?: string`、`marginTop?: number`、`stopPropagation?: boolean`、`readonly?: boolean`；`menu.ts:949-957` chips 分支替换为 `buildPresetChipGroup`；顺带修 `model-detail.ts:776` 的 i18n 硬编码 |
| 验收 | `grep -rn "className.*preset-chip" src/menus` 归零（除豁免项）；`model-detail.ts:776` 改走 `t()` |

#### 主题 2：safeCall / safeCallVoid / safeCallAsync 三件套

| 项 | 内容 |
|----|------|
| 涉及文件（≥25 处散点，按文件聚类前 11 项） | `core/audio-bus.ts:111,151,163`（3 处）、`outfit/audio.ts:59,195,241-243,277-279,370,404,488,493`（≥10 处）、`outfit/outfit-overlay.ts:173,228,241,259,275-279,359-372`（≥8 处）、`outfit/outfit.ts:122,136,153,202,226,492,565`（≥7 处）、`physics/physics-bridge.ts:152-154`（典型 safeCall 模式但内联）、`motion-algos/beat-detector.ts:60-62,70-84,178-180`、`core/dev-hooks.ts:51-54,65`、`menus/env-preset-levels.ts:75-77`、`core/events.ts:415-419,425-427,433-435`、`menus/library-actions.ts:120-123,137-146,276-299,304`、`core/init.ts:132,135,156,176,182`（5 处 `.catch(err => logWarn(...))`） |
| 与 ADR-143 主题 3 关系 | ADR-143 主题 3 仅处理 `env-bridge.ts` 4 处持久化 catch；本主题处理全局散点 ≥25 处，二者不冲突 |
| 统一动作 | 在 `core/logger.ts` 或新建 `core/safe-call.ts` 中加入：<br>`safeCall<T>(tag, msg, fn: () => T): T \| undefined`<br>`safeCallVoid(tag, msg, fn: () => void): void`<br>`safeCallAsync<T>(tag, msg, fn: () => Promise<T>): Promise<T \| undefined>`<br>内部统一走 `logWarn`（不引入 `safeLogInfo`/`safeLogError`，避免过度设计） |
| 验收 | `grep -rn "catch(err => logWarn" src` 归零；`grep -rn "} catch.*logWarn" src` 仅剩 safeCall 内部 1 处 |

#### 主题 3：safeDispose helper（if-dispose-null 模板）

| 项 | 内容 |
|----|------|
| 涉及文件（60-80 处模板重复） | `scene/env/env-water.ts:878-924`（disposeWater 8 处）、`scene/env/env-clouds.ts:729-779`（disposeClouds 8 处）、`scene/env/env-sky.ts:318-341`（disposeSky 5 处）、`scene/env/env-particles.ts:476-506`（disposeParticles 7 处）、`scene/render/renderer.ts:153-191`（disposeRenderer 6 处）、`scene/render/lighting.ts:742-781`（disposeLighting 5 处）、`scene/env/env-ground.ts:223-240`（disposeGroundMaterial 5 处） |
| 模板形态 | `if (_volCloudMat) { _volCloudMat.dispose(); _volCloudMat = null; }` × 60-80 |
| dispose 签名差异 | `mat.dispose()` / `mesh.dispose(true)` / `mat.dispose(false, true)` / `tex.dispose()` — Babylon 不同对象签名不同 |
| 统一动作 | 新建 `core/dispose-helpers.ts`（或并入 `observer-handle.ts`）；提供 `safeDispose<T extends { dispose(...args: any[]): void }>(obj: T \| null, ...args: any[]): null`；调用形式 `_volCloudMat = safeDispose(_volCloudMat);` 或 `_envSys.water.mesh = safeDispose(_envSys.water.mesh, true);`；按文件逐步迁移，不强制一次重写所有 dispose 函数 |
| 不抽取 | `disposeModule(name)` 统一入口 — 各模块副作用差异大（water 需清涟漪+水下+反射，clouds 需清 debug visual），参数对象会臃肿 |
| 验收 | `grep -rn "if (\_.*\) { \_.*\.dispose(); \_.* = null; }" src/scene/env` 按文件归零 |

#### 主题 4：camera.ts 5 处裸 Observable.add → observe()

| 项 | 内容 |
|----|------|
| 涉及文件 | `scene/camera/camera.ts:531,548,568,589,617`（5 处 `cam.onViewMatrixChangedObservable.add(scheduleCameraPersist)`） |
| 风险 | 相机切换时若旧 cam 未 dispose，observer 泄漏（`cam.dispose()` 内部虽会清理，但 ADR-139 的统一规范要求显式走 `observe()`） |
| 统一动作 | 改为 `observe(cam.onViewMatrixChangedObservable, scheduleCameraPersist)` 或 `reg.add(...)`；或在 camera dispose 时显式 `cam.onViewMatrixChangedObservable.remove(...)` 并保留 handle |
| 验收 | `grep -n "onViewMatrixChangedObservable.add" src/scene/camera/camera.ts` 0 处 |

#### 主题 5：menu.ts 弹窗标题 toggle preventDefault bug

| 项 | 内容 |
|----|------|
| 涉及文件 | `menus/menu.ts:853-867`（弹窗标题 toggle，缺 `e.preventDefault()`） |
| 与公共 slideRow headerToggle 差异 | 公共 `ui-slide-row.ts:171` 有 `e.preventDefault()` 防原生二次派发；手写版本只 `stopPropagation` + 翻转 checked |
| 风险 | 原生二次派发 click 导致双触发 bug |
| 统一动作 | 抽 `addHeaderToggle(headerEl, config)` 轻量公共函数（弹窗标题不是 slideRow，无法直接复用）；或先直接补 `e.preventDefault()` 修复 bug，再考虑抽取 |
| 验收 | `menus/menu.ts:853-867` 双触发 bug 修复；新增 `addHeaderToggle` 单测（若抽） |

### 组 B — P2（中收益，6 项）

#### 主题 6：菜单层 addEventListener → addDisposableListener

| 项 | 内容 |
|----|------|
| 涉及文件 | `menus/env-menu.ts:82-86`（window 'mmar:library-scanned'，已配对但未走统一）、`menus/library-actions.ts:104,107`（document 'mmku:modelLoaded'）、`menus/motion-popup.ts:734-735`（window 'mmar:library-scanned'）、`menus/motion-override-levels.ts:197`（document 'click' outsideClick）、`core/dialog.ts:70-71,137,140,218,227,381,382`（多处 dialog 事件） |
| 现状 | 已有 `core/dom.ts:63` `addDisposableListener` + `core/events.ts:31` `_eventDisposables` 模式，但上述文件仍手写 `addEventListener` + `disposeXxxListeners` |
| 统一动作 | 改用 `addDisposableListener(target, type, handler, options?)` + `_eventDisposables` 数组（与 `core/events.ts:42` 模式对齐） |
| 验收 | `grep -rn "addEventListener.*removeEventListener" src/menus` 归零（除豁免） |

#### 主题 7：_ensureBlueNoiseTexture 缺 scene 校验（bugfix）

| 项 | 内容 |
|----|------|
| 涉及文件 | `scene/env/env-clouds.ts:167-186` |
| 现状 | `if (_blueNoiseTex) return _blueNoiseTex;` 无 scene 校验；与同文件 `_ensureNoiseTexture:72-98` 的 `if (_noiseTex3D && _noiseTex3D.getScene() === scene)` 模式不一致 |
| 风险 | 场景切换时复用旧 scene 纹理 |
| 统一动作 | 补 `_blueNoiseTex.getScene() === scene` 判断 |
| 验收 | `_ensureBlueNoiseTexture` 含 scene 校验；体积云场景切换单测通过 |

#### 主题 8：env-water preset 4 行 setFloat 字面重复

| 项 | 内容 |
|----|------|
| 涉及文件 | `scene/env/env-water.ts:1231-1240`（`applyWaterPresetToMaterial`）重复 `_syncWaterUniforms:522-525` 的 `fresnelBias`/`fresnelPower`/`diffuseStrength`/`ambientStrength` 4 个 uniform |
| 统一动作 | `applyWaterPresetToMaterial` 直接调用 `_syncWaterUniforms(state, scene)` 而非重写 4 行 setFloat |
| 验收 | `applyWaterPresetToMaterial` 不再含 4 行 setFloat；preset 应用后水面 uniform 与 sync 一致 |

#### 主题 9：model-material.ts 2 处行内 toggle → slideRow headerToggle

| 项 | 内容 |
|----|------|
| 涉及文件 | `menus/model-material.ts:414-447`（matRoot 行 toggle）、`:754-780`（matList 行 toggle） |
| 与公共差异 | 缺 `disabled`/`onDisabledClick` 支持；多 `row.classList.toggle('mat-disabled', !newState)` 副作用；多 `setStatus()` 国际化消息，且 i18n 硬编码中文 `✓ 已显示: ${detail.name}` / `✕ 已隐藏: ${detail.name}` 未走 `t()` |
| 统一动作 | 收敛到 `slideRow` 的 `headerToggle.bind` + `onChange` 钩子；通过 `onUpdate` 处理 `mat-disabled` class；改走 `t()` + i18n key |
| 验收 | `model-material.ts` 行内 toggle 0 处；i18n 硬编码中文归零 |

#### 主题 10：6 处直接 import 子模块 → ui-helpers barrel

| 项 | 内容 |
|----|------|
| 涉及文件 | `menus/env-preset-levels.ts:8`、`menus/menu.ts:4`、`menus/motion-camera-levels.ts:57`、`menus/motion-override-levels.ts:13-14`、`menus/settings-rendering.ts:14` |
| 现状 | 上述 5 个文件直接 `from '../core/ui-rows'` / `'../core/ui-collapsible'`，其余 30+ 调用点走 `ui-helpers` barrel |
| 统一动作 | 改为 `from '../core/ui-helpers'`，无副作用 |
| 验收 | `grep -rn "from '\.\./core/ui-rows'" src/menus` 归零；`grep -rn "from '\.\./core/ui-collapsible'" src/menus` 归零 |

#### 主题 11：motion-popup 与 motion-override-levels 模块列表渲染段重复

| 项 | 内容 |
|----|------|
| 涉及文件 | `menus/motion-popup.ts:621-656`（`initMotionModules()` → `getRegisteredModules()` → `slideRow` + `bind: () => getModuleState(modelId, mod.id).enabled` + `onChange` 触发 `enable/disable` + `reRender`）、`menus/motion-override-levels.ts:287-324`（同模板，仅少 `initMotionModules()` 一行） |
| 统一动作 | 抽 `renderModuleToggleList(container, modelId, { onEnter, onChange })` helper |
| 验收 | 两处共用公共函数；重复行数减少 ≥30 |

### 组 C — P3（长期收益，3 项）

#### 主题 12：createModuleShell + BUILTIN_MODULE_DEFS

| 项 | 内容 |
|----|------|
| 涉及文件 | 6 个 motion-module 工厂文件（`body-posture.ts` / `position-offset.ts` / `hand-symmetry.ts` / `finger-pose.ts` / `riding-model.ts` / `sway-motion.ts`）末尾 5 行 spread + `registerXxx` |
| 模板形态 | 6 个工厂末尾 `getState: base.getState, setState: base.setState, setParam: base.setParam, enable: base.enable, disable: base.disable` 完全一致；6 个 `registerXxx()` 每个就一行 `registerModule(MODULE_ID, META, P, createXxx)` |
| 统一动作 | 在 `module-base.ts` 之上加 `createModuleShell({id, meta, priority, managedBones, buildSchema, base})` 消除 spread；在 `registry.ts` 用 `BUILTIN_MODULE_DEFS` 数组在 `initMotionModules` 里一次性注册，替代 6 个 `registerXxx` |
| 验收 | 6 个 `registerXxx` 函数归零；6 个工厂末尾 spread 归零 |

#### 主题 13：prepareBake 头部守卫

| 项 | 内容 |
|----|------|
| 涉及文件 | 6 个 `bake` 函数头部 4 行 `getModuleState + enabled 守卫 + claimBones` |
| 统一动作 | 抽 `prepareBake(modelId, moduleId, bones): { state, claimed } \| null`，返回 null 时 bake 提前返回 |
| 验收 | 6 个 bake 头部 4 行模板归零 |

#### 主题 14：setCollisionEnabled 等 setter → setEnvState({...}, true)

| 项 | 内容 |
|----|------|
| 涉及文件 | `scene/env/env-bridge.ts:147`（`setCollisionEnabled`）、`:156`（`setBodyCollisionEnabled`）、`:165-168`（`setGroundCollisionEnabled` + `applyGroundCollision` 副作用）、`:258,263,273,293`（time-of-day setter）、`scene/env/mirror-debug.ts:190-193`（`reflectionQuality` 直接写入） |
| 风险 | `setCollisionEnabled` 改走 `setEnvState` 会触发完整 facade（包括 sky/light 派生），可能引入回归 |
| 豁免 | `env-bridge.ts:237`（`_timeOfDayTick` 每帧）保留直接写入（性能理由，已加注释，已通过 `_applyEnvStateFacade` 手动走分发链路） |
| 统一动作 | 逐个迁移到 `setEnvState({...}, true)`；保留 `applyGroundCollision` 副作用；`mirror-debug.ts` 走 `setEnvState({ reflectionQuality })` 触发重建 |
| 验收 | `env-bridge.ts` setter 全部走 `setEnvState`；`mirror-debug.ts` 不直接写 `envState` |

### 不抽取（投入产出比低）

| 候选 | 原因 |
|----|------|
| `syncUniforms(state, uniformMap)` 通用工具 | 派生逻辑占 60%，类型杂（float/Color3/Vector3/Array2/Array4/Int/Texture 七种 setter），强行统一反而更冗长 |
| `disposeModule(name)` 统一入口 | 各模块副作用差异大（water 需清涟漪+水下+反射，clouds 需清 debug visual），参数对象会臃肿 |
| `safeLogInfo` / `safeLogError` / `wrapError` | 项目无对应使用场景，避免过度设计 |
| 通用 `createGenericModule(config)` | `buildSchema` 差异大，强行统一抽象收益有限 |
| `createCanvasTexture` / `getOrCreateCanvasTexture` 重抽 | ADR-092 已统一，4 处调用全部复用，无重复 |

### 函数名澄清（无 action，仅文档说明）

用户问题中提到 `setModuleState`，实际项目**不存在该函数**，已拆为 `setModuleParam`（`registry.ts:105`）+ `setModuleEnabled`（`registry.ts:120`）两个语义化 setter。本 ADR 不做 action，仅在文档澄清。

---

## 影响面

- **新增**:
  - `core/safe-call.ts`（safeCall 三件套）或并入 `core/logger.ts`
  - `core/dispose-helpers.ts`（safeDispose）或并入 `core/observer-handle.ts`
  - 可选 `core/ui-headers.ts`（`addHeaderToggle`）
- **扩展**（不新增文件）:
  - `core/ui-collapsible.ts:175` `addPresetChip` opts 扩展（icon/variant/title/marginTop/stopPropagation/readonly）
  - `core/scene/motion/motion-modules/module-base.ts` 新增 `createModuleShell`
  - `core/scene/motion/motion-modules/registry.ts` 新增 `BUILTIN_MODULE_DEFS` 数组
- **修改**:
  - 9 个 `menus/*.ts` 文件（preset-chip 收敛）
  - 11+ 个文件（safeCall 收敛）
  - 7 个 `scene/env/*` + `scene/render/*` 文件（safeDispose 收敛）
  - `scene/camera/camera.ts`（5 处 Observable.add）
  - `menus/menu.ts`（弹窗标题 toggle preventDefault + chips 分支）
  - `menus/model-material.ts`（行内 toggle + i18n）
  - `scene/env/env-clouds.ts`（_ensureBlueNoiseTexture scene 校验）
  - `scene/env/env-water.ts`（preset 4 行重复）
  - `scene/env/env-bridge.ts`（setter → setEnvState，P3）
  - `scene/env/mirror-debug.ts`（reflectionQuality → setEnvState，P3）
  - 5 个 `menus/*` 文件（import 路径统一）
  - `menus/motion-popup.ts` / `menus/motion-override-levels.ts`（模块列表段抽取）
  - 6 个 motion-module 工厂文件（createModuleShell，P3）
- **行为**: 无用户可见行为变化（仅内部收敛 + 2 个 bug 修复：preventDefault 与 _ensureBlueNoiseTexture scene 校验）
- **测试**:
  - safeCall / safeDispose 单测
  - addPresetChip 扩展 opts 单测（覆盖所有 variant/icon 组合）
  - _ensureBlueNoiseTexture 场景切换单测
  - 弹窗标题 toggle 双触发回归测试
  - 全量回归 `npm run test`

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| preset-chip 扩展后语义偏移（icon/variant 组合） | 🟠 中 | 单测覆盖所有 opts 组合；先迁移 3 处最简单的，验证后再批量 |
| safeCall 改写 Promise 链时丢失上下文 | 🟠 中 | 三件套签名接受 `tag+msg`，保留原 logWarn 上下文；保留 err 对象透传 |
| safeDispose 对 Babylon mesh 递归 dispose 签名差异 | 🟡 低 | 通过 `...args` 透传：`safeDispose(mesh, true)`；单测覆盖 7 个 dispose 函数 |
| setCollisionEnabled 改走 setEnvState 引入回归 | 🟠 中 | 单独 PR + 回归测试；先迁移 `mirror-debug.ts`（低风险）再迁移 `env-bridge.ts` |
| createModuleShell 重构破坏 ADR-125 undo/redo | 🟡 低 | `module-base` 单测已覆盖 `getState`/`setState` 对称性；保持 `createModuleBase` 不变 |
| menu.ts:853-867 抽 addHeaderToggle 与现有 slideRow headerToggle 边界模糊 | 🟡 低 | 优先修复 preventDefault bug（独立小改），抽取延后至 P2 末 |

## 分阶段实施

- **阶段 1（本 ADR 立项）**: 摸排 + 冲突核对（确认 ADR-143 已涵盖的 4 项不重复立项；确认 ADR-139/140/142/138 已覆盖部分不重复）
- **阶段 2（P1 高收益）**:
  - 主题 1 preset-chip 扩展 + 9 文件 20 处迁移
  - 主题 2 safeCall 三件套 + ≥25 处迁移
  - 主题 3 safeDispose + 7 文件 60-80 处迁移
  - 主题 4 camera.ts 5 处 Observable.add 收敛
  - 主题 5 menu.ts 弹窗标题 toggle preventDefault 修复
- **阶段 3（P2 中收益）**:
  - 主题 6 菜单层 addEventListener 统一
  - 主题 7 _ensureBlueNoiseTexture bugfix
  - 主题 8 env-water preset 重复消除
  - 主题 9 model-material.ts 行内 toggle 收敛
  - 主题 10 import 路径统一
  - 主题 11 模块列表渲染段抽取
- **阶段 4（P3 长期）**:
  - 主题 12 createModuleShell + BUILTIN_MODULE_DEFS
  - 主题 13 prepareBake 头部守卫
  - 主题 14 setCollisionEnabled 等 setter 迁移
- **阶段 5**: 全量回归（`npm run test` + `npm run lint` + `go build`）

## 验收标准

### P1

- [x] `grep -rn "className.*preset-chip" src/menus` 归零（除 `env-preset-levels.ts:142` 豁免）
- [x] `core/safe-call.ts` 三件套已建 + 单测通过；ADR 枚举「前 11 项」文件内的**纯 logWarn 吞错**散点全部收敛（16 处：outfit/audio×2、outfit-overlay×1、physics-bridge×1、beat-detector×1、env-preset-levels×1、events×1、library-actions×4、init×5）；多用途 catch（含 setStatus/console.error/资源清理/返回值）按设计保留。grep 审计发现更广表面（settings-paths 等 ~9 文件，约 26 处纯吞错 `.catch`）列为 主题2-b 后续，不强行 `grep` 归零以免破坏行为。
- [ ] `grep -rn "if (\_.*\) { \_.*\.dispose(); \_.* = null; }" src/scene/env` 按文件归零
- [x] `grep -n "onViewMatrixChangedObservable.add" src/scene/camera/camera.ts` 0 处
- [x] `menus/menu.ts:853-867` 双触发 bug 修复（含 `preventDefault`）

### P2

- [ ] `grep -rn "addEventListener.*removeEventListener" src/menus` 归零（除豁免）
- [x] `_ensureBlueNoiseTexture` 含 scene 校验
- [ ] `applyWaterPresetToMaterial` 不再含 4 行 setFloat
- [ ] `model-material.ts` 行内 toggle 0 处，i18n 硬编码归零
- [ ] `grep -rn "from '\.\./core/ui-rows'" src/menus` 归零
- [ ] `motion-popup.ts:621-656` 与 `motion-override-levels.ts:287-324` 共用公共函数

### P3

- [ ] 6 个 `registerXxx` 函数归零
- [ ] 6 个工厂末尾 spread 归零
- [ ] 6 个 bake 头部 4 行模板归零
- [ ] `env-bridge.ts` setter 全部走 `setEnvState`
- [ ] `mirror-debug.ts` 不直接写 `envState`

### 全量

- [ ] `npm run test` 全绿
- [ ] `npm run lint` 无新增告警
- [ ] `go build ./...` 通过

## 实施记录

### 2026-07-20 — P1 主题 5 / P2 主题 7 两个 bugfix 先行落地

用户批准（「执行吧」）先落地 ADR-146 中两个独立、零回归风险的 bugfix：

| 修复 | 文件:行 | 内容 |
|------|---------|------|
| menu.ts 弹窗标题 toggle 双触发 | `frontend/src/menus/menu.ts:862-866` | click handler 补 `e.preventDefault()`，阻止 label 原生 checkbox 切换与手动翻转叠加导致状态错乱；与公共 `ui-slide-row.ts` 的 headerToggle 行为对齐 |
| `_ensureBlueNoiseTexture` 缺 scene 校验 | `frontend/src/scene/env/env-clouds.ts:167-187` | 新增 `_blueNoiseTex.getScene() === scene` 校验 + 旧纹理 dispose，与同文件 `_ensureNoiseTexture` 对齐，修复 scene 切换后复用旧 GPU 纹理的泄漏/引用错误 |

验证：`cd frontend && npm run build`（tsc + vite build）通过，0 错误。

提交范围：仅 `frontend/src/menus/menu.ts`、`frontend/src/scene/env/env-clouds.ts`、`docs/adr/adr-146-function-duplication-triage.md`。工作树其余 `docs/*` 改动与删除项非本次任务，未纳入。

### 2026-07-20 — P1 主题 1 第一步：扩展 addPresetChip + 迁移 3 处最简手写 chip

用户批准「继续」后，按 ADR 风险缓解策略（先迁移 3 处最简单，验证后再批量）推进 P1 主题 1：

- **扩展** `core/ui-collapsible.ts:175` `addPresetChip` 的 opts：`icon` / `variant('default'|'danger'|'badge')` / `title` / `marginTop` / `marginLeft('auto'|number)` / `stopPropagation`；`badge` 变体为只读标签（不绑 click）；向后兼容既有 `onUpdate`/`wrap` 调用方。
- **迁移 3 处手写 chip 到 `addPresetChip`**（消除 `className='preset-chip'` 手写拼接）：
  - `frontend/src/menus/scene-render-presets.ts:192-205`（滤镜预设，纯文本）
  - `frontend/src/menus/motion-gaze-levels.ts:205-218`（情绪选项，选中态 active）
  - `frontend/src/menus/menu.ts:950-958`（声明式 `row.kind==='chips'` 分支，直接用 `addPresetChip` 替代手写循环）

剩余 17 处手写 chip（含 icon/danger/badge/margin/stopPropagation 差异）待下一批迁移，届时直接用已扩展的 opts 覆盖。

验证：`cd frontend && npm run build`（tsc + vite build）通过，0 错误。

提交范围：仅 `core/ui-collapsible.ts`、`menus/scene-render-presets.ts`、`menus/motion-gaze-levels.ts`、`menus/menu.ts`、`docs/adr/adr-146-function-duplication-triage.md`。

### 2026-07-20 — P1 主题 1 第二步：批量迁移剩余 16 处手写 chip

用户批准「继续」后，按既定风险缓解策略进入批量阶段，将剩余 16 处手写 `preset-chip`（含 icon/danger/badge/margin/stopPropagation 差异）全部收敛到 `addPresetChip`，沿用第一步已扩展的 opts。

- **补充 CSS**（`app.css` `.preset-chip.active` 之后）：新增 `.preset-chip.danger`（红底 `var(--danger)`，破坏性操作强调）、`.preset-chip.badge`（只读 `cursor:default` + neutral hover，覆盖原 `span` 徽标语义）。
- **迁移 16 处手写 chip**：
  - `motion-pose-levels.ts`：guide mode 选中组（active）、pose 类型（async handler）、相机预设（title）、截图/批量导出（emoji 前缀）共 4 处
  - `scene-stage-lights.ts`：`+` 添加灯光按钮（icon `lucide:plus` + 文本 fallback），并移除仅此处使用的 `createIconifyIcon` import
  - `model-detail.ts`：程序化徽标（badge 变体，原 `span` → `addPresetChip` variant badge）、待机/自动舞蹈两处编辑按钮（margin-left:auto + stopPropagation）共 3 处
  - `resource-detail-helpers.ts`：解除/挂载骨骼按钮（marginTop:4）共 2 处
  - `motion-popup.ts`：unpin / pin / clearVmd 共 3 处
  - `motion-override-levels.ts`：apply（marginTop:8）、clearAll（danger 变体，替代内联 `backgroundColor:'var(--danger)'`）共 2 处
- **豁免保留**：`env-preset-levels.ts:142` 覆写外部库返回按钮的 className（特殊场景，不适用公共函数）。
- **可接受差异**：`scene-stage-lights.ts` 的 `+` 按钮在 iconify 可用时由「仅图标」变为「图标 + '+' 文本」，保留文本作 fallback；视觉差异极小。

验证：`cd frontend && npm run build`（tsc + vite build）通过，0 错误。

提交范围：`app.css`、`menus/motion-pose-levels.ts`、`menus/scene-stage-lights.ts`、`menus/model-detail.ts`、`menus/resource-detail-helpers.ts`、`menus/motion-popup.ts`、`menus/motion-override-levels.ts`、`docs/adr/adr-146-function-duplication-triage.md`。

### 2026-07-20 — P1 主题 2：safeCall 三件套（ADR 枚举「前 11 项」文件纯吞错散点收敛）

用户批准「继续吧」后，推进 P1 主题 2。先建统一 helper，再收敛 ADR 枚举 11 文件内的纯 logWarn 吞错散点。

- **新建** `frontend/src/core/safe-call.ts`：`safeCall<T>` / `safeCallVoid` / `safeCallAsync<T>`，统一 `try { fn() } catch (err) { logWarn(tag, msg, err) }` 与 `promise.catch((err) => logWarn(tag, msg, err))` 手写重复。**保留 tag/msg 上下文**（区别于 `utils.ts` 的 `swallowError` 固定 tag `'swallow'` 丢失上下文）。`safeCallAsync` 解析为 `T | undefined`（不 reject），与原 `.catch` 语义一致。
- **新建单测** `frontend/src/core/__tests__/safe-call.test.ts`（5 例：成功返回值 / 异常 logWarn+undefined / void 不抛 / async 成功 / async 异常 logWarn+undefined），`vitest run` 全绿。
- **收敛 16 处纯吞错散点**（仅迁移「catch 块只 logWarn、无其它副作用、无返回值依赖」的站点）：
  - `outfit/audio.ts:242,368`（playAudio / resumeAudio）
  - `physics/physics-bridge.ts:152`（PerFrameUpdateRegistry update error）
  - `outfit/outfit-overlay.ts:360`（mesh dispose failed，dispose 循环内）
  - `motion-algos/beat-detector.ts:179`（onBeat callback error）
  - `menus/env-preset-levels.ts:75`（`ListEnvPresets failed`，`?? []` 兜底）
  - `core/events.ts:418`（refresh after drop）
  - `menus/library-actions.ts:122,229,238,617`（loadThumbnailsForLevel / AddRecentModel / SetLastBrowseDir / refresh after zip import）
  - `core/init.ts:130,131,152,166,176`（preloadAutoImportState / preloadDownloadWatchState / Library init / CheckForUpdate.then / Auto-restore）
- **保留** 多用途 catch（如 beat-detector 构造期 `set _lastError`+return、library-actions `setStatus`/`textContent`、events 外层 `console.error`+`setStatus`、dev-hooks 返回 error 供测试）——按 ADR-146 风险缓解，机械迁移会破坏行为，明确不改。
- **import 处理**：physics-bridge / env-preset-levels / events / init 四文件 `logWarn` 仅此处使用，import 直接替换为 safe-call；其余四文件保留 `logWarn`（仍有它用）并新增 safe-call import。
- **审计发现更广表面**：grep `logWarn` 全量显示纯吞错 `.catch` 还分布于 `settings-paths.ts`（12 处）、`menu.ts`（5）、`plaza.ts`（2）、`model-detail.ts`（2）、`library-setup.ts`/`library-core.ts`/`watch-import.ts`/`settings-about.ts`（各 1）——约 26 处，跨 ~9 文件。ADR 原枚举仅「前 11 项」且称「≥25 处」显著低估。这些同为低风险纯吞错，建议作为 **主题2-b** 后续批量收敛（同一 helper，机械替换）。

验证：`cd frontend && npm run build`（tsc + vite）通过，0 错误（379 模块）；`npx vitest run src/core/__tests__/safe-call.test.ts` 5/5 通过。

提交范围：`frontend/src/core/safe-call.ts`、`frontend/src/core/__tests__/safe-call.test.ts`、`frontend/src/outfit/audio.ts`、`frontend/src/outfit/outfit-overlay.ts`、`frontend/src/physics/physics-bridge.ts`、`frontend/src/motion-algos/beat-detector.ts`、`frontend/src/menus/env-preset-levels.ts`、`frontend/src/core/events.ts`、`frontend/src/menus/library-actions.ts`、`frontend/src/core/init.ts`、`docs/adr/adr-146-function-duplication-triage.md`。工作树其余 `docs/*` 改动非本次任务，未纳入。**未推送**。

### 2026-07-20 — P1 主题 4：camera.ts 5 处裸 `Observable.add` → `observe()` 收敛

用户批准「继续」后，推进 P1 主题 4（最小改动修泄漏）。`onViewMatrixChangedObservable.add` 虽在相机切换时随 `oldCam.dispose()` 清理（当前无实际泄漏），但违反 ADR-139「显式走 `observe()` 统一追踪生命周期」规范，且对未走 dispose 的路径缺少防御。

- **新增模块级句柄** `camera.ts:279` `let _viewMatrixHandle: ObserverHandle | null = null;`（与同文件 `_concertUpdateHandle` 等声明同组）。
- **5 处 create 函数**（`createOrbitCamera`/`createFreeflyCamera`/`createSurroundCamera`/`createConcertCamera`/`createOneshotCamera`）的 `cam.onViewMatrixChangedObservable.add(scheduleCameraPersist)` 改为 `_viewMatrixHandle = observe(cam.onViewMatrixChangedObservable, scheduleCameraPersist);`（`scheduleCameraPersist` 为 `()=>void`，可安全作为 `(eventData, eventState)=>void` 回调；`observe`/`ObserverHandle` 已在 `camera.ts:23` import）。
- **切换解绑** `switchCameraMode` 在 `oldCam.dispose()` 前补 `_viewMatrixHandle?.dispose(); _viewMatrixHandle = null;`（仅非 AR 分支；AR 模式不重建 Babylon 相机，不在此解绑）。`observe` 返回的 `ObserverHandle.dispose` 幂等，与 `cam.dispose` 双保险无重复释放风险；VMD 模式 `createVmdCamera` 不注册该 observer，切换归零后保持 `null`，行为与原先一致。
- **豁免**：`createVmdCamera` 本就不注册视角保存 observer，未改动。

验证：`cd frontend && npm run build`（tsc + vite build）通过，0 错误；`grep -n "onViewMatrixChangedObservable.add" src/scene/camera/camera.ts` 归零。行为零变化（仅 observer 生命周期从「依赖 cam.dispose 隐式清理」提升为「显式句柄追踪」）。

提交范围：仅 `frontend/src/scene/camera/camera.ts`、`docs/adr/adr-146-function-duplication-triage.md`。工作树其余 `docs/*` 改动非本次任务，未纳入。
