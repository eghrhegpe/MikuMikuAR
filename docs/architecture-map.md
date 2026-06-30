# 前端架构图（自动生成）

> 本文件由 `scripts/gen_arch_map.py` 自动生成，请勿手动编辑。
> 扫描范围：`frontend/src/`，共 67 个源文件（TS/CSS）

## 📊 统计概览

- **文件总数**：67
- **代码总行数**：约 20,749 行
- **目录数**：8

### 按目录统计

| 目录 | 文件数 | 行数 | 职责 |
|------|--------|------|------|
| `__tests__/` | 16 | 4,125 | 测试层：单元测试、集成测试 |
| `core/` | 5 | 1,588 | 核心层：共享状态、配置、工具函数、文件服务、图标 |
| `menus/` | 11 | 5,669 | UI层：菜单弹窗、模型库、设置、属性面板 |
| `motion/` | 5 | 644 | 动效层：程序化动作、节拍检测、LipSync、VPD解析、VMD写入 |
| `outfit/` | 2 | 481 | 业务层：换装系统、音频播放 |
| `physics/` | 5 | 1,674 | 物理层：XPBD布料、碰撞体 |
| `(root)` | 2 | 1,192 | 根目录：全局样式、类型声明 |
| `scene/` | 21 | 5,376 | 渲染层：3D场景、模型加载、VMD播放、环境系统、物理 |
| `assets/` | 3 | — (159.2 KB) | 资源层：字体、图片等静态资源 |

## 🏗️ 分层架构

```
┌─────────────────────────────────────────────────┐
│  测试层 (__tests__/)                           │
│  单元测试、集成测试、回归测试                    │
└───────────────────┬─────────────────────────────┘
                    │ 测试
┌───────────────────▼─────────────────────────────┐
│  UI 层 (menus/)                                │
│  模型库、设置、详情面板、场景菜单、环境菜单      │
└───────────────────┬─────────────────────────────┘
                    │ 调用
┌───────────────────▼─────────────────────────────┐
│  业务层 (outfit/ motion/)                      │
│  换装、音频、程序化动作、LipSync、节拍检测      │
└───────────────────┬─────────────────────────────┘
                    │ 依赖
┌───────────────────▼─────────────────────────────┐
│  渲染层 (scene/)                               │
│  3D场景、模型加载、VMD播放、环境系统、光照渲染  │
└───────────────────┬─────────────────────────────┘
                    │ 共享
┌───────────────────▼─────────────────────────────┐
│  核心层 (core/)                                │
│  全局状态、工具函数、文件服务、图标、入口       │
└───────────────────┬─────────────────────────────┘
                    │ 支撑
┌───────────────────▼─────────────────────────────┐
│  资源层 (assets/)                               │
│  字体、图片、图标等静态资源                      │
└─────────────────────────────────────────────────┘
```

## 📁 各模块详情

### `core/`

> 核心层：共享状态、配置、工具函数、文件服务、图标

| 文件 | 行数 | 导出数 | 内部依赖 | 职责 |
|------|------|--------|----------|------|
| `config.ts` | 554 | 79 | 4 | 全局状态：共享变量、DOM引用、类型定义、工具函数 |
| `fileservice.ts` | 26 | 2 | 1 | 文件服务：统一URL解析、HTTP服务器代理 |
| `icons.ts` | 31 | 2 | 0 | 图标注册表：Iconify 图标映射 |
| `main.ts` | 483 | 0 | 6 | 应用入口：事件绑定、快捷键、初始化调度 |
| `ui-helpers.ts` | 494 | 7 | 1 | UI构建器：slideRow、toggleRow、sliderRow 等DOM构建函数 |

### `scene/`

> 渲染层：3D场景、模型加载、VMD播放、环境系统、物理

