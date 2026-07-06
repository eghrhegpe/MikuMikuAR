# ADR-049: 轨道控制统一 — 球面坐标扩展到模型/道具

**日期**：2026-07-06
> **状态**：已实现（2026-07-06 落地 Phase 1 + Phase 2，`tsc --noEmit` 与 `vite build` 通过）
> **关联**：ADR-048(变换系统统一)、ADR-037(会话UI改进)

---

## 8. 实现记录（2026-07-06）

### 8.1 落地范围
- 新增 `core/orbit.ts`：统一 `orbitToCartesian` / `cartesianToOrbit`，公式与 `lighting.ts` 完全一致（避免各子系统重复实现漂移）。
- `core/types.ts`：`ModelInstance` / `PropInstance` 增加 `positionMode` + `orbitAzimuth/Elevation/Distance`（均为可选，向后兼容）。
- `model-manager.ts`：`setOrbit` / `getOrbit` / `setPositionMode` / `getPositionMode`（orbit→cartesian 写入 `meshes[0].position`，模式切换无跳变）。
- `model-ops.ts`：薄封装 `setModelOrbit` / `getModelOrbit` / `setModelPositionMode` / `getModelPositionMode`。
- `props.ts`：`setPropOrbit` / `getPropOrbit` / `setPropPositionMode` / `getPropPositionMode`。
- `scene-serialize.ts`：模型/道具序列化与反序列化加入 orbit 字段，`positionMode==='orbit'` 时优先 `setOrbit` 还原。
- `resource-detail-helpers.ts`：`buildTransformCard` 增加「坐标模式」切换（笛卡尔/轨道），轨道模式下滑条切换为 方位角/仰角/距离；actor / stage / prop 三处入口统一覆盖。

### 8.2 验证
- `tsc --noEmit`：0 错误
- `vite build`：成功（481 modules，2.03s → 后续回归修复后 1.87s）
- `vitest run`：1063 passed / 0 failed（含 `model-detail-ui.test.ts` 的 `buildModelLevel` 两用例，已修复，见 8.3）。
- 兼容旧场景：缺失 `positionMode` 时默认 `'cartesian'`，行为不变。

### 8.3 回归修复（2026-07-06 21:32）
- 问题：`buildTransformCard` 的 `render()` 闭包开头用 `container.innerHTML = ''` 清空**整个** container，会抹掉同一次 `buildModelLevel.renderCustom` 里先 append 的折叠组（外观/信息/工具），导致模型详情面板的折叠组在测试与真实 UI 中均不显示。
- 修复：`buildTransformCard` 改为自管理 `root` 子容器（`style.display='contents'`，布局透明），`render()` 只清 `root.innerHTML`，`cardContainer(root, ...)` 替代 `cardContainer(container, ...)`。
- 测试债清理：`model-detail-ui.test.ts` 的 `buildModelLevel` 两用例原断言依赖已淘汰的 `.slide-item`/`.slide-label` class（UI 重构后迁移至 `.cs-row`/`.cs-label`/`.collapsible-label`）。已改为检查 `.collapsible-wrapper>0`（验证折叠组不再被误清）+ `container.textContent` 包含关键标签（不依赖具体 class）。


---

## 0. 背景

灯光系统独有球面坐标轨道控制（`StageLightState.orbitAzimuth / orbitElevation / orbitDistance`），可以通过三个参数以原点为中心旋转灯光位置。模型和道具仅有笛卡尔坐标（x/y/z）定位方式，无法以类似"围绕原点旋转"的方式操控。

| 物体 | 位置控制方式 | 轨道控制 |
|------|-------------|---------|
| 灯光 | 球面坐标（orbitAzimuth/Elevation/Distance）+ 笛卡尔（posX/Y/Z）双模式 | ✅ azimuth ±180°, elevation -90~90°, distance |
| 模型 | 仅笛卡尔 `position.set(x, y, z)` | ❌ |
| 道具 | 仅笛卡尔 `target.position.set(x, y, z)` | ❌ |

---

## 1. 问题陈述

### 1.1 缺少统一的"围绕原点转动"能力

灯光可通过 `orbitAzimuth` 和 `orbitElevation` 实现以原点为中心的球面旋转定位。而模型/道具要绕原点旋转，需要手动计算三角函数再设 position，**无法通过 UI 直接操作**。

### 1.2 UI 交互不一致

灯光轨道控制在 `scene-stage-lights.ts` 中有专属 UI 控件（azimuth/elevation/distance 滑条）。模型/道具的详情的变换面板仅有 X/Y/Z 滑条。

### 1.3 状态同步负担

灯光有双模式同步逻辑（`_applyStageLightParams` 中 orbit → pos 的转换），模型和道具如果未来引入类似功能需要重新实现。

---

## 2. 否决的方案

### 方案 A：引入通用 Gizmo（直接拖动操作）

