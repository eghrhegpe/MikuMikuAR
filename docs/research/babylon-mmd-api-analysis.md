# babylon-mmd API 搬运清单

> **调研日期**: 2026-07-08
> **调研目的**: 全面梳理 babylon-mmd v1.2.0 的 API 覆盖情况，识别可搬运的未使用功能和类型安全缺口
> **参考版本**: babylon-mmd 1.2.0 (npm) / Babylon.js 9.2.0+

---

## 一、项目已使用的 babylon-mmd API（~39 条 import）

### 1.1 加载器子系统

| 模块路径 | 导入名 | 使用文件 | 用途 |
|----------|--------|----------|------|
| `Loader/vmdLoader` | `VmdLoader` | `vmd-loader.ts` / `vmd-layers.ts` / `vmd-evaluator.ts` | VMD 动画解析 |
| `Loader/dynamic` | `RegisterMmdModelLoaders` | `scene.ts` | 注册 PMX/PMD 动态加载器 |
| `Loader/registerDxBmpTextureLoader` | `RegisterDxBmpTextureLoader` | `scene.ts` | 注册 DirectX BMP 纹理加载器 |
| `Loader/mmdModelLoader.default` | side-effect | `scene.ts` | 注册默认材质构建器 |
| `Loader/Shaders/textureAlphaChecker.*` | side-effect | `scene.ts` | 透明度检测着色器 |

### 1.2 运行时核心

| 模块路径 | 导入名 | 使用文件 | 用途 |
|----------|--------|----------|------|
| `Runtime/Optimized/mmdWasmRuntime` | `MmdWasmRuntime` | `scene.ts` / `vmd-loader.ts` / `vmd-layers.ts` / `env-bridge.ts` | WASM 动画/IK/物理运行时 |
| `Runtime/mmdRuntime` | `MmdRuntime` | `scene.ts` | JS 版运行时（无双缓冲，允许 worldMatrix 覆写） |
| `Runtime/Optimized/Physics/mmdWasmPhysics` | `MmdWasmPhysics` | `scene.ts` | WASM Bullet 物理 |
| `Runtime/Optimized/mmdWasmInstance` | `GetMmdWasmInstance` | `scene.ts` | WASM 实例初始化 |
| `Runtime/Optimized/InstanceType/singlePhysicsRelease` | `MmdWasmInstanceTypeSPR` | `scene.ts` | 单线程物理 Release 二进制 |
| `Runtime/mmdStandardMaterialProxy` | `MmdStandardMaterialProxy` | `scene.ts` / `model-loader.ts` | MMD 标准材质代理 |
| `Runtime/mmdRuntimeShared` | `MmdRuntimeShared` | `scene.ts` | 全局材质代理构造器 |

### 1.3 动画子系统

| 模块路径 | 导入名 | 使用文件 | 用途 |
|----------|--------|----------|------|
| `Runtime/Optimized/Animation/mmdWasmAnimation` | `MmdWasmAnimation` | `vmd-loader.ts` / `vmd-layers.ts` | WASM 动画封装 |
| `Runtime/Animation/mmdCompositeAnimation` | `MmdCompositeAnimation` / `MmdAnimationSpan` | `vmd-layers.ts` | 多层 VMD 混合 |
| `Runtime/Animation/bezierInterpolate` | `BezierInterpolate` | `vmd-evaluator.ts` | 贝塞尔曲线帧插值 |
| `Runtime/Optimized/Animation/mmdWasmRuntimeModelAnimation` | side-effect | `scene.ts` | 注册 WASM 动画评估 |
| `Runtime/Animation/mmdRuntimeModelAnimation` | side-effect | `scene.ts` | 注册 JS 动画评估 |

### 1.4 相机

| 模块路径 | 导入名 | 使用文件 | 用途 |
|----------|--------|----------|------|
| `Runtime/mmdCamera` | `MmdCamera` | `camera.ts` | MMD 相机 |

### 1.5 类型接口

| 模块路径 | 导入名 | 使用文件 |
|----------|--------|----------|
| `Runtime/IMmdRuntime` | `IMmdRuntime` | `state.ts` / `playback.ts` / `model-loader.ts` / `scene.ts` |
| `Runtime/IMmdModel` | `IMmdModel` | `types.ts` / `model-loader.ts` |
| `Runtime/IMmdRuntimeBone` | `IMmdRuntimeBone` | `proc-motion-bridge.ts` / `wasm-layers-blender.ts` |
| `Loader/Animation/mmdAnimationTrack` | `MmdBoneAnimationTrack` / `MmdMovableBoneAnimationTrack` | `vmd-evaluator.ts` |
| `Loader/Animation/mmdAnimation` | `MmdAnimation` | `camera.ts` / `vmd-evaluator.ts` |
| `Runtime/Animation/IMmdBindableAnimation` | `IMmdBindableModelAnimation` | `vmd-layers.ts`（通过 cast） |

