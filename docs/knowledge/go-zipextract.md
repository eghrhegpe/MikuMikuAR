---
tier: architecture
adr:
  - ADR-057
  - ADR-058
  - ADR-099
kind: go_zipextract
name: Go ZIP 解压与缓存管理
category: backend
scope:
  - internal/app/zipextract.go
source_files:
  - internal/app/zipextract.go
symbols:
  - CacheStats
  - CleanOrphanCache
  - ClearAllCaches
  - ClearExtractCache
  - ClearThumbnailCache
  - CoopCoepMiddleware
  - ExtractResult
  - ExtractZip
  - GetCacheStats
  - ImportZip
  - StartFileServer
  - StopFileServer
  - Write
  - WriteHeader
  - basenameFallbackFS
  - bestDecode
  - bufferingResponseWriter
  - cleanControlChars
  - corruptFromBytes
  - corsMiddleware
  - customResourceDirs
  - decodeZipName
  - dirSize
  - extractCacheVersion
  - extractZipUnsafe
  - flush
  - garbageNameWords
  - importZipUnsafe
  - isGarbageModelName
  - manifest
  - maxVPDSize
  - maxZipEntries
  - serveFileWithSizeCheck
  - toCorruptStringGBK
  - toCorruptStringShiftJIS
  - truncate
  - zipCacheName
invariants:
  - extractCacheVersion 变更会失效全部解压缓存，升级格式须 bump
  - maxZipEntries=50000 限制解压条目数；expandZipEntries 预检总量防 ZIP 炸弹
  - 缓存清理路径（CleanOrphanCache/Clear*/GetCacheStats）须并发安全，防与 ExtractZip 竞态
  - 文件服务器 StartFileServer/StopFileServer 按 dirPath 键控 httpServers，ServiceShutdown 统一关闭
  - basenameFallbackFS + serveFileWithSizeCheck 兜底 Shift-JIS 乱码文件名的 HTTP 访问
  - CoopCoepMiddleware 启用 COOP/COEP（MPR，ADR-099），依赖 mpr_on/off 构建标签
tests:
  - internal/app/decodezip_test.go
  - internal/app/app_test.go
  - internal/app/fs_test.go
  - internal/app/coep_middleware_test.go
use_when:
  - Go ZIP 解压 ExtractZip ImportZip 缓存
  - 解压缓存清理 CleanOrphanCache ClearAllCaches GetCacheStats
  - Shift-JIS GBK 文件名解码 bestDecode decodeZipName
  - 文件 HTTP 服务 StartFileServer StopFileServer
  - COOP COEP 中间件
---

# Go ZIP 解压与缓存管理

## 系统概览
ZIP 导入、解压缓存与文件 HTTP 服务的 Go 侧实现（`zipextract.go` 单文件承载）。`ExtractZip`/`ImportZip` 按 `zipCacheName`（version+hash）落缓存 manifest，供前端经 HTTP 文件服务器按 URL 访问；同时承载 `StartFileServer`/`StopFileServer`、CORS/COOP-COEP 中间件、乱码文件名兜底服务。

## 核心职责
- `ExtractZip(zipPath, innerPath)` / `ImportZip(zipPath)` — 解压（`extractZipUnsafe`/`importZipUnsafe` 为无锁实现，上层加锁调用）。
- `CleanOrphanCache()` — 清理源 zip 已消失的缓存目录（ServiceStartup 后台调用）。
- `ClearExtractCache()` / `ClearThumbnailCache()` / `ClearAllCaches()` / `GetCacheStats()` — 缓存管理面。
- `decodeZipName`/`bestDecode` — Shift-JIS/GBK/UTF-8 文件名解码（`decodeZipName` 用于 ZIP 条目，`bestDecode` 通用）。
- `StartFileServer(dirPath)` — 起本地 HTTP 文件服务（返回端口），`basenameFallbackFS` 兜底乱码名文件。
- `CoopCoepMiddleware` + `corsMiddleware` — HTTP 中间件（MPR/COOP-COEP，ADR-099）。

## 对外 API（节选）
- `ExtractZip(zipPath, innerPath string) (*ExtractResult, error)` — 解压到缓存并回 manifest。
- `GetCacheStats() (*CacheStats, error)` — 缓存占用统计。
- `StartFileServer(dirPath string) (int, error)` — 返回监听端口（前端 `StartFileServer` 绑定）。

## 与其他子系统关系
- 前端 `fileservice.ts` / `drop-import.ts` 调用 `ExtractZip`/`ImportZip`。
- 依赖 `internal/util`（错误包装）、`internal/thumbnail`（ClearThumbnailCache 联动）。
- 与 `go-httpserver.md`（模型隔离）同属「本地 HTTP 服务」家族。

## 前端接入入口
- 拖拽导入 / 资源库导入：`drop-import.ts`、`library-actions.ts`。
- 缓存管理：设置 → 缓存清理（`settings-resources.ts` 相关行）。

## 不变量
- 缓存失效以 `extractCacheVersion` 版本号为准，升级必须 bump 否则旧缓存错配。
- 文件服务器端口释放由 `StopFileServer` 负责；异常退出场景由 `ServiceShutdown` 兜底。
- HTTP 文件服务只服务白名单目录（配合 `isSafePath`），禁止裸目录服务。

## 验证入口
- 测试：`internal/app/decodezip_test.go`、`internal/app/coep_middleware_test.go`。
- 命令：`go test ./internal/app/ -run "Zip|Cache|CoopCoep"`。
