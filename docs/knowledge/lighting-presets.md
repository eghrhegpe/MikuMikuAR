---
kind: lighting_presets
name: 灯光预设系统
category: rendering
scope:
  - frontend/src/scene/render/lighting-presets.ts
source_files:
  - frontend/src/scene/render/lighting-presets.ts
adr: []
symbols:
  - LightingPreset
  - LIGHTING_PRESETS
  - applyLightingPreset
invariants:
  - 预设参数在合理范围内
tests: []
use_when:
  - 灯光预设
  - 预设灯光
  - 灯光配置
---

## 系统概览
**灯光预设系统**。提供预设的灯光配置方案（如舞台光、自然光、戏剧光等），一键应用。

## 核心职责
- `lighting-presets.ts` — 预设定义、参数应用、预设切换。

## 对外 API（节选）
- `interface LightingPreset` — 灯光预设描述。
- `LIGHTING_PRESETS` — 内置预设列表。
- `applyLightingPreset(presetName, scene)` — 应用预设。

## 与其他子系统关系
- 被 `lighting-stage.ts` 调用。
- 状态管理：`./lighting-state.ts`。
- 过渡动画：`./lighting-tween.ts`。

## 不变量
- 预设参数在合理范围内，避免过曝或过暗。
- 预设切换时保留用户自定义的细微调整。
