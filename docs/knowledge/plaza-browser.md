---
tier: leaf
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
  - buildSiteTabs
  - buildToolbar
  - ensureSitesLoaded
  - getCustomPresets
  - loadPlazaCache
  - mergeSites
  - normalizeCreator
  - normalizeSite
  - openExternal
  - openInWindow
  - openSiteByMode
  - preserveBuiltinRouting
  - renderEmbed
  - renderHome
  - renderSiteContent
  - saveCustomPresets
  - savePlazaCache
  - showActionsMenu
  - showPlaza
invariants:
  - 广场状态集中在 plaza-state.ts，不分散到各子模块
  - showPlaza 为统一打开入口，closePlaza 在 plaza-state.ts 中
  - 自定义站点经 savePlazaCache / loadPlazaCache 持久化（Go 用户目录 plaza-cache/，不依赖 CWD 仓库文件）
  - preserveBuiltinRouting：缓存/远程配置丢失 directNavigate 时以源码 PLAZA_SITES 为准（SPA CORS 白屏不变量）
tests:
  - frontend/src/__tests__/plaza.contract.test.ts
use_when:
  - 模型广场
  - Plaza 浏览器
  - 社区模型
  - 模型下载
  - 广场搜索
---

# 模型广场浏览器

## 系统概览
**模型广场浏览器**（ADR-087）。负责广场站点标签页、搜索、创作者渲染、工具栏、
嵌入式/远程渲染，是社区模型/动作浏览的入口。

## 核心职责
- `plaza-browser.ts` — 广场浏览器 UI 构建、站点管理、搜索、渲染。

## 对外 API（节选）
- `showPlaza()` — 打开广场浏览器。
- `buildSiteTabs()` — 构建站点标签页。
- `renderSiteContent()` — 渲染站点内容。
- `renderHome()` / `renderEmbed()` — 首页/嵌入式渲染。
- `buildToolbar()` / `showActionsMenu()` — 工具栏与操作菜单。

## 与其他子系统关系
- 广场状态：`./plaza-state.ts`。
- 广场下载：`./plaza-download.ts`。
- 广场站点：`./plaza-sites.ts`。
- 广场创作者：`./plaza-creators.ts` / `./plaza-thumbnail.ts`。
- 渲染：`render-menu.ts`。

## 不变量
- 广场状态在 `plaza-state.ts` 中管理，不分散到各子模块。
- 广场打开/关闭通过 `showPlaza` / `closePlaza` 统一控制。
