# GroundMesh.render 崩溃：ShaderMaterial._effect 为 null

**日期**: 2026-07-20
**严重程度**: 🔴 P1（disposeWater 后下一帧必崩，且污染整个渲染循环）
**影响范围**: `frontend/src/scene/env/env-water.ts`（`disposeWater`）
**发现方式**: 错误堆栈分析 `GroundMesh.render → ShaderMaterial.isReadyForSubMesh → ShaderMaterial.isReady`

---

## 问题描述

错误堆栈：

```
GroundMesh.render → ShaderMaterial.isReadyForSubMesh → ShaderMaterial.isReady
```

水面使用 `MeshBuilder.CreateGround` 创建 GroundMesh 并挂载 `ShaderMaterial`。在 `disposeWater()` 中，三个 LOD mesh（meshHigh / meshMid / meshLow）共享**同一个** ShaderMaterial 实例。原代码 dispose 顺序错误，导致先 dispose 的 LOD mesh 级联销毁共享材质（`_effect = null`），而此时主 mesh 仍活在场景中、仍引用已销毁的材质。下一帧渲染时 Babylon 调用 `ShaderMaterial.isReady()` → `this._effect.isReady()` → 💥。

---

## 根因分析

### dispose 顺序漏洞

`disposeWater()` 修复前的执行顺序：

```
for (const lod of _waterLODs) {
    lod.dispose();                    // ① 第一个 LOD mesh dispose
                                      //    → mesh.dispose() 默认 disposeMaterialAndTextures=true
                                      //    → 销毁共享 ShaderMaterial（_effect = null）
                                      // ② 第二、三个 LOD mesh dispose
                                      //    → 虽然它们的 material 引用已被第一个销毁
                                      //    → 但 mesh 本身先从 scene 移除，不触发渲染
}
_envSys.water.mesh = safeDispose(     // ③ 主 mesh 还活着，material 已死！
    _envSys.water.mesh, true
);
_envSys.water.material = safeDispose( // ④ 二次 dispose（已被 LOD 销毁过）
    _envSys.water.material
);
```

关键问题在步骤 ①→③：第一个 LOD mesh 的 `dispose()` 销毁了共享材质后，主 mesh 仍存活于场景中且仍持有该材质引用。虽然 `mesh.dispose()` 会先调用 `scene._removeMesh(this)` 将自己从场景移除，但**主 mesh 尚未 dispose**，它仍然在场景的渲染列表中，下一帧渲染即崩溃。

### 为什么不是 Babylon.js 的 bug

Babylon.js `mesh.dispose()` 默认 `disposeMaterialAndTextures = true` 是合理设计——大多数场景下 mesh 独占材质，同时销毁是正确行为。问题出在我们的代码让三个 LOD mesh + 主 mesh **四个实体共享同一个材质实例**，但 dispose 时没有先切断共享引用。

---

## 修复

三步安全撤离（`env-water.ts:896-911`）：

| 步骤 | 操作 | 目的 |
|------|------|------|
| 1 | 所有 4 个 mesh 设 `material = null` | 切断共享引用，阻止级联销毁 |
| 2 | 显式 `dispose` 材质 | 干净释放 `_effect` |
| 3 | mesh dispose（`disposeMaterialAndTextures=false`） | 材质已解绑，安全释放 mesh |

```typescript
// ① 先解绑所有 mesh 的材质引用
if (_envSys.water.mesh) {
    _envSys.water.mesh.material = null;
}
for (const lod of _waterLODs) {
    lod.material = null;
}
// ② 再释放材质
_envSys.water.material = safeDispose(_envSys.water.material);
// ③ 最后释放 mesh（disposeMaterialAndTextures=false，材质已解绑）
for (const lod of _waterLODs) {
    lod.dispose(false, false);
}
_envSys.water.mesh = safeDispose(_envSys.water.mesh, false, false);
```

---

## 教训

1. **共享材质 dispose 必须先解绑** — 多个 mesh 共享同一材质时，必须先 `mesh.material = null` 再 dispose 材质，否则任一 mesh 的 `dispose()` 会级联销毁材质，导致其他仍存活的 mesh 引用已死材质。
2. **`mesh.dispose()` 的第二个参数决定生死** — `disposeMaterialAndTextures` 默认为 `true`，在共享材质场景下是陷阱。要么传 `false`，要么提前解绑。
3. **类比**：先拔掉所有插头（解绑引用），再关电闸（释放材质），最后搬走电器（释放 mesh）——不会因为先关电闸导致还在运行的电器烧掉。
4. **GroundMesh + ShaderMaterial 是特殊组合** — `GroundMesh.render()` 直接进入 Babylon 原生渲染管线，不像我们自己的 mesh 有额外守卫，崩溃直接抛到全局。
