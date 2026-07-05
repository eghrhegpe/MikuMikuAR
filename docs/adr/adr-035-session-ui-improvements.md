# ADR-035: P2 功能批量交付 — Lifelike / Formation / Auto Camera / Scene Bundle

**日期**：2026-07-05
> **状态**: 已完成

---

## 背景

两次会话完成全部 5 个 P2 功能：Motion Layers（首次会话）、Lifelike Motions、Formation System、Auto Camera、Scene Bundle（本次会话）。同时包含材质编辑器增量更新、物理 toggle 增量更新、状态提示自动消失等 UI 改进。

## 1. Motion Layers（多 VMD 叠加）

### 决策

引入 VmdLayer 类型，每个模型支持多层 VMD 动画，通过 MmdCompositeAnimation 混合。

### 实现

- `types.ts`：新增 VmdLayer（id/name/data/path/weight/enabled/boneFilter）+ ModelInstance.vmdLayers
- `vmd-layers.ts`：addVmdLayer / removeVmdLayer / toggleVmdLayer / setVmdLayerWeight / clearVmdLayers
- 混合逻辑：单图层走 loadVMDMotion；多图层走 MmdCompositeAnimation + MmdAnimationSpan（JS 运行时）
- WASM 运行时限制：MmdWasmAnimation 构造函数要求 MmdAnimation 类型，MmdCompositeAnimation 无法传入，回退到主图层
- 场景序列化：vmdLayers 写入/恢复

### 关联 ADR

- ADR-027（菜单响应式）：图层面板 UI 复用 slideRow / addSliderRow
- ADR-021（程序化动作）：loadVMDMotion 保持兼容，图层不干扰 procedural VMD

### 关联代码

| 文件 | 改动 |
|------|------|
| core/types.ts | +VmdLayer 类型 + vmdLayers 字段 |
| core/state.ts | +layerBindingTargetId |
| scene/motion/vmd-layers.ts | 新建 |
| scene/manager/model-loader.ts | ModelInstance 初始化 |
| scene/manager/model-manager.ts | clearVmdData 同步 |
| scene/scene-serialize.ts | 序列化/反序列化 |
| menus/library-core.ts | layerBindingTargetId 检查 |
| menus/motion-popup.ts | 图层面板 + 路由 |

## 2. 材质编辑器增量更新

### 决策

buildMatRootLevel 的色块点击和行选择改为增量 DOM 更新，消除 4 处 reRender()。

### 实现

- 色块点击：内联更新 swatch 样式 + row class（复用 buildMatListLevel 模式）
- 行点击：_renderParamCard() 只重建参数卡片容器，不重建材质列表
- 重置操作保留 reRender()（影响面大，增量不划算）

### 关联 ADR

- ADR-027（菜单响应式）：增量更新是 ADR-027 的延伸实践
- ADR-033（菜单统一）：buildMatRootLevel 结构与统一体系一致

## 3. 物理 toggle 增量更新

### 决策

scene-physics-levels.ts 的 14 处 reRender() 替换为 _patchToggle() 增量 DOM 更新。

### 实现

- 新增 _patchToggle(target, newValue)：通过 data-row-key 定位行 DOM，翻转 .switch 的 on/off class
- 4 个子页（物理主页/碰撞/WASM 物理/调试）共 14 处 toggle 回调改为 _patchToggle
- 滑条回调移除 reRender()（SlideMenu 的 patchPanel 已处理增量更新）

### 关联 ADR

- ADR-027（菜单响应式）：_patchToggle 是 ADR-027 updateControls 机制的轻量补充
- ADR-029（物理 UI 重构）：物理子页结构由 ADR-029 定义

## 4. 状态提示自动消失

### 决策

setStatus 新增 hold 参数，成功 2s / 错误 5s 后自动淡出；hint 不再阻塞 status 更新。

### 实现

- setStatus(text, ok, hold=false)：成功 2s 后 fade out，错误 5s 后 fade out，hold=true 持续显示
- 新消息清除旧定时器，不叠加
- hint 激活时 setStatus 仍更新保存值，hint 结束后显示最新状态
- CSS transition: opacity 0.5s ease 实现平滑淡出

### 关联 ADR

- 无直接关联 ADR，属于 UX 改进

### 向后兼容

hold 参数默认 false，176 处现有调用无需改动。

## 影响

- Motion Layers 为后续功能提供基础设施
- 材质编辑器和物理 toggle 操作更流畅，无闪烁/重建
- 状态提示不再永久占据状态栏，用户体验更干净

---

## 5. Lifelike Motions（微动作叠加层）

### 决策

新增 `generateLifelikeVmd()` 生成极微 VMD 叠加层，复用 Motion Layers 系统叠加在任何动画上。与 Idle 模式的区别：Idle 替换动画，Lifelike 叠加。

### 设计要点

- 幅度比 Idle 小 50%+：呼吸 0.015（Idle 0.03）、重心漂移 0.012、头部微摆 0.01
- 多频叠加避免周期感：呼吸双频（4s+6s）、重心三频（0.15/0.23/0.37 倍频）
- 10s 循环（足够长避免明显循环感）
- 通过 `addVmdLayer()` 作为图层添加，权重由 `lifelikeIntensity` 控制
- 状态通过 `ProcMotionState.lifelikeEnabled` + `lifelikeIntensity` 序列化

### 实现

- `procedural-motion.ts`：+generateLifelikeVmd()（~170 行）+ PROC_VMD_NAME_LIFELIKE + ProcMotionState 新字段
- `proc-motion-bridge.ts`：+setLifelikeEnabled() / setLifelikeIntensity() + 图层生命周期管理
- `motion-procmotion-levels.ts`：UI toggle（lucide:sparkles）+ 强度滑块

