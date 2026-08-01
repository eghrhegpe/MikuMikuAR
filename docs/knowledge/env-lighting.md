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
  - CategorizedEnvPreset
  - DerivedLighting
  - ENV_PRESET_FIELDS
  - EnvPreset
  - EnvPresetCategory
  - LEGACY_CATEGORY_MAP
  - TIME_OF_DAY_PRESETS
  - calcLuminance
  - deriveLighting
  - exportCategorizedEnvPreset
  - importCategorizedEnvPreset
  - snapshotEnvPresetByCategory
invariants:
  - 灯光预设参数在合理范围内
tests: []
use_when:
  - 环境灯光
  - 灯光包装
  - 灯光与场景集成
  - 时间预设
  - 灯光派生
---

## 系统概览
**环境灯光派生层**。纯计算模块，将 envState 的 sky/ground/water/atmosphere 参数派生为
`DerivedLighting`（方向光强度/颜色、半球光、阴影参数、groundColor），不直接操作任何
Babylon 灯光对象。同时提供时间段预设（`TIME_OF_DAY_PRESETS`）与分类预设的导出/导入。

## 核心职责
- `env-lighting.ts` — envState → DerivedLighting 纯函数派生、时间段预设库、分类预设序列化。

## 对外 API（节选）
- `deriveLighting(envState)` — 从 envState 派生 DerivedLighting（纯函数，无副作用）。
- `calcLuminance(rgb)` — 计算 RGB 亮度。
- `TIME_OF_DAY_PRESETS` — 内置时间段预设集（EnvPreset & DerivedLighting）。
- `snapshotEnvPresetByCategory(envState)` — 按 category 分类快照预设。
- `exportCategorizedEnvPreset(p)` / `importCategorizedEnvPreset(json)` — 分类预设序列化/反序列化。
- `ENV_PRESET_FIELDS` — 各 category 对应的 envState key 白名单。

## 与其他子系统关系
- 被 `env-impl.ts` 调用。
- 底层：`../render/lighting.ts`。

## 不变量
- 灯光对象在 dispose 时全部释放。
