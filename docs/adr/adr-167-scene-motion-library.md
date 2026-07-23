# ADR-167: 场景级动作库（Scene Motion Library）— 多主动作平等共存

> **状态**: 已完成（2026-07-23 核心功能落地，P0-P3 全部实施）
> **日期**: 2026-07-21
> **依赖**: ADR-121（全局动作意图）、ADR-129（场景级动作 UI）、ADR-144（per-model overlay，已废弃被本 ADR 取代）
> **路径约定**: 源码路径省略 `frontend/src/` 前缀，例如 `core/types.ts` = `frontend/src/core/types.ts`

## 背景与问题

ADR-121 引入「场景级 `activeMotion` singleton + per-model 继承/覆盖」，ADR-129 把 UI 改为场景级优先。但当前实现把场景级动作建模为 **「1 个基础动作（`vmdName`）+ N 个全局共享叠加层（`vmdLayers`）」**，与用户的直觉语义冲突：

### 用户实际场景

用户从动作库依次加载 6 个 VMD（斜坐、街舞 Black Swan、街舞 Booty Music ×3、斜坐），期望它们是 **平等的主动作候选**，角色可从中任选一个跳。但当前 `__scene_motion_browse__` 的 `onVmdPick` 逻辑（[motion-popup.ts:255-282](../../frontend/src/menus/motion-popup.ts#L255-L282)）：

```ts
if (!cur) {
    setActiveMotion({ vmdPath, vmdName, vmdLayers: [], source: 'vmd' }); // 第 1 个 → 基础
} else {
    setActiveMotion({ ...cur, vmdLayers: [...cur.vmdLayers, newLayer] }); // 后续 → 全局叠加层
}
```

导致：

| 用户期望 | 实际行为 |
|---|---|
| 6 个主动作平等共存 | 1 个基础 + 5 个叠加层混合播放 |
| 角色面板可从 6 个里选一个 | 角色面板「已加载动作」只显示基础动作名 |
| 叠加层属于每个主动作内部 | 叠加层是场景级共享，与基础动作解耦 |

### 数据模型根因

[types.ts:117-127](../../frontend/src/core/types.ts#L117-L127) 的 `SceneMotionIntent` 是**单例字段**：

```ts
interface SceneMotionIntent {
    vmdPath: string | null;
    vmdName: string;        // ← 基础动作，单值
    vmdLayers: VmdLayer[];  // ← 叠加层，多值但归属「场景」而非「主动作」
    ...
}
```

`vmdName` 是单值决定了「场景里只有一个基础动作」，`vmdLayers` 归属场景决定了「叠加层不属于某个主动作」。

### 现有 `pinned` 机制为何不够

ADR-121 已支持 `mode: 'pinned'` 让角色独立快照一份 `SceneMotionIntent`，理论上可让不同角色跳不同动作。但：

1. `pinned` 是 per-model 完整快照，**没有场景级动作库**概念——用户添加的第 2 个动作直接进了全局 `vmdLayers`，没有「加入候选库」语义
2. 角色面板无法从「场景已加载的动作」里选，只能重新浏览 VMD 文件
3. 多角色场景下，每个角色 pin 一份独立快照，内存与配置冗余

---

## 决策：场景级动作库 + 主动作内部叠加层

### 核心语义变更

| 维度 | 现状（ADR-121/129） | 本 ADR |
|---|---|---|
| 场景级动作存储 | `_activeMotion: SceneMotionIntent \| null`（单例） | `_sceneMotions: SceneMotionIntent[]`（列表） |
| 默认动作 | 即 `_activeMotion` 本身 | `_activeMotionId: string \| null` 指向列表中某项 |
| 叠加层归属 | 场景级共享（`activeMotion.vmdLayers`） | **每个主动作内部**（`sceneMotion.vmdLayers`） |
| 角色继承 | `inherit` 跟随唯一 `activeMotion` | `inherit` + `sceneMotionId` 引用场景库中某项；`sceneMotionId=null` 跟随默认 |
| 添加动作 | 第 1 个设基础，后续塞 `vmdLayers` | 每次都新建 `SceneMotionIntent` push 到 `_sceneMotions` |

### 数据模型

```ts
// scene/motion/motion-intent.ts
let _sceneMotions: SceneMotionIntent[] = [];        // 场景级主动作库
let _activeMotionId: string | null = null;           // 默认动作 id（null = 无默认，新角色静止）
let _motionGen = 0;                                  // generation counter（保留，竞态守护）

export function getSceneMotions(): SceneMotionIntent[];
export function getActiveMotion(): SceneMotionIntent | null;   // 返回 _activeMotionId 对应项；保持原名以最小化下游改动
export function getActiveMotionId(): string | null;
export function setDefaultMotion(id: string | null): void;      // 设默认动作，触发广播
export function addSceneMotion(intent: SceneMotionIntent): string; // 返回新 id
export function removeSceneMotion(id: string): void;             // 移除并处理引用该 id 的角色（回退到默认）
export function updateSceneMotion(id: string, patch: Partial<SceneMotionIntent>): void; // 更新某主动作（如改其 vmdLayers）
```

```ts
// core/types.ts
export interface MotionSlotConfig {
    source: SlotSource;
    /** [doc:adr-167] source==='inherit' 时引用场景库中某个主动作；undefined/null = 跟随 _activeMotionId */
    sceneMotionId?: string;
    pinned?: SceneMotionIntent;
    procRole?: 'idle' | 'autodance' | 'gesture' | 'expression';
    status: 'compatible' | 'incompatible' | 'idle' | 'overridden';
    // [adr-167] overlayPath/overlayName/overlayWeight 已移除（ADR-144 废弃）
}
```

### 关键不变量

1. **`SceneMotionIntent` 结构不变**——仍包含 `vmdPath / vmdName / vmdLayers / source / motionModules / procMotion`，只是 `vmdLayers` 语义从「场景级共享」变为「该主动作内部」。`SceneMotionIntent` 需新增稳定 `id` 字段。
2. **`getActiveMotion()` 保持原签名**——返回当前默认动作（`_activeMotionId` 对应项），下游 playback/vmd-loader/vmd-layers 链路无感知。
3. **ADR-144 per-model overlay 完全移除**——见 §「ADR-144 per-model overlay 去留决策」，方案 A 已拍板。
4. **`pinned` 仍是完整快照**——角色 pin 时 `structuredClone(sceneMotion)` 冻结，避免后续改场景库污染已 pin 实例。
5. **新角色加载默认 `sceneMotionId=undefined`**——即跟随 `_activeMotionId`；`_activeMotionId=null` 时新角色静止。

### 数据流

```
用户从主菜单「浏览动作库」选 VMD
  └─ addSceneMotion(intent) → 返回新 id
       └─ 若 _sceneMotions 为空，自动设为默认（_activeMotionId = newId）
       └─ 触发 broadcastMotion()：所有 sceneMotionId===undefined 的 inherit 角色套用新默认

用户点某主动作「设为默认」
  └─ setDefaultMotion(id)
       └─ broadcastMotion()：所有 sceneMotionId===undefined 的 inherit 角色重新套用

用户在角色「动作1」子页选某主动作
  └─ inst.motionSlots.primary.sceneMotionId = id
       └─ applyIntentToModel(id, sceneMotion, gen) → 写 inst.vmd*

用户在主动作详情页管理该主动作的 vmdLayers
  └─ updateSceneMotion(id, { vmdLayers: newLayers })
       └─ 广播：所有引用该 id 的角色重建 composite animation
```

---

## UI 变更

### 主菜单 Card 1（[motion-root-ui.ts:51-122](../../frontend/src/menus/motion-root-ui.ts#L51-L122)）

```
Card 1: 场景动作库
  ├─ [动作 A] [默认徽标]              → 点击进详情页（管理该主动作内部 vmdLayers + 骨骼覆盖）
  │   └─ trailing: 设为默认 / 删除
  ├─ [动作 B]
  ├─ [动作 C] [默认徽标]              ← 当前默认
  ├─ 浏览动作库                        → VMD 文件浏览器（stay 模式，每次选都 addSceneMotion）
  └─ 程序化动作                        → 子页
```

**关键变更**：
- `buildMotionRootItems()` 遍历 `_sceneMotions` 而非 `active.vmdLayers`
- 每个主动作行 trailing 提供「设为默认 / 删除」两个操作（用 `lucide:star` / `lucide:trash-2`）
- 默认动作行显示 `lucide:star` 实心徽标
- 「浏览动作库」`onVmdPick` 改为 `addSceneMotion({ vmdPath, vmdName, vmdLayers: [], source: 'vmd' })`

### 主动作详情页（[motion-detail-ui.ts](../../frontend/src/menus/motion-detail-ui.ts)）

```
主动作详情页（动作 A）
  ├─ 动作名 + 清除按钮
  ├─ 叠加层列表（该主动作内部的 vmdLayers）
  │   ├─ [叠加层 1] [100%] → trailing 齿轮进图层设置
  │   └─ 添加叠加层        → 浏览 VMD 库，选文件追加到该主动作 vmdLayers
  ├─ 骨骼覆盖入口
  └─ 播放速度滑块
```

**关键变更**：
- `buildMotionDetailLevel(id)` 接收 `sceneMotionId`，从 `_sceneMotions` 取对应项
- 图层列表数据源从 `active.vmdLayers` 改为 `sceneMotion.vmdLayers`
- 「添加叠加层」调用 `updateSceneMotion(sceneMotionId, { vmdLayers: [...current, newLayer] })`

### 角色「动作1」子页（[model-detail.ts:401-502](../../frontend/src/menus/model-detail.ts#L401-L502)）

```
已加载动作
  ├─ [当前动作名] [来源徽标]          → 点击重新应用
  ├─ 从场景库选择...                  → 弹出场景动作列表（含默认徽标 + 当前选中标记）
  ├─ [取消固定]（仅 source==='pinned' 时显示）
程序化动作
  ├─ 待机呼吸 / 自动舞蹈
```

**关键变更**：
- `buildMotionSlotLevel(id, inst)` 新增「从场景库选择」行（`lucide:library` 图标）
- 点击后 push 一个新 level：列出所有 `_sceneMotions`，每行 trailing 显示「默认/已选」徽标
- 选中后 `inst.motionSlots.primary = { source: 'inherit', sceneMotionId: pickedId, status: 'idle' }`
- 当前动作名显示逻辑：`sceneMotionId → _sceneMotions.find(...).vmdName`；`sceneMotionId=undefined` → 默认动作名

---

## 与现有系统的边界

| 系统 | 关系 | 处置 |
|---|---|---|
| `scene/motion/playback.ts` / `vmd-loader.ts` / `vmd-layers.ts` | 仍读 `inst.vmd*` 缓存 | **不变**（写入方从单例改为按 `sceneMotionId` 解析） |
| ADR-116 动作覆盖模块（per-model） | 基础 VMD 之上的独立层 | **不变**；本 ADR 只改基础动作来源 |
| ADR-144 per-model overlay（动作2） | per-model 叠加槽位 | **见 §「ADR-144 去留决策」** |
| ADR-108 retargeter | 外部动画重映射 | **不变**；retargeted 来源仍可作为主动作加入 `_sceneMotions` |
| `scene/scene-serialize.ts` | 场景持久化 | **扩展**（见下） |
| `scene/manager/model-loader.ts` | 新模型加载 | `pendingVmd` 钩子改为「按 `_activeMotionId` 解析」 |

---

## ADR-144 per-model overlay 去留决策

### 现状回顾

ADR-144 在 `MotionSlotConfig` 上加了 `overlayPath / overlayName / overlayWeight` 三个字段，并实现了 `buildMotionOverlayLevel`（[model-detail.ts:504+](../../frontend/src/menus/model-detail.ts)）——即角色「动作2」子页：每个角色可独立选一个 VMD 作为叠加层，叠加在 primary 动作之上。

UI 入口：模型详情页 → 动作 → 叠加动作（[无]）→ 子页选 VMD 或启用程序化叠加。

### 与本 ADR 的功能重叠

本 ADR 实施后，**主动作内部 `vmdLayers`** 已能覆盖大多数叠加场景：

| 场景 | ADR-144 per-model overlay | ADR-167 主动作内部 vmdLayers |
|---|---|---|
| 所有跳街舞的角色都加同样的手势 | 每个角色单独配 overlay | 在街舞主动作内部加一个手势 vmdLayer，所有引用街舞的角色自动共享 |
| 角色 A 跳街舞加手势、角色 B 跳街舞不加 | per-model overlay 独立配 | **无法实现**——主动作内部 vmdLayers 对所有引用者共享 |
| 已加载动作 + 程序化 idle 微动 | overlay 程序化 idle | 主动作内部 vmdLayers 加程序化 idle（但 vmdLayers 当前只支持 VMD，需扩展） |
| 多动作混合预设 | 每个角色配多个 overlay | 主动作内部 vmdLayers 直接定义 |

### 三种处置方案

#### 方案 A：完全移除 ADR-144 per-model overlay（推荐）

**做法**：
- 删除 `MotionSlotConfig.overlayPath / overlayName / overlayWeight` 字段
- 删除 `buildMotionOverlayLevel` 及相关 UI 入口
- 删除 `_ensureOverlayLayer` / `clearOverlayLayer` / `setOverlayWeight` 等运行时函数
- `MotionSlotConfig` 仅保留 `primary` 槽位（可重命名为 `motion`，但本 ADR 先不动命名）

**优点**：
- 概念统一：所有叠加层都属于某个主动作内部，无两套并行机制
- UI 简化：角色「动作」面板只剩「已加载动作（从场景库选）+ 程序化动作」
- 维护成本降低：少一套独立的 overlay 注入/权重/清除逻辑

**缺点**：
- 失去「同一主动作下，不同角色差异化叠加」能力——若用户需要此能力，必须创建两个主动作（如「街舞」「街舞+手势」），角色各自引用
- 程序化叠加（idle 作为 overlay）失去独立槽位——需把程序化作为主动作内部 vmdLayer 的一种（vmdLayer.kind 扩展 'proc'）

#### 方案 B：保留 ADR-144 作为高级特性，默认隐藏

**做法**：
- 保留所有 ADR-144 字段与逻辑
- UI 入口从「动作」面板移至「动作 → 高级 → per-model 叠加」折叠组
- 默认用户看不到，需主动展开

**优点**：
- 保留差异化叠加能力
- 兼容已有数据

**缺点**：
- 两套叠加机制并存，用户认知负担大
- UI 仍有入口，违反「概念统一」原则

#### 方案 C：保留 ADR-144 但语义收窄为「程序化叠加专用」

**做法**：
- 移除 ADR-144 的 VMD overlay（`overlayPath / overlayName`），仅保留程序化 overlay（`procRole` 作为 overlay）
- 即 per-model overlay 只能是程序化 idle/autodance，不能是 VMD
- VMD 叠加统一走主动作内部 vmdLayers

**优点**：
- 职责清晰：VMD 叠加走主动作，程序化叠加走 per-model
- 程序化微动天然是 per-model 的（每个角色呼吸节奏可独立），不适合做主动作内部共享

**缺点**：
- 需重构 ADR-144 UI，移除 VMD overlay 入口
- 仍保留一套独立的程序化 overlay 逻辑

### 决策：方案 A（完全移除）

用户已拍板采用方案 A。理由：

1. **概念统一**是本 ADR 的核心价值——两套叠加机制并存违背「6 个动作平等 + 主动作内部叠加层」的初衷
2. 程序化 idle/autodance 本就有独立的「程序化动作」入口（角色面板的「待机呼吸」「自动舞蹈」行），不需要再走 overlay 槽位
3. 「同一主动作下差异化叠加」是低频场景，用户可通过创建多个主动作（如「街舞」「街舞+手势」）实现
4. 移除后 `MotionSlotConfig` 从双槽位简化为单槽位，类型与序列化都更清晰

### 实施影响（纳入本 ADR 实施分期）

**类型层破坏性变更**（因本 ADR 已声明旧场景不兼容，可顺带完成）：

```ts
// core/types.ts — 移除 overlay 相关字段
export interface MotionSlotConfig {
    source: SlotSource;
    sceneMotionId?: string;   // [doc:adr-167] inherit 时引用场景库
    pinned?: SceneMotionIntent;
    procRole?: 'idle' | 'autodance' | 'gesture' | 'expression';
    status: 'compatible' | 'incompatible' | 'idle' | 'overridden';
    // ❌ 移除：overlayPath / overlayName / overlayWeight
}

// ModelMotionSlots 从双槽位简化为单槽位
export type ModelMotionSlots = MotionSlotConfig;  // 不再需要 primary/overlay 双层
// 或保留外层对象以减少迁移面：export interface ModelMotionSlots { primary: MotionSlotConfig; }
// 实施时择一，推荐直接简化为单类型别名
```

**代码删除清单**：

| 文件 | 删除内容 |
|---|---|
| `core/types.ts` | `MotionSlotConfig.overlayPath/overlayName/overlayWeight` 字段；`ModelMotionSlots.overlay` 字段（或整体简化为类型别名） |
| `menus/model-detail.ts` | `buildMotionOverlayLevel` 函数 + 其菜单注册 |
| `scene/motion/motion-binding-ui.ts` | `_ensureOverlayLayer` / `clearOverlayLayer` / `setOverlayWeight` / `getOverlayStatus` 等 overlay 运行时函数 |
| `scene/scene-serialize.ts` | `motionSlots.overlay` 序列化与反序列化分支 |
| `__tests__/` | overlay 相关测试用例（如 `motion-overlay.test.ts` 若存在） |

**ADR-144 处置**：
- ADR-144 文档状态改为「已废弃，被 ADR-167 取代」
- 在 ADR-144 顶部添加废弃标记指向 ADR-167

---

## 持久化扩展（scene-serialize.ts）

**不兼容旧格式**（用户决策：强制重新加载）。

### 新格式

```ts
// 场景文件顶层
{
  motion: {
    sceneMotions: SceneMotionIntent[];   // 场景级动作库
    activeMotionId: string | null;       // 默认动作 id
  },
  models: [
    {
      // ...
      motionSlots: {
        primary: {
          source: 'inherit' | 'pinned' | 'procedural',
          sceneMotionId?: string,        // inherit 时引用场景库
          pinned?: SceneMotionIntent,    // pinned 时完整快照
          procRole?: ...,
        },
        overlay: { /* ADR-144 不变 */ }
      }
    }
  ]
}
```

### 旧格式处理

加载旧场景文件（顶层有 `motion.activeMotion` 单例字段，无 `motion.sceneMotions` 数组）时：

- **动作配置丢弃**，不迁移
- 用户需重新从动作库加载
- 控制台 `logWarn('ADR-167: 旧场景动作配置已丢弃，请重新加载')`
- 其他场景数据（模型、环境、灯光等）正常加载

**理由**：用户明确选择不兼容，避免迁移逻辑的维护成本与潜在 bug。

---

## 实施分期

| 阶段 | 状态 | 文件 | 操作 | 验收 |
|---|---|---|---|---|
| **P0** | ✅ | `scene/motion/motion-intent.ts` | 新增 `_sceneMotions` / `_activeMotionId` store + `getSceneMotions` / `addSceneMotion` / `removeSceneMotion` / `updateSceneMotion` / `setDefaultMotion` / `getActiveMotionId`；`getActiveMotion` 改为返回默认项 | tsc 通过；旧调用 `getActiveMotion` 不破 |
| **P0** | ✅ | `core/types.ts` | `MotionSlotConfig` 新增 `sceneMotionId?`、移除 `overlayPath/overlayName/overlayWeight`；`ModelMotionSlots` 简化为单槽位（或保留 `primary` 字段名）；`SceneMotionIntent` 新增 `id: string` | tsc 通过；overlay 相关引用编译失败清单已识别 |
| **P0** | ✅ | `docs/adr/adr-144-per-model-overlay-motion.md` | 顶部加废弃标记，状态改「已废弃，被 ADR-167 取代」 | 文档可追溯 |
| **P1** | ✅ | `menus/motion-popup.ts` | `__scene_motion_browse__` 的 `onVmdPick` 改为 `addSceneMotion(...)` | 连续添加 6 个动作 → 场景库有 6 项，非 1+5 |
| **P1** | ✅ | `menus/motion-root-ui.ts` | `buildMotionRootItems` 遍历 `_sceneMotions`；每行 trailing 加「设为默认 / 删除」 | 主菜单列出所有主动作，默认项有徽标 |
| **P1** | ✅ | `menus/motion-detail-ui.ts` | `buildMotionDetailLevel(sceneMotionId)` 从场景库取项；图层管理作用于该主动作 vmdLayers | 在动作 A 详情页加叠加层，不影响动作 B |
| **P2** | ✅ | `menus/model-detail.ts` | `buildMotionSlotLevel` 新增「从场景库选择」行 + 子页；**删除 `buildMotionOverlayLevel` 函数与菜单注册** | 角色可从场景库选任一主动作；叠加动作菜单消失 |
| **P2** | ✅ | `scene/motion/motion-binding-ui.ts` | `applyIntentToModel` 按 `sceneMotionId` 解析；`broadcastMotion` 遍历模型按各自 `sceneMotionId` 套用；**删除 `_ensureOverlayLayer` / `clearOverlayLayer` / `setOverlayWeight` / `getOverlayStatus`** | 不同角色跳不同主动作；overlay 运行时无残留 |
| **P3** | ✅ | `scene/scene-serialize.ts` | 新增 `motion.sceneMotions` + `activeMotionId`；`inst.motionSlots.primary.sceneMotionId` 落盘；**移除 `motionSlots.overlay` 分支**；旧格式丢弃动作配置 | 保存→重载后场景库与角色引用一致还原 |
| **P3** | ✅ | `scene/manager/model-loader.ts` | `pendingVmd` 钩子改为按 `_activeMotionId` 解析 | 新模型加载即继承默认动作 |
| **P3** | ✅ | `core/i18n/locales/*.ts`（5 语言） | 新增 `motion.library.*` key（见 §i18n）；移除已废弃的 `model-detail.overlay*` key | 5 语种齐全；无悬空 key |
| **P3** | ✅ | `__tests__/` | 移除/重写 overlay 相关测试用例；新增场景库 + 角色引用测试 | `npm run test` 全绿（motion-intent-replace-default.test.ts 覆盖核心场景） |
| **P3** | ✅ | `__tests__/bindings/app.contract.test.ts` | 本 ADR 不动 Go struct，契约测试应保持通过 | 契约测试通过 |

---

## 风险与缓解

| 级别 | 风险 | 缓解 |
|---|---|---|
| 🔴 P1 | 删除主动作时，引用它的角色如何处理 | `removeSceneMotion(id)` 遍历模型，将引用该 id 的 `sceneMotionId` 置为 `undefined`（回退默认）；若删除的是默认动作，自动选列表第一项为新默认（无则 `null`） |
| 🔴 P1 | 主动作 vmdLayers 变更时，引用它的所有角色需重建 composite animation | `updateSceneMotion` 触发广播，仅遍历 `sceneMotionId === id` 的角色调用 `_rebuildCompositeAnimation`；用 generation counter 守护异步竞态 |
| 🟠 P2 | 角色切换动作时，旧动作的播放状态（时间轴位置）是否保留 | 默认不保留（切换即重置）；未来可扩展「保留时间轴位置」选项 |
| 🟠 P2 | 旧场景文件动作配置丢弃，用户感知 | 加载时 toast 提示「场景动作配置已升级，请重新加载动作」+ 控制台 `logWarn` |
| 🟡 P3 | `pinned` 快照与场景库主动作的同步问题 | `pinned` 是 `structuredClone` 独立副本，场景库变更不影响已 pin 实例（保持 ADR-121 语义） |
| 🟡 P3 | 性能：N 个主动作同时加载到内存 | 主动作 `vmdData` 仍为运行时缓存，可惰性加载；未引用的主动作不解析 VMD 二进制 |
| 🟢 P4 | UI 信息密度：主菜单列出 N 个主动作可能过长 | 列表可滚动；超过 5 项时折叠为「场景动作库 (N)」入口 |

---

## 不变的部分

| 模块 | 不动原因 |
|---|---|
| `scene/motion/playback.ts` / `vmd-loader.ts` / `vmd-layers.ts` 内部 | 仍读 `inst.vmd*` 缓存，本 ADR 不改播放链路 |
| ADR-116 动作覆盖模块 + `motion-modules/registry.ts` | 独立 per-model 层，与本 ADR 正交 |
| ADR-108 `animation-retargeter.ts` | 外部动画重映射，retargeted 来源可加入场景库 |
| `core/types.ts` 现有 `vmd*` 字段（ModelInstance 上的） | 作为已解析缓存保留 |

> **ADR-144 per-model overlay 不再保留**——已由本 ADR 方案 A 完全移除，见 §「ADR-144 per-model overlay 去留决策」。

---

## i18n 新增 key（5 语言：en / ja / ko / zh-CN / zh-TW）

| Key | zh-CN | ja | en | ko | zh-TW |
|---|---|---|---|---|---|
| `motion.library.title` | 场景动作库 | シーン動作ライブラリ | Scene Motion Library | 장면 동작 라이브러리 | 場景動作庫 |
| `motion.library.set_default` | 设为默认 | デフォルトに設定 | Set as default | 기본으로 설정 | 設為預設 |
| `motion.library.default_badge` | 默认 | デフォルト | Default | 기본 | 預設 |
| `motion.library.remove` | 删除动作 | 動作を削除 | Remove motion | 동작 삭제 | 刪除動作 |
| `motion.library.select_from` | 从场景库选择 | ライブラリから選択 | Select from library | 라이브러리에서 선택 | 從場景庫選擇 |
| `motion.library.empty` | 暂无场景动作，点击「浏览动作库」添加 | シーン動作なし。「動作ライブラリ」から追加 | No scene motions. Click "Browse Library" to add | 장면 동작 없음. "라이브러리 탐색"에서 추가 | 暫無場景動作，點擊「瀏覽動作庫」新增 |
| `motion.library.legacy_dropped` | 场景动作配置已升级，请重新加载动作 | シーン動作設定がアップグレードされました。再読込してください | Scene motion config upgraded. Please reload. | 장면 동작 설정이 업그레이드됨. 다시 로드하세요. | 場景動作設定已升級，請重新載入 |

---

## 后续迭代方向

- **动作预设组**：「演唱会包」一键加载多个主动作 + 给特定角色分配
- **主动作搜索/标签**：场景库超过 10 项时支持搜索
- **跨场景记住场景库**：若需「重开应用恢复场景库」，可将 `_sceneMotions` 快照进 `uiState`（届时须同步 Go struct + 重生成绑定）
- **主动作预览**：在主菜单 hover 主动作时实时预览骨骼动画（需性能评估）
- **时间轴位置保留**：角色切换动作时可选保留播放进度