### 关联 ADR

- ADR-021（程序化动作）：Lifelike 是程序化动作系统的扩展
- ADR-035 §1（Motion Layers）：复用图层系统实现叠加

---

## 6. Formation System（队形预设）

### 决策

扩展 `modelManager.arrange()` 为 6 种队形预设，≥2 模型时在场景菜单自动显示入口。

### 实现

- `model-manager.ts`：+setFormation(type) + _computeFormationPos() + FormationType 类型
- `model-ops.ts`：+setModelFormation() / getFormationLabels() 导出
- `scene-menu.ts`：队形子菜单 + 6 种预设 action

### 队形预设

| 类型 | 布局 | 间距 |
|------|------|------|
| line | 一字排列 | 等距水平 |
| v-shape | V 字阵型 | 前窄后宽 |
| circle | 圆形阵型 | 半径按人数自适应 |
| grid | 网格阵型 | √n 列自动分行 |
| diagonal | 对角排列 | 45° 递进 |
| arc | 弧形排列 | 144° 扇形 |

### 关联 ADR

- 无直接关联 ADR，属于多模型工作流增强

---

## 7. Auto Camera（节拍驱动运镜）

### 决策

BeatDetector 新增 `onBeat` 回调机制，Auto Camera 监听 beat 事件按节拍切换镜头角度。

### 实现

- `beat-detector.ts`：+onBeat(cb) 回调注册 / update() 内触发
- `camera.ts`：+setAutoCameraEnabled() / setAutoCameraBeatsPerSwitch() + 8 个镜头预设
- `motion-camera-levels.ts`：自动运镜 toggle + 切换间隔滑块

### 镜头预设

8 个 orbit 预设覆盖正面/侧面/俯拍/远景等角度，切换时用 smoothstep（500ms）平滑过渡。

### 关联 ADR

- ADR-016（视线追踪）：Auto Camera 与 gaze tracking 共存，gaze 是实时骨骼叠加不影响相机
- ADR-021（程序化动作）：共用 BeatDetector 实例

---

## 8. Scene Bundle（场景打包）

### 决策

将场景 JSON + 所有引用资源打包为单个 `.mmascene` zip 文件。格式：`scene.json`（libraryRef 重写为 bundle 内部路径）+ `assets/` 目录。

### 设计要点

- libraryRef 重写：绝对路径 → bundle 内部相对路径（主库 `rel/path`，外部库 `name:rel/path`）
- 加载时临时 `setLibraryRoot(extractDir)`，让 `resolveLibraryRef` 在解压目录下查找
- 现有 `deserializeScene()` 零改动 — 通过 libraryRoot 覆盖实现
- PMX 纹理依赖：保持 PMX 与纹理的相对目录结构，PMX loader 自动处理

### 实现

- `zipextract.go`：+BundleScene(targetPath, sceneJSON, assetPaths) + _bundleRelPath / _copyFileToZip
- `integration.go`：+SelectBundleSaveFile() + archive/zip 导入
- `scene-bundle.ts`（新文件）：collectSceneAssets() + rewriteRefsForBundle() + exportSceneBundle() / importSceneBundle()
- `scene-serialize.ts`：导出 resolvePathFromRef
- `scene-menu.ts`：导出场景包 / 导入场景包按钮
- `app.ts`（bindings）：+BundleScene / +SelectBundleSaveFile（需 `wails generate` 刷新 ID）

### 依赖

- Go 后端 zip 写入（archive/zip.NewWriter）
- 现有 ExtractZip 解压 + 缓存机制
- resolveLibraryRef 路径安全检测

### 向后兼容

现有 `.mmascene` JSON 文件仍可直接加载（无 zip 包装时走原路径）。

---

## 完整改动文件清单

### Lifelike Motions

| 文件 | 改动 |
|------|------|
| motion-algos/procedural-motion.ts | +generateLifelikeVmd() + PROC_VMD_NAME_LIFELIKE + ProcMotionState 字段 |
| scene/motion/proc-motion-bridge.ts | +setLifelikeEnabled/Intensity + 图层管理 |
| menus/motion-procmotion-levels.ts | UI toggle + 强度滑块 |

### Formation System

| 文件 | 改动 |
|------|------|
| scene/manager/model-manager.ts | +setFormation() + _computeFormationPos() + FormationType |
| scene/manager/model-ops.ts | +setModelFormation() + getFormationLabels() |
| menus/scene-menu.ts | 队形子菜单 + action handlers |

### Auto Camera

| 文件 | 改动 |
|------|------|
| motion-algos/beat-detector.ts | +onBeat(cb) 回调机制 |
| scene/camera/camera.ts | +setAutoCameraEnabled/BeatsPerSwitch + 8 预设 |
| menus/motion-camera-levels.ts | 自动运镜 toggle + 间隔滑块 |

### Scene Bundle

| 文件 | 改动 |
|------|------|
| internal/app/zipextract.go | +BundleScene() + _bundleRelPath + _copyFileToZip |
| internal/app/integration.go | +SelectBundleSaveFile() |
| frontend/src/scene/scene-bundle.ts | 新建：资源收集 + ref 重写 + 打包/解包 |
| frontend/src/scene/scene-serialize.ts | 导出 resolvePathFromRef |
| frontend/src/menus/scene-menu.ts | 导出/导入入口 |
| frontend/bindings/.../app.ts | +BundleScene + SelectBundleSaveFile（占位 ID） |
