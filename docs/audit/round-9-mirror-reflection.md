# 第⑨轮审核 — 镜面反射功能

> **审核范围**：`env-water.ts`（水面平面反射）、`env-impl.ts`（地面镜面反射）、`renderer.ts`（ReflectionProbe）
> **测试**：`env-water.test.ts` 2 个反射相关测试（mirror camera math + reflection quality tier）

---

> **📌 后续注记（2026-07-14）**：本报告撰写于 ADR-092 统一平面反射引擎（`planar-reflection.ts`）落地之前。经复核，原 **P2.1（水面 BFC 恢复缺失）** 与 **P2.2（renderList 每帧重建）** 均已在统一引擎中修复——`PlanarReflection.create()` 在 mirrorTexture / screenSpace 两模式均注册 `onBefore/onAfterRenderObservable` 做 BFC 保存/恢复，`update()` 采用 level/meshCount 脏标记增量重建。原 **P3「地面模块直接写 envState」** 代码路径已随迁移消失（grep 零命中）。本报告其余亮点与架构评价仍然有效。后续收尾另见 `mirror-debug.ts` 的 mesh 增删观察者自动刷新与 `renderer.ts` 的 probe 强制刷新语义化改造。

## 总体结论

**⚠️ 有条件通过** — 水面/地面平面反射架构扎实、互斥策略正确、帧跳过省帧设计合理。但存在 **2 个 P2 隐患**（水面反射 BFC 恢复缺失、renderList 每帧重建性能隐患）和 **2 个 P3**。

---

## 一、水面平面反射 — `env-water.ts`

**文件：** `frontend/src/scene/env/env-water.ts`
**涉及行：** L90-92（全局变量）、L566-667（RT/相机创建与挂载）、L900-917（每帧更新）、L984-1012（dispose）

### 亮点

| 模式 | 位置 | 说明 |
|------|------|------|
| `Matrix.Reflection` 镜像相机 | L592-601 | 用 `Plane(0,1,0,-waterLevel)` + `Matrix.Reflection` 计算镜像矩阵，冻结到 `_mirrorCam` 世界矩阵，数学严谨 ✅ |
| 水下跳过反射 | L901-903 | `camY < waterLevel` 时跳过 `_mirrorRT.render()`，避免反射失效时仍消耗 GPU ✅ |
| 分帧策略 | L906-912 | high=0/帧, medium=1/2帧, low=1/4帧, off=999 跳帧，质量/性能可配置 ✅ |
| `disableWaterReflection` 互斥销毁 | L1004-1012 | 地面反射启用时调用，清零 `planarReflectBlend` uniform + 销毁 RT+相机，GPU 资源释放 ✅ |
| Shader Fresnel 混合 | L402-429 | 波浪 UV 偏移 + Fresnel + foam 衰减，反射效果真实 ✅ |
| `worldMatrixFrozen` 静态物体排除 | L618 | `mesh._worldMatrixFrozen` 判断，排除静态物体减少 renderList ✅ |

### 状态读写追踪

- `_mirrorRT` / `_mirrorCam` / `_mirrorFrameCount`：模块级全局变量，写入点在 `_setupMirrorRT`（L641-666）和 `disposeWater`（L984-994）
- **幽灵路径检查**：无。`_mirrorRT` 仅通过 `state.reflectionQuality === 'off'` 条件触发销毁，无隐式覆盖 ✅
- `_waterUpdateObserver`：L973-977 有移除逻辑，`disposeWater` 中清理 ✅

### 🟠 P2.1 — 水面反射 `onAfterRenderObservable` BFC 恢复缺失

| 文件:行 | 问题 |
|---------|------|
| `env-water.ts:645-658` | `_setupMirrorRT` 仅注册 `onBeforeRenderObservable` 关闭 BFC，**无对应的 `onAfterRenderObservable` 恢复 BFC** |

水面反射的 `onBeforeRenderObservable` 关闭了所有 renderList 网格的 `backFaceCulling`，但渲染结束后**没有恢复**。

