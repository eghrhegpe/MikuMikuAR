# 骨骼覆盖父子骨冲突：`_computeOverride` weight≥1 丢弃父骨传播旋转

**发现日期**：2026-07-17
**严重度**：🔴 P1（功能缺陷，覆盖系统核心逻辑错误）

---

## 问题描述

动作覆盖模块中，同时启用 `body-posture` 的倾斜/弯腰（pitch）和 `hand-symmetry` 的扭转（yaw）时，子骨（`上半身2`）的覆盖会丢失父骨（`上半身`）的传播旋转。

具体表现：
- **扭腰**（`上半身2` yaw）→ 子骨（头、肩、臂）跟随旋转 ✅
- **弯腰/侧倾**（`上半身` pitch）→ 子骨（含 `上半身2` 及其子孙）不跟随 ❌

---

## 根因分析

### 管线顺序

```
VMD 动画 → IK 解算 → Feet Adjustment → Bone Override → 渲染
```

`_propagateChildrenWasm` 在父骨覆盖后正确更新了子骨的 `worldMatrix`（含父骨旋转），但后续 `_applyWasmOverride` 调用 `_computeOverride` 时，`weight >= 1` 分支直接返回 `slot.quat`（绝对旋转），**丢弃了父骨传播过来的旋转**。

```ts
// 错误代码
const rotation = slot.overrideRotation
    ? slot.weight >= 1
        ? slot.quat  // ← 绝对覆盖，丢弃 oldRotation（含父骨传播）
        : Quaternion.Slerp(oldRotation, slot.quat, slot.weight)
    : oldRotation;
```

### 传播链

```
上半身 覆盖 → _propagateChildrenWasm 更新上半身2.worldMatrix
              → 上半身2.worldMatrix = 上半身倾斜 × 上半身2动画(≈Identity)
              
上半身2 覆盖 → _applyWasmOverride 读取上半身2.worldMatrix
              → _computeOverride weight≥1 → slot.quat(扭转)
              → 上半身2.worldMatrix = 上半身2扭转(绝对)  ← 上半身倾斜丢失！
```

---

## 修复方案

### `_computeOverride` weight≥1 改为复合

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

### 修复后传播链

```
上半身 覆盖 → _propagateChildrenWasm 更新上半身2.worldMatrix
              → 上半身2.worldMatrix = 上半身倾斜 × 上半身2动画
              
上半身2 覆盖 → _applyWasmOverride 读取上半身2.worldMatrix
              → _computeOverride weight≥1 → oldRotation × slot.quat
              = 上半身倾斜 × 上半身2扭转  ← 父骨保留！
```

---

## 影响范围

| 模块 | 影响 |
|------|------|
| `body-posture.ts` | tilt/bend/twist 参数组合时，子骨正确继承父骨旋转 |
| `hand-symmetry.ts` | 无影响（仅操作手腕骨，层级独立） |
| `sway-motion.ts` | 影响 `センター` 的传播（根骨覆盖） |
| `riding-model.ts` | 影响 `腰`→`左足/右足` 的传播链 |
| `position-offset.ts` | 无影响（仅位置覆盖，不涉及旋转复合） |
| `finger-pose.ts` | 无影响（指骨层级独立） |
| 高级骨骼覆盖 | 行为变更：`weight=1` 从绝对覆盖改为与动画旋转复合。对于 `oldRotation=Identity` 的骨骼结果不变；对于有动画旋转的骨骼，覆盖会叠加而非替换 |

---

## 验证结果

- `tsc --noEmit` ✅
- `vitest run src/__tests__/scene/bone-override.test.ts` — 6 tests passed ✅
- 相关单测：`motion-modules-registry.test.ts`、`motion-modules-timed.test.ts`、`motion-math.test.ts` ✅

---

## 教训

**`_computeOverride` 的 `weight>=1` 语义不是「绝对覆盖」，而是「在现有变换之上叠加」**。`oldRotation` 可能来自三处：
1. 动画旋转（无父骨覆盖时）
2. 父骨传播旋转（有父骨覆盖时）
3. 前两者的混合

`slot.quat` 应与此 `oldRotation` 复合，而非替换。后续若需「绝对覆盖」行为，应增加新标志（如 `absolute: true`）而非改变 `weight` 的语义。