---

## 二、babylon-mmd 有但项目未用的 API

### 2.1 高价值（直接可搬运）

#### `StreamAudioPlayer` — 内置音画同步

**模块**: `Runtime/Audio/streamAudioPlayer`

自带音画同步的音频播放器，集成 `MmdRuntime.setAudioPlayer()`，支持：
- 流式加载（无需完整下载即可播放）
- AudioElementPool 复用
- 丰富的 Observable：`onPlay` / `onPause` / `onSeek` / `onDurationChanged` / `onLoadError` / `onMuteStateChanged` / `onPlaybackRateChanged`
- 自动处理浏览器自动播放策略（静音先行→用户交互后 unmute）

**当前状态**: 项目在 `outfit/audio.ts` 自建音频管线，完全绕开了 babylon-mmd 的音频系统。

**搬运收益**: 可简化播放控制 + 获得与 MMD Runtime 的原生节拍同步。但需评估自建管线中的 `Web Audio API` 节拍检测是否需要保留（babylon-mmd 不提供节拍检测）。

---

#### `AnimationRetargeter` — 人形动画重定向

**模块**: `Loader/Util/animationRetargeter`

将任意人形动画（Humanoid rig）重定向到 MMD 骨骼，支持自定义骨骼映射。

配合使用的类：
- `MmdHumanoidMapper` — 骨骼名称映射
- `MixamoMmdHumanoidBoneMap` — Mixamo→MMD 预设
- `VrmMmdHumanoidBoneMap` — VRM→MMD 预设
- `IMmdHumanoidBoneMap` — 自定义映射接口

**搬运收益**: 解锁 Mixamo / VRM / Blender 动作数据导入。当前项目仅支持 VMD 格式。

---

#### `HumanoidMmd` — 人形模型支持

**模块**: `Runtime/Util/humanoidMmd`

让非 MMD 格式的人形模型（如 Blender 导出的 Humanoid rig）也能用 MMD 动画系统驱动。

**搬运收益**: 扩大可加载的模型范围。

---

#### `MmdWasmInstanceTypeMPR` — 多线程物理 ✅ 已落地（ADR-099）

**模块**: `Runtime/Optimized/InstanceType/multiPhysicsRelease`

多线程 + 物理 Release 版本。项目默认使用 `MmdWasmInstanceTypeSPR`（单线程），通过 `VITE_MMD_WASM_MT` 环境变量开启 MPR 性能分支。

可用的 WASM 实例类型：

| 类型 | 线程 | 物理 | 调试 | 项目使用 |
|------|------|------|------|---------|
| `SD` | 单线程 | 无 | Debug | ❌ |
| `SPD` | 单线程 | 有 | Debug | ❌ |
| `SPR` ← 默认 | 单线程 | 有 | Release | ✅ 生产默认 |
| `SR` | 单线程 | 无 | Release | ❌ |
| `MD` | 多线程 | 无 | Debug | ❌ |
| `MPD` | 多线程 | 有 | Debug | ❌ |
| `MPR` | 多线程 | 有 | Release | ✅ 性能分支 |
| `MR` | 多线程 | 无 | Release | ❌ |

**搬运收益**: 多核设备上物理+IK 求解并行化，性能显著提升。

**落地方式**: Go 端 COOP/COEP 响应头注入（`c2a0734`）+ 前端动态 import MPR + Vite `worker: { format: 'es' }` 修复 IIFE 多 chunk 限制。真机 WebView2 验证 `crossOriginIsolated=true` / `SharedArrayBuffer=true` / `useMultiThread=true` 全绿。

---

#### `MmdOutlineRenderer` — 描边渲染 ✅ 已落地（ADR-098 批次一）

**模块**: `Loader/mmdOutlineRenderer`

MMD 风格的描边渲染器，v1.2.0 已适配 Babylon.js 9.2.0 skinning shader 变更。支持：
- WebGPU WGSL 着色器
- ALPHA_TEST 材质
- MirrorTexture 镜像反射
- Baked vertex animation
- `zOffset` / `zOffsetUnits` 解决 z-fighting

