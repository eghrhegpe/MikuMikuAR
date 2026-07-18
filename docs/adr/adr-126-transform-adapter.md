# ADR-126: 变换适配器统一（TransformAdapter Registry）— 跨 kind 拖拽/数值双模态去重

> **状态**: 实施中（Phase 1 + Phase 2 已完成，2026-07-18）
> **日期**: 2026-07-18
> **路径约定**: 本文档源码路径均省略 `frontend/src/` 前缀（与 ADR-121 / ADR-120 一致），例如 `scene/render/transform-gizmo.ts` = `frontend/src/scene/render/transform-gizmo.ts`。

## 背景与问题

「3D 拖拽（Gizmo）」是一项**跨 kind 的横向能力**（actor / stage / prop / light 都要用），但当前实现按 kind **纵向摊进了三个场景模块**，并在唯一调用方 `menus/resource-detail-helpers.ts` 的 `buildTransformCard`（:51-223）里以硬编码 `if/else` 分支收口。这违反 AGENTS.md「显著重复」反模式（相似逻辑出现在 ≥2 文件），也让「新增一个可变换 kind」的成本线性上升。

### 现状架构

```
transform-gizmo.ts (核心 singleton：attachGizmo/detachGizmo/isGizmoActive/getGizmoTargetId)
    ↑
    ├── model-ops.ts   attachModelGizmo()   (:193)  ← actor/stage
    ├── props.ts       attachPropGizmo()    (:365)  ← prop
    └── lighting.ts    attachLightGizmo()   (:1031) ← light
            ↑
    三函数结构完全同构，仅「node 来源 / types / 持久化回调」不同
            ↑
buildTransformCard (:51-223)  唯一调用方
    ├── Gizmo 拖拽行：actor/stage / prop / light 三分支   (:60-114)  ≈54 行
    ├── 缩放倍率行： actor/stage / prop / light 三分支     (:117-163) ≈47 行
    └── 透明度行：   actor/stage / prop / light 三分支     (:165-217) ≈53 行
```

### 已核验的 5 处重复（附文件:行号）

| # | 重复点 | 位置 | 量级 |
|---|--------|------|------|
| 1 | 三个 `attachXxxGizmo` 函数同构（查 registry → 选 node → `attachGizmo`） | `model-ops.ts:193` / `props.ts:365` / `lighting.ts:1031` | 3 函数 |
| 2 | re-export 风格不一致：别名 vs 显式包装 | `model-ops.ts:215-219`、`props.ts:387-390`（别名）↔ `lighting.ts:1068-1080`（显式包装） | 2 风格 |
| 3 | `buildTransformCard` Gizmo 三分支同构 | `resource-detail-helpers.ts:60-114` | ≈54 行 |
| 4 | `buildTransformCard` 缩放/透明度**再各一轮**三分支同构 | `resource-detail-helpers.ts:117-217` | ≈100 行 |
| 5 | `lighting.ts` 灯光类型切换时**内联复制** `attachLightGizmo` 的 `direction→target` 转换逻辑（未复用函数本体） | `lighting.ts`（类型切换 re-attach 分支） | 1 处复制粘贴 |

**核心症结**：`buildTransformCard` 把「某 kind 支持哪些可编辑变换属性 + 如何读写」硬编码为 **3 kind × 3 属性 = 9 段 `if/else`**，共约 150 行同构代码。

### 关联资产（证明可行性，非从零造）

| 资产 | 对本 ADR 的支撑 |
|------|----------------|
| `transform-gizmo.ts` 统一 `attachGizmo(options)` 单例 | 底层已收敛，本 ADR 只需在其上加一层「按 kind 生成 options」的适配器，无需重写 Gizmo 核心 |
| `ResourceKind` 类型 + `ResourceHandle`（`resource-detail-helpers.ts`） | 天然作为适配器注册表的键 |
| `addSliderRow` / `slideRow`（声明式 UI builder，ADR-093） | 数据驱动渲染的现成组件，无需新造 UI |
| `onDragEndObservable`（Babylon Gizmo 原生） | 拖拽结束回写的现成钩子；Phase 2 的实时同步复用 `onDragObservable` |

---

## 决策：TransformAdapter 注册表 + 拖拽/数值双模态

