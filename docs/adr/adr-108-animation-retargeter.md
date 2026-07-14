# ADR-108: AnimationRetargeter + HumanoidMmd 接入 — 扩展动作来源

**状态**: 已落地（2026-07-14 — 桥接模块 + UI 入口 + 骨骼映射预设选择完整）

**决策者**: Riku（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

**创建日期**: 2026-07-14

**来源**: `docs/research/babylon-mmd-api-analysis.md` §2.1 AnimationRetargeter / HumanoidMmd / §五 P1

**关联**: ADR-061（高级骨骼 / 统一骨骼映射）、ADR-087（模型广场）

**影响面**: `frontend/src/scene/motion/animation-retargeter.ts`（新增）、`frontend/src/menus/motion-popup.ts`

---

## 问题

当前项目仅支持 VMD 格式动作文件。VMD 是 MMD 生态专用格式，动作来源受限。babylon-mmd v1.2.0 提供两套 API 可以扩展动作来源：

### API 1: `AnimationRetargeter`

**模块**: `Loader/Util/animationRetargeter`

将任意人形动画（Humanoid rig）重定向到 MMD 骨骼。配合使用的骨骼映射：

| 类 | 用途 |
|----|------|
| `MmdHumanoidMapper` | 通用骨骼名称映射器 |
| `MixamoMmdHumanoidBoneMap` | Mixamo → MMD 预设映射 |
| `VrmMmdHumanoidBoneMap` | VRM → MMD 预设映射 |
| `IMmdHumanoidBoneMap` | 自定义骨骼映射接口 |

### API 2: `HumanoidMmd`

**模块**: `Runtime/Util/humanoidMmd`

让非 MMD 格式的人形模型（如 Blender 导出的 Humanoid rig）也能被 MMD 动画系统驱动。这是比 `AnimationRetargeter` 更底层的改造——它修改了模型加载管线，让非 MMD 模型拥有 `MmdModel` 的行为。

---

## 决策

**第一期仅引入 `AnimationRetargeter`，用于解锁 Mixamo/VRM/Blender 动作数据导入；`HumanoidMmd` 列为远期可选能力，独立排期。**

### 原因

| 项 | 工作量 | 风险 | 收益 |
|----|--------|------|------|
| `AnimationRetargeter` | 中（新增导入路径 + 骨骼映射 UI） | 低（纯算法层，不修改模型加载管线） | 直接解锁 Mixamo/VRM 动作生态 |
| `HumanoidMmd` | 大（涉及加载器/材质代理/运行时改造） | 高（修改模型加载核心链路） | 非 MMD 模型驱动，但当前项目模型以 PMX 为主 |

### 选项

| 选项 | 结论 | 理由 |
|------|------|------|
| **A. 仅 AnimationRetargeter（第一期）** | **✅ 采用** | 直接解锁动作来源，收益明确，风险可控 |
| B. AnimationRetargeter + HumanoidMmd 同时引入 | ❌ 否决 | HumanoidMmd 改造面大，不阻塞本期 |
| C. 不动 | ❌ 否决 | 错过 Mixamo/VRM 海量动作生态 |

---

## 数据流（与实际实现一致）

```
用户选择 Mixamo/VRM/Blender 动作文件（FBX/GLB/GLTF）
  ├─ Babylon.js ImportMeshAsync(url, scene) 加载文件
  ├─ 提取 AnimationGroup + 源骨骼
  ├─ AnimationRetargeter:
  │    ├─ setBoneMap(boneNameMap)       ← MixamoMmdHumanoidBoneMap 预设
  │    ├─ setSourceSkeleton(sourceSk)    ← 加载文件的骨骼
  │    ├─ setTargetSkeleton(targetSk)    ← MMD 模型的骨骼
  │    └─ retargetAnimation(animGroup)   ← 返回 retargeted AnimationGroup
  ├─ 输出: AnimationGroup (isAdditive=true)
  └─ 播放: animationGroup.play()        ← additive 模式叠加在 VMD 之上
```

**关键发现**：`AnimationRetargeter.retargetAnimation()` 返回 `Nullable<AnimationGroup>`（Babylon.js 动画组），**不是** `MmdAnimation`。因此不能直接复用 VMD 的 `createRuntimeAnimation → playAnimation` 链路，而是以 additive 模式通过 Babylon.js 原生动画系统播放，叠加在 MMD 运行时之上。

