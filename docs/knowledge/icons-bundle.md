---
kind: icons_bundle
name: 图标聚合
tier: leaf
category: core
scope:
  - frontend/src/core/icons.ts
  - frontend/src/core/icons-bundle.ts
source_files:
  - frontend/src/core/icons.ts
  - frontend/src/core/icons-bundle.ts
adr: []
symbols:
  - createIconButton
  - createIconifyIcon
  - registerIconBundle
  - softwareKindIcon
invariants:
  - icons-bundle.ts 由 scripts/gen-icon-bundle.mjs 自动生成，禁止手编（首行注释声明）
  - 图标全量离线注册（无网络加载），addCollection 经 try/catch 降级（注册失败不阻断启动）
  - lucide/tabler prefix 物理隔离，避免 iconify 名字空间碰撞；aliases 显式空对象
  - icons.ts 负责图标创建/加载（createIconButton/createIconifyIcon/softwareKindIcon）
tests: []
use_when:
  - 图标
  - 图标包
  - Iconify
  - 图标创建
---

# 图标聚合

## 系统概览
**图标聚合层**。集成 Iconify 图标库，提供按需加载和图标创建接口。

## 核心职责
- `icons.ts` — 图标创建、加载。
- `icons-bundle.ts` — 图标包管理。

## 对外 API（节选）
- `createIconifyIcon(name, props?)` — 创建 Iconify 图标。
- `createIconButton(...)` / `softwareKindIcon(kind)` — 图标按钮与软件类型图标。

## 与其他子系统关系
- 图标库：`@iconify/*`。
- 被 UI 组件调用。

## 不变量
- 图标按需加载：只在需要时加载图标数据。
