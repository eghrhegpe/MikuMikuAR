---
tier: architecture
kind: go_watch
name: Go 下载目录监听与导入
category: backend
scope:
  - internal/app/watch.go
source_files:
  - internal/app/watch.go
symbols:
  - GetDownloadAutoImport
  - GetDownloadWatchEnabled
  - GetDownloadWatchStatus
  - ImportLocalFile
  - SetDownloadAutoImport
  - SetDownloadWatchDir
  - SetDownloadWatchEnabled
  - StartWatchDir
  - StopWatchDir
  - checkMagicNumber
  - ensureDefaultWatchDir
  - flushPending
  - importRarToLibrary
  - lowerExt
  - magicSigs
  - notifyNewFile
  - restoreWatcher
  - watchExts
  - watchLoop
invariants:
  - fsnotify Create/Write 事件进入 watchPending，watchTimer 800ms 去抖后 flushPending 批量处理
  - 扩展名白名单 watchExts（zip/pmx/vmd 等）+ Magic Number 校验（ZIP/RAR 签名）过滤噪音事件
  - watcher 生命周期由 watchMu 保护；StartWatchDir/StopWatchDir/restoreWatcher 互斥
  - 所有 watch 状态读写（watchDir/watchEnabled/autoImport）必须经配置持久化路径，非内存临时值
  - Android 不支持文件监听，StartWatchDir 返回错误（internal/AGENTS §5.4）
tests:
  - internal/app/fs_test.go
use_when:
  - Go 下载目录监听 fsnotify 下载自动导入
  - 本地文件导入 ImportLocalFile
  - watch:newfile 事件
  - 去抖 800ms watchPending
---

# Go 下载目录监听与导入

## 系统概览
下载目录自动监听（`watch.go`，514 行）。fsnotify 监听下载目录的新文件事件，800ms 去抖聚合后自动导入资源库（zip/pmx/vmd 等），并通过 `watch:newfile` 事件通知前端刷新。承载 `ImportLocalFile`（本地单文件导入）与 RAR 导入。

## 核心职责
- `StartWatchDir(dir)` / `StopWatchDir()` — 监听启停（Android 不支持，返回错误）。
- `SetDownloadWatchDir/Enabled/AutoImport` + Getter — 监听配置读写（持久化）。
- `watchLoop(w)` → `flushPending()` — 事件循环 + 去抖批量处理。
- `ImportLocalFile(path)` — 单文件导入（magic number 校验后按类型入库）。
- `importRarToLibrary(rarPath)` — RAR 走外部解压链导入。
- `restoreWatcher()` / `ensureDefaultWatchDir()` — 启动恢复监听 + 默认下载目录兜底。

## 对外 API（节选）
- `StartWatchDir(dir string) error` — 绑定 `StartWatchDir`。
- `GetDownloadWatchStatus() string` — 当前监听状态描述。

## 与其他子系统关系
- 事件经 Wails Events 发 `watch:newfile` 给前端（`runtime-bridge`）。
- 依赖 `internal/util`（错误包装/SafeCall）、`internal/zipextract`（ZIP 展开入库）。
- 配置读写走 `go-app.md` 的 `updateConfig`。

## 前端接入入口
- 设置 → 下载/自动导入（`settings-downloads.ts`、`settings-resources.ts` 的 SetDownloadWatch* 行）。
- 前端监听 `watch:newfile` 刷新资源库（`library-setup.ts`）。

## 不变量
- 去抖期间新事件并入 watchPending，flushPending 后必须清空，防重复导入。
- 监听配置任何变更都要持久化，重启由 restoreWatcher 恢复，禁止只存内存。
- 事件过滤必须同时过扩展名白名单 + Magic Number，防非资源文件触发导入。

## 验证入口
- 测试：`internal/app/fs_test.go`。
- 命令：`go test ./internal/app/ -run "Watch|Import"`。
