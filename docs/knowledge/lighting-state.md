---
kind: lighting_state
name: 灯光模块状态对象
category: rendering
scope:
  - frontend/src/scene/render/**
source_files:
  - frontend/src/scene/render/lighting-state.ts
adr:
  - ADR-159
---

## 系统概览
灯光子系统的单一模块状态对象（ADR-159 P3-B）。全部模块级可变状态集中于 `lightingState`，彻底消除「跨文件幽灵状态」。属性可变、无绑定重赋值问题，子文件一律通过 `lightingState.xxx` 访问。

## 核心职责
- `lighting-state.ts` — 灯光系统全部可变状态的集中定义与初始化。

## 对外 API（节选）
- `StageLightEntry` — 舞台灯光条目接口（state / light / indicator / dirLine）。
- `LightingTween` — 灯光过渡动画接口（id / cancel）。
- `LightingStateValues` — 灯光系统完整状态接口（scene / 环境灯 / 方向光 / 舞台灯光 Map / 阴影 / 光锥 / 太阳圆盘 / tween / 个人灯等）。
- `SHADOW_REBUILD_KEYS` — 触发阴影重建的键集（enabled / shadowEnabled / shadowType / shadowResolution / shadowBias）。
- `CONE_UPDATE_KEYS` — 触发光锥更新的键集。
- `SUN_DISC_DISTANCE` — 太阳圆盘距离常量 1000。
- `SUN_DISC_MIN_INTENSITY` — 太阳圆盘可见最小强度 0.01。
- `lightingState` — 灯光系统模块级状态单例（含所有灯光/阴影/光锥/动画的运行时引用）。

## 与其他子系统关系
- 被 `lighting.ts`、[`lighting-stage.ts`](./lighting-stage.md)、[`lighting-shadow.ts`](./lighting-shadow.md)、[`lighting-sun.ts`](./lighting-sun.md)、[`lighting-tween.ts`](./lighting-tween.md)、[`lighting-follow.ts`](./lighting-follow.md)、[`light-cone.ts`](./light-cone.md) 共同读写。