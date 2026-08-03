---
kind: resource_warning_sink
name: 资源加载失败统一汇总
tier: architecture
category: core
scope:
  - frontend/src/core/resource-warning-sink.ts
source_files:
  - frontend/src/core/resource-warning-sink.ts
symbols:
  - reportResourceWarning
invariants:
  - 同一加载流程内多次警告在 DEBOUNCE_MS(400ms) 窗口合并为单条 info toast，避免刷屏
  - 警告按消息内容去重（Set）；flush 时附 logWarn 诊断日志
  - toast 不可用环境（无 document）降级为仅日志，不抛异常
tests:
  - frontend/src/core/resource-warning-sink.test.ts
use_when:
  - 资源加载失败
  - 纹理缺失
  - 警告汇总
  - toast 提示
---

# 资源加载失败统一汇总

## 系统概览
资源加载失败统一汇总（resource-warning-sink）。各加载点（模型纹理 / 换装贴图 / FBX / 音频）调用 `reportResourceWarning` 累积警告，在 debounce 窗口内合并为单条 info toast，避免逐条刷屏；flush 时附带 logWarn 诊断日志，便于无界面环境下定位。

## 核心职责
- `resource-warning-sink.ts` — 模块级去重集合 + debounce 定时器，窗口内合并警告并一次性 toast + logWarn

## 对外 API（节选）
- `reportResourceWarning(message)` — 上报一条资源加载警告（自动去重，窗口内合并）

## 与其他子系统关系
- 被 `outfit/audio.ts` / `outfit/outfit-overlay.ts` / `outfit/outfit.ts`（换装贴图 / 音频）调用
- 被 `scene/manager/model-loader.ts`（模型纹理）调用
- 依赖 `@/core/toast`（showInfoToast）、`@/core/i18n/t`、`@/core/logger`（logWarn）

## UI 入口
- 模型 / 换装 / FBX / 音频加载失败时，经 `t('resource.warnSummary', { count })` 合并为单条 info toast

## 不变量
- 同一次加载流程内的多次警告合并窗口 400ms；按消息去重
- 无 document 环境（部分测试）toast 不可用 → 降级为仅 logWarn，不抛异常

## 验证入口
- 测试：`frontend/src/core/resource-warning-sink.test.ts`
- 命令：`cd frontend && npm run test -- core/resource-warning-sink.test.ts`