**搬运收益**: 提供 MMD 原生描边效果。需要作为 side-effect import 注册。

---

#### `MmdCompositeRuntimeModelAnimation` — JS 运行时动画混合 ✅ 已落地（ADR-098 批次一，消除 vmd-layers cast）

**模块**: `Runtime/Animation/mmdCompositeRuntimeModelAnimation`

JS 运行时的动画混合容器，比手动操作 `MmdCompositeAnimation` 更安全。

**搬运收益**: 简化 JS runtime 路径的动画混合逻辑。

---

### 2.2 中等价值

| API | 模块 | 说明 |
|-----|------|------|
| `BpmxConverter` / `BvmdConverter` | `Loader/Optimized/` | PMX→BPMX / VMD→BVMD 预烘焙转换，加速运行时加载 |
| `StandardMaterialBuilder` | `Loader/` | 用 Babylon.js `StandardMaterial` 替代 `MmdStandardMaterial` |
| `PBRMaterialBuilder` | `Loader/` | 用 PBR 材质渲染 MMD 模型 |
| `SdefInjector` / `SdefMesh` | `Loader/` | SDEF 球形变形，更接近 MMD 原生渲染 |
| `MmdPlayerControl` | `Runtime/Util/` | 内置播放条 UI（时间显示 + seek） |
| `OiComputeTransformInjector` | `Runtime/Util/` | 无 MMD Runtime 也能更新骨骼变换矩阵 |
| `SharedToonTextures` | `Loader/` | 共享 Toon 纹理管理 |
| `MmdAsyncTextureLoader` | `Loader/` | 异步纹理加载器（带池化） |

### 2.3 低优先级

| API | 说明 |
|-----|------|
| `PmxReader` / `PmdReader` / `VmdObject` 等底层解析器 | 项目已通过高层 Loader 间接使用 |
| `PhysicsRuntime` / `MultiPhysicsRuntime` | 独立物理后端，项目已用 `MmdWasmPhysics` |
| `MmdAmmoPhysics` / `MmdAmmoJSPlugin` | Ammo.js 后端备选 |
| `MmdPhysics` | Havok 后端 |
| `RigidBody` / `PhysicsWorld` 等底层物理 API | 直接操作 Bullet 物理世界 |
| `MmdRuntimeCameraAnimation` / `MmdRuntimeModelAnimation` | JS 运行时动画（项目用 WASM 版本） |

---

## 三、类型安全缺口（`as any` / cast 问题）

### 3.1 接口缺口

| 位置 | 问题代码 | 根因 |
|------|----------|------|
| `core/types.ts:31-34` | `RuntimeModel = IMmdModel & { setRuntimeAnimation(...); createRuntimeAnimation(...); }` | `IMmdModel` 接口缺少 `setRuntimeAnimation` 和 `createRuntimeAnimation` 方法 |
| `vmd-layers.ts:577` | `composite as unknown as IMmdBindableModelAnimation` | `MmdCompositeAnimation` 实现了该接口但类型系统未声明 |
| `vmd-loader.ts:74` | `(vmdLoader as unknown as { dispose?: () => void }).dispose?.()` | `VmdLoader` 类型未暴露 `dispose()` 方法 |
| `vmd-loader.ts:109` | `(inst.mmdModel as { currentAnimation?: ... }).currentAnimation` | `IMmdModel` 不含 `currentAnimation` 属性 |

### 3.2 WASM/JS 骨骼区分

| 位置 | 问题 |
|------|------|
| `proc-motion-bridge.ts:81` | `(bone as any).updateWorldMatrix === undefined` 鸭子类型检查区分 WASM/JS 骨骼 |
| `proc-motion-bridge.ts` 多处 | `(bone as any).worldMatrix as Float32Array` — `IMmdRuntimeBone.worldMatrix` 已声明为 `Float32Array`，`as any` 多余 |

### 3.3 未类型化访问

| 位置 | 问题 |
|------|------|
| `proc-motion-bridge.ts:412` | `(mmdModel.mesh.metadata as any).skeleton` — 访问未类型化的 mesh metadata |
| `wasm-layers-blender.ts:228` | 类似的 `as any` worldMatrix 访问 |

### 3.4 建议

向 babylon-mmd 上游提交 PR：
1. 将 `setRuntimeAnimation` / `createRuntimeAnimation` / `currentAnimation` 加入 `IMmdModel` 接口
2. 为 `MmdCompositeAnimation` 声明 `IMmdBindableModelAnimation` 兼容
3. 为 `VmdLoader` 添加 `dispose()` 类型声明

