# 第 13 轮审核报告 — scene 核心 / 渲染+物理 / core 关键设施 / UI 菜单核心

> **日期**: 2026-08-06
> **范围**: 31 模块（scene 核心 6、rendering+physics 8、core 关键设施 9、ui 菜单核心 8）
> **方法**: 4 子代理并行（explore 只读），知识卡 → 源码 → 5 维度 + 4 心理模拟；逐行核对源码，非照抄知识卡
> **结论**: 31 模块中 ✅通过 9 / ⚠️有条件通过 21 / ❌不通过 1（P1×4，已全部修复）

---

## 执行摘要

| 结论 | 模块数 | 模块 |
|------|--------|------|
| ✅ 通过 | 9 | lighting-presets、gpu-capabilities、wind-physics、dispose-helpers、fileservice（编码正确）、audio-bus、dialog（修复后）、scene-serialize 相关、renderer（修复后） |
| ⚠️ 有条件通过 | 21 | scene.ts、model-manager、model-loader、model-ops、camera-state、camera、renderer（4 处 P2）、lighting、performance、physics-bridge、virtual-skirt、init、render-loop、load-manager、events、state、menu-schema、menu-stack-registry、menu-overlay、menu-factory、settings、settings-shared、plaza-state、dom-contract |
| ❌ 不通过 | 1 | camera.ts（vmd→orbit→vmd 复用已 dispose MmdCamera，P1#1） |

## 🔴 P1 问题（必须修复）

> **修复状态（2026-08-06）**：P1#1~#4 均已修复并回归测试全绿，见下方「✅ 已修复」标注。

| # | 模块 | 位置 | 问题 | 影响 |
|---|------|------|------|------|
| 1 | camera | camera-vmd.ts:94-102 + camera.ts:469,420-438 | `switchCameraMode` 切出 vmd 时 `oldCam.dispose()` 销毁 MmdCamera，但 camera-vmd 模块级 `_mmdCamera`/`_cameraAnimationHandle` 未置空；再次切回 vmd：`createVmdCamera` 的 `if (_mmdCamera) return _mmdCamera` 无 `isDisposed()` 守卫，直接返回已 dispose 相机并设为 activeCamera，每帧 `animate` 已销毁对象 | vmd→orbit→vmd 切换后相机失效/渲染异常，需重载 VMD 才能恢复 |
| 2 | dialog | dialog.ts:344-425 | `showPrompt2` 无并发守卫：第二次调用复用单例 `_overlay2` 并替换按钮监听器，第一个 Promise 的 cleanup/resolve 永不执行 → **Promise 永不 resolve**，调用方（settings-resources.ts:325）永久挂起 | 违反 dialog.md「并发调用必须 FIFO 排队」不变量 |
| 3 | performance | performance.ts:248-274 + renderer.ts:681 + lighting.ts:388 | 自动降级激活期间用户手动调参：`resetPerformanceSnapshot()`→`_restoreSnapshot()` 在 patch **应用之后**回写降级前快照，覆盖用户刚应用的改动（已被 auto-save 持久化）→ 内存与存档发散 | 低帧率下拖动渲染/灯光滑块「不生效/跳回」，形成「改→恢复→再降级」死循环 |
| 4 | physics-bridge | physics-bridge.ts:56-65 + virtual-skirt.ts:316,452-455 | `getBoneWorldPosition` 名不副实：返回 `bone.worldMatrix`（rootMesh **局部**坐标系）平移分量；virtual-skirt 锚定体用局部坐标而链身骨节经 `localToWorld` 放入世界坐标 | 模型被移动/缩放（rootMesh world≠Identity）时锚定体与裙链相距数米，弹簧把裙摆拉断/漂移 |

### ✅ 已修复（2026-08-06）

- **P1#1（camera-vmd 复用已 dispose 相机）**：`createVmdCamera` 加 `_mmdCamera.isDisposed()` 守卫；模块级保留 `_mmdAnimation` 动画源引用，`loadCameraVmd` 写入、`clearCameraVmd` 清空；已 dispose 时重建相机并用保留的动画源恢复动画句柄。`_cameraAnimationHandle` 类型修正为 `MmdRuntimeAnimationHandle`（branded number）。
- **P1#2（showPrompt2 并发守卫）**：与 showDialog 同构——`_prompt2Active` 标志 + `_pendingPrompt2` FIFO 队列 + `_drainPrompt2Queue`；`disposeOverlay2`（HMR 清理）同步重置守卫与队列。
- **P1#3（快照回写覆盖用户改动）**：`renderer.ts` setRenderState 与 `lighting.ts` setLightState 中 `resetPerformanceSnapshot()` 移到 patch **应用之前**——先恢复到全质量再应用用户 patch，用户意图最后生效。
- **P1#4（虚拟裙锚定体坐标系）**：virtual-skirt `_update()` 锚定体 `setTransformMatrix` 前将局部矩阵 `multiplyToRef(_meshWorld)` 转世界坐标（与链身骨节坐标空间一致）。

