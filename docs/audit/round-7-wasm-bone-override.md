# 第⑦轮审核 — WASM 混合 + 骨骼覆盖

## bone-override.ts (~300行)

**总体结论：⚠️ 有条件通过**

**文件：** `frontend/src/scene/motion/bone-override.ts`
**测试：** ❌ 0 测试

---

### 接口重复定义 — 🟠 P2

`MmdRuntimeBoneExtended` 接口在 `bone-override.ts` 中定义，与 `perception.ts` 中的定义**高度重叠**。

```typescript
// bone-override.ts
interface MmdRuntimeBoneExtended {
  position: Vector3;
  rotation: Quaternion;
  // ...额外字段
}

// perception.ts (类似结构)
interface MmdRuntimeBoneExtended {
  position: Vector3;
  rotation: Quaternion;
  // ...额外字段
}
```

两处定义无共享基础类型，修改一处时必须手动同步另一处。**应抽取为公共类型**到 `motion-types.ts` 或类似位置。

### 测试覆盖 — 🟠 P2

0 测试。骨骼覆盖是模型动画的核心路径之一，直接影响角色动作正确性。

### 功能正确性 — 🟡 P3

| # | 问题 | 位置 | 风险 |
|---|------|------|------|
| 1 | `_propagateChildrenWasm` 每帧 `new Matrix()` | L~150 | 每帧在热路径中创建临时 Matrix 对象，GC 压力大。应复用预分配对象 |

---

## wasm-layers-blender.ts (265行 — 追审)

**总体结论：⚠️ 有条件通过**

详见第⑤轮报告，此轮重点追审 ADR-056 合规性。

### ADR-056 实现验证

| ADR 要求 | 实现状态 | 结论 |
|----------|----------|------|
| JS 帧流合并——每帧求值 overlay 骨骼变换 | ✅ 实现 | `_applyLayersBlending` 按帧处理 |
| frontBuffer 混合：位置 Lerp + 旋转 Slerp + 权重归一化 | ✅ 实现 | `blendPosition` + `blendRotation` |
| B1 降级兜底 | ✅ 实现 | WASM 不可用时回退到 JS 层 |
| 权重归一化策略 | ⚠️ 与 JS composite 微偏差 | 浮点运算顺序不同导致 ±0.0001 差异，P4 |

---

## scene.ts — WASM 集成部分

**总体结论：✅ 通过**

**文件：** `frontend/src/scene/scene.ts`（WASM 集成相关代码）

### 生命周期管理

| 阶段 | 操作 | 状态 |
|------|------|------|
| 初始化 | WASM 模块按需加载，`MmdRuntime` 延迟初始化 | ✅ |
| 运行 | 每帧通过 `_applyLayersBlending` 处理图层混合 | ✅ |
| 清理 | `disposeScene` 中按依赖顺序释放：layers → blender → runtime | ✅ |

清理顺序正确（反向初始化顺序），无泄漏。

---

## 风险清单

| 文件 | 观察 | 建议 |
|------|------|------|
| 🟠 P2 | bone-override.ts | MmdRuntimeBoneExtended 与 perception.ts 重复定义 | 抽取公共类型到 `motion-types.ts` |
| 🟠 P2 | bone-override.ts | 0 测试 | 最小添加：骨骼覆盖应用 + 子骨骼传播测试 |
| 🟡 P3 | bone-override.ts:~150 | `_propagateChildrenWasm` 每帧 new Matrix | 复用预分配 Matrix 对象 |
| 🟠 P2 | wasm-layers-blender.ts | `_applyLayersBlending` 零功能测试 | 添加输出正确性验证（与 vmd-evaluator 基线对比） |
| 🟢 P4 | wasm-layers-blender.ts | 权重归一化微偏差 | 统一浮点运算顺序以消除偏差 |
