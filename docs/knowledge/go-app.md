---
tier: architecture
kind: go_app
name: Go 后端核心（App 生命周期 + 配置系统）
category: backend
scope:
  - internal/app/*.go
source_files:
  - internal/app/app.go
  - internal/app/config.go
  - internal/app/log_ring.go
  - internal/app/a11y.go
  - internal/app/a11y_stub.go
  - internal/app/a11y_windows.go
  - internal/app/mpr_on.go
  - internal/app/mpr_off.go
symbols:
  - AddRecentModel
  - AiGetBackendLogs
  - AiGetBackendState
  - App
  - Append
  - AppendLine
  - BuildInfo
  - Config
  - DefaultResourceRoot
  - DualWriter
  - EnvState
  - GetAppVersion
  - GetBuildInfo
  - GetConfig
  - GetLastBrowseDir
  - GetPath
  - GetRecentModels
  - GetStorageMode
  - GetSystemA11ySettings
  - HKEY_CURRENT_USER
  - KEY_READ
  - KeyBindingOverride
  - LogEntry
  - LogRing
  - ModelEntry
  - ModelMeta
  - NewApp
  - NewDualWriter
  - NewLogRing
  - OverridePaths
  - REG_DWORD
  - Recent
  - RecentByLevel
  - RenderPreset
  - SelectAudioFile
  - SelectEnvTextureFile
  - SelectExeFile
  - SelectImportFile
  - SelectPMXFile
  - SelectRetargetFile
  - SelectVMDMotion
  - SelectVPDPose
  - ServiceShutdown
  - ServiceStartup
  - SetBlenderPath
  - SetDisplayNamePriority
  - SetEnvState
  - SetLastBrowseDir
  - SetOverridePath
  - SetPerformanceMode
  - SetResourceRoot
  - SetStorageMode
  - SetUIAccent
  - SetUIAnimations
  - SetUIAutoUpdate
  - SetUIBlurBg
  - SetUIFontFamily
  - SetUIPopupWidth
  - SetUIScale
  - SetUIState
  - SetWailsApp
  - SoftwareEntry
  - SystemA11ySettings
  - UIState
  - UnmarshalJSON
  - Write
  - catDef
  - cloneConfig
  - closeRegistryKey
  - configDir
  - coopCoepEnabled
  - currentConfigVersion
  - detectDarkMode
  - detectHighContrast
  - ensureDir
  - ensureResourceDirs
  - extractedDir
  - fileSelector
  - finaliseConfig
  - getConfigUnsafe
  - getLastDir
  - getRegistryDWORD
  - httpServerInfo
  - isAndroid
  - maxRecentModels
  - mergeEnvState
  - mergeUIState
  - modadvapi32
  - openRegistryKey
  - procRegCloseKey
  - procRegOpenKeyExW
  - procRegQueryValueExW
  - safeLogError
  - safeLogInfo
  - safeLogWarning
  - selectFile
  - setLastDir
  - settingDir
  - shutdownServers
  - softwareDir
  - thumbnailDir
  - updateConfig
  - userConfigDir
invariants:
  - 所有配置读写经 configMu RWMutex（GetConfig RLock / updateConfig+writeConfig Lock），禁止裸读 cachedCfg
  - cachedCfg 仅由 writeConfig（Lock 内）写入，RLock 读取安全
  - SaveLastScene 经 sceneMu 串行化，防并发截断/交错写入
  - ServiceShutdown 顺序：关 watcher → 关 plaza 窗口（先卸 hook 再 Close）→ 并行关 HTTP 服务（5s 超时）
  - SetWailsApp 必须用 io.Writer 双写 slog（NewDualWriter），禁止自定义 slog.Handler 包装（wails3 生产构建挂死）
  - 错误返回须经 util.WrapError/WrapErrorf 包装；对外绑定方法须 util.SafeCall 兜 panic
tests:
  - internal/app/app_test.go
  - internal/app/shutdown_test.go
use_when:
  - Go 后端 生命周期 ServiceStartup ServiceShutdown
  - Go 配置系统 config.json GetConfig SetResourceRoot SetStorageMode
  - 无障碍 GetSystemA11ySettings
  - 后端日志环形缓冲 LogRing AiGetBackendLogs
  - COOP/COEP MPR coopCoepEnabled
---

# Go 后端核心（App 生命周期 + 配置系统）

## 系统概览
Go 端唯一的 Wails 绑定服务体（`internal/app` 包）。`App` 结构体持有全部后端状态（HTTP 服务表、配置缓存、下载监听器、LLM 取消句柄、日志环形缓冲、广场预热窗口），通过 `ServiceStartup`/`ServiceShutdown` 管理生命周期。`config.go` 实现双层配置持久化（bootstrap + settings）+ 版本迁移。

## 核心职责
- `app.go` — App 结构体 + 生命周期 + 各 Select* 文件对话框入口 + 数据模型（ModelEntry/SoftwareEntry/ModelMeta/UIState/OverridePaths/Config/EnvState/RenderPreset）。
- `config.go` — 双层配置读取（`configDir()/config.json` 引导 → 含 ResourceRoot 时叠加 `settingDir()/config.json`）、`finaliseConfig` 迁移（v0→v1 library_root→resource_root）、Android storage mode 同步。
- `log_ring.go` — `LogRing` 环形缓冲（cap 200）+ `DualWriter`（ring + stderr 双写），供 AI 诊断助手取后端日志（ADR-196/205）。
- `a11y*.go` — `GetSystemA11ySettings`，按平台（windows/其他）返回系统无障碍设置。
- `mpr_on.go`/`mpr_off.go` — 构建标签互斥的 `coopCoepEnabled` 常量（MPR 多线程 WASM 物理，ADR-099）。

## 对外 API（节选）
- `NewApp(version, buildTime, commitHash)` — 构造 App。
- `ServiceStartup(ctx, options)` — 恢复下载监听 + 后台清理孤立缓存 + 清理 legacy serve 目录。
- `ServiceShutdown()` — 见不变量（watcher→plaza→HTTP 三级关闭）。
- `GetConfig() (*Config, error)` — RLock 读取（含缓存）。
- `updateConfig(mutate, rescan)` — Lock 写 + 可选重扫模型库。
- `GetBuildInfo()` / `GetAppVersion()` — 构建信息（-ldflags 注入）。

## 与其他子系统关系
- 被 Wails 绑定层自动生成（`@bindings`），前端经 `core-backend` / `wails-bindings` 调用。
- 依赖 `internal/dialogs`（文件对话框）、`internal/util`（错误包装/SafeCall）、`internal/thumbnail`、`internal/i18nerr`。
- 持有并驱动 `watch.go`（watcher）、`zipextract.go`（HTTP 服务表）、`proxy.go`、`plaza_window.go`（预热窗口）。

## 前端接入入口
- 前端通过 `@/core/wails-bindings`（代理化，ADR-176）调用全部绑定。
- 设置页：`frontend/src/menus/settings-system.ts`（无障碍/系统设置）、`settings-about.ts`（GetBuildInfo）。
- AI 诊断：`AiGetBackendLogs` / `AiGetBackendState` 供 `settings-diagnostic` 面板使用。

## 不变量
- 配置单写者：任何 Set*/配置变更必须经 `updateConfig(mutate, rescan)`，禁止在 config.go 外直接改字段。
- 生命周期配对：ServiceStartup 里 `go func` 启动的后台任务不要求同步阻塞，但 Shutdown 必须清理所有可回收资源。
- 平台分支用 `isAndroid` 变量 + 文件名后缀构建标签（`_desktop`/`_android`/`_windows`）。

## 验证入口
- 测试：`internal/app/app_test.go`、`internal/app/shutdown_test.go`。
- 命令：`go test ./internal/app/`。
