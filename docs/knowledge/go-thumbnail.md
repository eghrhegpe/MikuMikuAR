---
tier: leaf
kind: go_thumbnail
name: Go 缩略图缓存
category: backend
scope:
  - internal/thumbnail/thumbnail.go
source_files:
  - internal/thumbnail/thumbnail.go
symbols:
  - CacheKey
  - Save
  - Get
  - GetBatch
  - SaveScreenshot
  - readThumb
invariants:
  - CacheKey 用 SHA-256(modelPath+rootPath) 做键，路径变化必须重算键
  - Save/Get 成对使用，缺失时 Get 返回可识别错误供前端回退生成
  - 缓存目录由调用方（thumbDir）传入，本包不持有全局状态（零外部依赖）
  - SaveScreenshot 按文件名落盘，仅用于截图功能（非缩略图缓存）
tests: []
use_when:
  - Go 缩略图缓存 CacheKey Save Get
  - 截图保存 SaveScreenshot
---

# Go 缩略图缓存

## 系统概览
缩略图 PNG 缓存（`internal/thumbnail/thumbnail.go`，80 行）。`CacheKey` 用 SHA-256（modelPath + rootPath）生成稳定键，`Save`/`Get` 落盘读取 PNG base64，`GetBatch` 批量读取，`SaveScreenshot` 供截图落盘。

## 核心职责
- `CacheKey(modelPath, rootPath)` — 稳定缓存键（SHA-256）。
- `Save(thumbDir, modelPath, rootPath, base64PNG)` / `Get(...)` — 写/读 PNG。
- `GetBatch(thumbDir, paths, rootPath)` — 批量读（含缺失项处理）。
- `SaveScreenshot(dir, filename, base64PNG)` — 截图落盘。

## 对外 API（节选）
- `CacheKey(modelPath, rootPath string) string` — 缓存键。
- `GetBatch(thumbDir string, paths []string, rootPath string) (map[string]string, error)` — 批量缩略图。

## 与其他子系统关系
- 被 `internal/app` 的缩略图绑定（`thumbnail.go` / `GetThumbnail`）调用，供前端资源库渲染。
- 前端缩略图键治理见 [thumbnail-key 卡](./thumbnail-key.md)（ADR-119）。

## 不变量
- 键算法（SHA-256 组合）是缓存寻址契约，改动即全量缓存失效。
- 保持标准库 only。

## 验证入口
- 无专项单测，手动验证：`go test ./internal/thumbnail/`。
