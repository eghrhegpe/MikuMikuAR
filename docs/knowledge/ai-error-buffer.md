---
tier: architecture
kind: ai_error_buffer
name: 错误环形缓冲与全局捕获
category: core
scope:
  - frontend/src/core/ai
source_files:
  - frontend/src/core/ai/error-buffer.ts
adr:
  - ADR-196
symbols:
  - ErrorEntry
  - ErrorRingBuffer
  - GlobalErrorTarget
  - captureError
  - clearErrors
  - errorBuffer
  - getErrors
  - inferSeverity
  - installErrorCaptureOn
  - installGlobalErrorCapture
  - installLoggingPatch
  - toDiagnosticContext
  - uninstallLoggingPatch
invariants:
  - ErrorRingBuffer 容量必须为正整数（构造期校验），默认单例容量 50
  - installLoggingPatch 幂等（_loggingPatched 守卫），patch 后所有 console.error 自动入环，保留原始行为
  - 全局捕获单例（installGlobalErrorCapture）去重注册；dispose 时需移除 listener
  - toDiagnosticContext 从最新向旧拼接并截断到 maxBytes（默认 4096），供 AI 上下文注入
tests: []
use_when:
  - 错误缓冲
  - console.error 捕获
  - 全局错误
---

# 错误环形缓冲与全局捕获

## 系统概览
ADR-196 的诊断上下文采集底座：固定容量环形缓冲（`ErrorRingBuffer`）+ 全局 `errorBuffer` 单例，配合 `console.error` 补丁与 window error/unhandledrejection 捕获，将错误归一化为 `ErrorEntry` 供 AI 诊断助手读取。

## 核心职责
- `ErrorRingBuffer` — 定容环形队列（push/oldest/newest/toArray/clear）
- `errorBuffer` — 容量 50 全局单例
- `captureError()` — 归一化 unknown 错误为 `ErrorEntry`
- `installLoggingPatch()` / `uninstallLoggingPatch()` — 幂等 patch console.error
- `installErrorCaptureOn()` / `installGlobalErrorCapture()` — 全局错误捕获注册/去重
- `getErrors()` / `clearErrors()` / `toDiagnosticContext()` — 读取与序列化

## 与其他子系统关系
- 被 `menus/settings-diagnostic.ts` 引入（`getErrors` / `clearErrors`）
- 由应用初始化入口 install 后供 AI 上下文

## 不变量
- ErrorRingBuffer 容量必须为正整数（构造期校验），默认单例容量 50
- installLoggingPatch 幂等（_loggingPatched 守卫），patch 后所有 console.error 自动入环，保留原始行为
- 全局捕获单例（installGlobalErrorCapture）去重注册；dispose 时需移除 listener
- toDiagnosticContext 从最新向旧拼接并截断到 maxBytes（默认 4096），供 AI 上下文注入
