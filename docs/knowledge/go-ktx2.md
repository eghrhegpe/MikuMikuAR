---
tier: architecture
kind: go_ktx2
name: Go KTX2 纹理编码
category: backend
scope:
  - internal/app/ktxencode.go
source_files:
  - internal/app/ktxencode.go
symbols:
  - ktx2Encode
  - isKtx2SourceExt
  - guessEncodeMode
  - findToktx
  - transcodeTexturesInDir
invariants:
  - 依赖外部 toktx 工具链（findToktx 探测），缺失时须优雅跳过而非失败整个加载
  - 转码按扩展名白名单（isKtx2SourceExt）+ 目录批量（transcodeTexturesInDir），只转支持格式
  - guessEncodeMode 按用途猜测压缩模式，新增用途须同步该分支
  - 转码产物与源纹理路径映射由调用方（前端 KTX2 基础设施）约定，不可擅自改名
tests: []
use_when:
  - Go KTX2 纹理编码 toktx 转码
  - 纹理压缩 ktx2Encode transcodeTexturesInDir
  - 压缩模式 guessEncodeMode
---

# Go KTX2 纹理编码

## 系统概览
KTX2 压缩纹理转码的 Go 侧封装（`ktxencode.go`，189 行）。探测外部 `toktx` 工具链，将支持的纹理格式转码为 KTX2（配合 ADR-189 GPU 压缩纹理基础设施），支持按目录批量转码。

## 核心职责
- `ktx2Encode(srcPath)` — 单文件转码，返回产物路径。
- `transcodeTexturesInDir(root)` — 目录批量转码（`isKtx2SourceExt` 过滤）。
- `guessEncodeMode(name)` — 按用途猜测压缩模式。
- `findToktx()` — 工具链探测。

## 对外 API（节选）
- `ktx2Encode(srcPath string) (string, error)` — 转码单纹理（内部函数，绑定经前端 KTX2 路径调用）。

## 与其他子系统关系
- 前端 `gpu-capabilities.ts` / 纹理加载路径（ADR-189）触发转码。
- 依赖 `internal/util`（错误包装）。

## 前端接入入口
- 纹理加载：`frontend/src/core` 纹理工厂在 KTX2 能力可用时触发 Go 侧转码。

## 不变量
- toktx 缺失时优雅降级（返回可识别错误，前端回退非压缩纹理）。
- 只转白名单扩展名，防止对任意文件执行外部工具。

## 验证入口
- 无单测（依赖外部工具链），手动验证：`go test ./internal/app/ -run Ktx`。
