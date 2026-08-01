---
tier: leaf
kind: menu_schema_register_aggregator
name: 声明式菜单 Schema 集中注册聚合器
category: ui
scope:
  - frontend/src/menus/menu-schema-register.ts
source_files:
  - frontend/src/menus/menu-schema-register.ts
adr:
  - ADR-093
symbols:
invariants:
  - 纯副作用模块：被 integrity 测试 import 触发，一次性注册所有 schema
  - 自身无导出 API，不可被业务模块直接 import
  - 新增面板须在对应 *-levels.ts 导出 getXxxSchema() 并在此加一行 registerSchema
tests: []
use_when:
  - 菜单 schema 注册
  - 元测试触发
  - 新增面板登记
---

# 声明式菜单 Schema 集中注册聚合器

## 系统概览
ADR-093 元测试基础设施的集中注册聚合器。各 `*-levels.ts` 只导出 `getXxxSchema()`，不依赖 registry；此文件集中调用 `registerSchema`，供测试 import 触发全量注册。

## 核心职责
- 一次性 import 所有 `*-levels.ts` 的 `getXxxSchema` / `buildXxxSchema` 并 `registerSchema` 到 panelId
- 覆盖 env / scene / motion / settings 多域（env:sky … settings:physics-hud 共 16 项）

## 对外 API（节选）
- 无自身导出；通过 `registerSchema(panelId, builder)` 注册（函数来自 `menu-registry.ts`）

## 关键约定
- 新增面板 → 在对应 `*-levels.ts` 导出 `getXxxSchema()` 并在此加一行 `registerSchema`
- 纯副作用，勿被业务代码 import

## 与其他子系统关系
- 调用 `menu-registry.ts` 的 `registerSchema`
- 被 `menu-schema.integrity.test.ts` import 以触发注册
