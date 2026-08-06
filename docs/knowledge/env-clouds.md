---
tier: leaf
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
  - FRAG_SRC
  - buildJitterSource
  - createClouds
  - disposeClouds
  - resolveCloudShaderParams
invariants:
  - disposeClouds 释放云层所有资源（含调试可视化 mesh 挂载的 StandardMaterial——Mesh.dispose 不自动释放 material）
  - 云层使用程序化噪声纹理驱动形状，非静态 mesh
  - 云层参数经 envState.clouds 动态更新
tests:
  - frontend/src/__tests__/scene/env-clouds.test.ts
use_when:
  - 云层
  - 天空云层
  - 云朵动画
---

# 云层系统

## 系统概览
**云层系统**。在天空中生成动态云层，支持云层密度、移动速度和透明度调节。

## 核心职责
- `env-clouds.ts` — 云层网格创建、动画更新、参数配置、资源释放。

## 对外 API（节选）
- `createClouds(state)` — 初始化云层。
- `disposeClouds()` — 释放云层资源。

## 与其他子系统关系
- 被 `env-impl.ts` 调用初始化。
- 参数来源：`envState.clouds`。

## 不变量
- 云层对象在 `disposeClouds` 中全部释放，避免内存泄漏。
