# 函数映射表

> AI 找代码用。改前端功能时先 grep 此表定位文件。
> **⚠️ 部分过时**：本表创建于 main.ts 拆分前（ADR-102），`core/main.ts` 已拆分为多个子模块。入口/事件部分请以 `frontend/AGENTS.md` + `frontend/src/core/main/` 目录为准。3D 场景与模型部分仍有效。

## 入口 & 事件

> **⚠️ ADR-102 已拆分 `core/main.ts`**：键盘快捷键、seek 事件已迁移至 `core/main/events.ts`，启动初始化在 `core/main/init.ts`，键盘快捷键注册在 `core/main/shortcut-app.ts`。详见 `frontend/AGENTS.md` §二 2.2。

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `init()` | `core/main.ts` | 应用启动入口（薄层） |
| keyboard shortcuts | `core/main/shortcut-app.ts` / `core/main/events.ts` | Ctrl+1/2/3/4, Space, Escape, ←/→, WASD |
| seek bar events | `core/main/events.ts` | pointerdown/move/up |
| `closeAllOverlays()` | `core/utils.ts` | 关闭所有弹窗 |

## 3D 场景 & 模型

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `engine`, `scene`, `camera` | `scene/scene.ts` | Babylon.js 核心对象 |
| `initScene()` | `scene/scene.ts` | 注册 MMD loader、创建 runtime、地面 |
| `loadPMXFile()` | `scene/scene.ts` | HTTP 加载 PMX + `createMmdModel` |
| `loadVMDMotion()` | `scene/motion/vmd-loader.ts` | ArrayBuffer → VMD → `createRuntimeAnimation` |
| `loadVMDFromPath()` | `scene/motion/vmd-loader.ts` | 路径→HTTP fetch→`loadVMDMotion` |
| `loadCameraVmdFromPath()` | `scene/motion/vmd-loader.ts` | VMD 文件→相机轨道 |
| `loadVPDPose()` | `scene/motion/vmd-loader.ts` | VPD 姿势→VMD 帧→绑定 |
| `removeModel()` | `scene/scene.ts`（委托 modelManager） | 销毁 MMD 模型 + 清理 mesh |
| `focusModel()` | `scene/scene.ts`（委托 modelManager） | 相机自动 framing |
| `arrangeModels()` | `scene/scene.ts`（委托 modelManager） | 多模型横向排列 |
| `updatePlaybackUI()` | `scene/motion/playback.ts` | 进度条 + 时间显示 |
| `seekFromEvent()` | `scene/motion/playback.ts` | 点击/拖拽定位 |
| `ModelManager` | `scene/manager/model-manager.ts` | 模型注册表 + 生命周期 + 属性管理 |
| `focusedMmdModel()` | `scene/manager/model-manager.ts` | 当前聚焦模型的 WASM 对象 |
| `focusedModel()` | `scene/manager/model-manager.ts` | 当前聚焦模型实例 |
| `setModelVisibility()` / `setModelOpacity()` | `scene/manager/model-ops.ts` | 可见性/透明度 |
| `setModelWireframe()` / `setModelBoneLinesVis()` | `scene/manager/model-ops.ts` | 线框/骨骼调试 |
| `setModelPhysics()` / `setPhysicsCategory()` | `scene/manager/model-ops.ts` | 物理开关/按分类控制 |
| `setModelScaling()` / `setModelRotationY()` / `setModelPosition()` | `scene/manager/model-ops.ts` | 变换操作 |
| `stopVMD()` / `applyVPDPose()` | `scene/manager/model-ops.ts` | VMD 停止/VPD 姿势应用 |
| `setModelMorphWeight()` / `resetModelMorphs()` | `scene/manager/model-ops.ts` | 表情权重/重置 |
| `_catOf()`, `_applyAll()`, `setMatParams()` | `scene/manager/material.ts` | 材质分类/批量应用/按类设参 |

## 模型库 & 弹窗

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `togglePopup()`, `showPopup()`, `hidePopup()` | `menus/library.ts` | 模型库弹窗开关 |
| `showMotionPopup()`, `hideMotionPopup()` | `menus/library.ts` | 动作库弹窗开关 |
| `refreshMotionRoot()` | `menus/motion-popup.ts` | 重算动作弹窗根级 items |
| `refreshEnvRoot()` | `menus/env-menu.ts` | 重算环境弹窗根级 items |
| `initLibrary()` | `menus/library.ts` | 启动时加载配置 + 扫描模型库 |
| `refreshLibrary()` | `menus/library.ts` | 重新扫描 + 刷新弹窗 |
| `buildLevel()`, `modelToRow()` | `menus/library-core.ts` | 文件浏览层级构建 |
| `importFile()` | `menus/library-core.ts` | 导入文件：通过 SAF 文件选择器调起 SelectImportFile → 按扩展名路由到 loadManager 或 ImportZip |
| `showSettings()` | `menus/settings.ts` | 设置页（MenuStack） |
| `MenuStack` | `menus/menu.ts` | 通用菜单导航组件 |
| `initControl()` | `core/ui-rows.ts` | 控件自更新注册 + 立即初始化工具函数，封装 `registerControl` + 立即 `update()` 模式，消除 5 个控件的重复 |
| `registerControl()` / `updateControls()` | `menus/menu.ts` | 注册/统一刷新控件的自更新回调，参见 ADR-027 |

