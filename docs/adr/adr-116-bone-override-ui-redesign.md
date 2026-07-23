# ADR-116: 动作覆盖系统 — 模块化架构 + 骨骼覆盖下沉

> **状态**: 已完成（P0+P1+P2+P3 全部实施并通过验证：tsc + 1557 单测 + ESLint）。2026-07-17 补充：`_computeOverride` `weight≥1` 语义修正为复合父骨传播旋转，详见 §十一。基础层与 Phase 2 打磨均已交付（冲突提示用户语言化、骨骼搜索框、applyOverride 统一函数，见 §十·一，2026-07-23）。
> **背景**: 用户反馈骨骼覆盖面板「太难用了」：100+ 骨骼塞在一个下拉框里，调完还要点「Apply」才生效；即便优化选骨效率，本质仍是「用户直接操作骨骼 + 欧拉角」。竞品（VRChat Motion Override）采用**动作覆盖**范式——按功能/行为分模块，每个模块有独立开关 + 专属语义参数，用户 90% 操作不需接触骨骼名。本 ADR 将 ADR-116 初稿（纯 UI 优化）升级为**架构级双层重构**：L1 模块化动作覆盖（默认入口）+ L2 骨骼覆盖（下沉为高级子页）。
> **范围**: 新增 `motion/motion-modules/` 模块层（复用 ADR-093 `MenuNode` schema），重写 `menus/motion-override-levels.ts` 为模块列表 + 子页路由，`scene/motion/bone-override.ts` 核心引擎扩展（position 覆盖 + `_computeOverride` 复合 + `_mPool` 复用池）。

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

### 动作管线顺序（模块层定位）

模块层是整个动作管线中的第四层，需明确各层执行顺序与覆盖关系：

```
① VMD 基础动画
   ↓
② VMD 图层叠加（vmd-layers.ts，加权混合）
   ↓
③ 程序化动作（proc-motion-bridge.ts，idle/autodance/lifelike 微晃兜底）
   ↓
④ Ragdoll 物理回写（XPBD，非 head 骨骼 blendWeight Slerp 混合）
   ↓
⑤ Bone Override — 模块层（本 ADR，烘焙为 _overrideMap）
   ↓
⑥ Perception 层（scene/motion/perception.ts，呼吸/眨眼/头部跟随/眼部跟随/微表情，always-on）
```

**关键约定**：
- ⑤ 在 ⑥ 之前注册 `onBeforeRenderObservable`（perception 晚注册 = 最终覆写）
- 模块层与 perception 层的职责边界：模块层负责**用户主动设定的强交互姿态**（如身体倾斜、手对称），perception 负责**自动化的微动叠加**（呼吸、眨眼、视线跟随）
- 模块层不写 `首/頭/head` 骨骼的 rotationQuaternion，由 perception 层通过 gaze/blink 覆写（与 ragdoll 共存策略一致）
- 若将来头部追踪模块需写 head 骨骼，应走 perception 层通道（gaze 覆写方式），不走 bone override

---

## 二、模块层接口（复用 ADR-093 MenuNode schema）

> 设计原则：**复用现有 `MenuNode` / `ControlSpec` 声明式 schema 系统**（ADR-093），而非另建 `ParamSpec`。模块参数直接用 `MenuNode[]` 描述，UI 交给 `renderMenu` 渲染，避免两套 schema 并行导致的样式/交互不一致和渲染逻辑重复。
>
> 现有 `StatePath` 前缀体系扩展：新增 `motionModule.` 前缀，格式为 `motionModule.${moduleId}.${paramKey}`，由 `getStateValue/setStateValue` 路由到模块层状态。