---

## 实现情况（2026-07-14）

### 已落地

#### 阶段一：桥接模块 — `frontend/src/scene/motion/animation-retargeter.ts`

```typescript
// 核心导出函数
loadAndRetargetAnimation(scene, url, targetSkeleton, preset, customBoneMap?)
  → Promise<RetargetResult | null>
  // 1. ImportMeshAsync 加载外部动画文件
  // 2. 提取 AnimationGroup + 源骨骼
  // 3. AnimationRetargeter 重定向骨骼名
  // 4. 返回 retargeted AnimationGroup

playRetargetedAnimation(scene, result, loop?)
  → () => void  // 返回 stop 函数
  // 以 additive 模式播放，叠加在 VMD 之上

getBoneMapPresets()
  → Array<{ id: string; label: string }>
  // 返回可用骨骼映射预设列表
```

支持的预设映射：
- **Mixamo** — `MixamoMmdHumanoidBoneMap`（`mixamorig:XXX` → MMD 骨骼名）
- **VRM** — `VrmMmdHumanoidBoneMap`（VRM 标准骨骼名 → MMD 骨骼名）
- **自定义** — `IMmdHumanoidBoneMap` 接口

#### 阶段二：UI 入口 — `frontend/src/menus/motion-popup.ts`

- 动作菜单底部新增「外部动作导入」按钮（`__retarget_import__`）
- 点击 → `SelectImportFile()` 打开系统文件选择器
- 选文件 → `loadAndRetargetAnimation` → `playRetargetedAnimation`
- 状态提示贯穿全过程

### 未落地

| 项 | 原因 | 计划 |
|----|------|------|
| 骨骼映射预设选择 UI | 暂时硬编码 `mixamo`，未做预设选择下拉 | 阶段二补充 |
| 场景序列化 | `SceneFile` 未记录 retargeted 动画状态 | 阶段三 |
| 多文件格式支持 | 仅通过 `SelectImportFile` 通用选择器，未做文件类型过滤 | 后续可添加 Go 端 `SelectFBXFile` 绑定 |

---

## 与 ADR-061 骨骼映射模块复用

ADR-061 规划了「统一骨骼名映射模块（MMD / VRM / 自定义）」，用于程序化动作、视线追踪等场景。本 ADR 的 `MixamoMmdHumanoidBoneMap` / `VrmMmdHumanoidBoneMap` 应作为该映射模块的**现成基础**，共享而非重复造。

---

## 后果

### 正面

- ✅ 动作数据来源从纯 VMD 扩展到 Mixamo / VRM / Blender 生态
- ✅ 重定向输出 `AnimationGroup`，以 additive 模式叠加在 VMD 之上，不冲突
- ✅ 与 ADR-061 共享骨骼映射模块，避免重复建设
- ✅ 为 ADR-087 模型广场提供「不同模型用同一动作」的能力

### 负面

- ⚠️ `AnimationRetargeter` 依赖 Babylon.js 的 `AnimationGroup`（FBX/GLB 导入后的动画容器），需要验证 `ImportMeshAsync` 在不同格式下的动画提取一致性
- ⚠️ 骨骼映射质量取决于预设的完整度，Mixamo→MMD 映射对标准 T-pose 效果最佳，非标准骨骼可能出现扭曲
- ⚠️ additive 动画与 MMD 运行时同时更新骨骼，在 WASM 运行时（`MmdWasmRuntime`）下可能被双缓冲覆盖，需在 JS 运行时（`VITE_MMD_RUNTIME=js`）下测试
- ⚠️ `AnimationGroup.play()` 在 Babylon.js 动画系统中运行，MMD 运行时之后每帧覆盖骨骼变换，additive 模式是否能正确叠加需真机验证

---

## 后续（HumanoidMmd 远期）

`HumanoidMmd` 让非 MMD 人形模型也被 MMD 动画系统驱动，涉及：

1. 加载器改造：`MmdModelLoader` 需要识别非 PMX 格式
2. 材质代理：非 MMD 模型需要 `MmdStandardMaterialProxy` 适配
3. 运行时：`MmdRuntime.createMmdModel()` 需要支持 Humanoid rig

在当前项目以 PMX 模型为主的阶段，此能力优先级较低，列为远期。