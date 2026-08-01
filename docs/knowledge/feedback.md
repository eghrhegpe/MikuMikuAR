---
tier: architecture
kind: feedback
name: 结构化反馈 API
category: core
scope:
  - frontend/src/core/feedback.ts
source_files:
  - frontend/src/core/feedback.ts
symbols:
  - feedbackError
  - feedbackInfo
  - feedbackStatus
invariants:
  - 每条反馈回答三个问题：做了什么 / 对谁做 / 结果如何
  - actionKey 必须是 i18n 短 key，不含 {target}
  - target 是目标名称，可为 undefined
tests: []
use_when:
  - 错误提示
  - 信息提示
  - 状态反馈
  - toast
  - status
---

# 结构化反馈 API

## 系统概览
结构化反馈 API，统一「动作 + 目标 + 结果」三要素。替代旧模式 showToast(t('scene.saveFailed'), msg)，保证每条反馈回答三个问题：做了什么 / 对谁做 / 结果如何。

## 核心职责
- `feedback.ts` — 统一反馈 API，提供 toast 和 status 两种反馈方式。

## 对外 API（节选）
- `feedbackError(actionKey, target?, err?)` — 错误级 toast 反馈，标题含操作名+目标名。
- `feedbackInfo(actionKey, target?)` — Info 级 toast 反馈，标题含操作名+目标名。
- `feedbackStatus(statusKey, target?, explicitOk?, params?)` — 通用状态栏反馈，auto-detect 成功与否。

## 与其他子系统关系
- 依赖 `./i18n/t`（翻译函数）。
- 依赖 `./i18n/goerr`（Go 错误翻译）。
- 依赖 `./status-bar`（状态栏显示）。
- 依赖 `./toast`（toast 通知显示）。

## 不变量
- 每条反馈回答三个问题：做了什么 / 对谁做 / 结果如何。
- actionKey 必须是 i18n 短 key（如 'scene.saveSuccess'），不含 {target}。
- target 是目标名称（如文件名/模型名/预设名），可为 undefined（静默回退）。
- 当 target 为 string 时，feedback 内部将 t(key, { target }) 拼接为完整文本。
- `feedbackStatus` 的 `params` 参数用于带占位符的 i18n key（如 `{name}`），此时 target 应为 undefined，避免与占位符替换叠加产生无分隔符拼接。

## 验证入口
- 测试：当前主要由 UI 调用链间接覆盖。