```ts
// menus/menu-schema.ts 扩展
export type StatePath =
  | `env.${string}`
  | `render.${string}`
  | `light.${string}`
  | `ui.${string}`
  | `perception.${string}`
  | `motionModule.${string}`; // ← 新增

// motion/motion-modules/types.ts
export type ParamValue = number | boolean;

export interface MotionModuleState {
  id: string;
  enabled: boolean;
  params: Record<string, ParamValue>;
}

export interface MotionOverrideModule {
  readonly id: string;
  readonly meta: { labelKey: string; icon?: string; advanced?: boolean };
  /** 返回该模块的 MenuNode[] schema，由 renderMenu 自动渲染 UI */
  buildSchema(): MenuNode[];
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

### per-model 作用域

模块状态是 **per-model** 的，挂在 `ModelInstance.motionOverrideModules` 下。`scene/motion/bone-override.ts` 的 `_overrideMap` 虽然是全局单例，但模块层通过 `setTargetModel(modelId)` 管理作用域：

- 切换聚焦模型时，UI 层调用 `setTargetModel(newModelId)`，模块层先 `disable()` 当前模型的所有模块（清 `_overrideMap`），再 `enable()` 新模型已保存的模块状态
- `ModelInstance.motionOverrideModules: MotionModuleState[]` 是唯一持久化来源
- 模块实例本身是无状态的转换器（`buildSchema/getState/setState` 接受 `modelId` 参数），状态全部存在 `ModelInstance` 上

```ts
// model-instance 类型扩展（core/types.ts）
export type ModelInstance = {
  // ...existing fields...
  /** [doc:adr-116] 动作覆盖模块语义状态（per-model） */
  motionOverrideModules?: MotionModuleState[];
};
```

**烘焙约定**：`setParam` 内部执行 `disableBake()→逐参数 setBoneOverride(骨, euler, weight)→enableBake()`。`disable()` 调 `clearBoneOverride` 仅清本模块贡献的骨（模块记录自身占用的 `ownedBones: string[]`，释放时精确清除，不误伤其他模块或用户手动设的骨）。

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
// bend → 腰骨；twist → 上半身2
```

**位置覆盖（position override）— 引擎扩展说明**：

`height`（センター.position.y）和 `fwdBack`（前后位移）需要**位置覆盖**，但当前 `scene/motion/bone-override.ts` 引擎只覆盖 **rotation**（`_OverrideSlot` 只有 `quat` + `weight`），不支持 position。这需要引擎核心扩展，分两期处理：

| 阶段 | 范围 | 说明 |
|------|------|------|
| **P1（当前）** | 仅旋转覆盖 | `height`/`fwdBack` 参数暂不实现烘焙，UI 中标记为「即将推出」灰色禁用状态 |
| **P2（引擎扩展）** | 旋转 + 位置覆盖 | 扩展 `BoneOverrideEntry` 增加可选 `position?: [number, number, number]`；扩展 `_OverrideSlot` 增加 `pos?: Vector3`；`onBeforeRenderObservable` 写入逻辑同时处理旋转+位置 |

P2 引擎扩展涉及以下改动（需更新「不变的部分」清单）：
- `BoneOverrideEntry` 类型增加 `position?` 字段
- `setBoneOverride` / `setBoneOverrideQuat` 增加可选 position 参数，或新增 `setBoneOverridePosition`
- `_OverrideSlot` 增加 `pos?: Vector3`
- `onBeforeRenderObservable` 回调中，若 slot 有 pos 则同时写入骨骼位置（WASM 模式写 worldMatrix 平移分量，JS 模式写 `linkedBone.setPosition`）

**手对称烘焙**：左手设 `L:[p,y,r]` → 右手自动 `R:[-p, y, -r]`（镜像）+ 可配置偏移量，避免用户左右各调一遍。

**镜像规则精确约定**：
- Pitch（X 轴）：取反（`-p`），因为左右手前后弯曲方向相反
- Yaw（Y 轴）：保持（`y`），因为左右手水平旋转方向相同
- Roll（Z 轴）：取反（`-r`），因为左右手扭转方向相反
- 位置偏移：X 分量取反（左右镜像），Y/Z 保持
- 骨骼映射：`左腕↔右腕`、`左ひじ↔右ひじ`、`左手首↔右手首`、`左肩↔右肩`，手指逐指对应（`左親指↔右親指` 等）
- 目标骨骼缺失时（如模型无 `左肩`）：跳过该骨骼，不报错

