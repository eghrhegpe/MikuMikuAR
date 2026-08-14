---
kind: logger
name: 轻量日志工具（无依赖）
tier: leaf
category: core
scope:
  - frontend/src/core/logger.ts
source_files:
  - frontend/src/core/logger.ts
adr:
  - ADR-141
  - ADR-248
symbols:
  - LogEntry
  - clearLogs
  - getConsoleOutput
  - getLogBuffer
  - logError
  - logInfo
  - logWarn
  - setConsoleOutput
invariants:
  - 无依赖模块，不引入循环依赖（ADR-141 从 utils.ts 剥离）
  - 前缀格式固定为 [tag] message，message 为空时退化为 [tag]
  - warn/error 的 err 为 undefined 时不传入，避免控制台出现多余 undefined
  - 环形缓冲默认保留最近 200 条（ADR-248），console 输出可独立开关
  - 热路径（每帧/高频回调）禁止直接 logWarn/logInfo，必须 feetDebug 门控 + 帧节流（ADR-248 教训）
tests: []
use_when:
  - 日志工具
  - logWarn
  - logInfo
  - logError
  - 环形缓冲
  - 环形日志
  - 环形面板
  - 日志面板
  - 调试卡顿
---

# 轻量日志工具（无依赖）

## 系统概览
无依赖的轻量日志工具，从 `utils.ts` 拆分而来（ADR-141），专门消除 `state ↔ utils` 的循环依赖。所有模块应统一经本文件导入日志函数，而非从 `utils.ts` 取，从而保证标签格式一致、且不反向拉入状态模块。

## 核心职责
- `logInfo(tag, message, ...args)` — 统一 `[tag] message` 前缀，走 `console.info`
- `logWarn(tag, message, err?)` — 走 `console.warn`；`err` 为空时不传第二参数，避免打印 `undefined`
- `logError(tag, message, err?)` — 走 `console.error`
- 三者均先将日志写入**环形缓冲**再决定是否输出到 console（ADR-248）

## 对外 API（节选）
- `logInfo(tag: string, message: string, ...args: unknown): void`
- `logWarn(tag: string, message: string, err?: unknown): void`
- `logError(tag: string, message: string, err?: unknown): void`
- `getLogBuffer(): LogBuffer` — 获取环形缓冲（供调试面板读取）
- `setConsoleOutput(enabled: boolean)` — 开关是否同时输出到 console
- `clearLogs(): void` — 清空环形缓冲

## 环形缓冲 + 调试面板（ADR-248）
> 背景：`console.warn` 会触发 source map 展开，高频日志（尤其热路径）会让界面明显卡顿。ADR-248 引入**定容环形缓冲**：每条日志先进缓冲（默认 200 条），再决定是否刷 console，把「记录」与「展示」解耦。

- **环形缓冲**：`_logBuffer = new LogBuffer(200)`，满则丢弃最旧；`getLogBuffer().getAll()` 读取，`subscribe()` 订阅变更。
- **Console 开关**：`setConsoleOutput(false)` 可彻底关闭 console 输出，只进缓冲，避免 source map 卡顿。
- **调试面板**：独立模块 `core/debug-log-panel.ts` 渲染环形缓冲内容，支持 tag 过滤 / 级别筛选 / 清空 / Console ON-OFF。入口：
  - 设置 → 系统 → 缓存占用 → 「打开日志面板」
  - 或控制台 `window.__logPanel.toggle()`

## 热路径日志准则（ADR-248 教训）
> 教训源头：`bone-override._solvePosSlotIkWasm` 曾**每帧无条件** `logWarn` `[IK-ENTRY]/[IK-SOLVE]`，`slotCount=64` 时单条超长日志直接刷爆缓冲与 console，造成卡顿（2026-08-12 修复）。

- **热路径（每帧/高频回调）禁止裸调 `logWarn`/`logInfo`**。
- 需要诊断信息时应**门控 + 节流**：
  - 用 `feetDebug.value`（`window.__feetDebug`）做总开关，默认关闭
  - 帧节流 `% 60`（约每秒 1 条），复用 feet-adjustment 的成熟模式
  - 参考实现：`bone-override._solvePosSlotIkWasm` 的 `dbg = feetDebug.value && _ikWasmDbgFrame++ % 60 === 0`
- 低频路径（一次性 / 发生性事件）可直接 `logWarn`，但仍应避免超大 payload。

## 关键约定
- 前缀格式固定为 `[tag] message`，`message` 为空时退化为 `[tag]`
- `warn`/`error` 的 `err` 为 `undefined` 时不传入，避免控制台出现多余的 `undefined`

## 与其他子系统关系
- 被全模块引用（统一日志出口）
- 由 ADR-141 从 `utils.ts` 剥离，切断与 `state.ts` 的循环依赖
- 环形缓冲 + 调试面板由 ADR-248 引入，面板渲染在 `core/debug-log-panel.ts`
