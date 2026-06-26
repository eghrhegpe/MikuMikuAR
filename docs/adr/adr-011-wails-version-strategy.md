# ADR-011: Wails 版本策略 — 继续使用 v2，暂不升级 v3

**日期**：2026-07-16

---

## 背景

当前项目使用 Wails v2.12.0（稳定版）作为桌面壳。有两个需求触发了对 Wails v3 的评估：

1. **下载功能** — 先前尝试用 WebView2 内嵌模之屋实现"下载即导入"，但因 Wails v2 不暴露 `ICoreWebView2.DownloadStarting` 事件受阻（详见 ADR-003）。需确认 v3 是否解除此限制。
2. **Android 端适配** — 项目路线图有 Phase 6 Android 适配，v2 不支持移动端，v3 宣称支持 Android/iOS。

## 调查结果

### Wails v3 状态

| 维度 | 情况 |
|------|------|
| 版本 | v3.0.0-alpha2.106（2026-06-24） |
| 稳定度 | **Alpha** — README 标 Alpha，但官方称"API 基本稳定，已有生产应用在用" |
| 稳定版 ETA | **无** — 维护者承认"不知道什么时候能 beta" |
| 迁移成本 | **高** — API 全量重写：`wails.Run()` → `application.New()`，模块路径 `v2` → `v3`，CLI `wails` → `wails3` |
| Go 版本要求 | Go 1.25+（当前项目 1.23） |

### 下载功能 — v3 不解决问题

- v3 底层仍使用 `github.com/wailsapp/wails/webview2`（fork 自 `go-webview2`），与 v2 相同
- v3 的 `Window` 接口仍**不暴露** `ICoreWebView2` COM 对象
- GitHub issue [#4685](https://github.com/wailsapp/wails/issues/4685) 请求的是 `WebResourceRequested`（网络请求拦截），非 `DownloadStarting`，且仍在 backlog
- ADR-003 已选的方案 B（fsnotify 目录监听 + 自动导入）仍然是最佳路径

### Android 适配 — v3 可以解决，但不是现在

- v3 通过 JNI bridge + Android WebViewAssetLoader 支持 Android/iOS
- 构建命令：`wails3 task android:run` / `wails3 task android:package`
- 迁移涉及：桌面代码中 `//go:build linux` 需加 `&& !android` 保护；UI 需适配小屏幕

## 决定

**继续使用 Wails v2，暂不升级 v3。** 具体分两点：

### 1. 下载功能 — 坚持 ADR-003 方案 B

不因下载需求升级 v3（v3 无帮助）。继续推进 fsnotify 下载目录监听 + 自动导入链路：
- 将 `MMDDownloader/` 骨架合并回主项目
- 实现 `StartWatchDir` / `StopWatchDir` / `SetDownloadWatchDir` Go bindings
- 前端 toast 通知 + 一键导入按钮

### 2. Android 适配 — 等待 v3 进入 beta/stable

Android 是 Phase 6（路线图最末），距离当前 Phase 1-2 尚有距离。待 v3 进入 beta 或 stable 后再规划迁移。

## 备选方案对比

| 方案 | 下载问题 | Android | 迁移成本 | 推荐 |
|------|---------|---------|---------|------|
| A. 立即升级 v3 | ❌ 不解决 | ✅ 可解决 | 极高（重写整个应用） | ❌ |
| B. 继续 v2 + fsnotify | ✅ 已选路径 | ❌ 不支持 | 零 | ✅ **当前** |
| C. 保留 v2，Android 端用 Capacitor 等独立方案 | ✅ | ✅ 零耦合 | 中（维护两套壳） | ⬜ 远期候补 |

## 影响

**正面**
- 保持稳定构建环境，不引入 alpha 风险
- 下载功能按 ADR-003 既定方向推进，不因框架限制绕路
- 桌面端功能可继续打磨，不受迁移干扰

**负面或风险**
- Android 端需等 v3 稳定后才能启动，或考虑独立方案（如 Capacitor）
- 未来从 v2 迁移 v3 需要一次性重写整个前端壳集成层

## 相关文档

- [ADR-003](adr-003-download-strategy.md) — 下载策略决策（完整方案 A-E 枚举，确认方案 C + E）
- [ADR-008](adr-008-download-watch-spec.md) — 下载目录监听规范
- [Wails v3 Roadmap Discussion](https://github.com/wailsapp/wails/discussions/1484)
- [Wails #4685: Network Request Interception](https://github.com/wailsapp/wails/issues/4685)
