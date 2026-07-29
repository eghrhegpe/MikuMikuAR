# 自定义 slog.Handler WithAttrs 违反契约导致 exe 启动挂起

> **状态**: 🟢 已修复

**日期**: 2026-07-29
**严重程度**: 🔴 P1
**影响范围**: `internal/app/log_ring.go`、`internal/app/app.go`
**发现方式**: 开发发现
**修复提交**: `99d7dd9f`

---

## 问题描述

`wails3 build` 生成的 exe 启动后显示 3 行 Wails INF 日志，然后进程挂起（0% CPU，无窗口），约 60 秒后超时退出。`go build -tags production` 无任何输出直接挂死。v1.6.7 二进制正常。

## 复现步骤

1. `cd frontend && npm run build`（Vite 构建正常）
2. `wails3 build` 或 `go build -tags production`
3. 运行生成的 exe
4. 观察到进程启动 → 3 行 Wails 日志 → 挂起 → 约 60 秒后退出

## 根因分析

在 ADR-205 实现中新增 `SlogRingHandler`（`slog.Handler` 接口实现），用于将 Go slog 日志同时写入环形缓冲（供 LLM 查询）和标准输出。

`slog.Handler` 接口要求 `WithAttrs` 和 `WithGroup` **返回新的 Handler 实例**，将传入的 attrs/group 合并到后续日志中。但 `SlogRingHandler` 的实现直接返回 `self`（不保留 attrs/group 状态）。

Wails v3 内部在启动过程中调用 `slog.With("key", "val")` 创建带上下文的 logger，返回的 handler 因为 `WithAttrs` 返回 self，与 Wails 的日志系统交互时触发死锁或无限递归，导致程序卡在 `application.New()` 或 `app.Run()` 阶段。

## 修复方案

将自定义 `slog.Handler` 替换为 `DualWriter`（实现 `io.Writer`）：

- `DualWriter` 将写入同时转发到 ring buffer 和 `os.Stderr`
- 通过 `slog.NewTextHandler(NewDualWriter(ring, stderr), nil)` 创建标准 handler
- 不再实现 `slog.Handler` 接口，避免 `WithAttrs`/`WithGroup` 契约问题

变更：
- `log_ring.go`: 移除 `SlogRingHandler`、`NewSlogRingHandler`，新增 `DualWriter` + `NewDualWriter` + `AppendLine`
- `app.go`: `SetWailsApp` 中改用 `slog.NewTextHandler(NewDualWriter(...), nil)`，并将日志初始化挪到 `prewarmPlazaWindow()` 之前

## 教训

1. 实现标准库接口（`slog.Handler`、`io.Writer` 等）时，**必须仔细阅读接口契约**，尤其是 `WithAttrs`/`WithGroup` 这类容易被误解的方法。返回 `self` 通常不是正确的实现。
2. Wails v3 对 Go 标准库的依赖很深（slog、context 等），修改这些底层设施时需格外小心。
3. 如果只需要捕获日志输出流，`io.Writer` 比 `slog.Handler` 更安全、更简单。能用 `Writer` 就不要碰 `Handler`。
