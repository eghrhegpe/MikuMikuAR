---
tier: leaf
kind: go_i18nerr
name: Go 错误 i18n 信封
category: backend
scope:
  - internal/i18nerr/errors.go
source_files:
  - internal/i18nerr/errors.go
adr:
  - ADR-117
symbols:
  - EnvelopeMarker
  - Error
  - New
  - ParseEnvelope
  - UserError
invariants:
  - Go 端错误编码为 <可读msg>\n@@GOERR@@<json信封> 格式，前端按哨兵 @@GOERR@@ 提取（见 goerr 卡）
  - UserError 必须经 New 构造（含 code + fallbackMsg），禁止裸 errors.New 抛给用户
  - 信封 JSON 含 code/params/msg；参数值必须可 JSON 序列化
tests:
  - internal/i18nerr/errors_test.go
use_when:
  - Go 错误 i18n 信封 UserError @@GOERR@@
  - 后端错误编码 错误翻译 goerr
---

# Go 错误 i18n 信封

## 系统概览
Go 端用户可见错误的 i18n 信封编码（`internal/i18nerr/errors.go`，ADR-117）。`UserError` 把错误编码为 `<可读msg>\n@@GOERR@@<json信封>` 文本，前端 `goerr.ts` 按哨兵提取 JSON 后翻译。前端侧见 [goerr 卡](./goerr.md)。

## 核心职责
- `UserError.Error()` — 拼接可读 msg + 哨兵 + JSON 信封。
- `New(code, fallbackMsg, params...)` — 构造带 code/params 的错误。
- `ParseEnvelope(text)` — 反向解析（测试/工具用）。

## 对外 API（节选）
- `New(code, fallbackMsg string, params ...map[string]string) *UserError` — 错误工厂。

## 与其他子系统关系
- 被 `internal/app` 各绑定方法引用，返回给前端。
- 前端 `frontend/src/core/i18n/goerr.ts` 消费信封翻译（ADR-117）。

## 不变量
- 信封格式是前后端契约，改动必须同步 `goerr.ts` 与契约测试。
- 参数值必须可 JSON 序列化（map[string]string）。

## 验证入口
- 测试：`internal/i18nerr/errors_test.go`。
- 命令：`go test ./internal/i18nerr/`。