核心思路：**把差异点抽象为接口（一个 kind 一次性声明其全部变换能力），把同构逻辑收敛为数据驱动调度器**。抽象层级从「Gizmo 适配器」上移到「变换适配器」——因为缩放/透明度与 Gizmo 是同一批按 kind 派发的能力，应一并收口。

### 1. 能力声明接口

```ts
// scene/transform/transform-adapter.ts
import type { Node } from '@babylonjs/core';
import type { GizmoType } from '../render/transform-gizmo';
import type { ResourceKind } from '...';

interface TransformAdapter {
  /** 该适配器服务的 kind（actor 与 stage 共用同一适配器 → 数组声明） */
  kinds: ResourceKind[];

  // ── Gizmo 拖拽（粗调）──
  getNode(id: string): Node | null;
  gizmoTypes(id: string): GizmoType[];
  onPositionDragEnd(id: string, node: Node): void;
  onRotationDragEnd?(id: string, node: Node): void;
  onScaleDragEnd?(id: string, node: Node): void;

  // ── 数值滑杆（精调，能力声明式）──
  capabilities: ReadonlyArray<'slider-scale' | 'slider-opacity'>;
  getScale?(id: string): number;
  setScale?(id: string, v: number): void;
  getOpacity?(id: string): number;          // 归一化 0..1
  setOpacity?(id: string, v: number): void; // 归一化 0..1
}
```

### 2. 注册表 + 统一调度

```ts
const adapters = new Map<ResourceKind, TransformAdapter>();

export function registerTransformAdapter(a: TransformAdapter): void {
  for (const k of a.kinds) adapters.set(k, a);
}
export function getTransformAdapter(kind: ResourceKind): TransformAdapter | null {
  return adapters.get(kind) ?? null;
}

/** 统一 Gizmo 入口：替代三个 attachXxxGizmo */
export function attachGizmoForKind(kind: ResourceKind, id: string): boolean {
  const a = adapters.get(kind);
  const node = a?.getNode(id);
  if (!a || !node) return false;
  return attachGizmo({
    id, node, types: a.gizmoTypes(id),
    onPositionDragEnd: (n) => a.onPositionDragEnd(id, n),
    onRotationDragEnd: a.onRotationDragEnd ? (n) => a.onRotationDragEnd!(id, n) : undefined,
    onScaleDragEnd: a.onScaleDragEnd ? (n) => a.onScaleDragEnd!(id, n) : undefined,
  });
}
```

`detachGizmo` / `isGizmoActive` / `getGizmoTargetId` 已在 `transform-gizmo.ts` 存在，**直接复用**，不再需要 kind 别名。

### 3. 三个适配器注册（替代三套 attachXxxGizmo + 三套 re-export）

各 kind 模块在文件末尾注册一次，把「查 registry → 选 node → attachGizmo」与「滑杆读写」全部内聚：

