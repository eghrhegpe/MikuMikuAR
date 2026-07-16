# ADR-121: 全局动作意图（Scene-level Motion Intent）— 场景级意图 + 每实例继承/覆盖

> **状态**: 规划
> **日期**: 2026-07-17

## 背景与问题

当前动作是**纯每实例（per-`ModelInstance`）** 的：`ModelInstance` 持有 `vmdData / vmdName / vmdPath / animationDuration / vmdLayers`（`core/types.ts:100-105`），动作菜单（`menus/motion-popup.ts`）把 VMD **写入聚焦模型**的 `inst.vmdData`。

这带来两个体验与架构问题：

1. **换角色必须重选动作**：用户只想看角色、反复换皮时，每次换模型都要重新在菜单里点一遍同一个动作。对「欣赏型」用户是纯负担。
2. **动作菜单职责错位**：菜单本质是「让角色动起来」，却被迫承载「给哪个角色上什么」的派发逻辑，与「场上在跳什么」的直觉相悖。

### 已有的雏形（应被正式化，而非另造）

`scene/manager/model-loader.ts:457` 存在 `pendingVmd`：模型加载时若有待定 VMD 则自动套用。这正是「全局意图在加载时广播」的胚胎实现——但它只服务于「切换时带上一个 pending」，无场景级意图、无继承/覆盖语义、无兼容性判定。本 ADR 将其升级为**场景级 `activeMotion` 意图 + 每实例继承/覆盖**。

### 关联资产（证明可行性，非从零开始）

| 资产 | 对本 ADR 的支撑 |
|------|----------------|
| `ModelInstance` + Map 注册表（`core/types.ts`） | 天然支持「场景意图 → 遍历实例套用」 |
| 共享 WASM 物理时间轴 | 全局播放时间一致，多角色天然同步无漂移 |
| ADR-108 AnimationRetargeter（已落地） | 兼容性解析引擎：`activeMotion` → 按骨骼名候选表（全角+半角+英文变体，见工程铁律）重定向到各模型 |
| ADR-116 动作覆盖模块（`ModelInstance.motionOverrideModules`，per-model） | 覆盖模块是**基础 VMD 之上的独立层**（管线第⑤层），全局意图只改「基础 VMD 来源」，与覆盖层正交，无冲突 |
| `model-loader.ts:457` `pendingVmd` | 加载时套用 VMD 的现有钩子，本 ADR 复用其调用点 |

---

## 决策：场景级意图 + 每实例继承/覆盖（混合体）

核心区分：**「全局生效」≠「所有角色盲播同一条 VMD」**。VMD 按骨骼名引用，模型骨骼结构不同 → 广播时各模型只取自己兼容的子集（MMD 原生行为）。因此落地为：

- **场景级 `activeMotion`**：场上当前意图（「在跳什么」）。`none` 表示静态欣赏。
- **每实例 `motionAssignment`**：`mode: 'inherit' | 'pinned'`。默认 `inherit` → 继承 `activeMotion`；`pinned` → 独立指定（合奏/对舞场景用）。
- **加载即继承**：新模型加载时 `mode='inherit'`，按 `activeMotion` 解析兼容性后套用。换角色无需重选。
- **覆盖解耦**：右键模型可 `pin 指定动作` / `unpin（跟随全局）`。仅差异化场景才需手动分配。

### 关键不变量

1. **`vmdData/vmdName/vmdPath/vmdLayers` 仍是 `ModelInstance` 的「已解析缓存」**，playback / vmd-loader / vmd-layers 内部**继续读这些字段**，无需改动。本 ADR 只改变「谁、何时写入这些字段」——从「菜单写聚焦模型」改为「广播策略按 assignment 写入」。
2. **`activeMotion` 不入 `EnvState`**。动作是场景内容而非视觉环境；归入场景文件 + 一个轻量场景级 TS store（非 Go `EnvState` struct），**规避 EnvState 持久化须同步 Go struct + 重生成 wails 绑定的工程铁律成本**（见 `MEMORY.md` 工程铁律「EnvState 持久化」）。
3. **`none` 是一等公民**：全局意图为 `none` 时所有 `inherit` 模型保持静态，满足「只想看角色」的用户。

---

## 数据模型

