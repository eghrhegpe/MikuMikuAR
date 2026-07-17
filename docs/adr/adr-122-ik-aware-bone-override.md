# ADR-122: IK 感知骨骼覆盖 — 运动模块 IK 适配

**日期**: 2026-07-17
> **状态**: 规划中
> **背景**: `riding-model` 模块直接写 `左足/右足` 骨骼，绕过 MMD 腿部 IK 求解器，导致覆盖与 IK 每帧冲突。`feet-adjustment` 已实现正确的 MMD-native IK 驱动模式，本 ADR 将其推广到运动模块层。

---

## 一、问题

### 当前管线顺序

```
VMD 动画 → IK 解算(MmdRuntimeModel._update) → Feet Adjustment → Bone Override → 渲染
```

Bone Override 在 IK 解算之后执行，所以直接写 `左足/右足`（riding-model 的做法）在当前帧有效。但 IK 解算器在下一帧 VMD 动画后会重跑，覆盖掉上一帧的 override 值，导致：

- **riding-model 足部姿态每帧被 IK 重算覆盖**，仅靠 override 每帧重新写入勉强维持
- **无法与 feet-adjustment 共存**：feet-adjustment 驱动 IK 目标骨 + solve，riding-model 直接写足骨，两者冲突

### 涉及模块

| 模块 | 当前做法 | 问题 |
|------|---------|------|
| `riding-model.ts` | 直接写 `左足/右足/左ひざ/右ひざ` | 绕过 IK，足部姿态与 IK 求解器冲突 |
| `body-posture.ts` | 写 `上半身/上半身2` | 非 IK 骨，无影响 |
| `hand-symmetry.ts` | 写 `左手首/右手首` | MMD 无手 IK，无影响 |
| `feet-adjustment.ts` | 驱动 `左足IK/右足IK` + `ikSolver.solve()` | ✅ 正确模式 |

---

## 二、IK 感知覆盖方案

### 核心思路

> 不添加用户可见的 IK 开关，而是提供引擎级 IK 辅助函数，让需要 IK 的模块透明调用。

### IK 辅助函数

在 `bone-override.ts` 或 `module-base.ts` 新增：

```ts
/**
 * IK 感知的骨骼覆盖。
 * 如果目标骨是 IK 链末端（有 ikSolver），驱动 IK 目标骨 + 重解；
 * 否则回退直接写 bone。
 */
function applyBoneOverrideIK(
    boneName: string,
    euler: [number, number, number],
    weight: number,
    modelId: string,
    getRuntimeBones: () => readonly IMmdRuntimeBone[]
): void {
    // 1. 先写 bone（当前 override 逻辑）
    setBoneOverride(boneName, euler, weight, true, modelId);
    
    // 2. 检测 IK 求解器，有则重解
    const bones = getRuntimeBones();
    const rb = bones.find((b) => b.name === boneName);
    if (rb) {
        const solver = (rb as MmdRuntimeBoneExtended).ikSolver;
        if (solver) {
            solver.solve(false);
        }
    }
}
```

### riding-model 适配

| 骨骼 | 当前写入 | 适配后 |
|------|---------|--------|
| `腰` | `setBoneOverride` | 不变（非 IK） |
| `左ひざ/右ひざ` | `setBoneOverride` | `applyBoneOverrideIK` |
| `左足/右足` | `setBoneOverride` | `applyBoneOverrideIK` |

### 与 feet-adjustment 的共存

| 系统 | 注册顺序 | 职责 |
|------|---------|------|
| Feet Adjustment | 先（`beforeRender` 早期） | 地面跟随：驱动 IK 目标到地面 + solve |
| Bone Override | 后（`beforeRender` 晚期） | 用户姿态：在 IK 结果上叠加旋转 |

两者通过 `ikSolver.solve()` 共享 IK 解算器，互不冲突：feet-adjustment 设位置，bone-override 叠加旋转。

---

## 三、实施分期

| 阶段 | 内容 | 验收 |
|------|------|------|
| **P1** | 新增 `applyBoneOverrideIK` 辅助函数 | tsc 通过 |
| **P1** | riding-model 适配：膝/足骨改用 IK 感知写入 | 足部姿态不与 IK 冲突 |
| **P2** | 在 `module-base.ts` 中暴露 IK 辅助函数 | 新模块可复用 |
| **P3** | 高级骨骼覆盖 UI 中 IK 骨骼标记 | 用户可感知 IK 与非 IK 骨的区别 |

---

## 四、风险与缓解

| 风险 | 缓解 |
|------|------|
| `ikSolver` 在某些模型上为 null | 回退直接写 bone，不报错 |
| `ikSolver.solve()` 每帧调用性能 | solve 一次迭代极轻量，与 feet-adjustment 同量级 |
| 与 feet-adjustment 的 solve 顺序冲突 | 两者共享同一 ikSolver，后调用的 solve 覆盖前一次结果，但 bone-override 设的是旋转偏移而非位置，不冲突 |

---

## 五、参考实现

`feet-adjustment.ts` 中已有完整 MMD-native IK 驱动模式：

```ts
// 驱动 IK 目标骨骼世界坐标
ik.setWorldTranslation(_vTarget);
// 重解该腿 IK（solve 内部回写踝 + 链骨骼 worldMatrix）
const solver = (ik as MmdRuntimeBoneExtended).ikSolver;
if (solver) {
    solver.solve(false);
}
```