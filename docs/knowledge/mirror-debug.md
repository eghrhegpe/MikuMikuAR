---
kind: mirror_debug
name: 镜面道具
category: env
scope:
  - frontend/src/scene/env/**
source_files:
  - frontend/src/scene/env/mirror-debug.ts
adr:
  - ADR-128
---

## 系统概览
镜面反射道具：直接在场景中放置竖直平面 + `MirrorTexture` 反射，独立于 `PlanarReflection` 引擎。最初为调试反射问题而创建（ADR-128），现已升级为常态化场景道具。反射列表包含场景全部 mesh，并通过 `onNewMeshAddedObservable` / `onMeshRemovedObservable` 自动刷新。

## 核心职责
- `mirror-debug.ts` — 镜面创建/销毁/开关/参数调整/信息查询。

## 对外 API（节选）
- `createMirror()` — 创建镜面平面 + MirrorTexture，设置反射列表与场景网格增删观察者。
- `disposeMirror()` — 销毁镜面及其观察者。
- `isMirrorActive()` — 查询镜面是否激活。
- `toggleMirror()` — 切换镜面开关，返回新状态。
- `updateMirrorClearColor()` — 根据当前天空模式（color 模式用 scene.clearColor，其他用透明黑）同步 RT clearColor。
- `refreshMirrorRenderList()` — 刷新反射列表（模型加载/卸载后调用）。
- `setMirrorSize(width, height)` — 设置镜面尺寸（需重建）。
- `setMirrorPosition(x, y, z)` — 设置镜面位置。
- `setMirrorRotationY(rad)` — 设置镜面水平旋转。
- `setMirrorResolution(res)` — 设置反射分辨率（映射到 `reflectionQuality` 枚举，需重建）。
- `getMirrorInfo()` — 获取镜面完整状态信息。

## 与其他子系统关系
- 依赖 `env-context` 获取场景引用。
- 分辨率设置通过 [env-bridge](./env-dispatcher.md) 的 `setEnvState` 写入 `reflectionQuality`。