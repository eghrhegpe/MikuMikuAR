# 函数映射表

> AI 找代码用。改前端功能时先 grep 此表定位文件。

## 入口 & 事件

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `init()` | `core/main.ts` | 应用启动入口 |
| keyboard shortcuts | `core/main.ts` | Ctrl+1/2/3/4, Space, Escape, ←/→, WASD |
| seek bar events | `core/main.ts` | pointerdown/move/up |
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
| `showSettings()` | `menus/settings.ts` | 设置页（MenuStack） |
| `MenuStack` | `menus/menu.ts` | 通用菜单导航组件 |

## 相机

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `switchCameraMode()` | `scene/camera/camera.ts` | 切换相机模式 |
| `getCameraMode()` | `scene/camera/camera.ts` | 当前模式 |
| `freeflyInput` | `scene/camera/camera.ts` | WASD 自由飞行输入状态 |
| `hasCameraVmd()` / `clearCameraVmd()` / `animateCameraVmd()` | `scene/camera/camera.ts` | 相机 VMD 轨道 |

## 共享状态

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `mmdRuntime`, `modelRegistry` | `core/state.ts` | 全局可变状态 |
| `libraryRoot`, `allModels` | `core/state.ts` | 模型库状态 |
| `thumbnailCache`, `modelMetaCache` | `core/state.ts` | 内存缓存 |
| `dom` | `core/dom.ts` | 所有 DOM 元素引用 |
| `setStatus()`, `showHint()`, `hideHint()` | `core/utils.ts` | 底部状态栏 |
| `createIconifyIcon()` | `core/icons.ts` | Iconify 图标元素创建 |

## XPBD 物理

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `XpbdSolver` | `physics/xpbd-solver.ts` | Verlet 积分 + 约束求解 + 地面碰撞 |
| `createCloth()` | `physics/xpbd-cloth.ts` | 布料实例（粒子网格 + 约束 + Mesh）|
| `buildClothUpdateFn()` | `physics/xpbd-cloth.ts` | 每帧更新闭包 |
| `SdfCollider` | `physics/xpbd-collider.ts` | SDF 胶囊碰撞器（13个身体胶囊）|
| `XpbdRenderer` | `physics/xpbd-renderer.ts` | 调试可视化 |
| `toggleCloth()` / `recreateCloth()` | `physics/cloth-manager.ts` | 布料开关/重建 |

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

## 材质系统

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `_catOf()` / `_applyAll()` / `setMatParams()` | `scene/manager/material.ts` | 材质分类/批量应用/设参 |
| `_capture()` | `scene/manager/material.ts` | 原始值捕获 |
| `getMatCatGroups()` / `getMatDetailList()` | `scene/manager/material.ts` | 分组/详情查询 |
