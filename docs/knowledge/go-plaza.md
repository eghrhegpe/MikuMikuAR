---
tier: architecture
kind: go_plaza
name: Go 广场窗口与配置
category: backend
scope:
  - internal/app/plaza_window.go
  - internal/app/plaza_config.go
source_files:
  - internal/app/plaza_window.go
  - internal/app/plaza_config.go
symbols:
  - ClosePlazaWindow
  - FetchPlazaConfig
  - GetCachedPlazaConfig
  - NavigatePlazaWindow
  - PlazaGoBack
  - PlazaGoForward
  - PlazaReload
  - PlazaZoomIn
  - PlazaZoomOut
  - PlazaZoomReset
  - SavePlazaConfig
  - fetchPlazaRemote
  - plazaCacheDir
  - plazaCall
  - plazaDirectBridgeJS
  - plazaRemoteResult
  - plazaSource
  - prewarmPlazaWindow
  - readPlazaCache
  - writePlazaCache
invariants:
  - 广场窗口单实例预热（App 启动时 prewarmPlazaWindow，隐藏创建避免 WebView2 冷启动 1-3s）
  - plazaWin 访问必须经 plazaWinMu；ServiceShutdown 先卸 WindowClosing hook 再 Close，否则只隐藏不销毁
  - 导航完成时按 plazaDirectMode 注入 window.open 拦截桥（plazaDirectBridgeJS）
  - plaza 配置本地缓存（plazaCacheDir）兜底远程不可达；SavePlazaConfig 持久化用户配置
  - 窗口方法统一走 plazaCall(fn)，防窗口已关闭后调用 nil 指针
tests: []
use_when:
  - Go 广场窗口 预热 导航 NavigatePlazaWindow 窗口控制
  - 广场配置 FetchPlazaConfig SavePlazaConfig 缓存
  - plaza 直连模式 window.open 拦截
---

# Go 广场窗口与配置

## 系统概览
模型广场的桌面窗口管理与配置持久化（`plaza_window.go` + `plaza_config.go`）。启动时**预热**隐藏 WebView2 窗口（ADR-075 单实例，消除冷启动），点击站点时 Show + SetURL 导航；导航完成按直连/代理模式注入 `window.open` 拦截桥。配置侧支持远程拉取 creators/sites 列表 + 本地缓存兜底。

## 核心职责
- `prewarmPlazaWindow()` — App 启动预热隐藏窗口（ServiceStartup 前经 SetWailsApp）。
- `NavigatePlazaWindow(targetURL, direct)` — 导航 + 按 `plazaDirectMode` 注入桥。
- `ClosePlazaWindow()` / `PlazaGoBack/Forward/Reload/ZoomIn/ZoomOut/ZoomReset` — 窗口操作（统一 `plazaCall`）。
- `FetchPlazaConfig()` / `GetCachedPlazaConfig()` / `SavePlazaConfig()` — 远程/缓存/持久化三态配置。
- `fetchPlazaRemote` + `writePlazaCache`/`readPlazaCache` — 远程拉取 + 缓存文件。

## 对外 API（节选）
- `NavigatePlazaWindow(targetURL string, direct bool) error` — 绑定 `NavigatePlazaWindow`。
- `FetchPlazaConfig() (creators, sites string, err error)` — 广场配置（含缓存兜底）。

## 与其他子系统关系
- 与 `go-proxy.md` 配合：直连模式（direct）vs 代理模式决定导航注入逻辑。
- 被前端 `plaza-browser.ts` / `plaza-sites.ts` / `plaza-state.ts` 调用。

## 前端接入入口
- 模型广场面板：`plaza-browser.ts`（导航）、`plaza-sites.ts`（站点配置）、`plaza-state.ts`（状态）。

## 不变量
- plaza 窗口全局唯一；所有方法经 plazaWinMu 守卫 + `plazaCall` 判 nil。
- Shutdown 必须先卸 `WindowClosing` hook 再 Close（否则 Close 被 Cancel 只隐藏）。
- 配置读取顺序：内存/磁盘缓存 → 远程；远程失败回退缓存。

## 验证入口
- 无专项单测，手动验证：`go test ./internal/app/ -run "Plaza"`。
