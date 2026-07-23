---
kind: lighting_stage
name: 舞台灯光系统
category: rendering
scope:
  - frontend/src/scene/render/**
source_files:
  - frontend/src/scene/render/lighting-stage.ts
adr: []
---

## 系统概览
舞台灯光（Stage Light）管理：创建/删除/参数调节/序列化/反序列化。支持 SpotLight / PointLight / DirectionalLight 三种类型，每盏灯含轨道定位（orbitAzimuth/Elevation/Distance）、指示器网格、光锥、阴影。通过 `lightingState.stageLights` 统一管理状态。

## 核心职责
- `lighting-stage.ts` — 舞台灯光 CRUD、参数更新、指示器、序列化。

## 对外 API（节选）
- `_createStageLight(type, state)` — 创建舞台灯光实例。
- `_updateIndicator(entry)` — 更新灯光指示器（位置/方向/颜色）。
- `getStageLights()` — 获取所有舞台灯光的状态数组。
- `getActiveStageLightId()` / `setActiveStageLightId(id)` — 当前选中的舞台灯光 ID。
- `getStageLightState(id?)` — 获取指定灯光的完整状态。
- `setStageLightState(partial, id?)` — 更新灯光参数（含阴影重建、光锥重建、轨道移动）。
- `addStageLight(type, state)` — 新增舞台灯光。
- `removeStageLight(id)` — 删除舞台灯光。
- `loadStageLights(states)` — 批量加载灯光（场景恢复时调用）。
- `rebuildStageLightShadows()` — 重建所有舞台灯光阴影。

## 内部协作
- `_getEntry(id?)` — 按 ID 或当前活跃 ID 获取灯光条目。
- `_readStageLightState(entry)` — 读取灯光完整状态。
- `_applyStageLightParams(entry, partial)` — 应用灯光参数变更。
- `_ensureStageCone(id)` / `_disposeStageCone(id)` — 光锥生命周期管理。
- `_registerStageLight(id, entry)` — 注册灯光到状态表。

## 与其他子系统关系
- 状态集中于 [`lighting-state`](./lighting-state.md)。
- 阴影由 [`lighting-shadow`](./lighting-shadow.md) 管理。
- 光锥由 [`light-cone`](./light-cone.md) 渲染。
- 预设过渡动画由 [`lighting-tween`](./lighting-tween.md) 驱动。