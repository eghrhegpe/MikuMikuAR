---
kind: scene_lighting
name: 场景光照与阴影（barrel）
category: rendering
scope:
  - frontend/src/scene/render/lighting.ts
source_files:
  - frontend/src/scene/render/lighting.ts
---

## 系统概览
Scene Lighting：光照、阴影、太阳盘（barrel + 主光管理）。职责：方向光/半球光管理、阴影生成器、太阳圆盘可视化。子文件（lighting-stage/-shadow/-sun/-tween/-follow）通过单一 `lightingState` 共享全部模块状态。

## 核心职责
- `LightState` — 半球/方向光强度/颜色、阴影（enabled/type/cascades/resolution/bias）、groundColor
- 方向光 `getDirLight`、半球光 `getHemiLight` 管理
- `setLightState(patch)` / `getLightState()` — 光照唯一写入入口（被 env-bridge 调用 `applyLightingPresetFromEnv`）
- 太阳盘 `_updateSunDisc` / `_disposeSunDisc`、阴影 `_ensureShadow`、舞台灯 `_createStageLight` / `_updateIndicator`、个人光跟随 `tickPersonalLights` / `tickStageLightFollow`
- 光照补间 `_cancelAllLightingTweens`（切换预设时取消旧补间）

## 对外 API（节选）
- `setLightState(patch: Partial<LightState>)` / `getLightState(): LightState`
- `setSkipLightAutoSave(v)` / `getHemiLight()` / `getDirLight()`
- `applyLightingPresetFromEnv(...)` / `deriveLighting(...)`（来自 env-lighting）
- `rebakeEnvBrightness(...)` — 环境亮度重烘焙

## 关键约定
- 子模块共享 `lightingState`，避免状态碎片
- 阴影 bias 直接更新、补间跳帧保护（历史审计修复）

## 与其他子系统关系
- 被 `env-bridge.ts`（预设/亮度）、`env-lighting.ts`、`renderer.ts` 调用
- 依赖子模块 lighting-stage/-shadow/-sun/-tween/-follow、`transform-gizmo.ts`
- 依赖 `core/observer-handle` / `core/reactivity`
