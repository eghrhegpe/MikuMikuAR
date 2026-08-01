---
tier: leaf
kind: menu_schema_registry
name: 声明式菜单 Schema 注册表
category: ui
scope:
  - frontend/src/menus/menu-registry.ts
source_files:
  - frontend/src/menus/menu-registry.ts
adr:
  - ADR-093
symbols:
  - RegisteredSchema
  - registerSchema
  - collectAllSchemas
  - flattenNodes
  - _clearRegistry
invariants:
  - registerSchema 允许覆盖（DEV 告警），建议 panelId 唯一
  - collectAllSchemas 的 builder 可能依赖运行时状态（envState 等），失败仅 DEV warn 并跳过，不抛
  - flattenNodes 递归展开含 children 的树为扁平节点列表
  - _clearRegistry 仅测试用
tests: []
use_when:
  - 菜单 schema 注册
  - 元测试静态分析
  - 面板 schema 收集
---

## 系统概览
ADR-093 元测试基础设施。收集各面板的 `MenuNode[]` schema，供 `menu-schema.integrity.test.ts` 做静态分析。注册是自愿的：各 `*-levels.ts` 导出 `getXxxSchema()` 后在此注册。

## 核心职责
- `registry: Map<panelId, () => MenuNode[]>`
- `registerSchema(panelId, builder)` — 注册面板 schema 构建函数（重复覆盖并 DEV 告警）
- `collectAllSchemas()` — 执行所有 builder 返回 `{ panelId, nodes }[]` 快照（失败跳过）
- `flattenNodes(nodes)` — 递归展开声明式树为扁平 `MenuNode[]`

## 对外 API（节选）
- `registerSchema(panelId, builder)`
- `collectAllSchemas()`
- `flattenNodes(nodes)`
- `_clearRegistry()`（仅测试）

## 关键约定
- builder 可能依赖运行时状态，失败仅 DEV 告警跳过，不抛异常
- panelId 重复时覆盖并告警，建议唯一

## 与其他子系统关系
- 被 `menu-schema-register.ts` 集中调用以触发全量注册
- 供 `menu-schema.integrity.test.ts` 做 schema 静态分析
- schema 类型来自 `menu-schema.ts`（`MenuNode`）