## 模型广场

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `showPlaza()` | `menus/plaza-browser.ts` | 打开模型广场全屏视图（iframe/窗口/外部浏览器三模式） |
| `closePlaza()` | `menus/plaza-state.ts` | 关闭模型广场并回收代理 |
| `handlePlazaDownload()` | `menus/plaza-download.ts` | 处理从 iframe 内注入脚本发来的下载请求（ADR-078） |
| `installDownloadListener()` | `menus/plaza-download.ts` | 安装 postMessage 监听器，接收 iframe 下载请求 |
| `openExternal()` | `menus/plaza-browser.ts` | 用系统浏览器打开广场站点 |
| `openInWindow()` | `menus/plaza-browser.ts` | 用 Wails 新窗口打开广场站点 |
| `stopProxy()` | `menus/plaza-state.ts` | 停止 Go 反向代理（幂等） |
| `renderHome()` | `menus/plaza-browser.ts` | 渲染广场主页站点列表 |
| `renderEmbed()` | `menus/plaza-browser.ts` | 渲染内嵌 iframe 视图（启动代理） |

## 相机

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `switchCameraMode()` | `scene/camera/camera.ts` | 切换相机模式 |
| `getCameraMode()` | `scene/camera/camera.ts` | 当前模式 |
| `freeflyInput` | `scene/camera/camera.ts` | WASD 自由飞行输入状态 |
| `hasCameraVmd()` / `clearCameraVmd()` / `animateCameraVmd()` | `scene/camera/camera.ts` | 相机 VMD 轨道 |

## AR 相机

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `setARMode()` | `scene/ar/ar-scene.ts` | 切换 AR 模式（摄像头视频背景 + 透明 canvas） |
| `takeARScreenshot()` | `scene/ar/ar-scene.ts` | AR 合成截图（视频底 + 3D 层） |
| `isARModeActive()` | `scene/ar/ar-scene.ts` | 检查 AR 模式是否激活 |
| `startARCamera()` | `scene/ar/ar-camera.ts` | 启动 AR 摄像头（自动选择朝向） |
| `stopARCamera()` | `scene/ar/ar-camera.ts` | 停止 AR 摄像头并释放资源 |
| `switchARCameraFacing()` | `scene/ar/ar-camera.ts` | 切换前置/后置摄像头 |
| `setARMirror()` | `scene/ar/ar-camera.ts` | 设置摄像头镜像（前置默认镜像） |
| `isARMirrored()` | `scene/ar/ar-camera.ts` | 检查摄像头是否镜像 |
| `captureARScreenshot()` | `scene/ar/ar-camera.ts` | 捕获 AR 截图（内部实现） |
| `addARModeChangeListener()` | `scene/ar/ar-camera.ts` | 订阅 AR 模式切换事件（返回取消订阅函数） |

## 共享状态

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `mmdRuntime`, `modelRegistry` | `core/state.ts` | 全局可变状态 |
| `libraryRoot`, `allModels` | `core/state.ts` | 模型库状态 |
| `thumbnailCache`, `modelMetaCache` | `core/state.ts` | 内存缓存 |
| `dom` | `core/dom.ts` | 所有 DOM 元素引用 |
| `setStatus()`, `showHint()`, `hideHint()` | `core/utils.ts` | 底部状态栏 |
| `createIconifyIcon()` | `core/icons.ts` | Iconify 图标元素创建 |

## Observer 生命周期管理

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `ObserverHandle` | `core/observer-handle.ts` | 可释放的 Observer 句柄，`dispose()` 从 Observable 移除 observer，幂等 |
| `observe(observable, callback)` | `core/observer-handle.ts` | 替代 `observable.add(callback)`，返回 `ObserverHandle` |
| `observeOnce(observable, callback)` | `core/observer-handle.ts` | 替代 `observable.addOnce(callback)`，返回 `ObserverHandle` |
| `ObserverRegistry` | `core/observer-handle.ts` | 批量管理器，`add()` 注册、`disposeAll()` 一次性清理所有 observer |

**用法**：所有新代码禁止直接调用 `Observable.add()`，必须使用 `observe()` 获取 `ObserverHandle`，在 cleanup 时调用 `handle.dispose()`。详见 [ADR-139](adr/adr-139-observer-registry.md)。

> **⚠️ XPBD 物理已移除**：`physics/xpbd-solver.ts`、`xpbd-cloth.ts`、`xpbd-collider.ts`、`xpbd-renderer.ts`、`cloth-manager.ts` 等文件已在 ADR-081 中删除。当前物理系统仅保留 `physics/physics-bridge.ts`（WASM Bullet 代理）和 `physics/wind-physics.ts`（风力模拟）。