```ts
// core/types.ts 或 scene/motion/motion-intent.ts
export type MotionSource = 'vmd' | 'retargeted';

/** 场景级动作意图（「场上在跳什么」） */
export interface SceneMotionIntent {
  vmdPath: string | null;     // 库引用或绝对路径（持久化用）
  vmdName: string;
  vmdLayers: VmdLayer[];
  source: MotionSource;
  // vmdData 为运行时缓存，不持久化
}

/** 每实例动作分配策略 */
export interface ModelMotionAssignment {
  mode: 'inherit' | 'pinned';
  pinned?: SceneMotionIntent;             // mode==='pinned' 时有效
  status: 'compatible' | 'incompatible' | 'idle' | 'overridden';
}

// ModelInstance 扩展（保留现有 vmd* 缓存字段不动）
export type ModelInstance = {
  // ...existing vmdData/vmdName/vmdPath/animationDuration/vmdLayers...
  motionAssignment?: ModelMotionAssignment; // [doc:adr-121] 默认 undefined = 视为 inherit+idle
};
```

### 场景级 store（轻量 singleton，非 EnvState）

```ts
// scene/motion/motion-intent.ts
let _activeMotion: SceneMotionIntent | null = null; // null = none（静态）
export function getActiveMotion(): SceneMotionIntent | null;
export function setActiveMotion(intent: SceneMotionIntent | null): void; // 触发 broadcastMotion()
export function broadcastMotion(): void; // 遍历 modelMap，按 assignment 解析+写入 inst.vmd*
```

---

## 数据流（与现状一致，仅策略层变化）

```
用户从动作菜单选择动作
  └─ setActiveMotion(intent)          // 场景级意图
       └─ broadcastMotion()
            ├─ 遍历 modelMap 每个 inst
            │    ├─ mode==='inherit' → resolve(activeMotion, inst.skeleton)
            │    └─ mode==='pinned'  → resolve(inst.assignedMotion.pinned, inst.skeleton)
            │         ├─ 兼容 → 写 inst.vmdData/vmdName/vmdPath/vmdLayers + status='compatible'
            │         └─ 不兼容 → 不动 inst.vmd*（保留 idle/已有），status='incompatible'
            └─ 触发 playback 重载（复用现有 loadVMDMotion / vmd-layers 链路）

新模型加载（model-loader.ts:457 调用点）
  └─ inst.motionAssignment = { mode:'inherit', status:'idle' }
       └─ resolve(activeMotion, inst.skeleton) → 兼容则立即套用

用户右键模型 → pin 指定动作
  └─ inst.motionAssignment = { mode:'pinned', pinned: intent, status:'overridden' }
       └─ resolve(pinned, inst.skeleton) → 写 inst.vmd*

用户右键模型 → unpin
  └─ inst.motionAssignment = { mode:'inherit' }
       └─ resolve(activeMotion, inst.skeleton) → 回归全局
```

**兼容性解析**复用 ADR-108：`resolve()` 内部走 `AnimationRetargeter` + `matchBone` 候选表（全角 `左足ＩＫ`/半角/英文变体），返回可套用的 `AnimationGroup` / VMD 子集。

---

## 与现有系统的边界

| 系统 | 关系 | 处置 |
|------|------|------|
| playback.ts / vmd-loader.ts / vmd-layers.ts | 仍读 `inst.vmd*` 缓存 | **不变**（仅写入方改变） |
| ADR-116 动作覆盖模块（per-model） | 基础 VMD 之上的独立层 | **不变**；全局意图只改基础来源，覆盖模块照常叠加 |
| ADR-108 retargeter | 兼容性解析引擎 | **复用**，不重复建设 |
| `model-loader.ts:457` `pendingVmd` | 加载时套用钩子 | **吸收**为 `inherit` 解析逻辑，移除零散 pending 变量 |
| scene-serialize.ts | 场景持久化 | **扩展**（见下） |
| ADR-119 缩略图 cache key | 场景恢复传参一致性 | scene-restore 分支须一并传入 `motionAssignment`，对齐 `buildThumbnailKey` 契约 |

---

## 持久化扩展（scene-serialize.ts）

| 字段 | 位置 | 说明 |
|------|------|------|
| `motion.activeMotion` | 场景文件顶层（新增 `motion` 块） | 场景级意图；`null`=none |
| `inst.motionAssignment` | 每实例 | `mode` + `pinned`（如 pinned）；`status` 为运行时派生、不落盘 |
| `inst.vmdPath/vmdName/vmdLayers` | 每实例（已有） | 作为 `inherit` 模型的**可重建缓存**：加载时若 `activeMotion` 存在则优先从意图重解析，否则回退到该缓存（保持旧场景文件兼容） |

**向后兼容**：旧场景文件无 `motion` 块 → 加载时 `activeMotion=null`，各模型按已有 `vmdPath` 缓存还原（与当前行为一致），不报错。

---

## 实施分期

