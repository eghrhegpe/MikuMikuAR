---
kind: ui_constants
name: UI 与场景常量
category: core
scope:
  - frontend/src/core/**
source_files:
  - frontend/src/core/ui-constants.ts
adr:
  - ADR-143
---

## 系统概览
集中定义滑块四分位步进分数、环境默认值、场景事件字面量（ADR-143 主题7），消除魔法数值。所有模块应引用此文件中的常量，而非手写散落数值。

## 核心职责
- `ui-constants.ts` — 滑块步进分数、场景默认值、场景事件枚举。

## 对外 API（节选）
- `SLIDER_QUARTER_LARGE_STEP` — 左区大幅减步进：全范围 15%（0.15）。
- `SLIDER_QUARTER_SMALL_STEP` — 中左/中右微调步进：全范围 5%（0.05）。
- `DEFAULT_GRAVITY` — 默认重力 -98 m/s²。
- `ENV_LIGHT_MAX` — 环境光强度上限 0.5。
- `AUTO_LINK_THRESHOLD_DEG` — time-of-day 与 lighting 联动判定阈值 0.5°。
- `SCENE_EVENTS` — 场景事件枚举（SAVE / RELOAD / RESET / SWITCH），替代散落的 `'scene:xxx'` 字面量。
- `SceneEventKey` — SCENE_EVENTS 各取值的联合类型。

## 与其他子系统关系
- 被 `ui-slider-controller` 等 UI 组件引用。
- 被场景事件调度模块引用。