---

## 四、架构分析

### 4.1 三层封装架构

```
Layer 1: 直接 API 调用
  ├── scene.ts          — 初始化 WASM、注册加载器、创建 MmdRuntime
  ├── camera.ts         — MmdCamera 实例化
  └── model-loader.ts   — PMX 加载 + createMmdModel

Layer 2: 桥接/包装层
  ├── vmd-loader.ts     — VMD 加载 + WASM 动画封装
  ├── vmd-layers.ts     — 多层 VMD 混合（MmdCompositeAnimation）
  ├── playback.ts       — 播放控制 + Observable 管理
  ├── wasm-layers-blender.ts — WASM 多图层混合（JS 帧流→WASM buffer）
  └── proc-motion-bridge.ts  — 程序化动作（注视/摇头）+ WASM worldMatrix 覆写

Layer 3: 纯算法层
  ├── vmd-evaluator.ts  — VMD 帧级求值（二分查找 + Slerp/Lerp）
  ├── vmd-writer.ts     — VMD 二进制写入
  └── vpd-parser.ts     — VPD 姿势解析
```

### 4.2 关键 workaround

**`wasm-layers-blender.ts`** 是最精妙的 workaround：

WASM Runtime 不支持多动画混合（只有单动画通道），项目在 JS 侧用 `vmd-evaluator` 逐帧求值各层 VMD 的骨骼变换，然后按权重混合后直接写入 WASM 的 `worldMatrix` buffer。这绕过了 WASM 的限制，但依赖 `MmdWasmRuntimeBone` 的内部 buffer 布局。

**风险点**: 如果 babylon-mmd 升级改变了 WASM 侧 buffer 布局，此 workaround 会静默失效。

---

## 五、搬运优先级建议

> **更新于 2026-07-14**（基于代码实际核查）

| 优先级 | 项目 | 工作量 | 收益 | 状态 |
|--------|------|--------|------|------|
| ~~P0~~ | ~~`MmdWasmInstanceTypeMPR`~~ | ~~极小~~ | ~~多线程性能~~ | ✅ ADR-099 已落地 |
| ~~P0~~ | ~~向上游提交接口补全 PR~~ | ~~中~~ | ~~消除所有 `as any`~~ | ⏳ 推迟（部分已通过 module augmentation 止血） |
| **P1** | `AnimationRetargeter` + `HumanoidMmd` | 中（新增导入路径） | 解锁 Mixamo/VRM 动作 | ⏳ 待立项 |
| P1 | `StreamAudioPlayer` | 中（替换音频管线） | 音画同步简化 | ⏳ 待立项（需与 ADR-088 音效系统协调） |
| ~~P2~~ | ~~`MmdOutlineRenderer`~~ | ~~小~~ | ~~MMD 描边效果~~ | ✅ ADR-098 已落地 |
| ~~P2~~ | ~~`MmdCompositeRuntimeModelAnimation`~~ | ~~小~~ | ~~JS runtime 动画混合~~ | ✅ ADR-098 已落地 |
| **P2** | `SdefInjector` + `SdefMesh` | 小（side-effect import） | SDEF 球面变形，关节弯曲更自然 | ⏳ 待立项 |
| P3 | `BpmxConverter` / `BvmdConverter` | 大（需构建流程） | 加速加载 | ⏳ 待立项 |
| P3 | `PBRMaterialBuilder` | 中（材质系统改造） | PBR 渲染 | ⏳ 待立项 |
| P3 | `MmdPlayerControl` | 小 | 播放条 UI | ⏳ 待立项（项目已有 playback.ts） |

---

## 六、CHANGELOG 关键变更（v1.0.0 → v1.2.0）

### v1.2.0

- `TransformNode.parent` 替代 `setParent()` — 自动生效，无需改动
- `ArrayBufferView` 加载修复 — 之前无法从 TypedArray 加载，现已修复
- Disposable 模式重构 — `MmdWasmAnimation` / `MmdWasmRuntime` 等改用 `Observer.remove()`
- WASM Rust 2024 edition + LLVM 22 重编译 — 性能可能变化，建议 benchmark
- Outline renderer 适配 Babylon.js 9.2.0 skinning shader
- **最低 Babylon.js 版本升至 9.2.0**

### v1.1.0