| 文件 | 行数 | 导出数 | 内部依赖 | 职责 |
|------|------|--------|----------|------|
| `camera.ts` | 484 | 31 | 2 | 相机系统：轨道/自由飞行/镜头预设/演唱会模式 |
| `env-lighting.ts` | 212 | 9 | 0 | 环境光照推导：天空色→光照参数自动计算 |
| `scene-env-bridge.ts` | 201 | 14 | 5 | 环境桥接：envAutoLink、太阳角、时间流转、重力 |
| `scene-env-clouds.ts` | 368 | 2 | 2 | 云层系统：体积云、Perlin噪声 |
| `scene-env-impl.ts` | 406 | 28 | 2 | 环境核心：天空、地面、观察者、雾、时之砂 |
| `scene-env-particles.ts` | 277 | 3 | 2 | 粒子系统：樱花/雨/雪/风 |
| `scene-env-water.ts` | 528 | 12 | 2 | 水面系统：Gerstner波、涟漪、焦散、水下过渡 |
| `scene-env.ts` | 141 | 23 | 3 | 环境门面：统一环境API入口 |
| `scene-lighting.ts` | 205 | 9 | 1 | 光照系统：灯光、阴影、太阳盘、环境光 |
| `scene-lipsync.ts` | 70 | 7 | 5 | 口型同步：音频振幅→Morph权重映射 |
| `scene-loader.ts` | 194 | 3 | 4 | 模型加载：PMX加载流程、错误处理、进度反馈 |
| `scene-material.ts` | 261 | 20 | 2 | 材质系统：按部位分类、批量调参、状态持久化 |
| `scene-model-ops.ts` | 155 | 25 | 7 | 模型操作：可见性/变换/物理/Morph等便捷函数 |
| `scene-model.ts` | 622 | 1 | 3 | 模型管理器：注册表、生命周期、属性管理 |
| `scene-playback.ts` | 105 | 3 | 4 | 播放控制：进度条、seek、UI更新 |
| `scene-proc-motion.ts` | 153 | 13 | 5 | 程序化动作：Idle Motion / Auto Dance |
| `scene-props.ts` | 116 | 4 | 4 | 道具系统：道具加载、变换、列表管理 |
| `scene-renderer.ts` | 208 | 8 | 0 | 渲染管线：后处理、渲染参数、SSAO/辉光 |
| `scene-serialize.ts` | 336 | 6 | 17 | 场景序列化：保存/加载、自动保存、场景还原 |
| `scene-vmd.ts` | 160 | 4 | 4 | VMD加载：动作/相机/姿势加载与绑定 |
| `scene.ts` | 174 | 36 + * | 21 | 场景核心：装配器，按顺序初始化所有子系统 |

### `menus/`

> UI层：菜单弹窗、模型库、设置、属性面板

| 文件 | 行数 | 导出数 | 内部依赖 | 职责 |
|------|------|--------|----------|------|
| `env-menu.ts` | 490 | 14 | 7 | 环境菜单：天空、地面、粒子、风、云 |
| `library-core.ts` | 754 | 6 | 9 | 模型库核心：扫描、搜索、层级构建、标签 |
| `library.ts` | 8 | 9 | 0 | 模型库入口：弹窗开关、初始化、刷新 |
| `menu.ts` | 398 | 1 | 2 | MenuStack：通用菜单导航组件 |
| `model-detail.ts` | 605 | 7 | 12 | 模型详情：信息、变换、可见性、表情、材质 |
| `model-material.ts` | 305 | 4 | 4 | 材质调节：逐材质调参子菜单 |
| `model-preset.ts` | 383 | 11 | 6 | 模型预设：保存/加载/自动应用 |
| `motion-popup.ts` | 595 | 6 | 8 | 动作库弹窗：VMD、姿势、舞蹈套装 |
| `outfit-ui.ts` | 77 | 1 | 3 | 换装UI：服装变体子菜单 |
| `scene-menu.ts` | 1,234 | 2 | 12 | 场景菜单：相机、灯光、渲染、音乐、程序化动作 |
| `settings.ts` | 820 | 2 | 6 | 设置页：外部库管理、偏好配置 |

### `outfit/`

> 业务层：换装系统、音频播放

| 文件 | 行数 | 导出数 | 内部依赖 | 职责 |
|------|------|--------|----------|------|
| `audio.ts` | 219 | 20 | 3 | 音频系统：音乐播放、VMD同步、节拍检测挂载 |
| `outfit.ts` | 262 | 3 | 4 | 换装系统：outfits.json加载、变体应用、重置 |

### `motion/`

> 动效层：程序化动作、节拍检测、LipSync、VPD解析、VMD写入

| 文件 | 行数 | 导出数 | 内部依赖 | 职责 |
|------|------|--------|----------|------|
| `beat-detector.ts` | 164 | 1 | 0 | 节拍检测：Web Audio API 实时BPM检测 |
| `lipsync.ts` | 47 | 4 | 0 | 口型同步：音频振幅分析 |
| `procedural-motion.ts` | 187 | 7 | 1 | 程序化动作：Idle Motion / Auto Dance 核心算法 |
| `vmd-writer.ts` | 120 | 7 | 0 | VMD写入：程序化动作生成二进制VMD |
| `vpd-parser.ts` | 126 | 6 | 1 | VPD姿势解析：MikuMikuPose 格式→VMD帧转换 |

### `physics/`

