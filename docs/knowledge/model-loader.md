---
kind: model_loader
name: PMX 模型加载与缩略图捕获
category: scene
scope:
  - frontend/src/scene/manager/model-loader.ts
source_files:
  - frontend/src/scene/manager/model-loader.ts
---

## 系统概览
PMX 模型加载器：模型文件解析、实例创建、缩略图生成、outfit 预加载。从 `scene.ts` 静态导入但在函数体内访问（ES module live binding 保证安全）。是模型进入 `modelRegistry` 的入口。

## 核心职责
- 经 `readFileBytes` / `ListDirRecursive`（backend 代理）读取 PMX/资源字节
- `importMeshFromBytes` — 对 babylon-mmd 的 `ImportMeshAsync` 手动断言（原类型签名不支持 Uint8Array）
- 实例创建后写入 `modelRegistry`（`setFocusedModelId` / `setTransformMetadata`）、触发缩略图捕获（`renderInstanceThumbnail`）、`rebuildShadowCasters`
- 关联：`retryWindPhysicsSubscription`（物理订阅）、`getGroundHeightAt`（落点贴合）、`ListDirRecursive`（outfit 预载）

## 对外 API（节选）
- 模型字节加载 → 实例注册主流程（见 `load*Model` 系列，函数体内组装 `ModelInstance`）
- 依赖 `motion-intent`（兼容性解析）、`createDefaultFeetState`、`fileservice.resolveModelDir`

## 关键约定
- 加载锁 / 重复检测 / 清理由 `scene.ts` 编排器负责（见 scene 卡），本模块专注「解析→实例」
- 资源释放走 `model-manager` 的 `remove`，缩略图 key 见 `thumbnail-key`

## 与其他子系统关系
- 上游：`scene.ts` 编排调用
- 下游：`model-manager.ts`（注册表/生命周期）、`material.ts`（材质捕获 `_capture`）、`thumbnail-capture.ts`、`transform-pick.ts`（元数据）
- 物理联动：`physics/wind-physics.ts` 的风力订阅重试
