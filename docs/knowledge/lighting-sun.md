---
kind: lighting_sun
name: 太阳圆盘可视化
category: rendering
scope:
  - frontend/src/scene/render/**
source_files:
  - frontend/src/scene/render/lighting-sun.ts
adr: []
---

## 系统概览
方向光（太阳）的参考圆盘可视化。在光线来源方向（视线反方向）创建一个发光球体作为调光参照，不参与光照计算。圆盘可见性受方向光强度与地平线高度控制（低于地平线或强度过低时隐藏）。

## 核心职责
- `lighting-sun.ts` — 太阳圆盘创建/更新/销毁。

## 对外 API（节选）
- `_updateSunDisc()` — 更新太阳圆盘位置和颜色（从方向光方向推导，圆盘在光线来源方向 SUN_DISC_DISTANCE=1000 处）。
- `_disposeSunDisc()` — 释放太阳圆盘网格与材质。

## 内部协作
- `_ensureSunDisc()` — 惰性创建太阳圆盘网格（Sphere + StandardMaterial，emissiveColor 发光，disableLighting）。

## 与其他子系统关系
- 状态集中于 `lighting-state` 的 `lightingState.sunDisc`。
- 被 `lighting.ts` 在初始化与 dispose 时调用。
- 被 `env-sky.ts` 的 `disposeSky` 调用。