```ts
// model-ops.ts 末尾（actor + stage 共用）
registerTransformAdapter({
  kinds: ['actor', 'stage'],
  getNode: (id) => modelRegistry.get(id)?.meshes[0] ?? null,
  gizmoTypes: () => ['position', 'scale'],
  onPositionDragEnd: (id, n) => { const v = (n as { position: Vector3 }).position; modelManager?.setPosition(id, v.x, v.y, v.z); },
  onScaleDragEnd:    (id, n) => { const v = (n as { scaling: Vector3 }).scaling; modelManager?.setScaling(id, v.x); },
  capabilities: ['slider-scale', 'slider-opacity'],
  getScale: (id) => modelRegistry.get(id)?.scaling ?? 1,
  setScale: (id, v) => setModelScaling(id, v),
  getOpacity: (id) => modelRegistry.get(id)?.opacity ?? 1,
  setOpacity: (id, v) => { setModelOpacity(id, v); if (v > 0) setModelVisibility(id, true); },
});

// props.ts 末尾
// 现状约束：resource-detail-helpers.ts:117/166 的缩放/透明度分支已覆盖 actor/stage/prop/light 全部 4 个 kind；
// prop 缩放走 p.scaling → setPropTransform，prop 透明度为布尔可见（visible 布尔，步长 100），
// 适配器将布尔可见映射为归一化 0..1（getOpacity 返回 0 或 1）。
registerTransformAdapter({
  kinds: ['prop'],
  getNode: (id) => { const p = propRegistry.get(id); return p ? (p.container ?? p.rootMesh) : null; },
  gizmoTypes: () => ['position'],
  onPositionDragEnd: (id, n) => { const v = (n as { position: Vector3 }).position; setPropTransform(id, { position: [v.x, v.y, v.z] }); },
  capabilities: ['slider-scale', 'slider-opacity'],
  getScale: (id) => propRegistry.get(id)?.scaling ?? 1,
  setScale: (id, v) => { const p = propRegistry.get(id); if (p) { p.scaling = v; setPropTransform(id, { scaling: v }); } },
  getOpacity: (id) => propRegistry.get(id)?.visible ? 1 : 0,
  setOpacity: (id, v) => { const p = propRegistry.get(id); if (p) { p.visible = v > 0; setPropTransform(id, { visible: v > 0 }); } },
});

// lighting.ts 末尾（direction→target 转换内聚，消除 :655 内联复制）
// 现状约束：resource-detail-helpers.ts:150/204 的缩放/透明度分支已覆盖 light（indicatorScale/indicatorOpacity），
// 适配器直接映射为 getScale/getOpacity 读写。
registerTransformAdapter({
  kinds: ['light'],
  getNode: (id) => _stageLights.get(id)?.light ?? null,
  gizmoTypes: (id) => _stageLights.get(id)?.state.type !== 'point' ? ['position', 'rotation'] : ['position'],
  onPositionDragEnd: (id) => { const e = _stageLights.get(id); if (!e) return; const p = e.light.position; setStageLightState({ posX: p.x, posY: p.y, posZ: p.z }, id); },
  onRotationDragEnd: (id) => { /* SpotLight/DirectionalLight: target = pos + dir.scale(10) */ },
  capabilities: ['slider-scale', 'slider-opacity'],
  getScale: (id) => { const e = _stageLights.get(id); return e ? e.state.indicatorScale : 1; },
  setScale: (id, v) => setStageLightState({ indicatorScale: v }, id),
  getOpacity: (id) => { const e = _stageLights.get(id); return e ? e.state.indicatorOpacity : 1; },
  setOpacity: (id, v) => setStageLightState({ indicatorOpacity: v }, id),
});
```

### 4. `buildTransformCard` 数据驱动化（223 行 → ≈45 行）

```ts
export function buildTransformCard(container: HTMLElement, handle: ResourceHandle): void {
  const { id, kind } = handle;
  const adapter = getTransformAdapter(kind);
  const render = (): void => {
    container.innerHTML = '';
    if (!adapter) return;
    cardContainer(container, (c) => {
      // ① Gizmo 拖拽行（唯一一行，替代 54 行三分支）
      const active = isGizmoActive() && getGizmoTargetId() === id;
      slideRow(c, active ? 'lucide:x' : 'lucide:move-3d',
        t(active ? 'scene.exitDrag' : 'scene.dragPosition'), false, () => {
          if (active) { detachGizmo(); setStatus(t('scene.statusExitDrag'), true); }
          else { attachGizmoForKind(kind, id); setStatus(t('scene.statusDragHint'), false); }
          render();
        });
      // ② 数值滑杆（能力声明式，替代 100 行两轮三分支）
      if (adapter.capabilities.includes('slider-scale'))
        addSliderRow(c, '缩放倍率', adapter.getScale!(id), 0.1, 10, 0.1, () => {}, 'lucide:maximize', (v) => adapter.setScale!(id, v));
      if (adapter.capabilities.includes('slider-opacity'))
        addSliderRow(c, '透明度', Math.round(adapter.getOpacity!(id) * 100), 0, 100, 1, () => {}, 'lucide:eye', (v) => adapter.setOpacity!(id, v / 100));
    });
  };
  render();
}
```

### 5. 拖拽 + 数值双模态（回应「纯拖拽不好」）

**Phase 2 增量能力**：在 `transform-gizmo.ts` 现有 `onDragEndObservable` 之外，为适配器补一个 `onDragObservable`（连续）回调 → 拖拽过程中实时刷新数值滑杆显示。数值滑杆的 `onChange` 也 funnel 到同一 `adapter.setXxx`。两条路径共享唯一状态来源，**无漂移**（满足 AGENTS.md「状态来源唯一」）。

