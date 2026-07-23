---
kind: init
name: 应用启动引导
category: core
scope:
  - frontend/src/core/**
source_files:
  - frontend/src/core/init.ts
adr: []
---

## 系统概览
MikuMikuAR 前端应用的启动引导入口。`bootstrap()` 在 Wails 就绪后执行完整的初始化流水线：加载配置、初始化场景/渲染、注册快捷键、恢复环境状态与 UI 状态、检查更新、启动渲染循环。

## 核心职责
- `init.ts` — 应用启动编排、场景初始化、状态恢复、平台适配。

## 对外 API（节选）
- `bootstrap()` — 启动入口，串联所有初始化步骤。

## 内部协作
- `init()` — 核心异步初始化：获取配置、初始化 i18n、注册图标、创建场景与引擎、恢复环境/UI 状态、注册快捷键、启动渲染循环。
- `restoreEnvState()` — 从持久化配置恢复环境状态。
- `restoreUIState()` — 从持久化配置恢复 UI 状态（菜单位置、状态栏等）。
- `_updateStaticHtmlTexts()` — 更新静态 HTML 文本的国际化。
- `_applySystemA11y()` — 应用系统无障碍设置。

## 与其他子系统关系
- 依赖 `wails-bindings` 获取 Go 后端配置与事件。
- 依赖 `i18n/locale` 初始化国际化。
- 依赖 `platform` 检测平台特性。
- 依赖 `shortcut-registry` 加载快捷键绑定。
- 依赖 `render-loop` 启动渲染。
- 依赖 `scene/env/env-bridge` 同步环境状态。