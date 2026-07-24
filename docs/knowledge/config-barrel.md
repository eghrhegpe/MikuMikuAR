---
kind: config_barrel
name: 配置聚合层
category: core
scope:
  - frontend/src/core/config.ts
source_files:
  - frontend/src/core/config.ts
adr: []
symbols:
  - types
  - state
  - dom
  - utils
  - ui-helpers
  - status-bar
  - toast
invariants:
  - Barrel re-export，保持向后兼容
tests: []
use_when:
  - 配置聚合
  - 全局导出
  - barrel
  - 向后兼容
---

## 系统概览
**配置聚合层**（barrel re-export）。保持 `@/core/config` 的向后兼容，聚合各子模块的导出。
拆分后各子模块在独立文件中实现，`config.ts` 仅负责 re-export。

## 核心职责
- `config.ts` — barrel re-export，不实现逻辑。

## 对外 API（节选）
- `export * from './types'` — 类型定义。
- `export * from './state'` — 状态存储（ADR-141）。
- `export * from './dom'` — DOM 元素引用。
- `export * from './utils'` — 工具函数。
- `export * from './ui-helpers'` — UI 辅助函数。
- `export * from './status-bar'` — 状态栏。
- `export * from './toast'` — Toast 通知。

## 与其他子系统关系
- 所有子模块：`types.ts` / `state.ts` / `dom.ts` / `utils.ts` / `ui-helpers.ts` / `status-bar.ts` / `toast.ts`。

## 不变量
- Barrel re-export：保持 `@/core/config` 的 import 路径不变。
- 子模块拆分：逻辑在独立文件中，`config.ts` 仅聚合。
