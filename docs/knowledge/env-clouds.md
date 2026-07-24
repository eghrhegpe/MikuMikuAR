---
kind: env_clouds
name: 云层系统
category: env
scope:
  - frontend/src/scene/env/env-clouds.ts
source_files:
  - frontend/src/scene/env/env-clouds.ts
adr:
  - ADR-113
symbols:
  - initClouds
  - disposeClouds
  - updateClouds
invariants:
  - 云层对象在 dispose 时全部释放
tests: []
use_when:
  - 云层
  - 天空云层
  - 云朵动画
---

## 系统概览
**云层系统**。在天空中生成动态云层，支持云层密度、移动速度和透明度调节。

## 核心职责
- `env-clouds.ts` — 云层网格创建、动画更新、参数配置、资源释放。

## 对外 API（节选）
- `initClouds(scene, options)` — 初始化云层。
- `disposeClouds()` — 释放云层资源。
- `updateClouds(deltaTime)` — 更新云层动画。

## 与其他子系统关系
- 被 `env-impl.ts` 调用初始化。
- 参数来源：`envState.clouds`。

## 不变量
- 云层对象在 `disposeClouds` 中全部释放，避免内存泄漏。