- `MmdCamera.upVector` 可自定义
- `MmdCamera.target` 替代旧的 `position` 语义（`position` 变为计算属性）
- `MmdOutlineRenderer` 适配 WebGPU + ALPHA_TEST
- 修复 `MmdWasmModel` 刚体状态切换时未重置

### v1.0.0

- 大规模重命名：`AnimationGroup` → `AnimationContainer`
- `MmdModelLoader` 默认材质构建器改为 null（tree-shaking 友好）
- 多 MMD 相机支持
- 动画绑定 API 重构：`addAnimation`/`removeAnimation` → `createRuntimeAnimation`/`setRuntimeAnimation`
- `IMmdModelCreationOptions.materialProxyConstructor` 默认值改为 null
- 移除 `NullMaterialProxy`

---

## 七、总结

> **更新于 2026-07-14**（基于代码实际核查）

babylon-mmd v1.2.0 提供了 ~131 个导出 API，项目直接使用了约 **40+** 个。已完成的搬运：

| 项目 | ADR | 状态 |
|------|-----|------|
| `MmdOutlineRenderer` 描边渲染 | ADR-098 | ✅ 已落地 |
| `MmdCompositeRuntimeModelAnimation` JS 动画混合 | ADR-098 | ✅ 已落地 |
| `MmdWasmInstanceTypeMPR` 多线程物理 | ADR-099 | ✅ 已落地（Go COOP/COEP + Vite worker format） |

剩余未利用的高价值功能集中在：

1. **人形动画重定向** (`AnimationRetargeter` / `HumanoidMmd`) — 解锁 Mixamo / VRM / Blender 动作数据来源
2. **原生音频同步** (`StreamAudioPlayer`) — 与自建 BeatDetector 的取舍
3. **SDEF 球面变形** (`SdefInjector` / `SdefMesh`) — 零风险视觉提升，一行 side-effect import

类型安全方面，`IMmdModel` 接口缺少动画绑定方法是最大的系统性问题，已通过 `core/types.ts` module augmentation 本地止血，长期仍需向上游提交补全 PR。

---

## 八、派生 ADR（草案 · 待立项）

> 以下条目由本调研推导。**草案不预占 `docs/adr/` 编号**（预占易与实际落地顺序冲突）——立项时按铁律取 `docs/adr/` 当前最大号 +1。
>
> **落地进度**：
> - ✅ **描边渲染** + **Composite 动画类型收敛** 已合并落地为 **ADR-098（批次一）**，见 `docs/adr/adr-098-babylon-mmd-api-adoption-batch1.md`。
> - ✅ **MPR 多线程物理** 已落地为 **ADR-099**，见 `docs/adr/adr-099-mpr-coop-coep-poc.md`。
> - ✅ **StreamAudioPlayer 接入** 已落地为 **ADR-107**，见 `docs/adr/adr-107-stream-audio-player.md`。
> - 🟡 **AnimationRetargeter 接入** 已部分落地为 **ADR-108**，见 `docs/adr/adr-108-animation-retargeter.md`。
> - ✅ **SdefInjector + SdefMesh 接入** 已落地为 **ADR-109**，见 `docs/adr/adr-109-sdef-injector.md`。
> - ⏳ **IMmdModel 接口上游 PR** 已立项为 **ADR-110**，见 `docs/adr/adr-110-immdmodel-upstream-pr.md`。

---

# ✅ 多线程 WASM 物理实例迁移（MmdWasmInstanceTypeMPR）— 已落地

> **状态**: ✅ 已落地 — 见 `docs/adr/adr-099-mpr-coop-coep-poc.md`
> **日期**: 2026-07-08（草案）→ 2026-07-14（落地）
> **来源**: 本调研 §2.1 / §五 P0
> **关联**: Motion Layers、Wails v3 文件服务器机制（memory）

### 背景

当前 `scene.ts` 使用 `MmdWasmInstanceTypeSPR`（单线程物理 Release）。在多核设备上，物理 + IK 求解全部挤在单线程，是渲染卡顿的主要来源之一。babylon-mmd 提供 `MmdWasmInstanceTypeMPR`（多线程物理 Release），**仅需替换一行实例化参数**即可启用多线程物理求解。

可用实例类型矩阵（节选自 §2.1）：

| 类型 | 线程 | 物理 | 调试 |
|------|------|------|------|
| `SPR` ← 当前 | 单线程 | 有 | Release |
| `MPR` | 多线程 | 有 | Release |

### 决策

**迁移到 `MPR`，但默认保留 `SPR` 并通过 feature flag 控制开启。**

