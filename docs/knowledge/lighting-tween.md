---
kind: lighting_tween
name: 灯光预设过渡动画
category: rendering
scope:
  - frontend/src/scene/render/**
source_files:
  - frontend/src/scene/render/lighting-tween.ts
adr: []
---

## 系统概览
灯光预设过渡动画（tween）引擎：为灯光预设切换提供平滑的数值/颜色过渡。支持 `_tweenValue`（数值过渡，ease-out quad 缓动）与 `_tweenColor3`（颜色过渡）。`applyLightingPresetFromEnv` 是入口：补齐/删除灯光数量后，对各灯的位置（orbit）、强度、颜色进行并行 tween，动画期间抑制自动保存。

## 核心职责
- `lighting-tween.ts` — 灯光过渡动画、预设应用。

## 对外 API（节选）
- `_cancelAllLightingTweens()` — 取消所有活跃的灯光过渡动画。
- `_tweenValue(from, to, durationMs, onUpdate, onComplete?)` — 数值过渡动画，返回 LightingTween（含 cancel）。
- `_tweenColor3(from, to, durationMs, onUpdate, onComplete?)` — 颜色过渡动画。
- `applyLightingPresetFromEnv(presetName)` — 应用灯光预设：补齐/删除灯光、平滑过渡参数（位置 500ms、强度/颜色 300ms）。

## 内部协作
- 使用 `scene.onBeforeRenderObservable.addOnce(tick)` 驱动动画帧。
- 通过 `lightingState.activeTweens` Map 追踪所有活跃 tween。
- 动画期间 `lightingState.skipLightAutoSave = true` 抑制自动保存。

## 与其他子系统关系
- 状态集中于 `lighting-state`。
- 被 `env-bridge.ts` 在 `lightingPresetName` 变化时调用。
- 依赖 `lighting-stage` 的 `addStageLight` / `removeStageLight` / `setStageLightState`。
- 依赖 `lighting-presets` 的 `LIGHTING_PRESETS` 预设定义。