# ADR-016: 视线追踪子系统架构

**日期**：2026-07-03
> **状态**: 已完成 — 双路径方案已实施（WASM frontBuffer 直写 + JS linkedBone + updateWorldMatrix），手动计时方案（方案 A）为优化项，需上游 babylon-mmd 暴露 beforePhysics/afterPhysics API

---

## 背景

实现头部/眼球跟随相机的程序化动作，核心挑战是在 VMD 动画播放期间安全覆写特定骨骼旋转，且不破坏骨骼层级传播。调研 babylon-mmd 内部机制后发现：

1. **WASM 双缓冲**：`worldTransformMatrices` 采用双缓冲，`mmdRuntime.update()` 后写入会被下一帧覆盖
2. **worldMatrix 是切片视图**：渲染管线读的是 `_computeTransformMatrices` 输出的 `targetMatrix`，`worldMatrix` 只是其引用
3. **骨骼层级是官僚系统**：直接写父骨骼 worldMatrix 不会传播给子骨骼
4. **四元数乘法顺序敏感**：`parentInv × blended` ≠ `blended × parentInv`
5. **FromLookDirectionRH 语义**：forward 是相机朝向，物体方向需取反

## 决策

### 核心方案：linkedBone 覆写 + 手动骨骼链重算

不直接操作 worldMatrix，而是修改 `linkedBone.rotationQuaternion`（局部旋转），然后手动触发骨骼链重算：

```typescript
// 1. 世界旋转 → 局部旋转（左乘父骨骼世界逆）
const parentInvQ = Quaternion.FromRotationMatrix(parentWorldInv);
const localQ = parentInvQ.multiply(blended);  // 父逆左乘

// 2. 写入 linkedBone
headRuntime.linkedBone.rotationQuaternion = localQ;

// 3. 递归重算骨骼链
const updateBoneChain = (rb: IMmdRuntimeBone) => {
    (rb as any).updateWorldMatrix?.(false, false);
    for (const child of rb.childBones) updateBoneChain(child);
};
updateBoneChain(headRuntime);

// 4. 触发 skeleton 重算
(mmdModel.mesh.metadata as any).skeleton?._markAsDirty?.();
```

### 执行时序

```
onBeforeRenderObservable
  ├─ mmdRuntime.update()          // VMD 求解，写 worldTransformMatrices
  │   └─ skeleton._markAsDirty()  // 触发 _computeTransformMatrices
  └─ gaze observer                // 改 linkedBone → updateWorldMatrix → _markAsDirty
      └─ skeleton._markAsDirty()  // 再次触发（读新值）
```

gaze observer 必须在 `mmdRuntime.update()` 之后注册，确保覆盖 VMD 写入。

### 运行时约束

当前实现使用 JS 运行时（`VITE_MMD_RUNTIME=js`）配合 WASM Bullet 物理：

| 组件 | 运行时 | 物理 | gaze |
|------|--------|------|------|
| MmdWasmRuntime | WASM | ✅ | ❌（双缓冲覆盖） |
| MmdRuntime | JS | ❌ | ✅ |
| 当前方案 | JS + WASM Bullet | ✅ | ✅ |

**关键发现**：babylon-mmd 的 `IMmdRuntime` 暴露了 `beforePhysics/afterPhysics`，注释明确支持手动调用。这意味着未来可以不调 `mmdRuntime.register(scene)`，手动控制时序，在 `afterPhysics` 之后执行 gaze 覆写，从而保留 WASM 物理。

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| 四元数乘法顺序 | 高 | 已验证：`parentInv × blended` 是唯一正确顺序 |
| 骨骼链重算性能 | 低 | 只重算头部及其子骨骼（~20 骨骼），开销可忽略 |
| 物理骨骼抖动 | 中 | 头骨旋转后物理体用旧值，需在 gaze 覆写后调 `afterPhysics` 同步 |
| WASM 升级 breaking change | 低 | gaze 仅依赖公开 API（`linkedBone`/`updateWorldMatrix`/`_markAsDirty`） |

## 实现文件

| 文件 | 角色 |
|------|------|
| `scene/scene-proc-motion.ts` | gaze observer 实现（头部+眼球跟随） |
| `scene/scene.ts` | 运行时切换（`VITE_MMD_RUNTIME`） |
| `core/config.ts` | `RuntimeModel` 扩展类型 |
| `scene/scene-model.ts` | `focusedMmdModel()` 签名适配 |
| `scene/scene-loader.ts` | `mmdModel` 赋值类型守卫 |
| `scene/scene-vmd.ts` | 动画创建分支 instanceof 守卫 |
| `scene/scene-env-bridge.ts` | `mmdRuntime.physics` 访问守卫 |

## 未来方向

**方案 A（推荐）：手动时序 + linkedBone 覆写**

- 不调 `mmdRuntime.register(scene)`
- 手动在 `onBeforeRenderObservable` 执行：`beforePhysics(dt)` → `afterPhysics()` → gaze 覆写
- 保留 WASM Bullet 物理，gaze 实时性不变

需验证：WASM 版 `MmdWasmRuntimeBone.updateWorldMatrix` 是否被 override（若 JS 端覆写无效则需 fork babylon-mmd）。