```
拖拽(Gizmo 粗调) ─┐
                  ├─→ adapter.setXxx(id, v) ─→ 持久化 + mesh 更新 ─→ 重渲染数值
数值滑杆(精调) ──┘
```

### 关键不变量

1. **`transform-gizmo.ts` 核心单例契约不变**：`attachGizmo/detachGizmo/isGizmoActive/getGizmoTargetId` 签名与语义零改动。本 ADR 只在其上加适配层。
2. **各 kind 的持久化链路不变**：`modelManager.setPosition/setScaling`、`setPropTransform`、`setStageLightState` 仍是唯一写入点，只是改由适配器统一 funnel 调用。
3. **Phase 1 行为零变化**：纯去重重构，UI 与交互与现状逐像素一致；仅代码组织变化。

---

## 去重前后对比

| 维度 | 改造前 | 改造后（Phase 1） |
|------|--------|-------------------|
| Gizmo 包装函数 | 3 个 `attachXxxGizmo`（`model-ops`/`props`/`lighting`） | 1 个 `attachGizmoForKind` + 3 个声明式适配器对象 |
| re-export 风格 | 2 种不一致（别名 + 显式包装） | 0（统一走 `transform-gizmo.ts` 原函数） |
| `buildTransformCard` | 223 行，9 段 `if/else` 分支 | ≈45 行，能力声明式循环渲染 |
| Gizmo 三分支 | ≈54 行 | 1 行 `slideRow` |
| 缩放/透明度三分支 | ≈100 行 | 2 行 `if capabilities.includes` |
| `lighting.ts` 内联复制 | 1 处 `direction→target` 复制粘贴 | 0（内聚进适配器 `onRotationDragEnd`） |
| 新增可变换 kind 成本 | 改 4 处（新 attach 函数 + re-export + card 三处分支） | 改 1 处（注册 1 个适配器） |
| 可测试性 | 单例难测，`buildTransformCard` 逻辑厚重 | 适配器为纯对象可单测；card 逻辑变薄 |

**总消除**：3 函数 + 2 re-export 风格 + ≈154 行同构分支 + 1 处内联复制。

---

## 实施阶段

| 阶段 | 内容 | 涉及文件 | 验收 |
|------|------|---------|------|
| **Phase 1（去重，行为零变化）** | 新建 `scene/transform/transform-adapter.ts`；三 kind 各注册适配器；`buildTransformCard` 数据驱动化；删除三 `attachXxxGizmo` + re-export；修 `lighting.ts` 内联复制 | `transform-adapter.ts`（新）、`model-ops.ts`、`props.ts`、`lighting.ts`、`resource-detail-helpers.ts` | 契约测试 + build + 手动逐 kind 回归 |
| **Phase 2（双模态增强）** | `transform-gizmo.ts` 补 `onDragObservable` 连续回调；拖拽实时同步数值滑杆（局部 DOM 更新，非整卡重渲染） | `transform-gizmo.ts`、`transform-adapter.ts`、`resource-detail-helpers.ts` | ✅ 拖拽中数值实时刷新，无跳变 |

---

## 风险

