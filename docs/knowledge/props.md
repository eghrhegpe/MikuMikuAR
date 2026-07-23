---
kind: props
name: 道具系统
category: env
scope:
  - frontend/src/scene/env/**
source_files:
  - frontend/src/scene/env/props.ts
adr: []
---

## 系统概览
场景道具（Prop）的加载/移除/变换管理。道具是场景中独立于 MMD 模型的静态或动态 Mesh，可放置、旋转、缩放，支持笛卡尔坐标与轨道（orbit）两种定位模式。通过 `propRegistry` 统一管理实例生命周期，集成缩略图与变换适配器。

## 核心职责
- `props.ts` — 道具加载、移除、变换、定位模式切换、列表查询。

## 对外 API（节选）
- `loadProp(filePath, signal?)` — 异步加载道具（glTF/glb 等），返回 propId 或 null。支持 AbortSignal 取消。
- `removeProp(id)` — 移除道具并释放资源。
- `setPropTransform(id, position, rotation, scaling)` — 设置道具变换属性。
- `setPropOrbit(id, center, distance, azimuth, elevation)` — 切换到轨道定位模式。
- `getPropOrbit(id)` — 获取当前轨道参数。
- `setPropPositionMode(id, mode)` — 切换定位模式（'cartesian' | 'orbit'）。
- `getPropPositionMode(id)` — 查询当前定位模式。
- `getPropList()` — 获取所有道具实例列表。

## 与其他子系统关系
- 依赖 `propRegistry`（`core/config`）管理与持久化。
- 依赖 `manager/material` 注册/注销材质目标。
- 依赖 `transform/transform-adapter` 注册变换适配器。
- 依赖 `manager/thumbnail-capture` 渲染道具缩略图。
- 道具加载通过 `readFileBytes`（wails 绑定）读取文件。