> 物理层：XPBD布料、碰撞体

| 文件 | 行数 | 导出数 | 内部依赖 | 职责 |
|------|------|--------|----------|------|
| `cloth-manager.ts` | 84 | 2 | 4 | 布料管理器：布料实例生命周期管理 |
| `xpbd-cloth.ts` | 420 | 7 | 2 | XPBD布料：布料模拟核心算法 |
| `xpbd-collider.ts` | 302 | 4 | 1 | 碰撞体：SDF碰撞体、胶囊体预设 |
| `xpbd-renderer.ts` | 323 | 2 | 2 | 布料渲染：布料网格可视化 |
| `xpbd-solver.ts` | 545 | 5 | 0 | XPBD求解器：约束求解核心 |

### `__tests__/`

> 测试层：单元测试、集成测试

| 文件 | 行数 | 导出数 | 内部依赖 | 职责 |
|------|------|--------|----------|------|
| `beat-detector.test.ts` | 108 | 0 | 1 | 节拍检测单元测试 |
| `config.test.ts` | 66 | 0 | 2 | 配置工具函数单元测试 |
| `env-lighting.test.ts` | 53 | 0 | 1 | 环境光照推导单元测试 |
| `env-state-integrity.test.ts` | 108 | 0 | 1 | 环境状态完整性测试 |
| `env-state.test.ts` | 121 | 0 | 1 | 环境状态单元测试 |
| `environment-integration.test.ts` | 251 | 0 | 0 | 环境系统集成测试 |
| `lipsync.test.ts` | 74 | 0 | 1 | 口型同步单元测试 |
| `material-editor.test.ts` | 803 | 0 | 2 | 材质编辑器测试 |
| `model-detail-ui.test.ts` | 540 | 0 | 3 | 模型详情UI测试 |
| `model-preset.test.ts` | 744 | 0 | 5 | 模型预设功能测试 |
| `outfit.test.ts` | 301 | 0 | 1 | 换装系统单元测试 |
| `procedural-motion.test.ts` | 134 | 0 | 1 | 程序化动作单元测试 |
| `vmd-writer.test.ts` | 87 | 0 | 1 | VMD写入器单元测试 |
| `vpd-parser.test.ts` | 201 | 0 | 2 | VPD解析器单元测试 |
| `xpbd-cloth.test.ts` | 267 | 0 | 1 | XPBD布料模拟单元测试 |
| `xpbd-solver.test.ts` | 267 | 0 | 1 | XPBD求解器单元测试 |

### `(root)`

> 根目录：全局样式、类型声明、入口HTML

| 文件 | 行数 | 导出数 | 内部依赖 | 职责 |
|------|------|--------|----------|------|
| `app.css` | 1,191 | 0 | 0 | 全局样式：CSS变量体系、组件样式、布局 |
| `vite-env.d.ts` | 1 | 0 | 0 | Vite类型声明：环境变量类型、模块声明 |

### `assets/`

> 资源层：字体、图片等静态资源

| 子目录/文件 | 数量 | 说明 |
|-------------|------|------|
| `fonts/` | 2 | |
| `images/` | 1 | |

## 🔄 循环依赖

> 由 `madge --circular` 检测。部分循环依赖为**设计上故意**（子模块从 scene.ts 导入，scene.ts 又 re-export 子模块），
> 但仅在函数体内访问，利用 ES module live binding 保证运行时安全。

### 已知循环依赖（运行时安全）

| 循环 | 说明 | 风险 |
|------|------|------|
| `scene.ts` ↔ `scene-lighting.ts` | lighting 从 scene 拿 scene 对象，scene re-export lighting | ✅ 安全 |
| `scene.ts` ↔ `scene-renderer.ts` | renderer 从 scene 拿 scene 对象，scene re-export renderer | ✅ 安全 |
| `scene.ts` ↔ `scene-loader.ts` | loader 从 scene 拿 modelManager，scene re-export loader | ✅ 安全 |
| `scene.ts` ↔ `scene-env-bridge.ts` | bridge 从 scene 拿 _updateSunDisc，scene re-export bridge | ✅ 安全 |
| `scene.ts` ↔ `scene-proc-motion.ts` | proc 从 scene 拿模型，scene re-export proc | ✅ 安全 |
| `scene.ts` ↔ `scene-lipsync.ts` | lipsync 从 scene 拿 morph，scene re-export lipsync | ✅ 安全 |
| `scene.ts` ↔ `scene-props.ts` | props 从 scene 拿 scene 对象，scene re-export props | ✅ 安全 |
| `scene.ts` ↔ `scene-serialize.ts` | serialize 从 scene 拿状态，scene re-export serialize | ✅ 安全 |
| `scene.ts` ↔ `scene-model-ops.ts` | ops 从 scene 拿 modelManager，scene re-export ops | ✅ 安全 |
| `scene.ts` ↔ `camera.ts` | camera 从 scene 拿 canvas，scene import camera 函数 | ✅ 安全 |
| `scene-env.ts` ↔ `scene-env-impl.ts` | 门面模式，impl 持有状态，env 委托 | ✅ 安全 |
| `scene-env-impl.ts` ↔ `scene-env-water.ts` | water 从 impl 拿 _envSys，impl re-export water | ✅ 安全 |
| `scene-env-impl.ts` ↔ `scene-env-clouds.ts` | clouds 从 impl 拿 _envSys，impl re-export clouds | ✅ 安全 |
| `scene-env-impl.ts` ↔ `scene-env-particles.ts` | particles 从 impl 拿 _envSys，impl re-export particles | ✅ 安全 |

