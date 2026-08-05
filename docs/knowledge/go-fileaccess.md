---
tier: architecture
kind: go_fileaccess
name: Go 文件与路径平台抽象
category: backend
scope:
  - internal/app/fileaccess.go
  - internal/app/fileaccess_desktop.go
  - internal/app/fileaccess_android.go
  - internal/app/pathmgr.go
  - internal/app/pathmgr_desktop.go
  - internal/app/pathmgr_android.go
source_files:
  - internal/app/fileaccess.go
  - internal/app/fileaccess_desktop.go
  - internal/app/fileaccess_android.go
  - internal/app/pathmgr.go
  - internal/app/pathmgr_desktop.go
  - internal/app/pathmgr_android.go
symbols:
  - Abs
  - AppDataRoot
  - CacheRoot
  - DownloadsDir
  - ErrContentUriNotSupported
  - FileAccessor
  - FileExists
  - FileInfo
  - ListDir
  - ListDirRecursive
  - Open
  - PathManager
  - PrivateResourceRoot
  - ReadDir
  - ReadFileBytes
  - ReadTextFile
  - ResourceRoot
  - SharedResourceRoot
  - Stat
  - WalkDir
  - WriteTextFile
  - androidFileAccessor
  - androidPathMgr
  - desktopFileAccessor
  - desktopPathMgr
  - fileAccessor
  - init
  - isContentUri
  - newFileAccessor
  - newPlatformPathMgr
  - platformPathMgr
invariants:
  - 业务代码一律走 fileAccessor 接口，禁止裸 os.*（为 Android shared 模式 / SAF 预留统一入口）
  - 安卓 shared 模式：MANAGE_EXTERNAL_STORAGE 授权后 os.ReadDir 直读 /sdcard；content:// URI 返回 ErrContentUriNotSupported
  - pathmgr 桌面用 UserConfigDir/UserCacheDir；安卓用 /data/data/<pkg>/files
  - ReadFileBytes 桌面需解码 Wails v3 base64 绑定返回（与前端 readFileBytes 契约对齐）
tests:
  - internal/app/fs_test.go
use_when:
  - Go 文件访问 FileAccessor ReadTextFile ReadFileBytes 平台抽象
  - 安卓 shared 模式 路径管理 pathmgr
  - content:// URI ErrContentUriNotSupported
---

# Go 文件与路径平台抽象

## 系统概览
跨平台文件访问与路径管理抽象（`fileaccess*.go` + `pathmgr*.go`）。`FileAccessor` 接口统一桌面（`os.*`）与安卓（shared 模式 `os.ReadDir` 直读 `/sdcard`）的文件 IO；`PathManager` 抽象配置/缓存目录位置。安卓 SAF 相关细节与能力矩阵见 [android-file-access 卡](./android-file-access.md)。

## 核心职责
- `fileaccess.go` — `FileAccessor` 接口 + `isContentUri` 判定 + 应用层 `ReadTextFile/WriteTextFile/ReadFileBytes/ListDir*/FileExists`。
- `fileaccess_desktop.go` — os.* 实现（桌面）。
- `fileaccess_android.go` — 安卓实现；`content://` 直接返回 `ErrContentUriNotSupported`。
- `pathmgr.go` + `pathmgr_desktop.go` / `pathmgr_android.go` — `PathManager` 平台路径（UserConfigDir/UserCacheDir / 私有目录）。

## 对外 API（节选）
- `ReadTextFile(path)` / `WriteTextFile(path, content)` / `ReadFileBytes(path)` — 文件读写绑定。
- `ListDirRecursive(dir)` — 递归列目录（返回 FileInfo 列表）。
- `FileExists(path)` — 存在性判断。

## 与其他子系统关系
- 被 `go-app.md`（配置读写）、`go-watch.md`、`go-library.md` 统一调用。
- 前端契约对齐：`core-backend.md` 的 `readFileBytes` 与 Go `ReadFileBytes` base64 编解码。
- 安卓 shared/SAF 决策见 [android-file-access.md](./android-file-access.md)（ADR-017/180/183）。

## 前端接入入口
- 后端适配层：`frontend/src/core/backend/go-adapter.ts` 的能力矩阵（`fsSelectDir` 等）。

## 不变量
- 新增平台文件操作必须落在 `FileAccessor` 实现内，禁止在业务文件散落 os.* 分支。
- 安卓禁止引入 `content://` 依赖（后端 `ErrContentUriNotSupported` 兜底）。
- 前端能力矩阵（`go-adapter.ts`）是平台能力唯一真相源，与后端实现双向核对。

## 验证入口
- 测试：`internal/app/fs_test.go`。
- 命令：`go test ./internal/app/ -run "Fs|File"`。