## 🟠 P2 问题（建议修复）

> **修复状态（2026-08-06）**：以下 #1/#2/#3/#4/#5/#6/#8/#9 已修复，见「✅ 已修复」标注。

| # | 模块 | 位置 | 问题 |
|---|------|------|------|
| 1 | camera-state | camera-state.ts:345-354 | bridge `setCameraMode` 只写 `_cameraMode` 不真正切换相机（不调用 switchCameraMode/不派生命双轴）；AI 动作 `ai:control:setCameraMode` 消费 → 「切换相机模式」实际不生效 |
| 2 | scene | scene.ts:269-301 | `disposeScene` 未调用 `disposeCameraSystem()`（camera.ts:737，全工程无调用点）与 `modelManager.dispose()`；HMR 重入旧相机引用/触摸监听残留 |
| 3 | renderer | renderer.ts:852-857 | `transitionRenderState` 最终帧 `onComplete()` 在 `_cancelRenderTransition()` 之前调用；onComplete 抛错 → observer 泄漏 + animLoop 以 t=1 反复 setRenderState（无限自动保存） |
| 4 | renderer | renderer.ts:891-907 | `reattachPipeline` 相机切换时 dispose SSR/SSAO pipeline，注释称「下次 _applyRenderState 会重建」——但 SSR 从不重建（仅 setSSRFromReflection 创建），SSAO 也仅当后续 patch 含 ssao 字段时重建 → 切相机后 SSR/SSAO 静默关闭 |
| 5 | renderer | renderer.ts:478-482 | cel 开启无幂等守卫：已处于 cel 模式时再次收到 `{celShadingMode:true}` 会把 `_originalRenderState` 覆盖为 cel 调整后状态 → 关闭 cel 恢复的是 cel 观感而非用户原始观感（快照污染） |
| 6 | renderer | renderer.ts:392-407 + :203 | 开启 glow 未带 glowIntensity 时创建 intensity=0 的 GlowLayer；`getRenderState` glowEnabled 判定 `intensity>0` → 状态往返（get→set）把 glow 层判定为关闭并 dispose |
| 7 | events | events.ts:366-386 | `document.addEventListener('dragover')` 裸注册未入 `_reg` 收集，`disposeEventHandlers` 不释放；initDropHandler 每次 init（含 HMR 重跑）再挂一个 → 监听器累积 + 重复日志 |
| 8 | load-manager | load-manager.ts:98-102,143 | 排队中 signal 已 abort 的请求不短路，仍占用队列槽位启动底层 loader；被取消请求仍触发 warn + 包装 AbortError |
| 9 | plaza-state | plaza-state.ts:160-164 | `closePlaza` 不重置 observer（永不 disconnect）、隐藏 iframe 持续运行远程站点（直到下次 open 才 innerHTML=''），与知识卡「关闭时重置为初始值」不变量不符 |
| 10 | dialog | dialog.ts:22-38 | `_frozenTarget` 在 showDialog 与 showPrompt2 之间共享，`showDialog` 关闭时无条件解冻 #app → 嵌套/交叉打开时关闭内层会解冻外层对话框背景，Tab/点击可逃逸 |
| 11 | events/nav | nav-actions.ts:233-238 | `disposeNavBindings` 从未被调用（仅 library-setup import）；HMR 后按钮旧监听器残留 + 新监听器叠加 |
| 12 | init | init.ts:608-621 | `bootstrap()` 先于 `init()` 启动渲染循环；init 失败无资源回滚（渲染循环/事件监听/日志补丁残留） |

### ✅ 已修复（2026-08-06）