**安全判据**：子模块仅在**函数体内**访问 scene.ts 的导出，模块顶层不调用。

## 📑 核心模块导出索引

> 仅列出 scene/ 目录下的导出，便于快速查找。

### `camera.ts`

```typescript
  CameraMode
  OrbitParams
  FreeflyParams
  ConcertParams
  CameraPreset
  defaultCameraPreset
  getCameraPreset
  setCameraPreset
  getOrbitParams
  getFreeflyParams
  getConcertParams
  setOrbitParams
  setFreeflyParams
  setConcertParams
  getConcertPaused
  setConcertPaused
  getCameraVmdName
  getCameraVmdPath
  hasCameraVmd
  loadCameraVmd
  clearCameraVmd
  animateCameraVmd
  getCurrentCamera
  getCameraMode
  freeflyInput
  initCameraSystem
  switchCameraMode
  autoFrame
  CameraState
  getCameraState
  ... 还有 1 个
```

### `env-lighting.ts`

```typescript
  EnvPreset
  DerivedLighting
  calcLuminance
  deriveLighting
  ENV_PRESETS
  exportEnvPreset
  importEnvPreset
  WaterPreset
  WATER_PRESETS
```

### `scene-env-bridge.ts`

```typescript
  setGravityStrength
  getGravityStrength
  setEnvAutoLink
  getEnvAutoLink
  setEnvSunAngle
  getEnvSunAngle
  startTimeOfDay
  stopTimeOfDay
  isTimeOfDayActive
  getTimeOfDaySpeed
  setTimeOfDaySpeed
  redoEnvAutoLink
  applyEnvPreset
  setEnvState
```

### `scene-env-clouds.ts`

```typescript
  createClouds
  disposeClouds
```

### `scene-env-impl.ts`

```typescript
  getEnvSunAngle
  setEnvSunAngle
  registerSceneTickCallback
  initEnvImpl
  getScene
  getPipeline
  _envSys
  disposeSky
  applySky
  applyGround
  ensureEnvUpdateObserver
  disposeEnvUpdateObserver
  applyFog
  createWater
  disposeWater
  refreshWaterRenderList
  addRipple
  clearRipples
  updateWaterAnimSpeed
  _underwaterActive
  _underwaterSavedFog
  _underwaterTransitionProgress
  _underwaterTarget
  createClouds
  disposeClouds
  createParticleEmitter
  disposeParticles
  applyWindToParticles
```

### `scene-env-particles.ts`

```typescript
  createParticleEmitter
  disposeParticles
  applyWindToParticles
```

### `scene-env-water.ts`

```typescript
  _underwaterActive
  _underwaterSavedFog
  _underwaterTransitionProgress
  _underwaterTarget
  addRipple
  clearRipples
  createWater
  disposeWater
  refreshWaterRenderList
  updateWaterAnimSpeed
  updateUnderwaterTransition
  resetUnderwaterState
```

### `scene-env.ts`

```typescript
  initEnvFacade
  applySky
  applyGround
  createWater
  disposeWater
  refreshWaterRenderList
  updateWaterAnimSpeed
  addRipple
  clearRipples
  createParticleEmitter
  disposeParticles
  applyWindToParticles
  createClouds
  disposeClouds
  startTimeOfDay
  stopTimeOfDay
  isTimeOfDayActive
  getTimeOfDaySpeed
  setTimeOfDaySpeed
  applyEnvState
  _envSys
  registerSceneTickCallback
  ensureEnvUpdateObserver
```

### `scene-lighting.ts`

