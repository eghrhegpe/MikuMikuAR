# ADR-123: `_computeOverride` 语义正式化 — weight≥1 复合、overrideRotation 标志、absolute 模式

> **日期**: 2026-07-17
> **状态**: P1 已实施（2026-07-21）— `absolute` 标志已加入 `_OverrideSlot`/`OverrideSlotLike`/`BoneOverrideEntry`，`_computeOverride` 已增加 absolute 分支，高级骨骼覆盖 UI 写 `absolute=true`；P2（`restoreOverrides` 处理）已完成
> **背景**: 2026-07-17 修复 `_computeOverride` `weight≥1` 从绝对覆盖改为复合父骨传播旋转后，核心语义已变更。本 ADR 正式记录此语义，并规划后续的 `absolute` 模式扩展。

---

## 一、`_computeOverride` 当前语义

```ts
export function _computeOverride(
    oldTranslation: Vector3,
    oldRotation: Quaternion,
    slot: OverrideSlotLike
): { translation: Vector3; rotation: Quaternion } {
    const translation = slot.pos ? oldTranslation.add(slot.pos) : oldTranslation;
    const rotation = slot.overrideRotation
        ? slot.weight >= 1
            ? oldRotation.multiply(slot.quat)  // 复合
            : Quaternion.Slerp(oldRotation, slot.quat, slot.weight)
        : oldRotation;
    return { translation, rotation };
}
```

### 语义定义

| 参数 | 含义 |
|------|------|
| `oldTranslation` | 当前世界平移（来自动画或父骨传播） |
| `oldRotation` | 当前世界旋转（来自动画或父骨传播） |
| `slot.quat` | 本骨的目标旋转（模块设定的绝对旋转值） |
| `slot.weight` | 混合权重 0-1，≥1 视为完全生效 |
| `slot.overrideRotation` | true=覆盖旋转，false=保留旧旋转 |
| `slot.pos` | 可选位置偏移量（加法语义） |

### 输出

| 字段 | 含义 |
|------|------|
| `translation` | `oldTranslation + slot.pos`（加法偏移） |
| `rotation` | `weight≥1` → `oldRotation × slot.quat`（复合）；`0<weight<1` → Slerp 混合；`overrideRotation=false` → 保留 |

---

## 二、`weight≥1` 复合语义

### 公式

```
final = oldRotation × slot.quat
```

### 含义

`slot.quat` 是**本骨的目标旋转**（绝对旋转值），`oldRotation` 是**当前世界旋转**（含父骨传播）。复合结果 = 父骨传播旋转 × 本骨覆盖。

### 三种场景

| 场景 | oldRotation | 结果 | 说明 |
|------|-------------|------|------|
| 无父骨覆盖，无动画旋转 | `Identity` | `slot.quat` | 绝对覆盖（等价旧行为） |
| 有父骨传播 | `父骨旋转 × 子骨动画` | `父骨旋转 × 子骨动画 × slot.quat` | 保留父骨 + 子骨动画 |
| 有父骨传播，子骨动画≈Identity | `父骨旋转` | `父骨旋转 × slot.quat` | 保留父骨，叠加本骨覆盖 |

### 与旧行为的兼容性

`oldRotation=Identity` 时结果与旧行为完全一致。所有现有单测（`oldRotation` 均为 `Identity`）通过。

---

## 三、`overrideRotation` 标志

### 作用

控制是否覆盖旋转。`false` 或 `undefined` 时保留 `oldRotation`，仅叠加位置偏移。

### 使用场景

| 场景 | overrideRotation | 说明 |
|------|-----------------|------|
| `setBoneOverride` | `true` | 旋转覆盖 |
| `setBoneOverridePosition` | `false` | 仅位置偏移，不碰旋转 |
| 高级骨骼覆盖（手动设值） | `true` | 用户手动设定旋转 |

### 未来扩展

后续可增加 `overridePosition` 标志，分离位置覆盖控制（当前位置由 `slot.pos` 存在与否决定，无独立标志）。

---

## 四、`absolute` 模式（未来扩展）

### 需求

高级骨骼覆盖中，用户有时需要**绝对旋转**（完全替换动画旋转，不复合）。当前 `weight≥1` 已改为复合，不满足此需求。

### 方案

在 `_OverrideSlot` 中增加 `absolute?: boolean` 标志：

```ts
interface _OverrideSlot {
    quat: Quaternion;
    weight: number;
    enabled: boolean;
    pos?: Vector3;
    overrideRotation?: boolean;
    /** [doc:adr-123] true=绝对覆盖（替换 oldRotation），false=复合（默认） */
    absolute?: boolean;
}
```

`_computeOverride` 逻辑变为：

```ts
const rotation = slot.overrideRotation
    ? slot.weight >= 1
        ? slot.absolute
            ? slot.quat              // 绝对覆盖
            : oldRotation.multiply(slot.quat)  // 复合（默认）
        : Quaternion.Slerp(oldRotation, slot.quat, slot.weight)
    : oldRotation;
```

### 使用场景

| 场景 | absolute | 说明 |
|------|----------|------|
| 模块层覆盖（body-posture 等） | `false`（默认） | 复合，保留父骨传播 |
| 高级骨骼覆盖（手动设值） | `true` | 绝对，替换动画旋转 |
| `setBoneOverride` API | `false`（默认） | 向后兼容 |

---

## 五、实施分期

| 阶段 | 内容 | 验收 |
|------|------|------|
| **P0** | 本 ADR 作为正式语义记录 | 已写入 |
| **P1** | 新增 `absolute` 标志到 `_OverrideSlot` 和 `BoneOverrideEntry` | tsc 通过 |
| **P1** | `_computeOverride` 增加 `absolute` 分支 | 单测覆盖 |
| **P1** | 高级骨骼覆盖 UI 写 `absolute=true` | 手动覆盖行为与修复前一致 |
| **P2** | `restoreOverrides` 处理 `absolute` 字段 | 持久化正确 |