原因：MPR 依赖 `SharedArrayBuffer`，要求页面以 `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` 头加载。Wails v3 内置 WebView2 页面由文件服务器（每目录独立端口 + `basenameFallbackFS` 兜底）提供，**是否可注入 COOP/COEP 响应头需 POC 验证**——在验证通过前全量切换存在生产风险。

### 选项

| 选项 | 结论 | 理由 |
|------|------|------|
| A. 全量切 MPR | 拒绝 | WebView2 COOP/COEP 头注入未验证，生产风险高 |
| B. 保留 SPR + flag `VITE_MMD_WASM_MT=1` 默认关，POC 通过后再开 | **选定** | 风险可控，验证后可零成本开启 |
| C. 不迁移 | 拒绝 | 放弃明确的多核性能收益 |

### 后果

- ✅ 多核设备物理 / IK 并行，预期帧耗时下降（需 benchmark；注意 v1.2.0 已用 Rust 2024 + LLVM 22 重编译，性能基线可能变化）
- ⚠️ 新增「WebView2 COOP/COEP 头注入」POC 任务
- 🔗 与 ADR-056 的 JS 帧流合并路径**正交**——MPR 只改物理/IK 线程模型，不影响前端图层混合算法

---

# 向上游补全 IMmdModel 接口以消除类型安全缺口 — 部分落地

> **状态**: 部分落地 — 本地 module augmentation 已止血（`core/types.ts`），上游 PR 待提交
> **日期**: 2026-07-08（草案）→ 2026-07-13（ADR-098 消解 vmd-layers cast）
> **来源**: 本调研 §3.1 / §五 P0
> **关联**: ADR-098（已消解 vmd-layers 的 composite cast）

### 背景

项目通过 `as any` / `as unknown as` 绕过的接口缺口集中在 `IMmdModel`，系统性 cast 共 4 处：

| 位置 | 问题代码 | 根因 |
|------|----------|------|
| `core/types.ts:31-34` | `RuntimeModel = IMmdModel & { setRuntimeAnimation(...); createRuntimeAnimation(...); }` | 接口缺少这两个方法 |
| `vmd-layers.ts:577` | `composite as unknown as IMmdBindableModelAnimation` | `MmdCompositeAnimation` 未声明该接口兼容 |
| `vmd-loader.ts:74` | `(vmdLoader as unknown as { dispose?: () => void }).dispose?.()` | `VmdLoader` 未暴露 `dispose()` |
| `vmd-loader.ts:109` | `(inst.mmdModel as { currentAnimation?: ... }).currentAnimation` | `IMmdModel` 不含 `currentAnimation` |

### 决策

**本地 module augmentation 立即止血 + 向上游提 PR 根治，两者并行。**

1. **即时（A）**：在 `frontend/src/core/types.ts` 通过 TypeScript module augmentation 本地声明合并接口（为 `IMmdModel` 增补 `setRuntimeAnimation` / `createRuntimeAnimation` / `currentAnimation`，为 `MmdCompositeAnimation` 增补 `IMmdBindableModelAnimation` 兼容，为 `VmdLoader` 增补 `dispose()`），消除 4 处 cast。
2. **长期（B）**：向 `noname0310/babylon-mmd` 上游提交 PR 补全接口声明；上游版本发布后移除本地 augmentation。

### 选项

| 选项 | 结论 | 理由 |
|------|------|------|
| A. 仅本地 augmentation | 短期可行 | 零等待，但上游问题未根治 |
| B. 仅提上游 PR | 长期正确 | 时间线不可控，不解决当前痛点 |
| **A + B 并行** | **选定** | augmentation 即时消除 cast，PR 推动上游根治 |

### 后果

- ✅ 消除 4 处 `as any`，类型安全与可维护性提升
- ⚠️ 本地 augmentation 须在 babylon-mmd 升级时同步核查，避免重复声明冲突
- 🔗 `vmd-layers.ts` 的 composite cast 已随 `MmdCompositeRuntimeModelAnimation` 类型增强落地（ADR-098）而消解

---

# 草案：引入 StreamAudioPlayer 替代自建音频管线

> **状态**: 草案 · 待立项（需与 ADR-088 音效系统协调）
> **日期**: 2026-07-08
> **来源**: 本调研 §2.1 StreamAudioPlayer / §五 P1
> **关联**: ADR-088（音效系统，Phase B/C 待开发）、`outfit/audio.ts` 现状

### 背景

