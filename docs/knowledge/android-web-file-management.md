---
tier: architecture
kind: android_web_file_management
name: 安卓网页版文件管理诊断
category: core
scope:
  - build/android
  - frontend/src/core
  - frontend/src/core/backend
source_files:
  - frontend/src/core/platform.ts
  - frontend/src/core/backend/go-adapter.ts
  - frontend/src/core/backend/browser-adapter.ts
  - frontend/src/menus/library-setup.ts
adr:
  - ADR-017
  - ADR-176
  - ADR-177
  - ADR-178
  - ADR-180
  - ADR-183
  - ADR-194
  - ADR-099
symbols:
  - FsaAuthState
  - awaitWailsBridge
  - browserAdapter
  - dismissFsaAuthPrompt
  - getFsaAuthState
  - getFsaDownloadAuthState
  - getFsaDownloadHandle
  - goAdapter
  - guardExternalAction
  - ingestModelBytes
  - ingestModelFile
  - ingestModelFiles
  - initLibrary
  - isAndroidPlatform
  - isFsaAuthPromptDismissed
  - isWebEntryMode
  - isWebPlatform
  - openExternalLink
  - openExternalURL
  - readDeclaredAdapter
  - reauthorizeFsaDownload
  - reauthorizeFsaRoot
  - refreshLibrary
  - reloadConfig
  - rescanAndSync
  - resetFsaAuthPromptDismissed
  - selectFsaDownloadDir
  - selectOverridePath
  - selectResourceRoot
  - setScanProgressCallback
  - switchStorageMode
invariants:
  - 安卓 APK 内前端运行于 origin `https://wails.localhost`（WebViewAssetLoader `setDomain`，MainActivity.java:62-63/149/298），属安全上下文，FSA 句柄按此 origin 持久化
  - 安卓文件访问后端走 shared 模式（MANAGE_EXTERNAL_STORAGE + os.ReadDir /sdcard），与网页 FSA 是两套机制，检索与讨论时务必区分
  - `window.wails` 经 `addJavascriptInterface(WailsJSBridge,"wails")` 注入（MainActivity.java:294），`wails.platform()` 返回 "android"（WailsJSBridge.java:103），冷启动存在注入延迟
use_when:
  - 安卓网页版文件管理在 FSA 与 shared 模式之间行为漂移
  - 安卓端目录选择 / 授权 / 句柄持久化异常
  - 排查 `window.wails` 冷启动竞态导致的后端选型错误
---

# 安卓网页版文件管理诊断

## 系统概览

安卓 APK 内前端运行于 WebView，资源经 `WebViewAssetLoader`（`domain = wails.localhost`）由 Go 端 `serveAsset` 进程内提供：

- `MainActivity.java:62-63` `WAILS_SCHEME="https"` / `WAILS_HOST="wails.localhost"`
- `MainActivity.java:148-151` `WebViewAssetLoader.Builder().setDomain(WAILS_HOST).addPathHandler("/", new WailsPathHandler(bridge))`
- `MainActivity.java:298` `webView.loadUrl("https://wails.localhost/")`
- `WailsPathHandler.java` `handle()` → `bridge.serveAsset(goPath,...)`（WailsBridge.java:221，调 `nativeServeAsset` L110）

文件管理有两条**互斥**后端，由 `platform.ts` 平台判定 + `go-adapter.ts` 能力矩阵分流：

| 后端 | 机制 | 现状 |
|------|------|------|
| **shared 模式**（安卓原生）| Go `fileaccess_android.go` 经 `MANAGE_EXTERNAL_STORAGE` 授权直读 `/sdcard`（ADR-017/194）| ✅ 主流、已落地 |
| **FSA**（网页）| 浏览器端 `browser-adapter.ts` 走 `showDirectoryPicker` / 句柄持久化（ADR-180/183）| ✅ 网页活跃，安卓未分支 |

## 迷的根因（分层）

### A 层（Go/Java 平台）—— 已有分析，非本次缺口

`docs/research/Wails v3-android and ios.md`、`Android 环境下 Wails v3 隐患清单.md` 已覆盖 WebViewAssetLoader 架构、SAF 文件对话框、fsnotify 在安卓不可用、FileAccessor 未实现 SAF 等。**本卡不再重复**，仅标注其未触及前端 FSA 在安卓 WebView 内的行为。

### B 层（前端 FSA 在安卓 WebView 内）—— 本次真实缺口

