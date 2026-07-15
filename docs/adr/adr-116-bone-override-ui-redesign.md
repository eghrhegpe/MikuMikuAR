# ADR-116: 动作覆盖系统 — 模块化架构 + 骨骼覆盖下沉

> **状态**: 规划
> **背景**: 用户反馈骨骼覆盖面板「太难用了」：100+ 骨骼塞在一个下拉框里，调完还要点「Apply」才生效；即便优化选骨效率，本质仍是「用户直接操作骨骼 + 欧拉角」。竞品（VRChat Motion Override）采用**动作覆盖**范式——按功能/行为分模块，每个模块有独立开关 + 专属语义参数，用户 90% 操作不需接触骨骼名。本 ADR 将 ADR-116 初稿（纯 UI 优化）升级为**架构级双层重构**：L1 模块化动作覆盖（默认入口）+ L2 骨骼覆盖（下沉为高级子页）。
> **范围**: 新增 `motion/motion-modules/` 模块层（schema 驱动，复用引擎），重写 `motion-override-levels.ts` 为模块列表 + 子页路由，`bone-override.ts` 仅新增 `getOverride` 一个读函数。**引擎核心（`onBeforeRenderObservable` 写入逻辑）完全不动。**

---

## 一、范式转变：Bone Override → Motion Override

| 维度 | 原方案（Bone Override） | 新方案（Motion Override） |
|------|------------------------|---------------------------|
| 抽象层 | 选骨骼 → 调 Pitch/Yaw/Roll/Weight | 选**功能模块** → 调**语义参数**（倾斜/弯曲/对称…） |
| 开关 | 无总开关；靠是否有覆盖值判断 | `已启用`总开关 + **每模块独立开关** |
| 参数语义 | 通用欧拉角（需懂 XYZ 轴） | 功能专用，UI 自动从 `ParamSpec` 生成 |
| 组织逻辑 | 按解剖部位（頭/腰/手/足） | 按行为（身体/头部追踪/手对称/摇摆/骑行） |
| 用户心智 | "我要转哪根骨" | "我要什么效果" |
| 引擎关系 | 直接写 `_overrideMap` | 模块内部**烘焙**成 `_overrideMap`，引擎无感知 |

**核心不变量**：模块层不触碰引擎，只是把「语义参数 → `BoneOverrideEntry[]`」的转换器 + 持久化壳。引擎 `setBoneOverride/restoreOverrides` 仍是唯一写入通道。

---

## 二、模块层接口（schema 驱动）

> 设计原则：用**声明式 `ParamSpec`** 描述模块参数，UI 自动渲染滑块/开关，避免为每个模块手写 UI（符合「显著重复 → 抽象」工程纪律）。

```ts
// motion/motion-modules/types.ts
export type ParamValue = number | boolean;
export type ParamSpec =
  | { kind: 'slider'; key: string; labelKey: string; min: number; max: number; step: number; default: number }
  | { kind: 'toggle'; key: string; labelKey: string; default: boolean }
  | { kind: 'submenu'; key: string; labelKey: string; target: string }; // 跳转子页

export interface MotionModuleState {
  id: string;
  enabled: boolean;
  params: Record<string, ParamValue>;
}

export interface MotionOverrideModule {
  readonly id: string;
  readonly meta: { labelKey: string; icon?: string; advanced?: boolean };
  readonly schema: ParamSpec[];
  /** 读取当前语义参数（含默认值兜底） */
  getState(): MotionModuleState;
  /** 整体恢复（反序列化用） */
  setState(s: MotionModuleState): void;
  /** 单参数变更：重新烘焙到引擎 + 写回 state */
  setParam(name: string, value: ParamValue): void;
  enable(): void;
  disable(): void;
}
```

**烘焙约定**：`setParam` 内部执行 `disableBake()→逐参数 setBoneOverride(骨, euler, weight)→enableBake()`。`disable()` 调 `clearAllOverrides()` 仅清本模块贡献的骨（模块记录自身占用的 `boneName[]`，释放时精确 `clearBoneOverride`）。

