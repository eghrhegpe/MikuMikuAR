# 四端目标能力矩阵（Single Source of Truth）

> 本文件是《MikuMikuAR 联邦》四端部署目标的**唯一能力真相源**。
> 维护规则：任何"某功能在某端是否可用"的判定，一律以本表 + `getCachedCapabilities()` 为准，禁止散落 `isAndroidPlatform()` / `isWebPlatform()` 直接判定（见 ADR-178 阶段 2 迁移）。
> 能力键定义见 `frontend/src/core/backend/types.ts` 的 `BackendCapabilities`；后端原生键 13 个（ADR-176），宿主运行时键 3 个（ADR-178，Phase 1 已落地 2026-07-24）。

## 一、四端拓扑（2×2）

```
                桌面宿主                安卓宿主
Wails 原生      桌面应用 (go)          安卓应用 (go)        ← go-adapter
  (go-adapter)
纯网页         网页模式 (browser)      网页模式安卓 (browser) ← browser-adapter
(browser-adapter)
```

- **go-adapter** 同时服务「桌面应用」与「安卓应用」，二者差异靠运行时自报（`crossOriginIsolated` / `isAndroidPlatform()`）。
- **browser-adapter** 同时服务「网页模式」与「网页模式安卓」，二者宿主运行时一致（安卓浏览器与桌面浏览器行为相同），无独立分支。
- 四端**共用同一 `frontend/` 代码库**，差异只经 `BackendService` 适配器 + 能力矩阵表达。不存在第四种代码路径。

## 二、能力快照表

图例：✅=true / ❌=false / 🔍=运行时检测 / ◐=条件真 / —=不适用

### 后端原生能力键（13，ADR-176）

| 能力键 | 桌面应用 | 安卓应用 | 网页模式 | 说明 |
|--------|:------:|:------:|:------:|------|
| `ar` | ✅ | ✅ | ❌ | AR 相机透视（getUserMedia camera passthrough），桌面/安卓可用；原生路由见 `arScope`（与 ar 正交，勿混淆） |
| `externalApps` | ✅ | ❌ | ❌ | Blender/MMD 等外部程序（guardExternalAction 同挡安卓+Web） |
| `plazaWindow` | ✅ | ✅ | ❌ | 模型广场窗口控制 |
| `fsAccess` | ❌ | ❌ | 🔍 | File System Access API（showDirectoryPicker） |
| `watchDir` | ✅ | ✅ | ❌ | 目录监听 |
| `proxyServer` | ✅ | ✅ | ❌ | 代理服务 |
| `fileServer` | ✅ | ✅ | ❌ | 静态文件服务（注：A0-01 后模型走 Blob URL，不再依赖 127.0.0.1） |
| `systemDirOpen` | ✅ | ✅ | ❌ | 系统文件管理器打开 |
| `storageMode` | ✅ | ✅ | ◐ | 存储模式切换（网页模式依赖 FSA 检测） |
| `screenshotSave` | ✅ | ✅ | ✅ | 截图保存 |
| `cacheManage` | ✅ | ✅ | ✅ | 缓存清理（IndexedDB） |
| `configPersist` | ✅ | ✅ | ✅ | 配置持久化（IndexedDB） |
| `modelScan` | ✅ | ✅ | ◐ | 模型库扫描（网页模式依赖 FSA 检测） |

### 宿主运行时能力键（3，ADR-178 Phase 1 已落地）

| 能力键 | 桌面应用 | 安卓应用 | 网页模式 | 说明 |
|--------|:------:|:------:|:------:|------|
| `crossOriginIsolated` | 🔍(true) | 🔍(**false**) | 🔍(true) | SharedArrayBuffer 可用 → MPR 多线程物理（ADR-133）。安卓应用 WebView 恒 false，是「桌面应用 vs 安卓应用」唯一功能性断点 |
| `clipboardReliable` | ✅ | ❌ | ✅ | 剪贴板 API 可靠。安卓应用 WebView 部分版本不可用（ADR-017 A2-06，已补 toast 兜底） |
| `arScope` | `none` | `android-app` | 🔍(`webxr`/`none`) | AR 原生路由作用域：无 / 安卓应用 ARCore / 网页 WebXR（按 `navigator.xr` 检测；当前无 UI 消费） |

> ⚠️ `crossOriginIsolated` 在 go-adapter 中**必须读 `window.crossOriginIsolated` 运行时**，不得硬编码 true——否则安卓应用误报可开 MPR（ADR-133 根因重现）。

## 三、四端差异要点（TL;DR）

1. **桌面应用 vs 安卓应用**：仅差三位宿主键——安卓应用 `crossOriginIsolated=false`（MPR 回退单线程）、`clipboardReliable=false`、`arScope=android-app`（ARCore）。其余后端键几乎一致。
2. **网页模式 vs 网页模式安卓**：共享 browser-adapter，宿主键取值一致；差异仅在于安卓浏览器的个别怪癖（如 A2-06 个别版本），由 `clipboardReliable` + 调用点兜底覆盖，**无需独立分支**。
3. **原生 vs 网页的本质断点**：`externalApps`/`plazaWindow`/`watchDir`/`proxyServer`/`fileServer`/`systemDirOpen` 为原生独占；`fsAccess`/`storageMode`/`modelScan` 网页模式依赖 FSA 检测。

## 四、CI 制品矩阵（待立，见 ADR-178 阶段 3）

| 制品 | 构建入口 | smoke 验收 |
|------|----------|-----------|
| 桌面应用（Win/macOS/Linux） | `wails build` | 现有 E2E（Playwright 5222） |
| 安卓应用（arm64 APK） | `build-android.ps1` | 安装自检 + MPR 单线程降级观测 |
| 网页模式 | `vite build --config vite.web.config.ts` → GitHub Pages | `web-smoke.spec.ts` / `web-resources.spec.ts` |

## 五、与 ADR 的映射

| ADR | 贡献 |
|-----|------|
| ADR-176 | `BackendService` 双适配器 + 13 键能力矩阵 |
| ADR-177 | Web Loader 与主应用统一路径（网页模式入口） |
| ADR-017 | 安卓应用适配（platform 探测范式、A2-06 剪贴板） |
| ADR-133 | 安卓应用 MPR 物理缺口（`crossOriginIsolated=false` 的根） |
| ADR-178 | 宿主运行时键补全（本表 §二 第二组） |
