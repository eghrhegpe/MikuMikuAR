---
kind: env_water
name: 水面系统
category: env
scope:
  - frontend/src/scene/env/env-water.ts
source_files:
  - frontend/src/scene/env/env-water.ts
adr:
  - ADR-062
symbols:
  - initWater
  - disposeWater
  - updateWater
invariants:
  - 水面 RT 在 dispose 时释放
tests: []
use_when:
  - 水面
  - 水池
  - 水面反射
---

## 系统概览
**水面系统**。在地面之上生成动态水面，支持波纹动画和反射效果。

## 核心职责
- `env-water.ts` — 水面网格创建、波纹动画、反射效果、资源释放。

## 对外 API（节选）
- `initWater(scene, options)` — 初始化水面。
- `disposeWater()` — 释放水面资源（含反射 RT）。
- `updateWater(deltaTime)` — 更新水面动画。

## 与其他子系统关系
- 被 `env-impl.ts` 调用初始化。
- 参数来源：`envState.water`。
- 反射：可能使用 `env-reflection.ts` 的反射技术。

## 不变量
- 水面反射 RT（RenderTexture）在 `disposeWater` 中释放。
- 水面对象在场景 dispose 时级联释放。