1. **冷启动平台判定竞态**（ADR-176/177）
   - `isWebPlatform()`（`platform.ts:28`）判 `window.wails` 是否 `undefined`；`isAndroidPlatform()`（`platform.ts:13`）判 `window.wails.platform() === 'android'`。
   - `window.wails` 经 `addJavascriptInterface(WailsJSBridge, "wails")` **异步注入**（`MainActivity.java:294`）；`wails.platform()` 为 `@JavascriptInterface`（`WailsJSBridge.java:103`）。
   - 冷启动时 `window.wails` 尚未注入 → `isWebPlatform()` 先返回 `true` → **FSA 后端被提前选中**；若 `resolveBackend()` 未 `await awaitWailsBridge()`（`platform.ts:44`），文件管理就跑在 FSA 路径而非安卓 shared 模式。

2. **FSA 在 `wails.localhost` origin 的行为未文档化**
   - FSA 句柄按 origin 持久化（`docs/web-data-origin-isolation.md`），但安卓 WebView 内 `showDirectoryPicker` / `requestPermission` 的**支持度、跨会话句柄留存、COOP/COEP（ADR-099）表现**均**无文档、无测试**。
   - `getFsaAuthState` 四态测试（`backend.fsa-auth.test.ts`）**无安卓分支**，只覆盖 `unsupported/none/granted/revoked` 抽象态。
   - `browser-adapter.ts` 对 `android|fsa|showDirectoryPicker|webview` **零命中**。

3. **能力矩阵散落分支**（ADR-178 / ADR-176 已识别 🔴P1）
   - `fsSelectDir: !isAndroidPlatform()` 是「每能力一处 `isAndroid` 分支」的典型。`docs/research/multi-end-maturity-matrix.md`（已并入 `docs/targets.md` §六）明确：缺统一端能力协商协议，接缝随能力数增长变脆。
   - 竞态窗口内 `isAndroidPlatform()` 误判为 `false` → `fsSelectDir=true` → 触发 `showDirectoryPicker`（FSA），在安卓上半支持。

4. **死代码与框架 SAF 残留**
   - `WailsBridge.openDocumentTree`（L302）+ `MainActivity.SAF_TREE_REQUEST`（L66/L656）已标 `@deprecated SAF 已废弃 (ADR-194)`，Go 侧无调用者。
   - 但 Wails v3 框架文件**打开**对话框仍走 SAF（`Wails v3-android and ios.md:148`），与 shared 模式后端并存，易误判路径。

## 关键符号 → 源码锚点

| 符号 | 文件:行 | 角色 |
|------|---------|------|
| `isAndroidPlatform` | `frontend/src/core/platform.ts:13` | 判 `window.wails.platform()==='android'` |
| `isWebPlatform` | `frontend/src/core/platform.ts:28` | 判 `window.wails` 是否 undefined（冷启动竞态源）|
| `awaitWailsBridge` | `frontend/src/core/platform.ts:44` | 轮询等待 `window.wails` 注入 |
| `fsSelectDir` | `frontend/src/core/backend/go-adapter.ts` | `!isAndroidPlatform()`，目录选择能力真相源 |
| `getFsaAuthState` | `frontend/src/core/backend/browser-adapter.ts` | FSA 四态探针，**无安卓分支** |
| `platform()` | `WailsJSBridge.java:103` | `@JavascriptInterface`，回 "android" |
| `openDocumentTree` | `WailsBridge.java:302` | SAF 死代码（ADR-194 待清）|
| `serveAsset` | `WailsBridge.java:221` | 转发 Go `nativeServeAsset` 供 WebView 资源 |

## 外部浏览器文档核对（已拉取 · 2026-08-10）

> 来源：MDN Web Docs（`showDirectoryPicker` / COOP / COEP 兼容性表）、Chrome for Developers《The File System Access API》、Wails v3 官方文档（`guides/mobile`）、社区 POC（`cs-util-com/FileSystemAccessOnAndroid`，Chrome 132+）。结论互证一致，且与 `docs/research/` 的 Go/Java 层分析**互补不重叠**。

### ① FSA 在安卓 Chrome / System WebView 的支持矩阵

| 能力 | 安卓 Chrome | 安卓 System WebView | Firefox Android | Safari iOS |
|------|------------|---------------------|-----------------|------------|
| `showDirectoryPicker` / `showOpenFilePicker` / `showSaveFilePicker` | ✅ **132+**（2025-01 起全量）| ✅ **132+** | ❌ 不支持 | ❌ 不支持 |
| `FileSystemDirectoryHandle` 读/写/迭代 | ✅ | ✅ | ❌ | ❌ |
| 句柄 `IndexedDB` 跨会话持久化 | ✅（按 origin 绑定）| ✅ | ❌ | ❌ |
| `requestPermission` / `queryPermission` | ✅ | ✅ | ❌ | ❌ |