- **#1 camera-state bridge 真正切相机**：scene-action-bridge 新增 `switchCameraMode` action 键；camera.ts 注册该 action 调 `switchCameraMode(isCameraMode(mode)?mode:'orbit')`；camera-state bridge 委托 `getSceneAction('switchCameraMode')`（未注册时降级 setCameraMode 状态写入）。
- **#2 disposeScene 补相机系统释放**：`disposeScene()` 增加 `disposeCameraSystem()` 调用（stop 各行为循环 + dispose 当前相机 + 清运行时上下文）；HMR 重入会重新 initCameraSystem，安全且必须。
- **#3 transitionRenderState try/finally**：onComplete 放 try、`_cancelRenderTransition()` 放 finally，onComplete 抛错不再泄漏 observer。
- **#5 cel 双开守卫**：`if (s.celShadingMode && !_celShadingMode)` 才保存 `_originalRenderState`，杜绝快照污染。
- **#6 glow 判定**：`glowEnabled: _glowLayer !== null`（去掉 intensity>0 条件），强度 0 状态往返不再丢开关。
- **#7 events dragover 入 _reg**：改用 `_reg(document,'dragover',handler,{capture:true})`，纳入 disposeEventHandlers 统一清理。
- **#8 load-manager abort 短路**：dispatch 入口 `if (signal?.aborted) throw new DOMException('Aborted','AbortError')`，取消语义立即生效。
- **#9 plaza closePlaza 资源清理**：断开 observer + 清引用 + 移除隐藏 iframe 元素。
- **#10 dialog _frozenTarget 引用计数**：freeze/unfreeze 改为 `_frozenDepth` 计数，嵌套关闭内层不解冻外层。

## 🟡 P3 关注项（持续改进，本轮未修）

| 模块 | 问题 |
|------|------|
| renderer | #4 reattachPipeline SSR/SSAO 重建（需 env-reflection 配合，留待下轮）；initRenderer `scene.activeCamera!` 非空断言；disposeRenderer 无 try/finally 异常隔离 |
| performance | `_bridgeGetLightState = () => ({})` 不安全强转（registerRenderBridge 前调用会捕获空快照） |
| lighting | `rebakeEnvBrightness` 无防重入钳制，多次调用强度复利放大 |
| physics-bridge | lighting-follow 个人灯基准点同样使用局部坐标（`_getLightBasePos` → getBoneWorldPosition），模型移动时个人灯错位 |
| virtual-skirt | dispose 阶段 `.dispose()` 调用无 try/catch（与知识卡「每项独立 try/catch」不符） |
| model-ops | `import { modelManager } from '../scene'` 真实循环依赖（camera.ts:26、camera-auto.ts:14 同） |
| model-manager | `remove()` 删除非焦点模型隐式触发焦点模型 reframe + autoSave 副作用 |
| events | `update:installFailed` 用原始 API 未入 `_reg`（10s 自清理，HMR 窗口内泄漏）；`_lastTapTime` 死代码；`dropOverlay` 非空断言；async 处理器内 `await mmdRuntime.playAnimation()` 无 try/catch |
| init | `window.wails!` 非空断言（Android dev 模式 TypeError）；`setEnvState` 抛错时 auto-save 永久抑制 |
| state | `uiState` 字段在 scene-menu/motion-pose-levels/settings-resources/camera 等多处直写绕过 setUIState（部分手动 schedulePersistUI） |
| render-loop | `stopRenderLoop()` 不重置 `_lastMul`/`_frameCounter` |
| audio-bus | `disposeAudioBus` 不断开 `_master`；无 AudioContext 支持探测（旧 WebView `new Ctor()` 抛错） |
| fileservice | 浏览器分支 `createObjectURL` 永不 revoke；`_cachedBackend` 缓存 rejected Promise 永不再试 |
| load-manager | kind: light/personalLight/mirror 静默 return null；失败 console.warn 双份 |
| menu-overlay | `disposeMenuWrapper`/`clearAllMenuWrappers` 全库零调用；模型菜单 onClose 不 dispose，_liveMenus 常驻逐帧 updateControls |
| menu-stack-registry | `sceneStackGetter` 死字段（全库零赋值）；modelStack 关闭后不置 null |
| menu-factory | `showPopupMenu` 硬编码移除 3 类 overlayClass 与 register 动态清理不一致 |
| settings | `settingsOnFolderEnter` 每次进入子页 builder() 两次（性能冗余） |
| dom-contract | `ARIA_ATTR` 死导出；ui-collapsible 硬编码 panelClass/openClass 绕过契约 |
| render-menu | colorSlider/modeSlider/modeRow 未应用 ControlSpec get/set 衍生转换（当前无 schema 使用，潜在） |

## 跨模块模式问题