如 DanceXR 的 Gizmo Cube，允许用户在 3D 视口中直接拖拽/旋转物体。

**否决理由**：需要实现 Babylon.js GizmoManager 集成 + 鼠标/触控交互 + 焦点管理，工程量远超当前需求。保留到 P2 评估。

### 方案 B：仅给道具加轨道控制，模型不加

**否决理由**：模型是场景中最常被定位的物体，不统一等于没做。

### 方案 C：模型/道具改为纯球面坐标，废弃笛卡尔

**否决理由**：破坏向后兼容性，旧场景文件无法恢复。且笛卡尔坐标在精细定位（对齐到网格等）场景下更直观。

---

## 3. 决策

### 3.1 双模式共存（笛卡尔 + 球面）

仿照灯光设计，模型和道具同时支持两种坐标体系：

```
PositionMode: 'cartesian' | 'orbit'
```

- **笛卡尔模式**：当前行为，`position.set(x, y, z)`
- **轨道模式**：通过 `orbitAzimuth / orbitElevation / orbitDistance` 计算 position

切换模式时自动同步（轨道→笛卡尔用球面公式，笛卡尔→轨道用反推公式）。

### 3.2 数据模型变更

**`ModelInstance`**（`core/types.ts`）增加：
```typescript
positionMode?: 'cartesian' | 'orbit';   // 默认 'cartesian'
orbitAzimuth?: number;    // -180~180
orbitElevation?: number;  // -90~90
orbitDistance?: number;   // > 0
```

**`PropInstance`**（`core/types.ts`）同增。

**`SceneFile` 格式**：
```typescript
// model/prop 序列化字段增加（版本不变，新增可选字段）
orbitAzimuth?: number;
orbitElevation?: number;
orbitDistance?: number;
```

### 3.3 API 变更

**`model-manager.ts`** 新增：
```typescript
setOrbit(id, azimuth, elevation, distance): void
getOrbit(id): { azimuth: number, elevation: number, distance: number } | null
setPositionMode(id, mode: 'cartesian' | 'orbit'): void
```

**`props.ts`** 的 `setPropTransform` 增加 orbit 参数支持。

### 3.4 UI 变更

模型/道具详情面板（`resource-detail-helpers.ts`）的 `buildTransformCard` 增加：

- 模式切换开关（笛卡尔 ↔ 轨道）
- 轨道模式下：X/Y/Z 滑条替换为 Azimuth / Elevation / Distance 滑条

---

## 4. 影响范围

| 层 | 文件 | 改动量 |
|----|------|--------|
| 数据模型 | `core/types.ts`（ModelInstance / PropInstance） | ~10 行 |
| 模型管理 | `model-manager.ts`（setOrbit, getOrbit, setPositionMode） | ~30 行 |
| 道具管理 | `props.ts`（setPropTransform orbit 支持） | ~15 行 |
| 序列化 | `scene-serialize.ts`（serialize/deserialize 字段） | ~20 行 |
| 序列化 | `scene-serialize.ts`（SceneFile 类型扩展） | ~5 行 |
| UI | `resource-detail-helpers.ts`（buildTransformCard） | ~40 行 |
| UI | `buildStageTransformLevel` 类似 | ~20 行 |
| **合计** | | **~140 行** |

---

## 5. 实施计划

### Phase 1 — 数据模型 + 核心 API（P0）

1. `core/types.ts`: ModelInstance / PropInstance 增加 orbit 字段
2. `model-manager.ts`: 实现 `setOrbit` / `getOrbit` / `setPositionMode`，包含 orbit → cartesian 转换
3. `props.ts`: `setPropTransform` 增加 orbit 支持
4. `scene-serialize.ts`: 序列化/反序列化 orbit 字段

### Phase 2 — UI（P1）

1. `resource-detail-helpers.ts`: `buildTransformCard` 增加模式切换 + orbit 滑条
2. `buildStageTransformLevel`: 同步（stage 也是 ModelInstance）

### Phase 3 — 验证

1. 新旧场景文件兼容（旧文件缺失 orbit 字段默认为 'cartesian'）
2. 模式切换时位置无跳变（笛卡尔↔轨道互相转换精确）
3. UI 滑条联动正确

---

## 6. 验证标准

1. 设置 `orbitAzimuth=45, orbitElevation=30, orbitDistance=10` 后 `getPosition` 返回正确的笛卡尔坐标
2. 切换回笛卡尔模式再切回轨道模式，位置不变
3. 旧场景文件加载后 positionMode 默认 'cartesian'，行为不变
4. `tsc --noEmit` 通过
5. `vite build` 通过

---

## 7. 后续

若后续需要直观点击拖动（Gizmo），可在轨道控制基础上增加 GizmoManager 集成，轨道控制的值随 Gizmo 拖动实时更新。两者不冲突。