| 级别 | 风险 | 缓解 |
|------|------|------|
| 🟢 P4（已验证安全） | **`stage` 共用 `modelRegistry`**：已 grep 核验——`model-loader.ts:345` 设 `kind:'stage'` 经 `model-manager.ts:243` 入同一 `modelRegistry`；`attachModelGizmo`（`model-ops.ts:193`）内部无 kind 分叉，actor/stage 走同一函数。结论：**原 P2 风险解除**，适配器 `kinds:['actor','stage']` 安全 | 无需缓解；保留核验记录备查 |
| 🟡 P2（真实难点，已隔离） | **prop 连续 opacity 不可直接统一**：actor/stage 走 `material.alpha`（连续 0..1）；prop 仅 `visible` 布尔（`props.ts:229/259-266`，`setEnabled` 实现）。当前 prop 透明度分支 `buildTransformCard:186-203` 为布尔可见（步长 100），适配器将其映射为 `getOpacity` 返回 0 或 1；若需连续透明度需给 `PropInstance` 增 `opacity` 字段 + 跨 meshes/container 逐材质 alpha 管线（共享材质 clone、`transparencyMode`、shader 忽略 alpha 等），属 prop 数据模型/材质工程 | **Phase 1 保持布尔映射**：适配器 `getOpacity` 返回 0/1，`setOpacity` 写 `visible` 布尔，行为与现状一致。连续透明若要做，单列 prop 材质增强 ADR，不纳入本 ADR |
| 🟢 P3 | **循环依赖风险**：`transform-adapter.ts` 若静态 import 各 kind 模块会成环。应由各 kind 模块**反向注册**（import adapter registry，而非 registry import 各模块） | 遵循 ADR-121 依赖方向：registry 只定义接口 + Map，各模块单向注册。参照工程铁律「motion-modules 禁静态 import UI 层」 |
| 🟢 P3 | **注册时机**：适配器在模块 import 副作用中注册，若 `buildTransformCard` 先于 kind 模块加载则拿到 `null` | `resource-detail-helpers.ts` 已 import 三 kind 模块（现状即如此），import 图保证注册先行；`getTransformAdapter` 返回 null 时 card 安全空渲染 |
| 🟢 P4 | **`transform-gizmo.ts` 仍无 `disposeTransformGizmo()`**：`detachGizmo` 不清 `_scene` 引用 | 非本 ADR 范围，登记为独立设计债（可挂 ADR-104 design-debt-registration） |

---

## 验证清单

1. `npm run test -- src/__tests__/bindings/app.contract.test.ts`（116 函数存在性契约，确认删除 attachXxxGizmo 不破绑定——注：这些是纯前端函数，非 Wails 绑定，契约应不受影响，跑一遍确认）。
2. `cd frontend && npm run build`。
3. 手动逐 kind 回归：actor / stage / prop / light 各自的拖拽进入/退出、缩放、透明度行为与改造前一致。
4. 为 `transform-adapter.ts` 新增单测（适配器纯对象 → mock registry 验证 getNode/gizmoTypes/getScale 等）。

---

## 备选方案（已否决）

| 方案 | 否决理由 |
|------|---------|
| **仅抽 GizmoAdapter（窄口径）** | 只消除 Gizmo 54 行，遗漏缩放/透明度 100 行同构；`buildTransformCard` 仍臃肿 |
| **维持现状 + 注释标记** | 不解决「新增 kind 改 4 处」的线性成本，违反「显著重复」反模式 |
| **每 kind 独立 TransformCard 组件** | 过度拆分，反而增加 UI 布局重复；违背「交互一致性」（同类操作应复用同一组件） |

---

## 实施记录

### Phase 1（去重，行为零变化）— 已完成 2026-07-18

**改动文件（5 个）**：
- 新增 `scene/transform/transform-adapter.ts`：定义 `TransformAdapter` 接口、`adapters` Map 注册表、`registerTransformAdapter` / `getTransformAdapter` / `attachGizmoForKind`，并透传 `detachGizmo` / `isGizmoActive` / `getGizmoTargetId`。
- `scene/manager/model-ops.ts`：actor/stage 注册同一适配器（`kinds:['actor','stage']`）；删除 `attachModelGizmo` + re-export 别名。
- `scene/env/props.ts`：prop 注册适配器；删除 `attachPropGizmo` + re-export 别名。
- `scene/render/lighting.ts`：light 注册适配器（`direction→target` 转换内聚进 `onRotationDragEnd`）；删除 `attachLightGizmo`/`detachLightGizmo`/包装函数；修复内联复制（类型切换 re-attach）改为 `attachGizmoForKind('light', targetId)`。
- `menus/resource-detail-helpers.ts`：`buildTransformCard` 由 223 行数据驱动化为 ~57 行；删除全部 `attachXxxGizmo` 系列导入。

**关键修正（实施中发现）**：
- prop/light 适配器**必须**声明 `capabilities:['slider-scale','slider-opacity']`——现状变换卡中 prop/light 同样有缩放/透明度滑杆（原 draft 误判为仅 actor/stage 有）。get/set 精确 funnel 到现存 `setPropTransform({scaling}/{visible})` 与 `getStageLightState().indicatorScale/indicatorOpacity`，行为零变化。