---

## 三、内置模块规格

| 模块 | ID | 语义参数（`schema`） | 内部映射骨骼 | 优先级 |
|------|-----|---------------------|-------------|--------|
| 身体姿态 | `body-posture` | 倾斜/弯曲/扭曲/头部偏移/高度/前后/距离(checkbox)/检测范围/最小距离/最大距离 | センター+上半身+下半身+腰+首 | **P1 必做** |
| 手对称 | `hand-symmetry` | 启用(开关)/镜像偏移/编辑模式 | 左手×5 ↔ 右手×5 镜像复制 | **P1 必做** |
| 头部追踪 | `head-tracking` | 目标角色(子页)/更新范围/最小距/最大距/权重 | 首+頭 | **P2** |
| 摇摆运动 | `sway-motion` | 幅度/频率/衰减 | 全身根骨骼（正弦驱动） | **P3** |
| 手指姿势 | `finger-pose` | 预设选择器（≡） | 左右手 10×3 指骨 | **P3** |
| 骑行模型 | `riding-model` | 预设(≡)/鞍高/踏板角 | 腰+腿IK+足 | **P3** |

**示例烘焙（身体姿态/倾斜）**：
```ts
// tilt∈[-15,15] → 旋转上半身根骨
setBoneOverride('上半身', [tilt, 0, 0], 1, true);
// bend → 腰骨；twist → 上半身2；height → センター.position.y（走单独通道）
```

**手对称烘焙**：左手设 `L:[p,y,r]` → 右手自动 `R:[-p, y, -r]`（镜像）+ 可配置偏移量，避免用户左右各调一遍。

---

## 四、骨骼覆盖下沉（保留 ADR-116 初稿优化）

原 ADR-116 的 UI 改进点**不废弃**，降级为「高级骨骼覆盖」子页，作为 power user 精细通道：

| 原优化点 | 处置 |
|---------|------|
| 分类预设按钮（頭/腰/手/足 + 詳細▾） | 保留为高级子页入口 |
| 实时滑块（去 Apply） | 保留，`_createSlider` 增 `onChange` 参数 |
| 已设覆盖可编辑（点击回填） | 保留，列表项加 `編集` 按钮 |
| `getOverride(boneName)` 新增 | 保留（`bone-override.ts` 仅此一处新增） |

高级子页与模块层**共享 `_overrideMap`**：模块禁用时精确 `clearBoneOverride` 自己占用的骨，不误伤用户手动设的骨（模块记录 `ownedBones: string[]`）。

---

## 五、持久化扩展

现有链路 `inst.boneOverrides: BoneOverrideEntry[]` → 序列化 → `restoreOverrides` 保留不动。新增并行字段：

```ts
// model-instance 类型扩展
inst.motionOverrideModules: MotionModuleState[]; // 模块语义状态（非骨骼级）
```

`scene-serialize.ts` 增加该字段的序列化/反序列化；加载时 `setState` 重烘焙到引擎。模块级状态与骨骼级覆盖解耦，互不覆盖。

---

## 六、实施分期

| 阶段 | 文件 | 操作 | 验收 |
|------|------|------|------|
| **P0** | `motion/motion-modules/types.ts` | 定义 `ParamSpec`/`MotionOverrideModule`/`MotionModuleState` | tsc 通过 |
| **P0** | `motion/motion-modules/registry.ts` | 模块注册表 + 工厂（`createModule(id, state)`） | 单测：注册/注销 |
| **P0** | `motion-override-levels.ts` | 重写为：总开关 + 模块列表（开关+▸）+ 子页路由框架 | 列表渲染、开关切换即时生效 |
| **P1** | `motion/motion-modules/body-posture.ts` | 身体姿态模块（6 滑块+距离） | 实时调参，3D 可见 |
| **P1** | `motion/motion-modules/hand-symmetry.ts` | 手对称模块（镜像+偏移） | 左手调→右手联动 |
| **P1** | `bone-override.ts` | 新增 `getOverride(boneName)` | 回填用 |
| **P2** | `head-tracking.ts` + 下沉 | 头部追踪模块 + 高级骨骼覆盖子页落地 | 子页路由+烘焙 |
| **P2** | `scene-serialize.ts` | `motionOverrideModules` 持久化 | 重载恢复 |
| **P3** | `sway-motion.ts` / `finger-pose.ts` / `riding-model.ts` | 三个附加模块 | 各自烘焙正确 |

