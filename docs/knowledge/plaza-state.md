---
tier: architecture
kind: plaza_state
name: 广场状态管理
category: ui
scope:
  - frontend/src/menus/plaza-state.ts
source_files:
  - frontend/src/menus/plaza-state.ts
adr:
  - ADR-087
symbols:
  - GLOBAL_MODE_KEY
  - OpenMode
  - SITE_GROUPS
  - allCreators
  - allSites
  - closePlaza
  - currentSiteId
  - downloadListenerInstalled
  - effectiveMode
  - eventListenersInstalled
  - getCurrentSite
  - getLayer
  - layer
  - loadGlobalMode
  - observer
  - plazaIframe
  - plazaProxyActive
  - saveGlobalMode
  - setAllCreators
  - setAllSites
  - setCurrentSiteId
  - setDownloadListenerInstalled
  - setEventListenersInstalled
  - setObserver
  - setPlazaIframe
  - setPlazaProxyActive
  - setShortcutsRegistered
  - shortcutsRegistered
  - stopProxy
invariants:
  - 广场状态在关闭时重置为初始值
  - 站点列表变更时通知 plaza-browser 重渲染
  - 打开/关闭通过 closePlaza 统一控制，open 在 plaza-browser.showPlaza
tests: []
use_when:
  - 广场状态
  - Plaza 状态
  - 广场关闭
  - 广场站点
  - 广场层级
---

## 系统概览
**广场状态管理**（ADR-087）。管理广场的全局状态（开启/关闭、站点列表、当前层级等），
被 plaza-browser/plaza-download/events/init 约 5 个模块引用。

## 核心职责
- `plaza-state.ts` — 广场状态存储、站点管理、层级切换。

## 对外 API（节选）
- `interface PlazaState` — 广场状态描述。
- `closePlaza()` — 关闭广场。
- `setAllSites(sites)` — 设置全部站点。
- `setLayer(layer)` — 设置当前层级。

## 与其他子系统关系
- 广场浏览器：`./plaza-browser.ts`。
- 广场下载：`./plaza-download.ts`。
- 事件：`@/core/events.ts`（广场关闭事件）。
- 初始化：`@/core/init.ts`（启动时设置默认状态）。

## 不变量
- 广场状态在关闭时重置为初始值。
- 站点列表变更时通知 plaza-browser 重渲染。
