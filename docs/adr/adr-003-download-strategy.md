# ADR-003: 下载策略决策

**日期**：2026-07-16  
**更新**：2026-07-16 — 补充完整方案枚举（A-E），确认方案 C（短期）+ 方案 E（长期）架构
> **状态**: 部分完成 — 方案 C（fsnotify 自动导入）已实施，方案 E 为远期构想

---

## 背景

模之屋（aplaybox.com）是 MMD 模型的主要下载来源。用户需要将网站上下载的模型自动导入 MikuMikuAR 模型库。

模之屋特性：
- **Vue.js SPA** — 所有内容 JS 动态渲染，下载按钮由 JS 触发
- 下载**可能需要登录**（Cookie 会话）
- 下载 URL 可能是临时签名 / CDN
- `X-Frame-Options` 可能设 `DENY`（阻止 iframe 嵌入）

## 完整方案枚举

### 方案 A：WebView2 原生嵌入（放弃）

**路径**：Wails v2 底层用 `go-webview2`，通过操作 WebView2 Core 的 `DownloadStarting` 事件拦截下载。

**致命问题**：
- Wails v2 的 `options.App` **不暴露** `ICoreWebView2` COM 对象，无法注入 `DownloadStarting` handler
- Wails v3（当前 alpha）同样不暴露该接口（GitHub issue [#4685](https://github.com/wailsapp/wails/issues/4685) 是 `WebResourceRequested`，非 `DownloadStarting`，仍在 backlog）
- SPA + JS 触发下载 → 无法单纯通过 URL 拦截
- **结论**：不可行，除非 fork Wails 或 Wails 官方暴露该事件

### 方案 B：子窗口 WebView（放弃）

**路径**：Go 端用 `webview` 库单独开一个 WebView 窗口加载模之屋，监听导航事件。

**问题**：
- `go-webview2` Go binding 同样不暴露 `DownloadStarting`
- 需要写 CGo 直接调 WebView2 COM API — 复杂度极高
- **结论**：过度复杂，ROI 低

### 方案 C：系统浏览器 + 下载目录监听（当前推荐 · 短期）

**路径**：
```
用户点 🌐 → BrowserOpenURL(aplaybox.com) → 系统浏览器打开
用户在浏览器登录、浏览、下载
fsnotify 监听专用下载目录 → 检测到 .zip/.rar/.7z → toast 通知 → 一键导入
```

**优点**：
- 零反爬风险
- 用户用熟悉的浏览器（登录态、Cookie 都在）
- 对所有下载来源通用（模之屋 / Niconi / DeviantArt / BowlRoll）
- 实现成本低

**缺点**：
- 体验割裂（两个窗口）
- 需用户切换窗口

**改进措施**：
- 用户点击 🌐 后，Wails 窗口保持前台，弹出 Toast：「请在浏览器中完成下载，下载完成后将自动导入...」
- 监听**专用子目录**（`Downloads/MMDHub_Inbox`）而非整个 Downloads，避免误触
- 下载完成切回应用时，Toast 仍在 → 心理暗示"任务完成中"
- 文件类型校验：先读 Magic Number（`PK\x03\x04` / `Rar!\x1A\x07\x00`），过滤 `.crdownload` / `.part` 临时文件

### 方案 D：内嵌 WebView + 反向代理（放弃）

**路径**：Go 端做反向代理，剥离 `X-Frame-Options` 头，前端 iframe 加载模之屋，注入 JS hook 拦截下载。

**问题**：
- SPA 所有资源（JS/CSS/API/WebSocket）都要走代理
- 登录态 Cookie 需在代理层维护
- 下载 URL 可能临时签名，Go `http.Get` 可能 403
- 模之屋改接口/加密参数 → 代理立即失效
- **结论**：技术可行但工程量大、维护成本高，是无底洞

### 方案 E：浏览器扩展 + 本地通信（远期目标 · 长期）

**路径**：开发浏览器扩展注入模之屋页面，拦截下载按钮点击 → 获取下载 URL → 通过 `nativeMessaging` 发给 MikuMikuAR → Go 原生下载。

**优点**：
- 体验最好：完全在浏览器内操作，无割裂
- 可以获取精确的下载 URL（含登录态 Cookie）

**缺点**：
- 要开发、维护、分发浏览器扩展
- Chrome Web Store 对"下载拦截"类功能审核敏感
- 用户需手动安装扩展
- 长期维护成本高

**结论**：适合用户量起来后的护城河，现阶段只记录构想不动代码。

## 决定

### 短期 — 方案 C（立即执行）

将 MMDDownloader/ 骨架合并回主项目，完善下载目录监听 + 自动导入链路。

**关键设计决策**：

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 监听目录默认值 | `%USERPROFILE%/Downloads/MMDHub_Inbox` | 比监听整个 Downloads 干净，避免误触 |
| 自动导入默认值 | `false`（需要确认） | 安全第一，防止弄乱模型库 |
| 文件类型校验 | 读 Magic Number 过滤 | 防止 `.crdownload` / `.part` 触发导入 |
| 通知方式 | Toast + 状态栏 | 保持应用内上下文 |

**合并计划**：

| Phase | 内容 | 预估 |
|-------|------|------|
| Phase 1 | Go 端合并下载 + 监听 binding（`DownloadFile`/`DownloadAndImport`/`ImportLocalFile`/`StartWatchDir`/`StopWatchDir`/`SetDownloadWatchDir`） | 2h |
| Phase 1.5 | 文件类型校验（Magic Number 检测） | 0.5h |
| Phase 2 | 前端合并 `download.ts`，适配 MenuStack 架构 | 1.5h |
| Phase 3 | 设置面板 — 下载监听配置（目录输入 + 自动导入 checkbox） | 1h |
| Phase 4 | 🌐 按钮改为下载弹窗（资源网站列表 + 直链下载输入） | 1h |

### 长期 — 方案 E（构想阶段）

如果方案 C 体验不够好，再做浏览器扩展。这是一个独立项目，不在 MikuMikuAR 主项目内。

## 影响

**正面**
- 低风险、低维护成本的下载落库方案
- 不依赖任何站点的 DOM 结构或 API
- 监听专用目录，误触率低

**负面或风险**
- WebView 内嵌方案（方案 A/B/D）被排除，直到 Wails 原生暴露 DownloadStarting
- 浏览器扩展方案（方案 E）成本高，暂不投入

## 相关文档

- [ADR-008](adr-008-download-watch-spec.md) — 下载目录监听规范
- [ADR-011](adr-011-wails-version-strategy.md) — Wails 版本策略（确认 v3 不解决 DownloadStarting）
- [Wails #4685: Network Request Interception](https://github.com/wailsapp/wails/issues/4685)