## 物理系统（WASM Bullet）

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `PhysicsBridge` | `physics/physics-bridge.ts` | WASM Bullet 物理引擎代理 |
| `WindPhysics` | `physics/wind-physics.ts` | 风力模拟（影响衣物/头发） |

## 程序化动作 & VMD

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `generateIdleVmd()` | `motion-algos/procedural-motion.ts` | Idle 动作 VMD |
| `generateAutoDanceVmd()` | `motion-algos/procedural-motion.ts` | AutoDance VMD（节拍驱动）|
| `buildVmd()` | `motion-algos/vmd-writer.ts` | VMD 二进制构建 |
| `loadVPDFromBuffer()` | `motion-algos/vpd-parser.ts` | VPD 文本→VMD 二进制 |
| `BeatDetector` | `motion-algos/beat-detector.ts` | 节拍检测器 |
| `amplitudeToWeight()` / `findLipMorph()` | `motion-algos/lipsync.ts` | 振幅→morph权重 |

## 环境系统

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `initLighting()` / `transitionLighting()` | `scene/render/lighting.ts` | 灯光初始化/过渡 |
| `setEnvState()` / `redoEnvAutoLink()` | `scene/env/env-bridge.ts` | 环境状态 + 光照联动 |
| `applyEnvPreset()` | `scene/env/env-bridge.ts` | 预设切换 |
| `deriveLighting()` / `ENV_PRESETS` | `scene/env/env-lighting.ts` | 天空色→光照推导 |
| `createWater()` / `disposeWater()` | `scene/env/env-water.ts` | 水面 |
| `createParticleEmitter()` / `updateParticleWind()` | `scene/env/env-particles.ts` | 粒子 |
| `createClouds()` / `disposeClouds()` | `scene/env/env-clouds.ts` | 体积云 |

## 渲染状态

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `setRenderState()` | `scene/render/renderer.ts` | 更新渲染状态（含赛璐珞模式等） |
| `getRenderState()` | `scene/render/renderer.ts` | 获取当前渲染状态快照 |
| `celShadingMode` | `scene/render/renderer.ts` | 赛璐珞后处理模式开关（ADR-076） |

## 材质系统

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `_catOf()` / `_applyAll()` / `setMatParams()` | `scene/manager/material.ts` | 材质分类/批量应用/设参 |
| `_capture()` | `scene/manager/material.ts` | 原始值捕获 |
| `getMatCatGroups()` / `getMatDetailList()` | `scene/manager/material.ts` | 分组/详情查询 |

---

## 近期新增模块（ADR-166~175，grep 为准）

> 以下为 ADR-166~175 引入的对外公共符号补登（文末增量，不改动上方既有行）。
> 路径以源码为准；本表仅列主要入口，完整符号请 `grep "^export " <file>`。

### 质量维度 & 场景拖拽（ADR-173/174/171）

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `QualityProfile` / `QualityDimension` / `QualityProfileSettings` | `scene/render/quality-profile.ts` | 质量维度类型 + 配置 |
| `resolveQualityProfile()` / `inferQualityProfile()` | `scene/render/quality-profile.ts` | 维度→预设解析 / 运行时推断 |
| `buildDragModeLevel()` | `menus/scene-drag-levels.ts` | 拖拽模式设置面板层级 |

### 环境子系统（ADR-151/172/173）

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `initEnvImpl()` / `getScene()` / `getPipeline()` / `resolveStaticAsset()` / `isInitialized()` | `scene/env/env-context.ts` | 环境上下文（场景/管线/静态资源） |
| `ReflectionMode` / `resolveReflectionMode()` / `applyReflection()` / `getCurrentReflectionMode()` / `bindProbeToMeshes()` / `disposeReflection()` / `setReflectionARSuspended()` | `scene/env/env-reflection.ts` | 反射模式解析与执行（planar/ssr/probe/hybrid） |
| `applyWetnessToAllModels()` / `removeWetnessFromAllModels()` / `applyWetnessToInst()` / `isWetnessActive()` | `scene/env/env-wetness.ts` | 湿身效果（ADR-172） |

### 动作 / 感知（ADR-166/167/169）

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `BoneOverrideStore` / `InMemoryBoneOverrideStore` / `getBoneOverrideStore()` / `BoneConflict` | `scene/motion/bone-override-store.ts` | 骨骼占用登记与冲突检测 |
| `MotionPipeline` / `getMotionPipeline()` / `PipelineStage` / `PipelineLayer` | `scene/motion/motion-pipeline.ts` | 动作管线分层框架 |
| `getMediumMaxOthers()` / `setMediumMaxOthers()` / `_getActiveContextsByTier()` / `_applyPerceptionForContext()` | `scene/motion/perception-observer.ts` | 感知层 per-model 上下文观察（ADR-166） |