```typescript
  LightState
  hemiLight
  dirLight
  initLighting
  getLightState
  setLightState
  _updateSunDisc
  _disposeSunDisc
  rebuildShadowCasters
```

### `scene-lipsync.ts`

```typescript
  setLipSyncEnabled
  setLipSyncSensitivity
  setLipSyncIntensity
  getLipSyncState
  setLipSyncState
  resetLipSyncOnFocusChange
  updateLipSync
```

### `scene-loader.ts`

```typescript
  initLoader
  captureThumbnail
  loadPMXFile
```

### `scene-material.ts`

```typescript
  MaterialCategoryParams
  MaterialCategory
  _catState
  _matState
  _matEnabled
  _catOf
  _applyAll
  isMatEnabled
  setMatEnabled
  getMatCatGroups
  getMatCatParams
  setMatCatParams
  resetMatCatParams
  getMatDetailList
  getMatParams
  setMatParams
  resetSingleMatParams
  resetAllMatParams
  getMatState
  applyMatState
```

### `scene-model-ops.ts`

```typescript
  PhysicsCategory
  removeModel
  removeFocusedModel
  focusModel
  arrangeModels
  setModelVisibility
  setModelOpacity
  setModelWireframe
  setModelBoneLinesVis
  setModelBoneJointsVis
  setModelPhysics
  getPhysicsCategories
  getPhysicsCatState
  isPhysicsCategoryEnabled
  setPhysicsCategory
  setModelScaling
  setModelRotationY
  setModelPosition
  getModelPosition
  resetModelTransform
  stopVMD
  getModelMorphs
  setModelMorphWeight
  getModelMorphWeight
  resetModelMorphs
```

### `scene-model.ts`

```typescript
  ModelManager
```

### `scene-playback.ts`

```typescript
  initPlaybackObservables
  updatePlaybackUI
  seekFromEvent
```

### `scene-proc-motion.ts`

```typescript
  procVmdActive
  getProcBeatDetector
  createProcBeatDetector
  stopProcMotion
  onModelRemoved
  updateProcMotion
  setProcMotionMode
  setProcMotionIntensity
  setProcMotionSpeed
  setProcMotionAutoSwitch
  getProcMotionState
  setProcMotionState
  regenerateProcMotion
```

### `scene-props.ts`

```typescript
  loadProp
  removeProp
  setPropTransform
  getPropList
```

### `scene-renderer.ts`

```typescript
  ToneMappingMode
  RenderState
  pipeline
  initRenderer
  getRenderState
  setRenderState
  reattachPipeline
  rebuildOutlineState
```

### `scene-serialize.ts`

```typescript
  SceneFile
  serializeScene
  deserializeScene
  triggerAutoSaveImpl
  saveSceneImmediate
  tryRestoreLastScene
```

### `scene-vmd.ts`

```typescript
  loadVMDMotion
  loadVMDFromPath
  loadCameraVmdFromPath
  loadVPDPose
```

### `scene.ts`

```typescript
  engine
  scene
  modelManager
  focusedMmdModel
  focusedModel
  initScene
  getScene
  _catState
  _matState
  _matEnabled
  _catOf
  _applyAll
  isMatEnabled
  setMatEnabled
  getMatCatGroups
  getMatCatParams
  setMatCatParams
  resetMatCatParams
  getMatDetailList
  getMatParams
  setMatParams
  resetSingleMatParams
  resetAllMatParams
  getMatState
  applyMatState
  loadVMDMotion
  loadVMDFromPath
  loadCameraVmdFromPath
  loadVPDPose
  updatePlaybackUI
  ... 还有 6 个
```

> `export *` — 转发子模块全部导出

## 📈 依赖复杂度 Top 10

> 按内部依赖数量排序，依赖越多的文件越需要关注。

| 排名 | 文件 | 内部依赖 | 外部依赖 | 行数 |
|------|------|----------|----------|------|
| 1 | `scene.ts` | 21 | 12 | 174 |
| 2 | `scene-serialize.ts` | 17 | 1 | 336 |
| 3 | `model-detail.ts` | 12 | 0 | 605 |
| 4 | `scene-menu.ts` | 12 | 0 | 1,234 |
| 5 | `library-core.ts` | 9 | 0 | 754 |
| 6 | `motion-popup.ts` | 8 | 0 | 595 |
| 7 | `env-menu.ts` | 7 | 0 | 490 |
| 8 | `scene-model-ops.ts` | 7 | 0 | 155 |
| 9 | `main.ts` | 6 | 0 | 483 |
| 10 | `model-preset.ts` | 6 | 0 | 383 |

---

*自动生成于 2026-06-30 14:11:52*
