---
tier: architecture
kind: go_integration
name: Go 软件集成（Blender/MMD/自定义）
category: backend
scope:
  - internal/app/integration.go
source_files:
  - internal/app/integration.go
symbols:
  - AddCustomSoftware
  - LaunchSoftware
  - OpenCacheDir
  - OpenInBlender
  - OpenInMMD
  - OpenScreenshotDir
  - OpenWithSoftware
  - RemoveCustomSoftware
  - ScanSoftwareDir
  - SetMMDPath
  - UpdateCustomSoftware
  - defaultBlenderCandidates
  - defaultMMDCandidates
  - detectBlender
  - detectBlenderAt
  - detectMMD
  - detectMMDAt
  - detectSoftwareKind
invariants:
  - 软件路径检测须用候选表 + 探测（detectBlenderAt/detectMMDAt 注入式可测），禁止硬编码绝对路径
  - 启动一律 exec.Command 参数数组传递（无 shell 解释），禁止拼接命令字符串
  - 自定义软件登记持久化（Add/Remove/UpdateCustomSoftware 经配置系统）
  - Android 不支持软件启动（LaunchSoftware/OpenInMMD 返回错误）
tests: []
use_when:
  - Go 软件集成 Blender MMD 检测 打开
  - 自定义软件 ScanSoftwareDir LaunchSoftware
  - OpenWithSoftware 外部软件打开模型
---

# Go 软件集成（Blender/MMD/自定义）

## 系统概览
外部软件集成（`integration.go`，386 行）：自动探测 Blender/MMD 安装路径、以外部软件打开模型、自定义软件登记与扫描、截图/缓存目录打开。所有启动命令用参数数组（`exec.Command`），无 shell 注入风险。

## 核心职责
- `detectBlender` / `detectBlenderAt` + `detectMMD` / `detectMMDAt` — 候选路径探测（注入式可单测）。
- `OpenInBlender(modelPath)` / `OpenInMMD(modelPath)` — 以外部软件打开模型。
- `SetBlenderPath` / `SetMMDPath` — 手动指定路径（持久化）。
- `ScanSoftwareDir()` / `LaunchSoftware(path, args)` / `OpenWithSoftware` — 自定义软件扫描与启动。
- `Add/Remove/UpdateCustomSoftware` — 自定义软件管理（持久化）。
- `OpenScreenshotDir` / `OpenCacheDir` — 打开资源目录。

## 对外 API（节选）
- `OpenInBlender(modelPath string) error` — 绑定 `OpenInBlender`。
- `ScanSoftwareDir() ([]SoftwareEntry, error)` — 扫描可用软件列表。
- `LaunchSoftware(path, args string) error` — 启动外部程序。

## 与其他子系统关系
- 前端模型菜单 → 用外部软件打开（`model-ops.ts`）、设置 → 软件路径（`settings-about.ts` 相关）。
- 配置持久化走 `go-app.md` 配置系统。

## 前端接入入口
- 模型详情菜单：用 Blender/MMD/自定义软件打开（`model-ops.ts`）。
- 设置：软件路径登记（`settings-about.ts` / `settings-actions.ts`）。

## 不变量
- 命令参数必须数组化传递，禁止拼接字符串进 shell。
- 自定义软件登记持久化，重启后保留。
- 软件探测失败必须优雅回退（返回明确错误而非 panic）。

## 验证入口
- 无专项单测，手动验证：`go test ./internal/app/ -run "Blender|MMD|Software|Launch"`。