项目在 `outfit/audio.ts` 自建音频管线，完全绕开 babylon-mmd 音频系统。babylon-mmd 提供 `StreamAudioPlayer`（`Runtime/Audio/streamAudioPlayer`），集成 `MmdRuntime.setAudioPlayer()`，内置：

- 流式加载（无需完整下载即可播放）
- `AudioElementPool` 复用
- 丰富 Observable：`onPlay` / `onPause` / `onSeek` / `onDurationChanged` / `onLoadError` / `onMuteStateChanged` / `onPlaybackRateChanged`
- 自动播放策略处理（静音先行 → 用户交互后 unmute）

### 决策

**`StreamAudioPlayer` 接管播放 / 音画同步层，保留自建的 Web Audio 节拍检测（`beat-detector.ts`，babylon-mmd 不提供节拍检测）。**

### 选项

| 选项 | 结论 | 理由 |
|------|------|------|
| A. 全量替换自建管线 | 拒绝 | 丢失已验证的节拍检测，耦合重建成本高 |
| **B. StreamAudioPlayer 接管播放/同步，BeatDetector 桥接到其 Observable** | **选定** | 获得原生音画同步 + 保留节拍检测 |
| C. 完全不动 | 拒绝 | 放弃原生音画同步与代码简化 |

### 后果

- ✅ 音画与 MMD Runtime 原生节拍同步，播放控制简化
- ⚠️ 需重新接线 `outfit/audio.ts` → `StreamAudioPlayer`，`BeatDetector` 作为独立节拍分析模块保留
- ✅ `StreamAudioPlayer` 的静音先行策略可消除现有自动播放被浏览器拦截的边界 case

---

# 草案：引入 AnimationRetargeter + HumanoidMmd 扩展动作来源

> **状态**: 草案 · 待立项（P1 优先级，模型广场 ADR-087 关键前置）
> **日期**: 2026-07-08
> **来源**: 本调研 §2.1 AnimationRetargeter / HumanoidMmd / §五 P1
> **关联**: ADR-061（高级骨骼 / Accessory / T-pose，同源骨骼名映射需求）、ADR-087（模型广场）

### 背景

当前项目仅支持 VMD 格式动作。babylon-mmd 提供：

- `AnimationRetargeter`（`Loader/Util/animationRetargeter`）—— 将任意人形动画（Humanoid rig）重定向到 MMD 骨骼，配合 `MmdHumanoidMapper` / `MixamoMmdHumanoidBoneMap` / `VrmMmdHumanoidBoneMap`
- `HumanoidMmd`（`Runtime/Util/humanoidMmd`）—— 让非 MMD 格式人形模型也能被 MMD 动画系统驱动

### 决策

**第一期引入 `AnimationRetargeter` 解锁 Mixamo / VRM / Blender 动作数据导入；`HumanoidMmd` 列为远期可选能力（模型加载改造面更大，单独排期）。**

**关键复用约束**：与 ADR-061 §2.4 / §2.2 所需的「统一骨骼名映射模块（MMD / VRM / 自定义）」**同源**——本 ADR 的 `MixamoMmdHumanoidBoneMap` / `VrmMmdHumanoidBoneMap` 应作为该映射模块的现成基础，**共享而非重复造**。

### 选项

| 选项 | 结论 | 理由 |
|------|------|------|
| **A. 仅 AnimationRetargeter（第一期）** | **选定** | 直接解锁动作来源，收益明确 |
| B. + HumanoidMmd 同时引入 | 远期 | 模型加载/材质代理改造面大，不阻塞本期 |
| C. 不动 | 拒绝 | 错过 Mixamo/VRM 海量动作生态 |

### 后果

- ✅ 动作数据来源从纯 VMD 扩展到 Mixamo / VRM / Blender
- ⚠️ 需新增导入路径 + 重定向 UI（骨骼映射选择）
- 🔗 与 ADR-061 共享骨骼名映射模块，避免重复建设
- ⚠️ `HumanoidMmd` 涉及加载器 / 材质代理改造，列为远期，不阻塞本期

---

# 引入 MmdOutlineRenderer 描边渲染 ✅ 已落地（ADR-098 批次一）

> **状态**: ✅ 已落地 — 见 `docs/adr/adr-098-babylon-mmd-api-adoption-batch1.md`
> **日期**: 2026-07-08（立项）→ 2026-07-13（落地）
> **来源**: 本调研 §2.1 MmdOutlineRenderer / §五 P2
> **关联**: 渲染管线 / `renderer.ts`

### 背景