---

## 四、骨骼覆盖下沉（保留 ADR-116 初稿优化）

原 ADR-116 的 UI 改进点**不废弃**，降级为「高级骨骼覆盖」子页，作为 power user 精细通道：

| 原优化点 | 处置 |
|---------|------|
| 分类预设按钮（頭/腰/手/足 + 詳細▾） | 保留为高级子页入口 |
| 实时滑块（去 Apply） | 保留，`_createSlider` 增 `onChange` 参数 |
| 已设覆盖可编辑（点击回填） | 保留，列表项加 `編集` 按钮 |
| `getOverride(boneName)` 新增 | 保留（`scene/motion/bone-override.ts` 仅此一处新增） |

高级子页与模块层**共享 `_overrideMap`**：模块禁用时精确 `clearBoneOverride` 自己占用的骨，不误伤用户手动设的骨（模块记录 `ownedBones: string[]`）。

---

## 四点五、模块间冲突仲裁

当两个启用的模块同时写同一根骨骼时，`_overrideMap` 是 `Map<boneName, slot>`，同一根骨只能有一个 slot，后写入覆盖先写入。需要仲裁策略：

| 策略 | 说明 | 采用 |
|------|------|------|
| **优先级覆盖** | 每个模块声明 `priority: number`（P1=高 > P2 > P3），高优先级覆盖低优先级 | ✅ 当前阶段 |
| 加权混合 | 同骨多模块贡献加权 Slerp，权重归一化 | ❌ 复杂度过高，暂不实现 |
| 互斥声明 | 模块声明 `conflicts: string[]`，启用 A 自动禁用 B | ❌ 限制过强，用户体验差 |

**当前阶段仲裁规则**：
1. 模块声明 `priority`（与实施分期 P1/P2/P3 对齐：P1=1, P2=2, P3=3，数字小优先）
2. `setParam` 烘焙时，若目标骨已被**更低优先级**模块占用，允许覆盖，并通知低优先级模块该骨已被抢占（低优先级模块从 `ownedBones` 中移除该骨）
3. 若目标骨已被**更高或同等优先级**模块占用，跳过该骨的烘焙，`console.warn` 提示冲突
4. 模块 `disable()` 只清 `ownedBones` 中未被抢占的骨
5. 用户手动骨骼覆盖（高级子页）优先级最低（=Infinity），任何模块均可覆盖

```ts
export interface MotionOverrideModule {
  // ...其他字段...
  readonly priority: number; // 1=最高
  /** 本模块当前占用的骨骼名（运行时维护，含抢占记录） */
  ownedBones: string[];
}
```

---

## 五、持久化扩展

现有链路 `inst.boneOverrides: BoneOverrideEntry[]` → 序列化 → `restoreOverrides` 保留不动。新增并行字段：

```ts
// model-instance 类型扩展
inst.motionOverrideModules: MotionModuleState[]; // 模块语义状态（非骨骼级）
```

`scene/scene-serialize.ts` 增加该字段的序列化/反序列化；加载时 `setState` 重烘焙到引擎。模块级状态与骨骼级覆盖解耦，互不覆盖。

---

## 六、实施分期

