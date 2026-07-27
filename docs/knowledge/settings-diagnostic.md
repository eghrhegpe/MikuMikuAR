---
kind: settings_diagnostic
name: AI 诊断助手面板
category: ui
scope:
  - frontend/src/menus
source_files:
  - frontend/src/menus/settings-diagnostic.ts
adr:
  - ADR-196
  - ADR-093
symbols:
  - buildSettingsDiagnosticLevel
invariants:
  - 面板三分区：上下文信息 / 聊天对话 / 端点配置，经 resolveAi() 统一分发双路径
  - 模块加载即 ensureAiConfigLoaded()；面板打开时异步 resolveAi 并刷新 capabilities
  - 流式对话受 req.signal 控制，外部 break/return 时底层 fetch 被中止（FR-10/AC-6）
tests: []
use_when:
  - AI 诊断面板
  - 设置诊断
  - 聊天对话
---

## 系统概览
ADR-196 Phase 1 的 AI 诊断助手 UI 面板，声明式菜单 Schema（ADR-093）挂载于设置页。三分区（上下文信息 / 聊天对话 / 端点配置）经 `resolveAi()` 获取适配器实例，对 browser/go 双路径透明分发。

## 核心职责
- `buildSettingsDiagnosticLevel(getSettingsMenu)` — 返回声明式 PopupLevel，renderCustom 渲染诊断 schema
- 模块级状态：`_ai` / `_caps` / `_messages` / `_isStreaming` / `_abortController` / `_mode`
- 导入 error-buffer / scene-snapshot / config-store / resolveAi 组装诊断上下文与聊天流

## 与其他子系统关系
- 上行：依赖 `core/ai/*`（resolveAi、error-buffer、scene-snapshot、config-store）
- 下行：经 ADR-093 声明式 Schema 挂载到设置菜单

## 不变量
- 见 frontmatter
