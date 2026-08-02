---
tier: architecture
source_files:
  - frontend/src/scene/manager/material-proxy-resolver.ts
  - frontend/src/scene/manager/material-sss.ts
  - frontend/src/scene/manager/material.ts
  - frontend/src/scene/manager/pbr-builder-init.ts
tests:
  - frontend/src/__tests__/material-sss.state.test.ts
adr:
  - ADR-188
kind: material_system
name: 分类材质系统
category: scene
scope:
  - frontend/src/scene/manager/material.ts
  - frontend/src/scene/manager/material-sss.ts
  - frontend/src/scene/manager/material-proxy-resolver.ts
  - frontend/src/scene/manager/pbr-builder-init.ts
symbols:
  - AlphaCtx
  - DEFAULT_MAT_PARAMS
  - DEFAULT_SSS_PARAMS
  - MaterialCategory
  - MaterialCategoryParams
  - MaterialMode
  - MaterialStateManager
  - SssColorInput
  - SssMaterial
  - SssParams
  - _applyAll
  - _capture
  - _capturePbr
  - _catOf
  - _catState
  - _isPbrMaterial
  - _matEnabled
  - _matState
  - applyMatSssState
  - applyMatState
  - applySss
  - applyUnlitFallback
  - disposeModelMaterialState
  - disposeModelSssState
  - getMatCatGroups
  - getMatCatParams
  - getMatDetailList
  - getMatParams
  - getMatSssParams
  - getMatSssState
  - getMatState
  - getMaterialMode
  - getPBRMaterialBuilder
  - getStandardMaterialProxy
  - isMatCategoryAllEnabled
  - isMatEnabled
  - isPbrMaterial
  - resetMatCatParams
  - resetPerMaterialParams
  - resetSingleMatParams
  - resolveMaterialProxy
  - setMatCatParams
  - setMatCategoryEnabled
  - setMatEnabled
  - setMatParams
  - setMatSssParams
  - tryApplyPbrMaterialBuilder
invariants:
  - 资源卸载必须 disposeModelMaterialState(id) 释放按 id 的材质状态映射，避免模型材质泄漏
  - 写入触发 triggerAutoSave
  - 材质分类参数按网格/材质名归类批量调参，由 MaterialStateManager 统一管理

use_when:
  - 材质系统
  - 分类材质
  - 材质参数调节
  - 材质状态管理
---

# 分类材质系统

## 系统概览
MikuMikuAR 材质系统：分类（category-based）与逐材质参数调整，沉淀为独立 `scene/manager/material.ts` 模块（原从 `scene.ts` 抽取）。以 `MaterialStateManager` 单例 + id-based 自由函数提供按模型 / 分类的材质状态管理。

## 核心职责
- `MaterialStateManager` 单例（L163 `_stateMgr`）管理按 id 的材质状态：`catState`（分类参数映射）/ `matState`（逐材质参数映射）/ `matEnabled`（启用开关映射）
- `disposeModelMaterialState(id)` 卸载时释放按 id 的材质状态映射，避免模型切换时的材质泄漏
- 材质分类参数 `MaterialCategoryParams`（diffuseMul 等），按网格/材质名归类批量调参
- 提供 `_capture(mat)`（供 `model-loader` 在实例创建时捕获初始材质状态）

## 对外 API（节选）
- `MaterialStateManager` 实例状态 + id-based 自由函数：`isMatEnabled` / `setMatEnabled` / `getMatCatParams` / `setMatCatParams` / `resetMatCatParams` / `getMatParams` / `setMatParams` / `getMatDetailList` / `applyMatState` / `getMatState` / `disposeModelMaterialState` / `applyUnlitFallback`
- `_capture(mat)` — 供 `model-loader` 在实例创建时捕获初始材质状态

## 关键约定
- 资源卸载必须 `disposeModelMaterialState(id)` 释放按 id 的材质状态映射，避免模型材质泄漏
- 写入触发 `triggerAutoSave`

## SSS 次表面散射（ADR-188）
- 职责：在 PBR 材质上应用 SSS（次表面散射）参数到指定分类的材质，`material-sss.ts` 为参数应用层，`material.ts` 负责类型标记与守卫
- 类型：`SssMaterial` = `PBRMaterial` 类型别名；SSS 分支统一走 `isPbrMaterial(mat)` 判定（原 `SSS_MATERIAL_MARKER` / `isSssMaterial` 鸭子标记无人挂载、恒 false，已移除）
- 参数：`SssParams`（sssPower 开关+强度 0.1~1.5 / sssColor 散射色 / sssDistance 深度 / sssMin/MaxThickness 厚度），默认值见 `DEFAULT_SSS_PARAMS`
- 应用：`applySss(id, cat, params)` 按分类应用到模型材质；`getMatSssParams(id, cat)` 读取；`disposeModelSssState(id)` 卸载释放
- 序列化：material.ts 的 `getMatSssState` / `applyMatSssState` 将 SSS 参数随材质状态持久化
- 前提：材质经 PBRMaterialBuilder 加载（`VITE_MMD_MATERIAL=pbr`），`SssPBRMaterial` 由 PMX 加载时构建

## 材质构建模式（standard / pbr，ADR-188）
- `material-proxy-resolver.ts`：按 `VITE_MMD_MATERIAL` 环境变量返回材质代理构造函数——`standard`（默认）→ MmdStandardMaterialProxy（Lambert + Blinn-Phong，toon/sphere 原生支持）；`pbr` → PBRMaterialBuilder（Cook-Torrance PBR，metallic/roughness，无 toon/sphere）
- `pbr-builder-init.ts`：动态导入 PBRMaterialBuilder 并覆盖 `MmdModelLoader.SharedMaterialBuilder`（`tryApplyPbrMaterialBuilder`），把加载器从默认 StandardMaterial 切到 PBR；失败时回退并告警
- 注意：PBR 模式下 `toonTexLevel` / `sphereTexLevel` 参数静默忽略，UI 需置灰提示

## 与其他子系统关系
- 上游：`model-loader.ts`（`_capture`）、UI 面板（model-material.ts）
- 下游：`model-manager.ts`（`disposeModelMaterialState`）、`core/state`（`uiState` / `triggerAutoSave`）
- 状态源：`modelRegistry`（按 id 查找模型）
