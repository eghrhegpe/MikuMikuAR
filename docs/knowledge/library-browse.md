---
kind: library_browse
name: 资源库浏览弹窗
category: ui
scope:
  - frontend/src/menus/**
source_files:
  - frontend/src/menus/library-browse.ts
adr: []
---

## 系统概览
模型库的主浏览弹窗。构建按目录分组的模型列表，支持延迟恢复上次浏览位置（deferRestore 轮询等待 allModels 就绪），集成模型详情、舞台变换、编队模式等子菜单入口。

## 核心职责
- `library-browse.ts` — 模型库弹窗构建、浏览位置恢复、目录导航。

## 对外 API（节选）
- `showModelPopup()` — 打开模型库弹窗，初始化目录分组与浏览状态恢复。

## 内部协作
- `makeModelMenu(container)` — 构建模型库菜单主体（199 行），按目录分组渲染模型列表，支持模型点击打开详情、舞台变换、编队模式。
- `deferRestore(menu, dir, seg)` — 延迟恢复上次浏览位置，轮询等待 allModels 就绪后自动展开目录并高亮模型。
- `_isDirDataReady(targetDir)` — 目录数据是否就绪检查。

## 与其他子系统关系
- 依赖 [`library-session-store`](./library-session-store.md) 的恢复链路状态。
- 依赖 `model-detail` 构建模型详情层级。
- 依赖 `scene-menu` 构建舞台变换层级。
- 依赖 `load-manager` 获取模型加载状态。