**影响**：水面反射开启期间，场景中所有有材质的网格 `backFaceCulling=false`，背面渲染被启用，导致：
1. **性能下降**（背面多一倍片元）
2. **渲染错误**（某些模型材质依赖 BFC=背向不可见）

**证据**：

```typescript
// L645-650 — 关闭 BFC（正确）
_mirrorRT.onBeforeRenderObservable.add(() => {
    for (const mesh of _mirrorRT!.renderList ?? []) {
        if (mesh.material) {
            mesh.material.backFaceCulling = false;
        }
    }
});
// ❌ 缺少 onAfterRenderObservable — BFC 永远不会被恢复
```

对比 `env-impl.ts`（L674-689）**正确实现了** BFC 的保存和恢复：

```typescript
// env-impl.ts L677-678 — 保存原始 BFC
_groundMirrorOrigBFC.set(mesh.material.uniqueId, mesh.material.backFaceCulling);
mesh.material.backFaceCulling = false;
// env-impl.ts L683-687 — onAfterRenderObservable 恢复
_groundMirrorRT.onAfterRenderObservable.add(() => {
    for (const mesh of _groundMirrorRT!.renderList ?? []) {
        if (mesh.material && _groundMirrorOrigBFC.has(mesh.material.uniqueId)) {
            mesh.material.backFaceCulling = _groundMirrorOrigBFC.get(mesh.material.uniqueId)!;
        }
    }
    _groundMirrorOrigBFC.clear();
});
```

**修复建议**：

```typescript
// env-water.ts，在 _mirrorRT.onBeforeRenderObservable.add(...) 后添加：
const _waterOrigBFC = new Map<number, boolean>();
_mirrorRT.onBeforeRenderObservable.add(() => {
    for (const mesh of _mirrorRT!.renderList ?? []) {
        if (mesh.material) {
            _waterOrigBFC.set(mesh.material.uniqueId, mesh.material.backFaceCulling);
            mesh.material.backFaceCulling = false;
        }
    }
});
_mirrorRT.onAfterRenderObservable.add(() => {
    for (const mesh of _mirrorRT!.renderList ?? []) {
        if (mesh.material && _waterOrigBFC.has(mesh.material.uniqueId)) {
            mesh.material.backFaceCulling = _waterOrigBFC.get(mesh.material.uniqueId)!;
        }
    }
    _waterOrigBFC.clear();
});
// disposeWater 中添加：_waterOrigBFC.clear()
```

**严重程度**：🟠 高 P2 — 影响所有有材质网格，不修则水面反射开启期间性能+正确性双损。

---

### 🟠 P2.2 — `_populateMirrorRenderList` 每帧重建，性能隐患

| 文件:行 | 问题 |
|---------|------|
| `env-water.ts:608-627` | `_populateMirrorRenderList` 每帧调用，每次都 `rt.renderList = []` 然后遍历 `scene.meshes` |

水面反射每帧都重新构建 renderList，调用 `scene.meshes` 迭代。对大型场景（数百个网格）会有性能开销。

**证据**：

```typescript
// L915 — 每帧重建
_populateMirrorRenderList(scene, _mirrorRT, envState.waterLevel);
```

当前实现没有脏标记机制（对比 `buildGroundReflection` 在 `groundMode === 'texture'` 切换时才重建）。水面网格列表相对稳定，每帧重建不必要。

**对比**：`env-impl.ts` 的 `_populateGroundMirrorRenderList` 同样每帧重建（`env-impl.ts:996-1002`），存在相同问题，两个文件都需修复。

**修复建议**：添加脏标记，仅在以下情况重建 renderList：
- 地面/水面高度变化
- `scene.meshes` 数量变化（模型加载/卸载）
- 网格可见性变化

```typescript
let _mirrorRenderListDirty = true;
// 水面创建/销毁时标记脏
function markMirrorRenderListDirty() { _mirrorRenderListDirty = true; }
// 每帧更新中：
if (_mirrorRenderListDirty) {
    _populateMirrorRenderList(scene, _mirrorRT, envState.waterLevel);
    _mirrorRenderListDirty = false;
}
```

**严重程度**：🟠 高 P2 — 对大场景有性能隐患，与 `buildGroundReflection` 同款问题。