| 阶段 | 文件 | 操作 | 验收 |
|------|------|------|------|
| **P0** | `motion/motion-modules/types.ts` | 定义 `MotionOverrideModule`/`MotionModuleState`（复用 `MenuNode` schema） | tsc 通过 |
| **P0** | `menus/menu-schema.ts` | `StatePath` 增加 `motionModule.` 前缀；`getStateValue/setStateValue` 路由到模块层状态 | tsc 通过 + 现有菜单不受影响 |
| **P0** | `motion/motion-modules/registry.ts` | 模块注册表 + 工厂（`createModule(id, modelId, state)`） | 单测：`createModule` 返回实例 `getState()`/`setState()` 对称，不影响其他模块状态 |
| **P0** | `menus/motion-override-levels.ts` | 重写为：总开关 + 模块列表（开关+▸）+ 子页路由框架 | 列表渲染正确；开关切换触发 `enable()`/`disable()` → `_overrideMap` 实时更新 → 下一帧 3D 视图反映变化 |
| **P1** | `motion/motion-modules/body-posture.ts` | 身体姿态模块（tilt/bend/twist 滑块；height/fwdBack 灰色禁用） | 滑块 input 事件 → `setParam` → 引擎 `_overrideMap` 更新 → 下一帧渲染反映；`getState()` 返回值与滑块一致 |
| **P1** | `motion/motion-modules/hand-symmetry.ts` | 手对称模块（镜像+偏移） | 左手调 Pitch → 右手 Pitch 取反；左手调 Roll → 右手 Roll 取反；Yaw 保持；目标骨缺失时跳过不报错 |
| **P1** | `scene/motion/bone-override.ts` | 新增 `getOverride(boneName)` | 返回 `_overrideMap` 中对应 slot 的欧拉角+权重；不存在返回 `undefined` |
| **P2** | 高级骨骼覆盖子页 | 原 ADR-061 UI 下沉为 power user 通道 | 子页路由+烘焙正确 |
| **P2** | `scene/scene-serialize.ts` | `motionOverrideModules` 持久化 | 保存→重载后 `setState` 重烘焙，模块状态与保存前一致 |
| **P2** | `scene/motion/bone-override.ts` 引擎扩展 | `BoneOverrideEntry` 增加 `position?`；`_OverrideSlot` 增加 `pos?`；写入逻辑扩展 | position 覆盖在 WASM/JS 模式均生效；现有 rotation-only 覆盖不受影响 |
| **P3** | `sway-motion.ts` / `finger-pose.ts` / `riding-model.ts` | 三个附加模块 | 各自烘焙正确；模块间冲突按优先级仲裁 |
| **P4** | `motion/motion-modules/module-base.ts` | 抽取 `createModuleBase` 工厂，消除 7 模块间 ~105 行重复 boilerplate | 6 个模块统一使用 base，删除 286 行重复代码 |
| **P4** | `motion/motion-modules/module-base.ts` | 抽取 `createFrameHookManager`，统一 sway/riding 帧钩子管理 | 消除手工 Map get/delete 重复 |
| **P4** | `scene/motion/bone-override.ts` | 移除 `head-tracking.ts` 模块（感知层已有独立控制） | 删除 150 行死代码 |
| **P4** | `scene/motion/bone-override.ts` | `_computeOverride` `weight≥1` 语义修正 | `slot.quat` → `oldRotation.multiply(slot.quat)`，保留父骨传播旋转 |
| **P4** | `scene/motion/bone-override.ts` | 回调拆分 + `Map` O(1) 查找 + `addInPlace` | 90 行 callback 拆为 3 子函数；`bones.find` → `Map.get`；`add` → `addInPlace` |
| **P4** | `scene/motion/bone-override.ts` | `_mPool`/`_vPool` 复用池 + `Matrix.ComposeToRef` | WASM 路径零分配，消除每帧 GC 压力 |

---

## 七、风险与缓解

