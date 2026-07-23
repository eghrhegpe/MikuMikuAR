---
kind: library_menu
name: 资源库入口与编排
category: ui
scope:
  - frontend/src/menus/library.ts
source_files:
  - frontend/src/menus/library.ts
---

## 系统概览
Library 入口：注册表初始化 + re-export，保持外部 API 不变。聚合模型库与动作库的弹窗入口，具体实现拆分到 `library-core.ts` / `library-browse.ts` / `library-session-store.ts` / `motion-popup.ts` / `model-preset.ts` 等子模块。

## 核心职责
- re-export 公开符号：`showModelPopup` / `initLibrary` / `rescanAndSync` / `reloadConfig` / `refreshLibrary`（来自 library-core）
- `showMotionPopup` / `hideMotionPopup`（来自 motion-popup）
- `ModelPresetFile` 类型 + `serializeModelPreset` / `applyModelPreset`（来自 model-preset）

## 对外 API（节选）
- `initLibrary()` / `rescanAndSync()` / `refreshLibrary()`
- `showModelPopup()` / `showMotionPopup()`
- `serializeModelPreset(...)` / `applyModelPreset(...)`

## 关键约定
- barrel re-export 保持历史 import 路径零变化
- 具体库逻辑内聚在各子模块，本文件仅做路由聚合

## 与其他子系统关系
- 依赖 `library-core.ts`（核心实现）、`library-browse.ts`（浏览弹窗）、`library-session-store.ts`（会话状态 ADR-135）
- 模型预设依赖 `model-preset.ts`
- 状态源：`core/state`（libraryState）、`core/config`
