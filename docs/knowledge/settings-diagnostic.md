---
tier: leaf
kind: settings_diagnostic
name: AI 诊断助手面板（协调入口）
category: ui
scope:
  - frontend/src/menus
source_files:
  - frontend/src/menus/settings-diagnostic.ts
adr:
  - ADR-196
  - ADR-093
  - ADR-203
symbols:
  - buildSettingsDiagnosticLevel
  - buildDiagnosticSchema
  - renderDiagnosticPanel
invariants:
  - 面板双标签页布局（chat/config），经 buildDiagnosticSchema 渲染；withSessions 可选嵌入会话历史
  - 模块顶层调用 resolveAi() 加载适配器 → loadActiveSession() → refreshCaps()，不阻塞启动
  - 流式对话受 diagState.abortController.signal 控制，break/return 时底层 fetch 被中止（FR-10/AC-6）
  - 状态寄存在 diagState 单例，disposeDiagnosticPanel 清空 DOM 引用但保留 messages 等运行时状态
  - 子模块负责各自 UI：diagnostic-chat（对话渲染）/ diagnostic-config（配置）/ diagnostic-control（动作面板）/ diagnostic-session（会话管理）；本文件仅做协调与生命周期
tests: []
use_when:
  - AI 诊断面板
  - 设置诊断
  - 聊天对话
---

# AI 诊断助手面板（协调入口）

## 系统概览
ADR-196 的 AI 诊断助手 UI 面板，经 ADR-203 重构为协调入口模式。采用双标签页布局（chat/config），状态统一寄存在 `diagState` 单例，各子模块负责各自 UI 区域。声明式菜单 Schema（ADR-093）挂载于设置页；亦可经 `assistant-panel.ts` 以独立 overlay 打开（withSessions:true）。

## 核心职责
- `buildSettingsDiagnosticLevel(getSettingsMenu)` — 设置页入口 PopupLevel
- `buildDiagnosticSchema(opts?)` — 构建 chat/config 双标签布局，withSessions 时嵌入会话历史列表
- `renderDiagnosticPanel(container, opts?)` — 渲染入口，返回 dispose 函数供调用方关闭时清理
- 模块顶层 `resolveAi()` 异步初始化；调度 `runStream()` 协调流式请求的生命周期
- 注册 `diagState.callbacks` 避免子模块间循环依赖

## 各子模块分工
| 模块 | 职责 |
|------|------|
| `diagnostic-state.ts` | 单例状态，共享给所有子模块 |
| `diagnostic-chat.ts` | 对话气泡渲染、流式逐块追加、消息裁剪、system message 构建 |
| `diagnostic-config.ts` | 端点/模型/AI provider 配置 UI、连接测试、Go key 放行 |
| `diagnostic-control.ts` | tool call 待确认队列、破坏性操作确认、批量回填 + continueStream |
| `diagnostic-session.ts` | 会话持久化（IndexedDB）、列表渲染、切换/新建/删除 |

## 与其他子系统关系
- 上行：依赖 `core/ai/*`（resolveAi、error-buffer、scene-snapshot、config-store、action-catalog）
- 下行：经 ADR-093 声明式 Schema 挂载到设置菜单；经 `assistant-panel.ts` 复用 buildDiagnosticSchema 以独立 overlay 打开

## 不变量
- 面板双标签页布局（chat/config），经 buildDiagnosticSchema 渲染；withSessions 可选嵌入会话历史
- 模块顶层调用 resolveAi() 加载适配器 → loadActiveSession() → refreshCaps()，不阻塞启动
- 流式对话受 diagState.abortController.signal 控制，break/return 时底层 fetch 被中止（FR-10/AC-6）
- 状态寄存在 diagState 单例，disposeDiagnosticPanel 清空 DOM 引用但保留 messages 等运行时状态
- 子模块负责各自 UI：diagnostic-chat（对话渲染）/ diagnostic-config（配置）/ diagnostic-control（动作面板）/ diagnostic-session（会话管理）；本文件仅做协调与生命周期
