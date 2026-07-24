---
kind: env_lighting_wrapper
name: 环境灯光包装
category: env
scope:
  - frontend/src/scene/env/env-lighting.ts
source_files:
  - frontend/src/scene/env/env-lighting.ts
adr: []
symbols:
  - initEnvLighting
  - disposeEnvLighting
invariants:
  - 灯光对象在 dispose 时释放
tests: []
use_when:
  - 环境灯光
  - 灯光包装
  - 灯光与场景集成
---

## 系统概览
**环境灯光包装层**。将光照系统与场景环境集成，提供统一的灯光初始化和释放接口。

## 核心职责
- `env-lighting.ts` — 场景灯光初始化、与 env 系统集成、资源释放。

## 对外 API（节选）
- `initEnvLighting(scene, options)` — 初始化环境灯光。
- `disposeEnvLighting()` — 释放灯光资源。

## 与其他子系统关系
- 被 `env-impl.ts` 调用。
- 底层：`../render/lighting.ts`。

## 不变量
- 灯光对象在 dispose 时全部释放。