| 阶段 | 文件 | 操作 | 验收 |
|------|------|------|------|
| **P0** | `scene/motion/motion-intent.ts`（新增） | 定义 `SceneMotionIntent`/`ModelMotionAssignment` + 场景级 store `get/setActiveMotion`/`broadcastMotion`/`resolve` 骨架 | tsc 通过；`setActiveMotion` 触发 `broadcastMotion` 遍历 modelMap |
| **P0** | `core/types.ts` | `ModelInstance` 增 `motionAssignment?` | 现有测试不破 |
| **P1** | `menus/motion-popup.ts` | 菜单操作改为 `setActiveMotion`（场景级），不再写聚焦模型 `inst.vmdData` | 选动作后所有 `inherit` 兼容模型同步起舞 |
| **P1** | `scene/manager/model-loader.ts:457` | `pendingVmd` 调用点改为 `inst.motionAssignment={mode:'inherit'}` + `resolve(activeMotion)` | 新模型加载即继承全局动作 |
| **P1** | UI（动作菜单 + 模型右键） | 菜单标题语义改为「场上在跳什么」；模型右键 `pin/unpin`；`incompatible` 状态显式提示（「此角色不兼容当前动作」） | 不兼容模型不被静默无视；静态场景 `none` 正确保持 |
| **P2** | `scene/scene-serialize.ts` | 写 `motion.activeMotion` + 每实例 `motionAssignment`；加载还原 + 重解析（回退旧缓存） | 保存→重载后全局动作与 per-model 覆盖一致还原 |
| **P2** | i18n（5 语言） | 新增 `motion.intent.*` key（见 §i18n） | 日/英/韩/繁体/简体齐全 |

---

## 风险与缓解

| 级别 | 风险 | 缓解 |
|------|------|------|
| 🔴 P1 | 不兼容模型被全局动作「静默无视」→ 用户以为坏了 | `status='incompatible'` 显式标记 + UI 提示；**绝不覆盖**模型已有 `vmd*`（保留 idle 或原动作） |
| 🟠 P2 | 合奏/对舞场景被迫同舞 | `pinned` 覆盖层（必需项，非可选项）；右键 `pin` 独立于全局 |
| 🟡 P3 | 持久化引入场景级 `activeMotion` 字段 | 仅扩展 `scene-serialize.ts`，**不入 `EnvState`**，规避 Go struct 同步 + wails 绑定重生成本 |
| 🟢 P4 | scene-restore 各分支（normal/replace/scene-restore/prop）传参不一致导致回放错乱 | scene-restore 一并传入 `motionAssignment`，对齐 ADR-119 `buildThumbnailKey` 契约 |
| 🟢 P4 | `resolve()` 高频调用性能 | 仅在 `setActiveMotion` / 模型加载 / `pin/unpin` 时解析一次，结果写入 `inst.vmd*` 缓存，每帧播放链路不变 |

---

## 不变的部分（P1 阶段）

| 模块 | 不动原因 |
|------|---------|
| `scene/motion/playback.ts` / `vmd-loader.ts` / `vmd-layers.ts` 内部 | 仍读 `inst.vmdData/vmdName/vmdPath/vmdLayers`，本 ADR 不改播放链路，只改写入方 |
| ADR-116 动作覆盖模块 + `motion-modules/registry.ts` | 独立 per-model 层，全局意图只换基础 VMD 来源，覆盖模块照常叠加 |
| `scene/motion/animation-retargeter.ts` | 兼容性解析引擎，直接复用 |
| `core/types.ts` 现有 `vmd*` 字段 | 作为已解析缓存保留，避免大范围重构 |

---

## i18n 新增 key

| Key | zh | ja | en |
|-----|----|----|----|
| `motion.intent.title` | 场上动作 | 場上の動作 | Active Motion |
| `motion.intent.none` | 静态（无动作） | 静止（動作なし） | Static (no motion) |
| `motion.intent.incompatible` | 此角色不兼容当前动作 | このキャラは現在の動作非対応 | This model is incompatible with the active motion |
| `motion.context.pinMotion` | 固定此动作 | この動作を固定 | Pin this motion |
| `motion.context.unpin` | 跟随全局动作 | 全体動作に追従 | Follow global motion |

---

## 后续迭代方向

- **跨场景记住上次动作**：若需「重开应用恢复上次动作」，可将 `activeMotion` 快照进 `uiState`（届时须同步 Go `UIState` struct + 重生成绑定，按工程铁律执行）——本 ADR P1/P2 不纳入，保持场景级范围。
- **动作预设组**：「演唱会包」一键设 `activeMotion` + 给特定角色 `pin` 独舞。
- **批量 pin**：多选模型统一指派动作。
