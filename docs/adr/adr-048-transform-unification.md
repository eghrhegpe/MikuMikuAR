# ADR-048: 变换系统统一 — 模型/灯光/道具移动一致性

> **日期**: 2026-07-06
> **状态**: 已完成 — 反序列化统一 + 输入验证均已实施。回调统一标记为可选（优先级低），未做
> **审查人**：Sisyphus
> **关联**：ADR-028(风场统一)、ADR-045(统一加载与资源管理)

---

## 背景

代码审查发现三类物体（模型/灯光/道具）的移动/变换机制存在显著不一致：

| 方面 | 模型 | 灯光 | 道具 |
|------|------|------|------|
| 位置 API | `modelManager.setPosition()` | `setStageLightState({posX/Y/Z})` | `setPropTransform({position})` |
| 轨道球坐标 | ❌ | ✅ orbitAzimuth/Elevation/Distance | ❌ |
| 位置输入验证 | ❌ | ❌ | ✅ `isValidPosition()` |
| 缩放验证 | ❌ | N/A | ✅ `isValidScaling()` |
| 反序列化方式 | **直接操作 Mesh** | `setStageLightState()` | `setPropTransform()` |
| 触发保存 | `onChange()` | `_triggerAutoSave()` | `triggerAutoSave()` |
| 多网格统一变换 | ❌ 仅 meshes[0] | N/A | ✅ container TransformNode |

---

## 1. 问题陈述

### 问题 1：反序列化路径不一致

`scene-serialize.ts:deserializeScene` 中，模型变换恢复**直接操作 Babylon.js Mesh**，绕过了 `modelManager.setPosition()` API：

```typescript
// 当前实现 — 直接操作 Mesh，绕过 API
inst.meshes[0].position.x = m.positionX;
inst.meshes[0].position.y = m.positionY;
inst.meshes[0].position.z = m.positionZ;
inst.meshes[0].scaling.setAll(m.scaling);
inst.meshes[0].rotation.y = m.rotationY;
```

而道具恢复使用正规 API：
```typescript
// 道具 — 通过 API
setPropTransform(propId, { position: [p.positionX, ...], ... });
```

**影响**：模型反序列化不触发 `onChange()`，可能导致状态同步丢失。

### 问题 2：模型移动无输入验证

`model-ops.ts:setModelPosition` 和 `model-manager.ts:setPosition` 接受任意 `x/y/z` 值，无 `isValidPosition()` 校验。

对比道具 (`props.ts:189-195`)：
```typescript
if (partial.position !== undefined) {
    if (!isValidPosition(partial.position)) {  // ✅ 验证
        console.warn('[props] setPropTransform: 无效的 position', partial.position);
        return;
    }
}
```

### 问题 3：保存回调机制三套

| 物体 | 保存触发 |
|------|---------|
| 模型 | `this.onChange()` (ModelManager 内部) |
| 灯光 | `_triggerAutoSave()` (module-level callback) |
| 道具 | `triggerAutoSave()` (scene module) |

---

## 2. 否决的方案

### 方案 A：引入统一 TransformManager

新增 `TransformManager` 类统一管理所有物体的变换。

**否决理由**：过度设计。三类物体的变换差异大（灯光有轨道控制、道具用 container、多网格处理不同），强行统一会引入不必要的适配层复杂度。

### 方案 B：仅加验证，不改反序列化

**否决理由**：`deserializeScene` 直接操作 Mesh 是一个已知的**不一致根源**，修复成本低（改 6 行），不修复会持续造成状态同步问题。

---

## 3. 决策

### 3.1 反序列化统一通过 API（必需）

`scene-serialize.ts:deserializeScene` 第 326-336 行，模型变换恢复改用 `modelManager` API：

```typescript
// 改前 ❌
inst.meshes[0].position.x = m.positionX;
inst.meshes[0].position.y = m.positionY;
inst.meshes[0].position.z = m.positionZ;
inst.scaling = m.scaling;
inst.meshes[0].scaling.setAll(m.scaling);
inst.rotationY = m.rotationY;
inst.meshes[0].rotation.y = m.rotationY;

// 改后 ✅
modelManager.setPosition(inst.id, m.positionX ?? 0, m.positionY ?? 0, m.positionZ ?? 0);
if (m.scaling !== undefined) modelManager.setScaling(inst.id, m.scaling);
if (m.rotationY !== undefined) modelManager.setRotationY(inst.id, m.rotationY);
```

**注意**：`setPosition` 当前无验证，需同步做 3.2。

### 3.2 模型变换增加输入验证（必需）

`model-manager.ts` 的 `setPosition` 和 `setScaling` 增加验证逻辑：

```typescript
// setPosition — 增加验证
setPosition(id: string, x: number, y: number, z: number): void {
    const inst = this.modelRegistry.get(id);
    if (!inst) return;
    // 验证：非 NaN、非 Infinity
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        console.warn('[model-manager] setPosition: 无效坐标', {x, y, z});
        return;
    }
    if (inst.meshes.length > 0) {
        inst.meshes[0].position.set(x, y, z);
    }
    this.onChange();
}

// setScaling — 增加验证（已有 Math.max(0.01, scaling)，保留但显式拒绝 NaN）
setScaling(id: string, scaling: number): void {
    if (!Number.isFinite(scaling) || scaling <= 0) {
        console.warn('[model-manager] setScaling: 无效值', scaling);
        return;
    }
    // ... 现有逻辑
}
```

### 3.3 回调机制统一（可选，优先级低）

当前三种保存触发机制共存：
- `this.onChange()` — 触发 `triggerAutoSave`（通过 `modelManager.onChange`）
- `_triggerAutoSave()` — 直接调用
- `triggerAutoSave()` — 直接调用

**决策**：暂不统一。当前链路已稳定运行，强行统一风险收益比低。如后续发现 `onChange` 未被调用导致 autosave 丢失，再行修复。

---

## 4. 影响范围

| 文件 | 改动 | 类型 |
|------|------|------|
| `frontend/src/scene/scene-serialize.ts` | 反序列化改用 API | 修复 |
| `frontend/src/scene/manager/model-manager.ts` | setPosition/setScaling 加验证 | 增强 |

**零新增依赖，零架构变更**。

---

## 5. 验证标准

1. `tsc --noEmit` 通过
2. `vite build` 通过
3. 场景保存/恢复后模型位置/缩放/旋转与保存前一致（人工验证）
4. `setPosition` 传入 `NaN`/`Infinity` 时控制台有 warning 且不生效
5. `setScaling` 传入 `0`/`-1`/`NaN` 时控制台有 warning 且不生效