---

### 🟡 P3 — `_mirrorRT` 挂载材质时无 null guard

| 文件:行 | 问题 |
|---------|------|
| `env-water.ts:663-666` | `mat.setTexture('reflectionTexture', _mirrorRT)` 之前仅检查 `mat` 是否存在，未检查 `_mirrorRT` |

若 `_mirrorRT` 在某些边界情况下为 null（理论上 `state.reflectionQuality !== 'off'` 且 `_setupMirrorRT` 成功时会非 null，但防御性编程应校验）。

```typescript
const mat = _envSys.water.material as ShaderMaterial;
if (mat) {
    mat.setTexture('reflectionTexture', _mirrorRT); // _mirrorRT 理论上非 null
}
```

**严重程度**：🟡 中 P3 — 实际风险低（`_setupMirrorRT` 中 `_mirrorRT` 必然非 null），但防御性校验符合规范。

---

## 二、地面镜面反射 — `env-impl.ts`

**文件：** `frontend/src/scene/env/env-impl.ts`
**涉及行：** L402-408（全局变量）、L582-693（RT/相机创建与挂载）、L995-1005（每帧更新）、L707-727（dispose）

### 亮点

| 模式 | 位置 | 说明 |
|------|------|------|
| BFC 保存/恢复完整 | L674-689 | `_groundMirrorOrigBFC` Map 保存 uniqueId→BFC，afterRender 恢复，dispose 时清空 ✅ |
| 互斥守卫 | L660-664 | `planarReflectBlend > 0` 时调用 `disableWaterReflection()`，避免水面+地面同时反射 ✅ |
| `groundMode` 切换时重建 | L789 | `updateGround` → `buildGroundReflection(state)` 重建 ✅ |
| `StandardMaterial.reflectionTexture.level` | L702 | 用 `level` 属性控制反射强度，API 语义正确 ✅ |
| `mat.reflectionTexture = null` | L725 | dispose 时清理材质引用，防止悬空指针 ✅ |
| `filter` 移除 RT | L710-712 | 从 `scene.customRenderTargets` 中移除后再 dispose，资源管理正确 ✅ |

### 资源配对验证

| 创建 | 释放 | 位置 | 状态 |
|------|------|------|------|
| `_createGroundMirrorRT` | `disposeGroundReflection` | L583/L708 | ✅ 配对 |
| `_createGroundMirrorCam` | `disposeGroundMirrorCam` | L596/L716-718 | ✅ 配对 |
| `onBeforeRenderObservable.add` | `onAfterRenderObservable.add` | L674/L682 | ✅ 配对（无单独 dispose，RT dispose 时自动清理） |
| `_groundMirrorOrigBFC` Map | `disposeGroundReflection` + afterRender clear | L407/L688/L721 | ✅ 配对 |

### 🟡 P3 — `buildGroundReflection` 调用 `disableWaterReflection()` 修改 `envState`

| 文件:行 | 问题 |
|---------|------|
| `env-impl.ts:660-664` | 地面反射模块直接修改 `envState.planarReflectBlend = 0` |

`buildGroundReflection` 是地面反射的构建函数，它在检测到 `envState.planarReflectBlend > 0` 时直接写 `envState.planarReflectBlend = 0`。这违反了「子模块不应直接修改父级状态」的原则，且 `envState` 是外部传入的状态对象，直接修改会导致状态来源不唯一。

**证据**：

```typescript
// env-impl.ts L660-664
if (envState.planarReflectBlend > 0) {
    envState.planarReflectBlend = 0; // ⚠️ 直接修改外部状态
    disableWaterReflection();
}
```

**对比**：`env-water.ts` 的 `disableWaterReflection()` 是导出函数，它**应该**接收外部状态变更。问题在于 `buildGroundReflection` 不是调 `setEnvState`（如果有的话），而是直接写 `envState` 对象。

**修复建议**：

```typescript
// 方案 1：通过回调通知外部状态变更（如果存在 setter）
// 方案 2：将 planarReflectBlend 重置逻辑移到调用 buildGroundReflection 的上游（applyGround/updateGround）
```