| 风险 | 概率 | 缓解 |
|------|------|------|
| 模块烘焙与用户手动骨骼覆盖冲突（同骨被双方写） | 中 | 模块记录 `ownedBones`，禁用/重写时只清自有骨；UI 对「已被模块占用的骨」在高级子页置灰提示；用户手动覆盖优先级最低 |
| **两个启用模块同骨冲突** | 中 | 优先级覆盖仲裁（见 §4.5）：高优先级抢占低优先级，同等优先级 `console.warn` 跳过 |
| **模块层与 perception 层 head 骨骼冲突** | 中 | 模块层不写 `首/頭/head` 骨骼的 rotationQuaternion；头部追踪模块走 perception 通道（gaze 覆写），不走 bone override。管线顺序保证 perception 晚注册 = 最终覆写 |
| **多模型场景下 `_overrideMap` 全局单例状态串扰** | 中 | 模块层通过 `setTargetModel(modelId)` 管理作用域：切换模型时先 `disable()` 当前模块（清 `_overrideMap`），再 `enable()` 新模型已保存状态 |
| 语义参数→多骨映射在某些 PMX 模型缺失（如无 `上半身2`） | 中 | 候选骨按优先级匹配，缺失则跳过该分量，不报错 |
| 模块层高频 `setBoneOverride` 性能 | 低 | 复用引擎 `_overrideMap`（O(1)），每帧只读一次，与现状等价 |
| 持久化字段膨胀（每个模块存全量 params） | 低 | 仅存 `enabled + params` 差异值，默认值不落盘 |
| **position 覆盖引擎扩展引入回归** | 低 | P2 阶段实施，扩展为可选字段（`position?`），现有 rotation-only 覆盖不受影响；WASM/JS 双模式需分别测试 |

---

## 八、不变的部分（P1 阶段）

| 模块 | 不动原因 |
|------|---------|
| `scene/motion/bone-override.ts` `startBoneOverride`/`stopBoneOverride`/每帧 `onBeforeRenderObservable` 注册 | 引擎整体架构正确 |
| `setBoneOverride`/`setBoneOverrideQuat`/`clearBoneOverride`/`clearAllOverrides`/`restoreOverrides`/`getAllOverrides` | API 兼容，模块层与高级子页共用 |
| `scene/model/model-manager.ts` 骨骼叠加层（LineSystem+Joints） | 读位置缓冲，不受旋转覆盖影响 |
| `_createSlider` 现有逻辑 | 仅增 `onChange` 参数，高级子页复用 |
| `scene/motion/perception.ts` 及其子模块（gaze/blink/breath/expression） | 独立 always-on 通道，模块层不干涉 |

**P2 阶段引擎扩展（打破「不变」）**：

| 模块 | 改动 | 原因 |
|------|------|------|
| `scene/motion/bone-override.ts` `onBeforeRenderObservable` 回调 | 增加 position 写入分支（`slot.pos` 存在时同时写位置） | 支持 `height`/`fwdBack` 参数 |
| `BoneOverrideEntry` 类型 | 增加可选 `position?: [number, number, number]` | 持久化位置覆盖 |
| `_OverrideSlot` 内部类型 | 增加 `pos?: Vector3` | 运行时缓存位置 |
| `setBoneOverride` API | 增加可选 `position?` 参数 | 模块层写入入口 |

> P2 扩展为**可选增量**：不传 position 时行为与 P1 完全一致，确保向后兼容。

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

---

## 十·一、Phase 2 打磨清单（2026-07-23 设计评审）

2026-07-23 对动作覆盖面板做设计评审，确认基础层（ADR-116 主交付）方向正确，落地一批 P2/P3/P4 修复，并识别出 3 项剩余打磨。均属 ADR-116 范畴（冲突仲裁见 §四点五、骨骼覆盖 UI 见 §四），无新架构决策，**不单独立项**。

### 已落地（2026-07-23 评审修复，commit `4fa515da`）

| 优先级 | 位置 | 修复 |
|--------|------|------|
| 🟠 P2 | `motion-override-levels.ts` apply | 高级骨骼覆盖「应用」后补 `triggerAutoSave()`，离开场景不再丢修改 |
| 🟠 P2 | `motion-override-levels.ts` toggle | 启用/禁用单条覆盖后补 `triggerAutoSave()`，与删除/清除行为一致 |
| 🟡 P3 | `OverrideFormState` + apply | 增 `absolute` 字段；编辑回填避免复合覆盖被静默翻转为绝对 |
| 🟡 P3 | clearAll | 破坏性「全部清除」前 `showConfirm` 确认（仍可撤销） |
| 🟢 P4 | 列表项 | `P/Y/R/W` 缩写加 tooltip（`axisHint`：俯仰/偏航/翻滚/权重） |