babylon-mmd 提供 `MmdOutlineRenderer`（`Loader/mmdOutlineRenderer`），MMD 原生描边风格。v1.2.0 已适配 Babylon.js 9.2.0 skinning shader 变更，支持：

- WebGPU WGSL 着色器
- `ALPHA_TEST` 材质
- `MirrorTexture` 镜像反射
- Baked vertex animation
- `zOffset` / `zOffsetUnits` 解决 z-fighting

当前项目无原生描边。

### 决策

**作为 side-effect import 注册 `MmdOutlineRenderer`，为 MMD 模型启用描边。**

### 选项

| 选项 | 结论 | 理由 |
|------|------|------|
| **A. side-effect 注册** | **选定** | 最小侵入，仅注册无需改渲染管线 |
| B. 自建后处理描边 | 拒绝 | 重复 babylon-mmd 已解决的 skinning 适配问题 |
| C. 不动 | 接受（低优先级） | 无描边，MMD 视觉风格不完整 |

### 后果

- ✅ 获得 MMD 原生描边效果（眼睛 / 轮廓线）
- ✅ side-effect 注册，零渲染管线改动
- ⚠️ 需验证 WebGPU + 当前材质代理（`MmdStandardMaterialProxy`）下的描边表现，必要时调 `zOffset`

---

# 引入 MmdCompositeRuntimeModelAnimation 简化 JS 动画混合 ✅ 已落地（ADR-098 批次一）

> **状态**: ✅ 已落地 — 见 `docs/adr/adr-098-babylon-mmd-api-adoption-batch1.md`
> **日期**: 2026-07-08（立项）→ 2026-07-13（落地）
> **来源**: 本调研 §2.1 MmdCompositeRuntimeModelAnimation / §五 P2
> **关联**: Motion Layers、IMmdModel 类型缺口消解

### 背景

JS 运行时的动画混合目前手动操作 `MmdCompositeAnimation`（`vmd-layers.ts`）。babylon-mmd 提供 `MmdCompositeRuntimeModelAnimation`（`Runtime/Animation/mmdCompositeRuntimeModelAnimation`）作为 JS 运行时动画混合容器，比手动操作 `MmdCompositeAnimation` 更安全（内建类型与生命周期管理）。

### 决策

**在 JS 运行时路径下，用 `MmdCompositeRuntimeModelAnimation` 替换手动 `MmdCompositeAnimation` 操作。WASM 路径维持 ADR-056 的 JS 帧流合并（不受影响）。**

**副作用**：本 ADR 落地后，§3.1 中 `vmd-layers.ts:577` 的 `composite as unknown as IMmdBindableModelAnimation` cast 可能自然消解（该类已正确声明接口）。

### 选项

| 选项 | 结论 | 理由 |
|------|------|------|
| **A. JS 路径替换** | **选定** | 类型安全收益，且与 ADR-056 正交 |
| B. 不动 | 拒绝 | 保留不安全的手动混合 |

### 与 ADR-056 的关系

ADR-056 解决 **WASM 下**多图层（前端 JS 帧流合并），本 ADR 改善 **JS 运行时**原生混合容器，两者互补不冲突。

### 后果

- ✅ JS 运行时动画混合获得内建类型 / 生命周期管理
- 🔗 可能消解 §3.1 的一处 cast（`vmd-layers.ts:577`）
- ℹ️ 仅影响 JS 运行时路径（默认 WASM），故为渐进改善，无回退风险

---

> **草案小结**：
> - ✅ **描边渲染** + **Composite 动画类型收敛** 已合并落地为 **ADR-098（批次一）**，见 `docs/adr/adr-098-babylon-mmd-api-adoption-batch1.md`。
> - ✅ **MPR 多线程物理** 已落地为 **ADR-099**，见 `docs/adr/adr-099-mpr-coop-coep-poc.md`。
> - ✅ **StreamAudioPlayer 接入** 已落地为 **ADR-107**，见 `docs/adr/adr-107-stream-audio-player.md`。
> - 🟡 **AnimationRetargeter 接入** 已部分落地为 **ADR-108**，见 `docs/adr/adr-108-animation-retargeter.md`。
> - ✅ **SdefInjector + SdefMesh 接入** 已落地为 **ADR-109**，见 `docs/adr/adr-109-sdef-injector.md`。
> - ⏳ **IMmdModel 接口上游 PR** 已立项为 **ADR-110**，见 `docs/adr/adr-110-immdmodel-upstream-pr.md`。
