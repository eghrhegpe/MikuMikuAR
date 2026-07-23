---
kind: env_reflection
name: 反射系统
category: env
scope:
  - frontend/src/scene/env/**
source_files:
  - frontend/src/scene/env/env-reflection.ts
adr:
  - ADR-151
  - ADR-152
---

## 系统概览
环境反射的**模式裁决与生命周期管理**中枢。将 EnvState 中的用户偏好 + 质量档位解析为具体反射模式
（none / planar / ssr / probe / hybrid），并管理反射探针（probe）的绑定、挂起与释放。

## 核心职责
- `env-reflection.ts` — 反射模式解析、质量预设映射、探针生命周期、应用到场景。

## 对外 API（节选）
- `type ReflectionMode = 'none' | 'planar' | 'ssr' | 'probe' | 'hybrid'` — 五态枚举。
- `resolveReflectionMode(state)` — 由 EnvState 裁决最终反射模式。
- `setReflectionARSuspended(suspended)` — 在 AR / 性能受限时挂起反射。
- `getQualityPreset(state)` — 取当前档位对应的反射质量预设（依赖 `quality-profile`）。
- `getPlanarQualityOverride(state)` — 平面反射的质量覆盖（off / low / null）。
- `bindProbeToMeshes(meshes)` / `onModelMeshesReady(meshes)` — 模型网格就绪后绑定探针。
- `applyReflection(state)` — 将解析结果应用到渲染管线。
- `getCurrentReflectionMode()` / `isReflectionProbeActive()` — 运行时查询。
- `disposeReflection()` — 释放探针与渲染目标。

## 与其他子系统关系
- 依赖 `quality-profile` 的质量预设；被环境初始化（`env-context` 所属管线）驱动。
- 反射探针需与模型加载时序对齐（`onModelMeshesReady`），避免网格未就绪时绑定失败。