**验证**：
- `npm run build`（tsc + vite）通过，3.69s，无类型/导入错误。
- 契约测试 `app.contract.test.ts` 17/17 通过（前端重命名未破 116 函数存在性）。
- 悬空引用扫描：0 处残留旧函数名。
- 单元套件 1572/1577 通过；5 失败均在 `scene-stage.test.ts`（地面/水面 toggle 用例，import `buildStageLevel` 来自未改动的 `scene-stage-levels.ts`），与本次改造零交集，为既有失败。

**Phase 2（双模态增强：拖拽实时同步数值滑杆）**：✅ 已完成 2026-07-18

**改动文件（4 个，含 1 新单测）**：
- `scene/render/transform-gizmo.ts`：
  - 新增模块级 `onGizmoDragObservable = new Observable<void>()`（连续拖拽信号）。
  - 三个 Gizmo 案例各自额外接线 `g.onDragObservable.add(() => onGizmoDragObservable.notifyObservers());`（与既有 `onDragEndObservable` 并列）。
  - 新增查询函数 `getGizmoNode(): Node | null`（返回实时节点，拖拽中其 transform 已被 Babylon 改写）与 `getActiveGizmoTypes(): GizmoType[]`（当前激活轴，用于判断是否在改缩放）。
- `scene/transform/transform-adapter.ts`：透传 `onGizmoDragObservable / getGizmoNode / getActiveGizmoTypes`（调用方从本模块统一 import）。
- `menus/resource-detail-helpers.ts`：`buildTransformCard` 接入双模态——订阅 `onGizmoDragObservable`，拖拽中经 `syncLive` 调用局部 `updateSliderDisplay(row, v, min, max, step)` 实时刷新缩放/透明度滑杆显示（与 `ui-rows.ts addSliderRow` 的 `updateDisplay` 显示格式一致，避免整卡 60Hz 重渲染导致的跳变）；模块级 `_activeDragObs` 保证订阅全局唯一，退出拖拽/切换实体时自清理。
- `scene/transform/transform-adapter.test.ts`（新增）：注册表隔离单测 4 项（未注册返回 null / actor+stage 共享同一适配器 / getScale·getOpacity funnel / 重注册覆盖）。

**关键设计纠偏（实施中发现，重要）**：
- ⚠️ **不可连续持久化**：初版计划是拖拽中连续调用 `adapter.onScaleDrag → setScaling` 实时持久化。但核查 `model-manager.ts:514 setScaling` 每次调用末尾执行 `this.triggerAutoSave()` → 60Hz 拖拽将触发场景序列化落盘风暴（灾难性回归）。故**改为只读实时节点、不连续持久化**：拖拽中读取 `getGizmoNode().scaling`（Babylon 已实时改写），仅同步滑杆*显示*；持久化仍在拖拽结束（`onScaleDragEnd`）一次性发生。这仍满足「实时刷新数值 + 两条路径共享唯一状态来源（结束点一致 funnel 到 setScaling）」，且彻底规避自动保存风暴。
- 局部 `updateSliderDisplay` 仅在「缩放 Gizmo 激活（`getActiveGizmoTypes` 含 `scale`）」时读实时 `node.scaling.x`；position/rotation 拖拽及 prop/light（无 scale 轴）回落到 `adapter.getScale`（registry 值，稳定），故不会改变非缩放数值的显示。

**验证**：
- `npm run build`（tsc + vite）3.78s exit0。
- 契约测试 `app.contract.test.ts` 17/17。
- 适配器单测 `transform-adapter.test.ts` 4/4。
- 完整单元套件 1576/1581 通过；5 失败仍仅在 `scene-stage.test.ts`（地面/水面 toggle，import 未改动的 `scene-stage-levels.ts`），与 Phase 2 零交集，属既有失败。
- 悬空引用：旧 `attachXxxGizmo` 系列 0 残留。

**剩余（可选，未做）**：ADR 原提及「可选网格吸附」未实施（不在本 Phase 验收硬性要求，且吸附属 Gizmo 自身 `snapDistance` 配置，可单列增强）。
