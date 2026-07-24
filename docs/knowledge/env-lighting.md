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
  - EnvPreset
  - DerivedLighting
  - calcLuminance
  - deriveLighting
  - TIME_OF_DAY_PRESETS
  - exportEnvPreset
  - importEnvPreset
invariants:
  - 灯光预设参数在合理范围内
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
- `EnvPreset` / `DerivedLighting` — 环境灯光预设接口。
- `calcLuminance(rgb)` — 计算亮度。
- `deriveLighting(envState)` — 从 envState 派生灯光配置。
- `TIME_OF_DAY_PRESETS` — 内置时间段预设集合。
- `exportEnvPreset(p)` / `importEnvPreset(json)` — 预设导出/导入。

## 与其他子系统关系
- 被 `env-impl.ts` 调用。
- 底层：`../render/lighting.ts`。

## 不变量
- 灯光对象在 dispose 时全部释放。
