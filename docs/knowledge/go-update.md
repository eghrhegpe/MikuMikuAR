---
tier: architecture
adr:
  - ADR-179
kind: go_update
name: Go 更新检查与安装
category: backend
scope:
  - internal/app/update.go
source_files:
  - internal/app/update.go
symbols:
  - CheckForUpdate
  - DownloadAndRunInstaller
  - DownloadApk
  - InstallResult
  - ProgressCallback
  - Read
  - UpdateCheckResult
  - compareVersion
  - downloadFile
  - githubRepo
  - isNewer
  - latestGitHubRelease
  - matchAndroidAsset
  - matchDesktopAsset
  - matchPlatformAsset
  - normalizeVersion
  - releaseAsset
  - splitVersion
  - updateProgressReader
invariants:
  - 版本比较走 compareVersion/splitVersion 语义化三段比较，禁止字符串比较
  - 下载须校验 expectedSize（downloadFile），防不完整包被拉起
  - 桌面按平台匹配 release 资产（matchDesktopAsset），安卓走 APK（matchAndroidAsset）
  - DownloadAndRunInstaller 拉起安装器后返回（异步安装），不阻塞绑定
tests:
  - internal/app/update_test.go
use_when:
  - Go 更新检查 CheckForUpdate GitHub Release
  - 安装器 DownloadAndRunInstaller APK DownloadApk
  - 版本比较 compareVersion isNewer
---

# Go 更新检查与安装

## 系统概览
GitHub Release 更新检查与安装拉起的 Go 侧实现（`update.go`，331 行）。`CheckForUpdate` 拉取仓库最新 Release，按平台匹配资产；`DownloadAndRunInstaller` / `DownloadApk` 下载后拉起安装流程（ADR-179 按平台分级）。版本比较用语义化三段解析，防 1.10 < 1.9 类字符串比较坑。

## 核心职责
- `CheckForUpdate()` — 查询最新版 + 平台资产匹配，返回 `UpdateCheckResult`。
- `DownloadAndRunInstaller()` / `DownloadApk()` — 下载并拉起（返回 `InstallResult`）。
- `latestGitHubRelease(repo)` — 调 GitHub API 解析 tag/assets。
- `matchDesktopAsset` / `matchAndroidAsset` / `matchPlatformAsset` — 平台资产选择。
- `downloadFile(url, dest, expectedSize)` — 带大小校验下载。
- `compareVersion` / `splitVersion` / `isNewer` — 语义化版本比较。

## 对外 API（节选）
- `CheckForUpdate() (*UpdateCheckResult, error)` — 绑定 `CheckForUpdate`。
- `DownloadAndRunInstaller() (*InstallResult, error)` — 桌面安装器拉起。
- `DownloadApk() (*InstallResult, error)` — 安卓 APK 下载。

## 与其他子系统关系
- 前端设置 → 关于页（`settings-about.ts`）调用 `CheckForUpdate`。
- 依赖 `go-app.md` 的配置（repo/版本注入）。

## 前端接入入口
- 设置 → 关于 → 检查更新（`settings-about.ts`）。

## 不变量
- 版本解析必须 `compareVersion`，禁止裸字符串 `>` 比较。
- 下载完成必须校验大小匹配，否则视为失败重新下载/提示。
- 安装拉起是异步返回，前端负责提示进度/结果。

## 验证入口
- 测试：`internal/app/update_test.go`。
- 命令：`go test ./internal/app/ -run "Update|Version"`。
