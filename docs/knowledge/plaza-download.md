---
kind: plaza_download
name: 广场下载拦截器
category: ui
scope:
  - frontend/src/menus/plaza-download.ts
source_files:
  - frontend/src/menus/plaza-download.ts
adr:
  - ADR-087
symbols:
  - handlePlazaDownload
  - installDownloadListener
invariants:
  - 被 plaza-browser import
tests: []
use_when:
  - 广场下载
  - Plaza 下载
  - 模型下载
  - 下载拦截
---

## 系统概览
**广场下载拦截器**（ADR-087）。处理广场模型的下载请求，拦截下载链接并触发本地加载。

## 核心职责
- `plaza-download.ts` — 下载拦截、下载处理。

## 对外 API（节选）
- `handlePlazaDownload(url)` — 处理广场下载链接。
- `installDownloadListener()` — 安装下载拦截监听。

## 与其他子系统关系
- 广场浏览器：`./plaza-browser.ts`。
- 文件导入：`@/core/drop-import.ts`。
- 加载管理：`@/core/load-manager.ts`。

## 不变量
- 下载拦截监听在广场打开时安装，关闭时移除。
- 下载成功后自动触发模型加载。