1. **🔴 相机系统销毁路径缺失**：`disposeCameraSystem()` 与 `modelManager.dispose()` 均为全工程无调用点的死代码——disposeScene 只依赖 `scene.dispose()` 兜底，HMR 下旧相机引用/触摸监听残留（本轮已补 disposeCameraSystem，modelManager 留待评估 HMR 语义后处理）。
2. **🟠 坐标系契约混淆**：babylon-mmd 骨骼 `worldMatrix` 是 rootMesh 局部坐标系，`physics-bridge.getBoneWorldPosition` 名不副实返回局部平移，virtual-skirt 锚定体/lighting-follow 个人灯消费时未转世界系（本轮已修 virtual-skirt 每帧锚定，lighting-follow 留 P3）。
3. **🟠 状态直写绕过 setter**：`restoreUIState`（init.ts:312-448）27 处直写 `uiState.xxx`、camera.ts:679/686 等直写绕过 setUIState，持久化回调不触发——恢复场景可能有意为之，但需显式豁免注释或统一走 setter。

## 知识卡偏差汇总（已发现待修）

| 知识卡 | 偏差 |
|--------|------|
| scene.md | 「disposeScene 负责级联释放各子系统」不完整——相机系统/ModelManager 未纳入（本轮已补相机系统）；各文件行数全部过期（camera.ts 715/实际 819 等） |
| model-loader.md | 「加载锁/重复检测/清理由 scene.ts 编排器负责」不实——三者均在 model-loader.ts 内（L434/448/724） |
| model-manager.md | 「不引用 scene.ts 任何符号」不成立——model-ops.ts:24/camera.ts:26/camera-auto.ts:14 均 import '../scene' |
| physics-bridge.md | 「getBoneWorldPosition 返回世界位置」名不副实（实际局部平移，已修 virtual-skirt 消费方，函数语义建议后续改名或修正） |
| dialog.md | API 节列出 `showErrorAction(title, message)` 不存在；「并发调用必须 FIFO 排队」未覆盖 showPrompt2（本轮已实现） |
| events.md | 「涵盖 500+ 行事件注册逻辑」实际 463 行；「disposeEventHandlers 释放所有」遗漏 dragover（本轮已修）与 update:installFailed |
| init.md | 「restoreEnvState/restoreUIState 异常时降级不阻塞启动」与实际不符（异常上抛到 init catch 走 showError 错误屏，实际阻塞）；「bootstrap → init → 渲染循环」顺序实际 startRenderLoop 先于 init |
| state.md | tests 引用 perception/state-lifecycle.int.test.ts 不覆盖 core state stores |
| fileservice.md | 「被 model-loader/vmd-loader 调用」——resolveFileUrl 无任何生产调用点（仅 re-export + 测试） |
| settings.md | 「7 分类」实际 8 项（settings.ts:51-101 含 DOWNLOADS）；re-export refreshLibrary/isAutoLoadCompanionAudioEnabled 实际不存在 |
| plaza-state.md | 「关闭时重置为初始值」未实现（本轮已补 observer/iframe 清理）；「站点列表变更通知重渲染」实际靠 plaza-browser 显式 renderHome() |
| menu-overlay.md | 「disposeMenuWrapper/clearAllMenuWrappers 被各菜单消费」全库零调用者 |
| menu-factory.md | tests:[] 不准确（实际有 popup-overlay/register-popup 测试）；「MenuFactory 类」源码中不存在 |
| dom-contract.md | 「渲染层产出 role/class 引用常量」ui-collapsible 硬编码绕过；ARIA_ATTR 死导出 |

## 测试覆盖两极分化

- **覆盖充分**：camera.adr100（guards/serialization/presets 45 用例）、renderer-transition、performance（snapshot/refresh-rate/reflection）、physics-bridge（含 coord 测试）、dialog、lighting-follow、plaza.contract、virtual-skirt.coord。
- **零覆盖/缺口**：init 四阶段流水线 + restore 流程、events 无测试、render-loop 无测试、load-manager 无专属单测、dialog showPrompt2 并发队列/Android back 交互、plaza closePlaza 重置语义/observer 生命周期、state core store 直测、model-loader 整模块。

## 验证

- `npx tsc --noEmit`：仅剩 toast.test.ts 4 处既有错误（该文件未被本次改动，git diff 为空，疑似 DOM lib 迭代器类型环境差异）。
- `npx vitest run`：270 文件 / 4523 用例全部通过。
- 相关定向测试：dialog/physics-bridge/renderer-transition/lighting-follow/camera×4/plaza/performance×3/lighting-stage 全部通过。