**对本项目的冲击（颠覆原假设）**：原以为「安卓不支持 FSA → 竞态只会落到 unsupported 兜底」。实情是**现代安卓 WebView（≥132，Play 商店自动更新）FSA 目录拾取完全可用**，因此冷启动竞态 `isWebPlatform()=true` 期间若设备 WebView≥132，`showDirectoryPicker` 会**真实成功**并开出一个与 shared 模式（`/sdcard`）并存的第二条文件管理路径——这正是「迷」的放大因子，ADR-176/177 的竞态修复优先级应上调。
- 前置条件：① 安全上下文（`https://wails.localhost` 满足 ✅）；② 用户手势触发（`showDirectoryPicker` 须 button click，自动重扫流程须注意）；③ 句柄持久化按 `wails.localhost` origin，与 shared 模式授权体系正交，易产生「同一文件两套访问入口」。

### ② Wails v3 安卓 `window.wails` 注入时序

- 官方：安卓 WebView + WebViewAssetLoader，「Wails wires up the message bridge automatically」（`v3.wails.io/guides/mobile`）。
- 本项目实现（与官方 deep-dive 同构）：`addJavascriptInterface(new WailsJSBridge(bridge, webView), "wails")`（MainActivity.java:294）在 WebView 初始化时同步注册；**完整 runtime（bindings / events / `platform()` 能力）在 `onPageFinished` 经 `injectRuntime` 注入**（gunbark.dev 复刻的同构 MainActivity）。
- `wails.platform()` 是 Java `@JavascriptInterface` 直接返回常量 `"android"`（WailsJSBridge.java:103），不依赖 Go 初始化；故 `window.wails` 对象存在的瞬间即可调 `platform()`。
- **时序契约结论**：`window.wails` 基础对象在 `loadUrl` 前已就位；但前端模块解析若早于 WebView JS 桥注册，仍会捕获到 `window.wails === undefined` 的瞬态。`awaitWailsBridge()`（platform.ts:44）的轮询兜底正确，但**后端选型必须 `await` 它**，否则竞态窗口内 `isWebPlatform()` 误判为真。

### ③ COOP/COEP 在 `wails.localhost` WebView origin

| 响应头 | 安卓 Chrome | 安卓 System WebView |
|--------|------------|---------------------|
| COOP（`same-origin`）| ✅ 83+ | ❌ **不支持** |
| COEP（`require-corp`）| ✅ 83+ | ✅ 86+ |

- **关键约束**：跨源隔离需 **COOP + COEP 同时成立**；安卓 WebView **不支持 COOP** → `self.crossOriginIsolated` 在 WebView 内**恒为 false**，即使注入 COEP 也无济于事。
- **对 ADR-099（mpr-coop-coep-poc）的反哺**：依赖 `crossOriginIsolated` 的能力（SharedArrayBuffer / WASM 多线程）在安卓 WebView 上**不可用**，必须回退单线程 WASM；且 COEP `require-corp` 下子资源需 CORP/CORS，而 `WailsPathHandler` 仅下发 `Access-Control-Allow-Origin: *`、未带 `Cross-Origin-Resource-Policy`，可能触发 COEP 拦截。建议回填 ADR-099 标注安卓 WebView 例外。

## 修复方向（落到 ADR）

1. 抽 `getCapabilities()` 声明式端能力清单，淘汰散落 `isAndroid` 分支（ADR-176/178 🔴P1）。
2. 后端选型强制 `await resolveBackend()`（ADR-176/177），消除冷启动 FSA/shared 漂移。
3. 安卓 FSA 路径补四态 + 平台分支测试；清理 `openDocumentTree` / SAF 死代码（ADR-194）。
4. 引擎层缺失文档补专卡（WebView2 / WKWebView / 安卓 WebView 能力矩阵）。

## 与其他子系统关系

- 能力真相源：`go-adapter.ts`；平台判定：`platform.ts`；Web 端 FSA：`browser-adapter.ts` + `docs/web-data-origin-isolation.md`。
- 多端成熟度卡点：`docs/targets.md` §六（原 `multi-end-maturity-matrix.md`），已列 🔴P1 端能力协商缺失。

## 验证入口

- 后端单测：`internal/app/*_test.go`
- 前端契约：`frontend/src/__tests__/bindings/app.contract.test.ts`
- FSA 单测：`frontend/src/core/backend/browser-adapter.fsa-auth.test.ts`（**需补安卓分支**）
- 手动复现：安卓 APK 冷启动即设下载目录，观察是否先弹 FSA 再翻 shared（竞态复现）

## UI 入口

- 菜单层级 / 入口函数 / 快捷键统一由 [menu-map.md](./menu-map.md) 机器生成（勿手改）。
- 运行时动态生成的菜单项（renderCustom / slideRow 等）无法静态提取，缺口由本卡正文说明。