**严重程度**：🟡 中 P3 — 实际风险有限（地面/水面互斥本身是正确的行为），但违反状态管理规范。

---

## 三、ReflectionProbe — `renderer.ts`

**文件：** `frontend/src/scene/render/renderer.ts`
**涉及行：** L124-147（probe 刷新）、L472-532（probe 创建与绑定）、L837-851（probe 刷新）、L854-874（bind to model）

### 亮点

| 模式 | 位置 | 说明 |
|------|------|------|
| `refreshRate = 0` | L484 | 静态环境仅渲染一次，省 GPU ✅ |
| `reflectionColor.set(intensity, intensity, intensity)` | L525 | 通过 Color3 设置反射强度，API 正确 ✅ |
| `filter` 移除绑定 | L491-500 | 关闭 probe 时清除所有模型材质的 `reflectionTexture`，无悬空引用 ✅ |
| try-catch 保护 | L134-145 | probe 刷新失败不影响主渲染 ✅ |

### 🟡 P3 — `reflectionProbe.refreshRate` 瞬时设为 1 再回 0

| 文件:行 | 问题 |
|---------|------|
| `renderer.ts:141-143` | 强制刷新通过瞬时 `refreshRate=1` 再 `refreshRate=0` 实现，可能在两帧之间触发额外的立即渲染 |

```typescript
_reflectionProbe!.refreshRate = 1;
_reflectionProbe!.refreshRate = 0;
```

这个双写模式在单线程 JS 中理论上不会有问题（中间无 await），但语义不够清晰。

**修复建议**：查阅 Babylon.js API，看是否有显式的 `forceRender()` 方法。

**严重程度**：🟡 中 P3 — 实际不影响功能，cosmetic。

---

## 四、跨文件问题汇总

### 🟠 P2 — 水面/地面 renderList 每帧重建

| 文件 | 位置 | 严重程度 |
|------|------|---------|
| `env-water.ts` | L915 | 🟠 高 P2 |
| `env-impl.ts` | L1002 | 🟠 高 P2（同款问题） |

两个文件均存在 `_populateMirrorRenderList` 每帧重建问题，应统一修复（加脏标记或缓存 mesh 数量）。

### 🟡 P3 — 状态来源不单一

| 文件 | 位置 | 问题 |
|------|------|------|
| `env-impl.ts` | L662 | `buildGroundReflection` 直接写 `envState.planarReflectBlend = 0`，应通过状态 setter |

---

## 风险全景

| 级别 | 数量 | 说明 |
|------|------|------|
| 🔴 P1 | 0 | 无运行时崩溃隐患 |
| 🟠 P2 | 2 | 水面 BFC 未恢复（影响所有材质网格）；renderList 每帧重建（大场景性能） |
| 🟡 P3 | 3 | 水面 RT null guard；地面模块直接写 envState；probe refreshRate 双写 |
| 🟢 P4 | 0 | — |

---

## 建议修复优先级

### 🔴 立即修复

| # | 问题 | 文件:行 | 修复 |
|---|------|---------|------|
| 1 | 水面反射 `onAfterRenderObservable` BFC 恢复缺失 | `env-water.ts:645-658` | 添加 afterRender 回调，复用 `_groundMirrorOrigBFC` 同款模式 |

### ⚠️ 短期修复

| # | 问题 | 文件:行 | 修复 |
|---|------|---------|------|
| 2 | `_populateMirrorRenderList` 每帧重建 | `env-water.ts:908-916`、`env-impl.ts:996-1004` | 加脏标记，仅在 mesh 集合变化时重建 |
| 3 | `buildGroundReflection` 直接写 `envState.planarReflectBlend` | `env-impl.ts:660-664` | 移至调用方或通过 setter 更新状态 |

---

## ADR 对应

- **ADR-062** — 水面平面反射（方案 A 已实施，P1 功能完整）
- **ADR-083 Phase B** — 地面镜面反射（已实施，与水面互斥守卫到位）
- 本轮审核发现的问题不影响 ADR 结论，仅为实现质量改进建议