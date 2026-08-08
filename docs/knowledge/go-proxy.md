---
tier: architecture
kind: go_proxy
name: Go 模型广场代理（SSRF 防护）
category: backend
scope:
  - internal/app/proxy.go
source_files:
  - internal/app/proxy.go
symbols:
  - DownloadFromPlaza
  - PlazaDownloadResult
  - Read
  - StartProxy
  - StopProxy
  - cookiesToString
  - currentProxyTarget
  - emitDownloadComplete
  - getCookies
  - handlePlazaDownloadPost
  - handlePlazaUrlPost
  - init
  - isBlockedIP
  - isWebSocketUpgrade
  - maxPlazaDownloadBytes
  - maxPlazaDownloadReqBytes
  - maxPlazaHTMLBody
  - plazaDownloadClient
  - plazaInjectScript
  - plazaSSRFGuard
  - progressReader
  - proxyServerKey
  - proxySession
  - proxySessions
  - proxyWebSocket
  - setCookies
  - ssrfGuardedTransport
  - wsTunnelMaxDuration
invariants:
  - 代理目标仅允许用户显式配置的广场域名，防止 Open Proxy；plazaSSRFGuard 拦截私有/环回 IP（isBlockedIP）
  - maxPlazaHTMLBody=64MiB、maxPlazaDownloadBytes=1GiB 大小上限，超限中止
  - 会话 cookie 按 host 隔离（proxySessions map），禁止跨站泄漏
  - 下载流经 progressReader 上报进度 + emitDownloadComplete 通知前端（去重）
  - 端口 0 随机监听；StopProxy 必须清理会话与 cookie
  - SSRF 防护只允许 http/https scheme 且 DNS 解析后 IP 必须在公网段
tests:
  - internal/app/proxy_test.go
use_when:
  - Go 模型广场代理 StartProxy StopProxy
  - SSRF 防护 私有 IP 拦截 isBlockedIP
  - 广场下载 DownloadFromPlaza
  - WebSocket 代理 proxyWebSocket
---

# Go 模型广场代理（SSRF 防护）

## 系统概览
模型广场（Plaza）的本地代理服务（`proxy.go`，867 行）。起本地 HTTP/HTTPS 代理转发到用户配置的广场站点，注入前端脚本改造页面（`plazaInjectScript`），支持会话 cookie 隔离、WebSocket 升级转发、限流与**下载专用通道**（`DownloadFromPlaza`）。安全重点是防 Open Proxy 与 SSRF。

## 核心职责
- `StartProxy(target, mode)` — 起本地代理（按模式注入桥接脚本，直连/代理两模式），返回本地 URL。
- `StopProxy()` — 停代理并清理会话。
- `plazaSSRFGuard` + `isBlockedIP` — DialContext 拦截私有网段/环回 IP，防 SSRF。
- `proxyWebSocket` — WebSocket 升级转发（含 cookie）。
- `DownloadFromPlaza(fileURL, fileName)` — 经代理会话下载资源（限 1GiB，进度上报）。
- `handlePlazaDownloadPost` / `handlePlazaUrlPost` — 前端回调端点。

## 对外 API（节选）
- `StartProxy(target, mode string) (string, error)` — 绑定 `StartProxy`，返回 `http://127.0.0.1:<port>/`。
- `DownloadFromPlaza(fileURL, fileName) (*PlazaDownloadResult, error)` — 广场下载。
- `StopProxy() error` — 清理。

## 与其他子系统关系
- 被前端 `plaza-browser.ts` / `plaza-download.ts` 调用。
- 与 `go-plaza.md`（窗口预热/导航）配合；下载目标经 `go-watch.md`/`zipextract` 入库。

## 前端接入入口
- 模型广场：`plaza-browser.ts`（启动代理）、`plaza-download.ts`（下载）、`plaza-state.ts`。

## 不变量
- 代理只转发配置的白名单广场源；任何用户自定义 target 都必须过 SSRF 校验。
- 私有/环回/链路本地 IP 一律拒绝，DNS rebinding 由 DialContext 层兜底。
- 下载与页面体大小上限不可移除（磁盘/内存保护）。

## 验证入口
- 测试：`internal/app/proxy_test.go`。
- 命令：`go test ./internal/app/ -run "Proxy|SSRF|Blocked"`。
