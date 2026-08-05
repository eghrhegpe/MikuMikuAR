---
tier: architecture
kind: go_httpserver
name: Go 模型隔离与安全 HTTP
category: backend
scope:
  - internal/app/httpserver.go
source_files:
  - internal/app/httpserver.go
symbols:
  - serveRootDir
  - isSafePath
  - trustedRoots
  - IsolateModelDir
  - copyFile
invariants:
  - isSafePath 用前缀 + "/" 边界匹配，禁止 substring 匹配（防路径穿越）
  - IsolateModelDir 对信任目录直接返回原路径，外部文件才复制到缓存；EvalSymlinks 防符号链穿越
  - 单文件上限 maxIsolateFileSize=500MB、单次复制上限 maxIsolateTotalSize=2GB
  - trustedRoots = ResourceRoot + LibraryRoot，扩展信任根须在此处登记
tests:
  - internal/app/fs_test.go
  - internal/app/app_test.go
use_when:
  - Go 模型隔离 IsolateModelDir
  - 安全路径 isSafePath 路径穿越
  - 信任目录 trustedRoots
---

# Go 模型隔离与安全 HTTP

## 系统概览
模型文件隔离与安全服务边界（`httpserver.go`，92 行）。`IsolateModelDir` 决定模型文件走「信任根直读」还是「复制到隔离缓存」，`isSafePath` + `EvalSymlinks` 防路径穿越/符号链逃逸。历史上曾有 `serveRootDir()` 复制隔离目录（ADR-005 legacy），现已废弃（ServiceStartup 清理残留）。

## 核心职责
- `IsolateModelDir(filePath)` — 信任目录（`trustedRoots()`）内返回原路径；否则校验大小上限后复制到隔离缓存。
- `isSafePath(filePath)` — 前缀 + "/" 边界安全判定。
- `trustedRoots()` — ResourceRoot + LibraryRoot 白名单。
- `serveRootDir()` — legacy 隔离目录定位（仅用于启动清理）。

## 对外 API（节选）
- `IsolateModelDir(filePath string) (string, error)` — 返回可安全服务/加载的最终路径（绑定 `IsolateModelDir`）。

## 与其他子系统关系
- 被前端模型加载（`model-loader.ts`）与资源库调用，保证加载路径不越界。
- 依赖 `internal/util`（错误包装）。
- 与 `go-zipextract.md`（文件服务器）配合构成完整 HTTP 服务边界。

## 前端接入入口
- 模型加载：`model-loader.ts` 在加载 PMX 前调用 `IsolateModelDir`。

## 不变量
- 路径判定必须经 `isSafePath`，禁止任何裸 `strings.Contains` 等价实现。
- 复制前必须做大小预检（单文件/单次总量），防磁盘打爆。

## 验证入口
- 测试：`internal/app/fs_test.go`（文件系统操作）、`internal/app/app_test.go`。
- 命令：`go test ./internal/app/ -run "Isolate|SafePath|Fs"`。
