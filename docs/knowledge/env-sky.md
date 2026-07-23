---
kind: env_sky
name: 天空系统
category: env
scope:
  - frontend/src/scene/env/**
source_files:
  - frontend/src/scene/env/env-sky.ts
adr: []
---

## 系统概览
天空子系统的完整实现：三种天空模式（color 渐变色 / procedural 程序化天空盒 / cube 六面体 HDR 贴图），支持恒星纹理、太阳光晕、昼夜过渡。通过 `applySky` 统一调度，带缓存与清理机制。

## 核心职责
- `env-sky.ts` — 天空创建/切换/销毁，恒星纹理缓存与加载。

## 对外 API（节选）
- `applySky(state)` — 根据 EnvState 的 skyMode 选择并应用天空模式。
- `disposeSky()` — 销毁天空球、环境贴图、太阳光晕与观察者。
- `_getStarsTexCache()` / `_setStarsTexCache(img, url, gen)` — 恒星纹理缓存的读写。
- `clearStarsTexCache()` — 清理恒星纹理缓存。

## 内部协作
- `drawSkyGradient` — 在 DynamicTexture 上绘制线性渐变天空（color 模式）。
- `updateSkyDynamicTexture` — 更新渐变色天空的 DynamicTexture（含太阳光晕圆形渐变）。
- `createProceduralSky` — 用 Babylon 的 `CreateProceduralSkyTexture` 创建程序化天空。
- `createProceduralEnvTexture` — 创建程序化环境贴图（PMREMGenerator）。
- `loadSkyCube` — 加载六面体 HDR 贴图并设置环境贴图强度。

## 与其他子系统关系
- 依赖 `env-context` 获取场景引用与静态资源路径。
- 太阳光晕通过 `ensureEnvUpdateObserver` 注册每帧更新。
- 释放时调用 `_disposeSunDisc` 清理 `render/lighting` 的太阳光晕。