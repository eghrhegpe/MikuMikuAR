---
tier: leaf
kind: go_util
name: Go 通用工具
category: backend
scope:
  - internal/util/*.go
source_files:
  - internal/util/errors.go
  - internal/util/safecall.go
  - internal/util/pmx.go
  - internal/util/hash.go
symbols:
  - PMXMeta
  - ParsePMXHeader
  - SHA256Hex
  - SafeCall
  - SafeCallVoid
  - WrapError
  - WrapErrorf
  - decodeUTF16
  - decodeUTF16LE
  - parsePMXHeaderBytes
  - parsePMXHeaderUnsafe
invariants:
  - 错误包装统一 WrapError/WrapErrorf（op 上下文），禁止散落 fmt.Errorf 不带语义前缀
  - 对外绑定方法统一 SafeCall/SafeCallVoid 兜 panic，绝不让 panic 穿越 Wails 绑定层
  - ParsePMXHeader 只读头部（解码 PMX 魔数/名称），不改文件内容
  - 依赖保持标准库 only（internal/util 零外部依赖）
tests:
  - internal/util/errors_test.go
  - internal/util/safecall_test.go
  - internal/util/safecall_integration_test.go
  - internal/util/pmx_test.go
use_when:
  - Go 错误包装 WrapError SafeCall panic 恢复
  - PMX 头部解析 ParsePMXHeader UTF-16
  - SHA256Hex 哈希
---

# Go 通用工具

## 系统概览
Go 端零外部依赖工具集（`internal/util`）。错误包装（`WrapError`/`WrapErrorf`）、panic 恢复（`SafeCall`/`SafeCallVoid`）、PMX 二进制头解析（`ParsePMXHeader`，UTF-8/UTF-16LE）、SHA-256 哈希。

## 核心职责
- `errors.go` — `WrapError(op, err)` / `WrapErrorf(op, msg, err)` 错误上下文包装。
- `safecall.go` — `SafeCall[T](fn)` / `SafeCallVoid(fn)` 泛型 panic 恢复。
- `pmx.go` — `ParsePMXHeader`（UTF-8/UTF-16LE 模型名解码）、`PMXMeta`。
- `hash.go` — `SHA256Hex(s)`。

## 对外 API（节选）
- `WrapError(op string, err error) error` — 带操作上下文的错误包装。
- `SafeCallVoid(fn func() error) (err error)` — panic 兜底调用。
- `ParsePMXHeader(path string) (*PMXMeta, error)` — PMX 头部解析。

## 与其他子系统关系
- 被 `internal/app` 全部文件引用（约定 §七）；`ParsePMXHeader` 供 `go-library.md` 模型元数据用。

## 不变量
- 保持标准库 only，禁止引入第三方依赖（防止拖拽无关依赖进 Go 模块）。
- panic 必须收敛在 SafeCall 内，Wails 绑定方法不允许 panic 逃逸。

## 验证入口
- 测试：`internal/util/*_test.go`。
- 命令：`go test ./internal/util/`。