### 已实施（2026-07-23 续）

| 优先级 | 项 | 说明 | 归属 | 落地 |
|--------|----|------|------|------|
| 🟡 P3 | 冲突提示用户语言化 | `getAllConflicts` 文案从技术化 `骨A←模块B` 改为「当前生效 / 被让位」 | §四点五 冲突仲裁 | ✅ `motion.boneConflict.line` + `updateConflictBanner` 重写为按骨逐条用户语言化 |
| 🟢 P4 | 骨骼搜索框 | 高级骨骼覆盖选择器加过滤输入框 | §四 骨骼覆盖下沉 | ✅ `motion.boneOverride.search` 输入框实时过滤 optgroup/option |
| 🟢 P4 | `applyOverride` 统一动作函数 | 收敛 apply/toggle 重复尾部 | §四 / 代码整洁度 | ✅ `finalizeOverride(boneName, enabled)` 统一「写运行时+同步实例+自动保存+提示+重渲染」 |

> 注：脚 IK 模块冲突语义（引擎恒胜 vs `claimBones` 仲裁）已在 `feet-adjustment-module.ts` 注释澄清（ADR-085 设计），不属本清单。

---

## 十一、2026-07-17 补充：`_computeOverride` 复合语义修正

### 背景

`_computeOverride` 在 `weight ≥ 1` 时返回 `slot.quat`（绝对旋转）。当父骨覆盖通过 `_propagateChildrenWasm` 传播到子骨后，子骨的 `_applyWasmOverride` 读取传播后的 `worldMatrix`（含父骨旋转），但 `_computeOverride` 直接返回 `slot.quat`，**丢弃了父骨传播旋转**。

### 修复

```diff
 const rotation = slot.overrideRotation
     ? slot.weight >= 1
-        ? slot.quat
+        ? oldRotation.multiply(slot.quat)  // 复合：父骨传播旋转 × 本骨覆盖
         : Quaternion.Slerp(oldRotation, slot.quat, slot.weight)
     : oldRotation;
```

### 复合顺序

`oldRotation × slot.quat` = 父骨传播旋转 × 本骨覆盖。符合 MMD 骨骼层级顺序：父骨变换先作用于子骨，子骨再叠加自身旋转。

### 影响

| 场景 | 改前 | 改后 |
|------|------|------|
| 无父骨覆盖，`oldRotation=Identity` | `slot.quat`（绝对） | `Identity × slot.quat = slot.quat`（不变） |
| 有父骨传播，`oldRotation=父骨旋转` | `slot.quat`（丢失父骨） | `父骨旋转 × slot.quat`（保留父骨） |
| 有父骨传播 + 子骨动画非 Identity | `slot.quat`（丢失父骨+动画） | `父骨旋转 × 子骨动画 × slot.quat`（保留两者） |

### 相关优化

| 优化 | 说明 |
|------|------|
| `_mPool` 8192 矩阵复用池 | WASM 路径零分配，消除 `Matrix.FromArray`/`new Matrix` 每帧 GC 压力 |
| `_vPool` 8 向量复用池 | `getTranslationToRef` 替代 `getTranslation` |
| `_ONE` 常量 | `Matrix.ComposeToRef` 复用，避免 `Vector3.One()` 重复分配 |
| `bones.find` → `Map` O(1) | 帧首建 `Map<boneName, bone>` 索引，替代 `Array.find` O(n²) |
| `addInPlace` | JS 路径 `curPos.add(slot.pos)` → `curPos.addInPlace(slot.pos)`，避免 new Vector3 |
| `callback` 拆分 | `_runFrameHooks` / `_applyWasmOverride` / `_applyJsOverride` 三大子函数 |
