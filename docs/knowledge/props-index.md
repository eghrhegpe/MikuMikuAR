---
kind: props_barrel
name: 道具模块 barrel 重导出
category: scene
scope:
  - frontend/src/scene/env/props/**
source_files:
  - frontend/src/scene/env/props/index.ts
adr: []
symbols:
  - loadProp
  - removeProp
  - setPropTransform
  - setPropOrbit
  - getPropOrbit
  - setPropPositionMode
  - getPropPositionMode
  - getPropList
invariants:
  - 纯 barrel re-export（props.ts + accessory.ts），无独立逻辑
  - 真实实现见 scene/env/props/props.ts 与 scene/env/accessory.ts
tests: []
use_when:
  - 道具系统
  - 道具 barrel
  - 道具加载
---

## 系统概览
**道具模块 barrel 重导出**。仅作为 `scene/env/props/` 子目录的统一入口，`export * from './props'` + `export * from './accessory'`，无独立业务逻辑。

## 核心职责
- `props/index.ts` — 聚合导出 `props.ts`（[道具系统](./props.md)）与 `accessory.ts`（[道具骨骼锚定系统](./accessory.md)）的公共 API。

## 对外 API（节选）
- 透传 `loadProp` / `removeProp` / `setPropTransform` / `setPropOrbit` / `getPropOrbit` / `setPropPositionMode` / `getPropPositionMode` / `getPropList`（详见 [props.md](./props.md)）。
- 透传 accessory 相关 API（详见 [accessory.md](./accessory.md)）。

## 与其他子系统关系
- 转发至 `scene/env/props.ts`（[道具系统](./props.md)）与 `scene/env/accessory.ts`（[道具骨骼锚定系统](./accessory.md)）。
- 被场景编排层统一引用，避免消费者直接抓子文件路径。

## 不变量
- 纯重导出：不含自有状态/逻辑；改动应落到 `props.ts`/`accessory.ts` 并在对应卡片记录。
