# ADR-108: AnimationRetargeter + HumanoidMmd 接入 — 扩展动作来源

**状态**: 部分落地（2026-07-14 — 桥接模块 + UI 入口已实现，骨骼映射选择 UI 待完善）

**决策者**: Riku（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

**创建日期**: 2026-07-14

**来源**: `docs/research/babylon-mmd-api-analysis.md` §2.1 AnimationRetargeter / HumanoidMmd / §五 P1

**关联**: ADR-061（高级骨骼 / 统一骨骼映射）、ADR-087（模型广场）、ADR-056（WASM 运行时动画）

**影响面**: `frontend/src/scene/motion/`（新增模块）、`frontend/src/scene/motion/proc-motion-bridge.ts`、`frontend/src/scene/manager/model-loader.ts`、`frontend/src/menus/motion-popup.ts`

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

### 现状

| 文件 | 相关代码 | 说明 |
|------|----------|------|
| `scene/env/accessory.ts:53` | `logWarn('accessory', 'bone has no linkedBone (HumanoidMmd path untested):', boneName)` | 有一处注释提及 HumanoidMmd 路径未测试 |
| `scene/motion/proc-motion-bridge.ts` | 多处 `(bone as any).updateWorldMatrix === undefined` | 鸭子类型检查区分 WASM/JS 骨骼，已暗示骨骼类型多样性 |

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

## 约束

### 与 ADR-061 骨骼映射模块复用

ADR-061 规划了「统一骨骼名映射模块（MMD / VRM / 自定义）」，用于程序化动作、视线追踪等场景。本 ADR 的 `MixamoMmdHumanoidBoneMap` / `VrmMmdHumanoidBoneMap` 应作为该映射模块的**现成基础**，共享而非重复造。

具体复用边界：

| 场景 | 映射来源 | 说明 |
|------|----------|------|
| AnimationRetargeter | `MixamoMmdHumanoidBoneMap` / `VrmMmdHumanoidBoneMap` | 动作重定向 → 使用 babylon-mmd 预设 |
| ADR-061 程序化动作 | `IMmdHumanoidBoneMap` 自定义 | 用户自定义骨骼映射 |
| 视线追踪 | `IMmdHumanoidBoneMap` 子集（头部/眼球） | 只取头部/眼球骨骼映射 |

### 动作导入流程

```
用户选择 Mixamo/VRM/Blender 动作文件（FBX/GLB/GLTF）
  ├─ Babylon.js ImportMeshAsync 加载动作
  ├─ AnimationRetargeter.retarget(animation, boneMap) → MmdAnimation
  └─ 现有 VMD 加载链路复用：createRuntimeAnimation → playAnimation
```

关键：重定向结果是一个 `MmdAnimation`，与 VMD 加载后的数据结构一致，之后全链路复用现有播放/混合/序列化代码。

---

## 实现计划

### 阶段一：模块导入 + 骨骼映射注册（预估 1 天）

```
新增: frontend/src/scene/motion/animation-retargeter.ts
├── import { AnimationRetargeter } from 'babylon-mmd/esm/Loader/Util/animationRetargeter'
├── import { MixamoMmdHumanoidBoneMap } from 'babylon-mmd/esm/Loader/Util/animationRetargeter'
├── import { VrmMmdHumanoidBoneMap } from 'babylon-mmd/esm/Loader/Util/animationRetargeter'
├── import { MmdHumanoidMapper } from 'babylon-mmd/esm/Loader/Util/animationRetargeter'
├── import type { IMmdHumanoidBoneMap } from 'babylon-mmd/esm/Loader/Util/animationRetargeter'
├── export function retargetAnimation(animation, boneMapName): Promise<MmdAnimation>
├── export function getBoneMapPresets(): string[]  // 返回可用预设列表
└── export function setCustomBoneMap(map: IMmdHumanoidBoneMap): void
```

### 阶段二：UI 接入（预估 1 天）

```
menus/motion-popup.ts
├── 动作加载菜单新增「导入外部动作」按钮
├── 弹出文件选择器（FBX/GLB/GLTF）
├── 选择骨骼映射预设（Mixamo / VRM / 自定义）
├── 调用 retargetAnimation()
└── 将结果注入现有 VMD 播放链路
```

### 阶段三：场景序列化（预估 0.5 天）

```
SceneFile 新增:
  models[].retargetedAnimation?: {
    sourcePath: string;       // 原始动作文件路径
    boneMapName: string;      // 骨骼映射预设名
    libraryRef: string;       // 跨机器解析
  }
```

---

## 后果

### 正面

- ✅ 动作数据来源从纯 VMD 扩展到 Mixamo / VRM / Blender 生态
- ✅ 重定向输出 `MmdAnimation`，现有播放/混合/序列化链路零改动
- ✅ 与 ADR-061 共享骨骼映射模块，避免重复建设
- ✅ 为 ADR-087 模型广场提供「不同模型用同一动作」的能力

### 负面

- ⚠️ `AnimationRetargeter` 依赖 Babylon.js 的 `AnimationGroup`（FBX/GLB 导入后的动画容器），需要验证 `ImportMeshAsync` 在不同格式下的动画提取一致性
- ⚠️ 骨骼映射质量取决于预设的完整度，Mixamo→MMD 映射对标准 T-pose 效果最佳，非标准骨骼可能出现扭曲
- ⚠️ 用户需要自己准备 Mixamo 动作文件（FBX with skin），项目不提供下载服务

### 未知

- `AnimationRetargeter` 在 WASM 运行时（`MmdWasmRuntime`）下的表现是否与 JS 运行时一致？需要测试。
- 重定向后的 `MmdAnimation` 是否可以参与 `MmdCompositeAnimation` 混合？理论可行，需要验证。

---

## 后续（HumanoidMmd 远期）

`HumanoidMmd` 让非 MMD 人形模型也被 MMD 动画系统驱动，涉及：

1. 加载器改造：`MmdModelLoader` 需要识别非 PMX 格式
2. 材质代理：非 MMD 模型需要 `MmdStandardMaterialProxy` 适配
3. 运行时：`MmdRuntime.createMmdModel()` 需要支持 Humanoid rig

在当前项目以 PMX 模型为主的阶段，此能力优先级较低，列为远期。