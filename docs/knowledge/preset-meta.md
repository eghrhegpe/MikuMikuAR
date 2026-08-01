---
tier: leaf
kind: preset_meta
name: 预设元数据归一化
category: core
scope:
  - frontend/src/core/preset-meta.ts
source_files:
  - frontend/src/core/preset-meta.ts
adr:
  - ADR-130
symbols:
  - PresetCategory
  - PresetMeta
  - toPresetMeta
  - listPresets
invariants:
  - PresetMeta.id 为稳定主键 `${category}:${name}`
  - 四类预设（env/render/scene/model）存储键前缀分别为 env:/render:/scene:/model:
  - 对 Go nullable 返回做 ?? [] 守卫，避免 NPE
  - 读侧归一不写侧信封化，写侧保持各系统独立写路径
tests:
  - frontend/src/__tests__/core/preset-meta.test.ts
use_when:
  - 预设
  - 预设列表
  - 预设元数据
  - PresetMeta
  - ADR-130
---

# 预设元数据归一化

## 系统概览

预设元数据跨系统归一模块（ADR-130 Phase 2.7 收敛）。四类预设系统（env/render/scene/model）经 ADR-176 的 backend 代理统一走 `resolveBackend()`，存储共享 `presets` IDB store，但返回形状不统一。本模块提供读侧归一，将四类 list 结果统一为 `PresetMeta[]`，供未来跨类浏览/排序/标签筛选/搜索复用。

## 核心职责

- `preset-meta.ts` — 预设读侧归一化

## 对外 API（节选）

- `toPresetMeta(category, name, extra?)` — 由单条记录构造 `PresetMeta`，id 为 `${category}:${name}`
- `listPresets(category?)` — 跨系统枚举预设，归一为 `PresetMeta[]`。不传 category 聚合全部四类，传 category 仅查询该类

## 与其他子系统关系

- 被 UI 预设面板（settings-graphics、settings-actions、env-menu 等）在枚举预设时调用
- 依赖 `@/core/wails-bindings` 的 `ListEnvPresets`、`GetRenderPresets`、`GetPresetScenes`、`GetModelPresets`

## 不变量

- `PresetMeta.id` 为稳定主键 `${category}:${name}`，不可重复
- 四类预设存储键前缀分别为 `env:`/`render:`/`scene:`/`model:`
- 对 Go 层 nullable 返回做 `?? []` 守卫，避免 NPE
- 读侧归一不影响写侧；写侧保持各系统独立写路径，不强制信封化

## 验证入口

- 测试：`frontend/src/__tests__/core/preset-meta.test.ts`
- 命令：`cd frontend && npm run test -- core/preset-meta.test.ts`