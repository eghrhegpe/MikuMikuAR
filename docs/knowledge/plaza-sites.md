---
kind: plaza_sites
name: 广场站点配置
category: ui
scope:
  - frontend/src/menus/plaza-sites.ts
source_files:
  - frontend/src/menus/plaza-sites.ts
adr:
  - ADR-087
symbols:
  - PlazaSiteConfig
  - SITES
invariants:
  - 被 plaza-browser/plaza-state 引用
tests: []
use_when:
  - 广场站点
  - Plaza 站点
  - 站点配置
  - 社区站点
---

## 系统概览
**广场站点配置**（ADR-087）。定义模型广场支持的社区站点列表和配置，
被 plaza-browser/plaza-state 引用。

## 核心职责
- `plaza-sites.ts` — 广场站点列表、站点配置。

## 对外 API（节选）
- `interface PlazaSiteConfig` — 站点配置（名称/URL/图标等）。
- `SITES` — 内置站点列表。

## 与其他子系统关系
- 广场浏览器：`./plaza-browser.ts`。
- 广场状态：`./plaza-state.ts`。
- 广场下载：`./plaza-download.ts`。

## 不变量
- 站点列表与 `plaza-state.ts` 的 `setAllSites` 保持同步。
- 站点 URL 格式统一，支持 HTTP/HTTPS。
