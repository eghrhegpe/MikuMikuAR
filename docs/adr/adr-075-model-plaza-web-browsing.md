# ADR-075: 模型广场 · 网页浏览（内嵌代理 + 外链闭环）

> **状态**: 已采纳 · 已实施（Phase 1 基础代理 + 导航接入）
> **关联**: ADR-003（下载策略，方案 C 已实施）、ADR-011（Wails 版本策略）
> **增强**: ADR-077（Cookie 中继·登录态）、ADR-078（下载拦截·一键入库）、ADR-079（页面语义提取）
> **来源**: 用户需求 2026-07-09；参考 `ysm-model-manager` 的「创意工坊」实现

---

## 背景

用户希望在 MikuMikuAR 内浏览模型资源站，复刻 `ysm-model-manager` 的「创意工坊」体验（内嵌 iframe + Go 本地反向代理突破 `X-Frame-Options`）。

`ADR-003` 方案 D（内嵌 WebView + 反向代理）曾因「SPA 全链路代理工程量大易失效」被否决，转用方案 C（系统浏览器 + fsnotify 落库）。但 `ysm-model-manager` 实际用**双路**规避了方案 D 的失效点：

- 免登录的展示型站点（Pixiv / Booth / 作者页）走**内嵌代理**；
- 需登录的强 SPA（模之屋）走**系统浏览器外链**，保留登录态与临时签名 URL。

本项目已有方案 C 的 fsnotify 落库闭环（`internal/app/watch.go` + `DownloadWatchDir`），可无损复用。两条路在「落库」处会师，无需重复造轮子。

---

## 决策

采用**双路模型**（联邦架构，见对话中的接入架构图）：

| 模式 | 流量 | 站点类型 | 登录态 |
|------|------|----------|--------|
| A · 内嵌 | Go 反向代理 → `iframe` | 免登录展示站 | 不需要 |
| B · 外链 | `Browser.OpenURL` → 系统浏览器 | 需登录 SPA | 保留 |

**落库闭环**：无论哪条路下载的 zip，落入 `Downloads/MMDHub_Inbox`，由 `ADR-003` 方案 C 的 fsnotify 监听 → Magic Number 校验 → `ImportLocalFile` 落库。

---

## Wails v3 适配要点

1. **绑定生成**：`frontend/bindings/` 由 `npm run generate:bindings`（`wails3 generate bindings -ts -i -d frontend/bindings ./...`）**自动生成**，含全部 `export function` 包装与 FNV-1a method ID（生成器自动算，无需手写）。新增/删除 Go 方法后**重跑生成器**即可，禁止手维护 `bindings/` 下 .ts。契约测试 `app.contract.test.ts` 动态校验导出函数存在性 + FNV-1a ID（仅一致性护栏，非手写依据）。
2. **下载钩子**：v3 WebView2 是否暴露下载事件**未验证**；内嵌模式内的下载先引导用户用「在浏览器打开」切到外链（模式 B），不依赖 webview 下载拦截。
3. **Android**：本期**不做**（用户确认桌面优先）。`proxy.go` 的反向代理逻辑保持 cgo-free，未来 Android 端可直接复用。

---

## 技术实现

- **Go 新增 `internal/app/proxy.go`**：
  - `StartProxy(target string) (string, error)`：启动 `httputil.ReverseProxy`，返回 `http://127.0.0.1:<port>/` 本地 URL；剥离响应头 `X-Frame-Options` 与 CSP 的 `frame-ancestors`；改写页面内相对 URL / 重定向 `Location` 为代理绝对 URL。
  - `StopProxy()`：关闭并清理代理 server。
  - 复用 `zipextract.go` 的 `a.httpSrvMu` / `httpServerInfo` / `shutdownServers` 框架挂载生命周期。
- **站点元数据**：首版用前端常量 `frontend/src/menus/plaza-sites.ts`（`{ name, url, mode: 'embed'|'external' }`）；后续可下沉到 Go config 做用户配置。
- **前端新增 `frontend/src/menus/plaza.ts`**：`registerPopupMenu` 建菜单，根级 `slideRow` 列站点；内嵌站进入 `renderCustom` iframe 层（含地址展示 + 「在浏览器打开」按钮），外链站直接 `openExternalURL`。
- **入口绑定**：`frontend/src/core/main.ts` 用 `toggleOverlay('sceneOverlay', m.showPlaza)` 接入（参考现有 settings 入口）。
- **事件**：无新增前端事件；`StartProxy` 同步返回本地 URL。

---

## 涉及文件

| 文件 | 改动 |
|------|------|
| `internal/app/proxy.go` | 新增 `StartProxy` / `StopProxy` |
| `frontend/src/menus/plaza.ts` | 新增菜单 + iframe 面板 |
| `frontend/src/menus/plaza-sites.ts` | 站点常量 |
| `frontend/src/core/main.ts` | 绑定入口（`toggleOverlay`） |
| `frontend/bindings/mikumikuar/internal/app/app.ts` + `models.ts` | 自动生成（`npm run generate:bindings`） |
| `frontend/src/core/wails-bindings.ts` | 手维护（model 类型登记聚合层，生成器只写 `bindings/`、不碰 `src/`） |
| `frontend/src/__tests__/bindings/app.contract.test.ts` | 动态计数（`Object.keys`），Go 方法增删后重跑生成器即自动同步，无需手改期望值 |

---

## 风险与限制

- **站点反爬 / 动态 API**：内嵌代理仅用于相对静态的展示站；登录站一律外链，规避 cookie / 签名 URL 跨域代理失效。
- **HTTPS 重定向改写**：`ReverseProxy` 的 `ModifyResponse` 需改写 `Location` 与页面内相对路径，细节需实测。
- **CSP 残留**：部分站点 CSP 含 `script-src` 限制，iframe 内 JS 可能仍受限；首版接受，必要时扩展头改写。

---

## 后续增强（已拆分 ADR）

| ADR | 内容 | 优先级 |
|-----|------|--------|
| ADR-077 | Cookie 中继 — 代理层维护 cookiejar，解锁登录态站点内嵌 | P0 |
| ADR-078 | 下载拦截 — 注入 JS 拦截下载链接，Go 端直接入库 | P0 |
| ADR-079 | 页面语义提取 — 解析 HTML 返回结构化数据，原生列表替代 iframe | P1 |
