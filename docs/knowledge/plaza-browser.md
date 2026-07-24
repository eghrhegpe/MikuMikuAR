---
kind: plaza_browser
name: 模型广场浏览器
category: ui
scope:
  - frontend/src/menus/plaza-browser.ts
source_files:
  - frontend/src/menus/plaza-browser.ts
adr:
  - ADR-087
symbols:
  - openPlaza
  - closePlaza
  - PlazaSite
  - buildPlazaLevel
invariants:
  - 广场浏览器核心（~34KB/29 导出）
tests: []
use_when:
  - 模型广场
  - Plaza 浏览器
  - 社区模型
  - 模型下载
  - 广场搜索
---

## 系统概览
**模型广场浏览器**（ADR-087）。负责广场站点标签页、搜索、创作者渲染、工具栏、
嵌入式/远程渲染，是社区模型/动作浏览的入口。

## 核心职责
- `plaza-browser.ts` — 广场浏览器 UI 构建、站点管理、搜索、渲染。

## 对外 API（节选）
- `openPlaza()` — 打开广场浏览器。
- `closePlaza()` — 关闭广场浏览器。
- `interface PlazaSite` — 广场站点描述。
- `buildPlazaLevel()` — 构建广场层级。

## 与其他子系统关系
- 广场状态：`./plaza-state.ts`。
- 广场下载：`./plaza-download.ts`。
- 广场站点：`./plaza-sites.ts`。
- 广场创作者：`./plaza-creators.ts` / `./plaza-thumbnail.ts`。
- 渲染：`render-menu.ts`。

## 不变量
- 广场状态在 `plaza-state.ts` 中管理，不分散到各子模块。
- 广场打开/关闭通过 `openPlaza` / `closePlaza` 统一控制。