---

## 七、风险与缓解

| 风险 | 概率 | 缓解 |
|------|------|------|
| 模块烘焙与用户手动骨骼覆盖冲突（同骨被双方写） | 中 | 模块记录 `ownedBones`，禁用/重写时只清自有骨；UI 对「已被模块占用的骨」在高级子页置灰提示 |
| 语义参数→多骨映射在某些 PMX 模型缺失（如无 `上半身2`） | 中 | 候选骨按优先级匹配，缺失则跳过该分量，不报错 |
| 模块层高频 `setBoneOverride` 性能 | 低 | 复用引擎 `_overrideMap`（O(1)），每帧只读一次，与现状等价 |
| 持久化字段膨胀（每个模块存全量 params） | 低 | 仅存 `enabled + params` 差异值，默认值不落盘 |

---

## 八、不变的部分

| 模块 | 不动原因 |
|------|---------|
| `bone-override.ts` 核心：`startBoneOverride`/`stopBoneOverride`/每帧 `onBeforeRenderObservable` 写入 | 引擎正确，模块层只是更聪明的调用方 |
| `setBoneOverride`/`setBoneOverrideQuat`/`clearBoneOverride`/`clearAllOverrides`/`restoreOverrides`/`getAllOverrides` | API 兼容，模块层与高级子页共用 |
| `model-manager.ts` 骨骼叠加层（LineSystem+Joints） | 读位置缓冲，不受旋转覆盖影响 |
| `_createSlider` 现有逻辑 | 仅增 `onChange` 参数，高级子页复用 |

---

## 九、i18n 新增 key

**模块层（中/日/英/韩）**：

| Key | zh | ja | en |
|-----|----|----|----|
| `motion.override.title` | 动作覆盖 | 動作オーバーライド | Motion Override |
| `motion.override.enabled` | 已启用 | 有効 | Enabled |
| `motion.override.module.bodyPosture` | 身体姿态 | 身体ポーズ | Body Posture |
| `motion.override.module.headTracking` | 头部追踪 | 頭部トラッキング | Head Tracking |
| `motion.override.module.handSymmetry` | 手对称 | 手対称 | Hand Symmetry |
| `motion.override.module.swayMotion` | 摇摆运动 | 揺れ運動 | Sway Motion |
| `motion.override.module.fingerPose` | 手指姿势 | 指ポーズ | Finger Pose |
| `motion.override.module.ridingModel` | 骑行模型 | 乗馬モデル | Riding Model |
| `motion.override.advancedBone` | 高级骨骼覆盖 | 詳細骨オーバーライド | Advanced Bone Override |

**身体姿态参数（节选）**：`param.tilt`(倾斜/Tilt)、`param.bend`(弯曲/Bend)、`param.twist`(扭曲/Twist)、`param.headOffset`(头部/Head)、`param.height`(高度/Height)、`param.fwdBack`(前后/Fwd-Back)、`param.distance`(距离/Distance)、`param.detectRange`(检测范围/Detect)、`param.minDist`(最小距离/Min)、`param.maxDist`(最大距离/Max)。

---

## 十、后续迭代方向

- **3D gizmo 直接拖拽模块效果**（如拖身体倾斜）：需 `BoneGizmo` 组件，把拖拽量反解成语义参数。
- **多模块协同预设**：「坐姿包」一键启身体姿态+骑行模型。
- **撤销/重做**：模块层 `setParam` 入历史栈。
