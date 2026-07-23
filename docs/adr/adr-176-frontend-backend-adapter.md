# ADR-176: 前端 Backend 适配器双实现（Web/Desktop 通杀）

> **状态**: 实施中（2026-07-23 Phase 1 backend 抽象层 + Phase 2 业务接入均已落地。Phase 2 采用**绞杀者模式**：`wails-bindings.ts` 聚合层改造为 backend 代理——106 个业务真实调用函数改为 `_p()` 代理导出（经 `resolveBackend()` 路由），ESM 本地导出优先覆盖 `export *`，星号透传仅兜底 ④ 组 33 零调用函数；43 个业务消费文件**零改动**完成全量路由切换（含 init.ts 首屏链第 0 步）。web-loader 入口置 `__MMKU_WEB__` 短路标记。测试环境在 setup-wails.ts 注入 wails 桥标记（mock runtime 语义等价 Go 在场），防 3s 超时误降级 browser。验证：tsc 0 错、backend 单测 16/16、契约 17/17、全量回归 1956/1956 绿。Phase 3（同日落地）：web-loader 升级准完整网页入口——新增 `src/web-loader/library.ts` 模型库（IndexedDB 持久化，键规约 `entry:<name>` 元数据 + `file:<name>` 原档字节，与 browser-adapter 共库互通）；main.ts 经 `resolveBackend()` 接入 backend（能力徽章 + 初始化失败不阻断拖拽主链路）；加载成功自动入库 + lastModel 恢复引导；库面板 UI（列表/一键重载/删除二次确认防呆/空状态引导）；顺手修复 browser-adapter `_listModels` 误列 `recent` 数组的隐患（`entry:` 前缀过滤）。验证：tsc 0 错、库单测 7/7、backend 16/16、全量回归绿）
> **日期**: 2026-07-23
> **关联**: ADR-011（Wails 版本策略）、ADR-017（安卓适配，platform 探测范式）、ADR-159（桥接注入范式）、现有 `src/web-loader/`（纯浏览器 PMX 原型）
> **审核记录**: 2026-07-23 架构审核（数据流/生命周期/降级契约）— 有条件通过，**全部 P1×2 + P2×3 已回填修订并同步至蓝图**：P1① 调用集实证见文末章节（业务真实调用 106/139）；P1② `resolveBackend()` async + 桥接短路；P2① 接入点改造第 0 步首屏链；P2② 新建 `isWebPlatform()` + 扩展 `guardExternalAction`；P2③ 三态能力矩阵节。**状态可由「规划」推进至「待实施」。** 详见「审核发现」。

## 背景

MikuMikuAR 当前是 Wails v3 桌面/安卓应用，前端通过 `src/core/wails-bindings.ts` 聚合层调用 Go 生成的 `@bindings/...` 函数，并经 `window.wails` 桥接访问原生能力（文件系统、配置持久化、场景存档、AR、外部程序等）。

用户诉求：能否**一个前端同时跑在浏览器（零后端）和 Wails（含 Go 后端）两种环境**，而非维护独立分支或仅靠 `web-loader` 原型。

**关键量化发现**（2026-07-23 核查）：
- 直接 `import '@bindings/'` 的文件**仅 2 个**：`wails-bindings.ts`（聚合层）与 `plaza-browser.ts`（模型广场代理，独立页面）。
- 业务代码对 Go 的调用高度收敛在聚合层，且已大量使用 `window.wails?.xxx?.()` 可选链兜底。
- `src/web-loader/main.ts` 已证明：PMX 加载 + JSZip 解压 + babylon-mmd 在**零后端**下完全可用。

结论：耦合面窄、浏览器侧最难一环已有验证，引入适配器层实现双环境通杀**工程可行且改造量小**。

## 决策

引入 **BackendService 适配器层**，将前端对 Go 后端的依赖收敛为统一接口；运行时按 `window.wails` 是否存在注入 `GoAdapter` 或 `BrowserAdapter`。目标不是 100% 功能对等，而是**能力探测 + 优雅降级**：原生独占能力（AR、外部程序、系统级文件访问）在浏览器侧显式降级。

## 建筑蓝图

> ⚠️ **接口规模预警（2026-07-23 实测）**：`BackendService` 绝非蓝图示例的 ~10 方法。业务真实调用 Go 函数 **106** 个（占契约测试 139 全量的 76%）。实施时接口须覆盖这 106 个函数、或对其中的 17 个原生独占函数显式降级，并逐一定义浏览器降级返回契约（抛错 / no-op / null）。完整清单见文末「调用集实证」。

### 接口契约（src/core/backend/types.ts）

```typescript
export interface BackendService {
  readonly kind: 'go' | 'browser';

  // —— 文件系统 / 模型 ——
  readFileBytes(path: string): Promise<Uint8Array | null>;
  // 浏览器侧：基于用户授权目录或 IndexedDB 缓存，path 为逻辑 key
  listModels(): Promise<ModelEntry[]>;
  extractArchive(buf: Uint8Array, dest: string): Promise<ExtractResult>;

  // —— 配置 / UI 状态持久化 ——
  getConfig(): Promise<Config>;
  setConfig(cfg: Partial<Config>): Promise<void>;
  getUIState(): Promise<UIState>;
  setUIState(s: Partial<UIState>): Promise<void>;

  // —— 场景存档 ——
  saveScene(name: string, data: Uint8Array): Promise<void>;
  loadScene(name: string): Promise<Uint8Array | null>;

  // —— 能力探测 ——
  // 三态能力矩阵见下方「能力矩阵（三态 × 能力键）」；浏览器侧按此显式降级
  capabilities(): BackendCapabilities;
  // BackendCapabilities = {
  //   ar: boolean;            // AR（ARCore/Vuforia）—— 原生独占
  //   externalApps: boolean;  // 外部程序（Blender/MMD/LaunchSoftware）
  //   plazaWindow: boolean;   // 模型广场窗口控制（Navigate/Close/Fetch/Download）
  //   fsAccess: boolean;      // File System Access API（showDirectoryPicker 等）
  //   watchDir: boolean;      // 目录监听（StartWatchDir/StopWatchDir）
  //   proxyServer: boolean;   // 代理（StartProxy/StopProxy）
  //   fileServer: boolean;    // 静态文件服务（StartFileServer/StopFileServer）
  //   systemDirOpen: boolean; // 系统文件管理器打开（OpenCacheDir/OpenScreenshotDir）
  //   storageMode: boolean;   // 存储模式切换（GetStorageMode/SetStorageMode 有意义）
  // }

  // —— 原生桥（可选，浏览器侧为 no-op）——
  events(): typeof Events | null; // 事件总线
}
```

### 适配器实现

| 文件 | 职责 |
|------|------|
| `src/core/backend/go-adapter.ts` | 将现有 `wails-bindings.ts` 的导出函数搬入，实现 `BackendService`；`capabilities()` 全开 |
| `src/core/backend/browser-adapter.ts` | 浏览器实现：File System Access API（`showDirectoryPicker`）+ IndexedDB（配置/存档/模型缓存）+ JSZip（解压）；`capabilities()` 按 `navigator` 探测 |
| `src/core/backend/index.ts` | `resolveBackend(): Promise<BackendService>`：先 `await awaitWailsBridge()`（ADR-017/159 桥接注入范式，消除 Android 冷启动竞态）再判定 `window.wails` 存在与否注入 `goAdapter`/`browserAdapter`，惰性单例。**禁止模块顶层同步 `export const backend = detectBackend()`**——Android 冷启动 `window.wails` 尚未注入会被误固化成 browser。业务统一 `const backend = await resolveBackend()`。为消除纯 Web 入口下 `awaitWailsBridge` 的 3s 超时等待，web 入口需置短路标记（如 `globalThis.__MMKU_WEB__ = true` 或 `import.meta.env.MODE === 'web'`）直接返回 `browserAdapter`。 |

### 接入点改造（按序，低风险）

0. **首屏数据源切换（最高优先）**：`init.ts` 首屏链 `GetConfig` / `GetSystemA11ySettings` / `CheckForUpdate` / `initLibrary`（Go 扫描）是后端调用最密集处。改为 `const backend = await resolveBackend()` 后取数；否则浏览器侧仍走 `fireAndForget → swallowError` 空壳路径（启动不崩但无配置/UI 状态/场景/模型库的跛脚壳）。
1. `wails-bindings.ts` 退化为仅 `export * from '@bindings/...'` + 类型，供 `go-adapter.ts` 内部使用；
2. 业务代码将 `import { readFileBytes } from '@/core/wails-bindings'` 改为 `import { resolveBackend } from '@/core/backend'`，调用 `const backend = await resolveBackend(); backend.readFileBytes(...)`（调用点由同步转异步，需逐处补 `await`）；
3. UI 降级：**新建 `isWebPlatform()`**（与 `isAndroidPlatform()` 并列，见 `platform.ts`），`guardExternalAction` 扩展为同挡 Android + Web；启动期 backend 选型必须用 `await resolveBackend()`（异步），运行时 UI 降级判定可用 `isWebPlatform()`/`isAndroidPlatform()` + `backend.capabilities()`（后者已稳定无竞态）；按 `capabilities()` 隐藏/禁用 AR、外部程序入口；
4. `web-loader` 升级为准完整页：复用 `browser-adapter` 接入模型库/设置/存档，作为网页侧主入口（`web-loader.html`）；入口处置 `globalThis.__MMKU_WEB__ = true` 短路桥接探测。

### 能力矩阵（三态 × 能力键）

平台由二态（desktop-wails / android-wails，二者均有 `window.wails`）升为三态（新增 browser-web）。单一 `isWeb` 布尔不足，故以能力键矩阵表达，缺失时 UI 统一降级。

> ⚠️ `isWebPlatform()` 为**同步**判定，Android 冷启动 `window.wails` 未注入时会被误判为 web；因此它**只用于运行时已稳定的 UI 降级判定**，启动期 backend 选型必须用 `await resolveBackend()`（异步 + `awaitWailsBridge`）。

| 能力键 | desktop-wails | android-wails | browser(web) | 缺失时 UI 降级表现 |
|--------|:---:|:---:|:---:|------|
| ar（ARCore/Vuforia） | ✅ | ✅ | ❌ | 隐藏 AR 入口 |
| externalApps（外部程序） | ✅ | ❌ | ❌ | 禁用 + tooltip「仅桌面支持」 |
| plazaWindow（广场窗口控制） | ✅ | ✅ | ⚠️ 部分（PlazaGo\* 网页可控，窗口级不可） | 隐藏窗口级控制，保留前进/后退/缩放 |
| fsAccess（File System Access API） | ❌（原生对话框） | ❌ | ⚠️ Chrome/Edge 支持，Firefox/Safari 不支持 | 回退上传/拖拽，或不支持浏览器禁用 + tooltip |
| watchDir（目录监听） | ✅ | ✅ | ❌ | 隐藏「下载自动导入」监听开关 |
| proxyServer（代理） | ✅ | ❌ | ❌ | 隐藏代理设置 |
| fileServer（静态文件服务） | ✅ | ❌ | ❌ | 隐藏 |
| systemDirOpen（系统文件管理器打开） | ✅ | ✅ | ❌ | 隐藏「打开目录」按钮 |
| storageMode（存储模式切换） | ✅ | ✅ | ❌（固定 'web'） | 隐藏存储模式切换 |
| screenshotSave（截图保存） | ✅ | ✅ | ✅（Canvas.toBlob + download） | — |
| cacheManage（缓存清理） | ✅ | ✅ | ✅（IndexedDB） | — |
| configPersist（配置持久化） | ✅ | ✅ | ✅（IndexedDB） | — |
| modelScan（模型库扫描） | ✅ | ✅ | ⚠️ FSA 授权目录替代 | 引导用户授权目录 |

> 原生独占须降级的函数清单见文末「调用集实证」③组（17 个）。`capabilities()` 须如实反映上表，UI 屏蔽规则据此生成，避免「幽灵入口」。

### 测试

- `backend` 接口契约单测：两套 adapter 对同一组输入产出可比对结果（mock 文件系统 / fake-indexeddb）；
- `resolveBackend()` 选型单测：`window.wails` 存在/缺失、Android 冷启动（桥接未注入）三路径；验证 `awaitWailsBridge` + Web 入口短路标记避免纯 Web 入口 3s 阻塞；
- 能力降级单测：浏览器 adapter 下 `capabilities().ar === false`、`.externalApps === false`，相关 UI 不渲染；
- `guardExternalAction` 单测：Android 与 Web 均返回 false，desktop 返回 true。

## 边界条件

- **不追求功能全等**：AR（ARCore/Vuforia）、外部程序（Blender/MMD）、系统级文件遍历属原生独占，浏览器侧必须降级，不得伪造。
- **聚合层不可再被业务直接 import**：业务只依赖 `BackendService` 接口，避免绕过适配器造成双源耦合。
- **`plaza-browser.ts` 独立保留**：模型广场走代理/iframe，属 WebView 内独立页面，不强制纳入适配器（仅其 Go 调用点如存在需同步收敛）。
- **持久化语义差异**：Go 侧为单机文件，浏览器侧为 IndexedDB（同源隔离），跨设备不互通——文档需明示。
- **Wails 生成的 `@bindings` 仍由 `wails3 generate bindings -ts` 维护**，`go-adapter.ts` 仅消费，不手改生成物。

## 审核发现（2026-07-23）

> 审核结论：有条件通过。方向与 chokepoint 判断正确，以下需在实施前回填修订。

### 数据流追踪
- **🔴 P1 接口覆盖落差**：`wails-bindings.ts:4` 为 `export * from '@bindings/app'` 全量透传（契约测试实测 **139** 函数；注释称 122、AGENTS 文档称 116，均已过时），业务 40+ 文件消费具体函数；`BackendService` 仅列 ~10 方法。「改造量小」建立在「接口窄」假设上，实际调用面远宽。**修订**：见文末「调用集实证（2026-07-23 实测）」——已 grep 业务对 139 函数的真实调用集为 **106**（非 ~10），`BackendService` 须覆盖 106 函数或显式降级 17 个原生独占函数；各函数的浏览器降级返回契约（抛错/no-op/null）须逐一定义。
- **🟠 P2 接入清单遗漏 init.ts**：首屏 `GetConfig`/`GetSystemA11ySettings`/`CheckForUpdate`/`initLibrary` 是后端调用最密集处，未列入「接入点改造」。**修订**：`init.ts` 列为第 0 步（首屏数据源切换），否则浏览器侧仍走 swallowError 空壳路径。**状态**：已回填——「接入点改造」新增第 0 步首屏数据源切换（`await resolveBackend()` 取数）。

### 生命周期
- **🔴 P1 detectBackend 时序竞态**：`platform.ts:26 awaitWailsBridge` 证明 Android 冷启动 `window.wails` 异步注入。若 `index.ts` 顶层 `export const backend = detectBackend()` 同步求值，Android 首个 import 该模块的业务会把 backend 固化为 browserAdapter → 误降级。**修订**：`detectBackend()` 改 async 内部 `await awaitWailsBridge()`，或导出 `getBackend(): Promise<BackendService>` 惰性单例；禁止模块顶层同步求值。**状态**：已回填至蓝图——「适配器实现」index.ts 行改 `resolveBackend(): Promise<BackendService>`（async + `awaitWailsBridge` + Web 入口短路标记），禁顶层同步求值；测试节同步改为 `resolveBackend()` 三路径单测。
- **🟢 P4 IndexedDB/句柄释放**：补 browser-adapter 的 dispose/close 契约（IndexedDB 连接、FS 目录句柄），与资源配对纪律对齐。

### 降级契约
- **🟠 P2 isWeb 判定不存在**：`platform.ts` 仅 `isAndroidPlatform()`，`guardExternalAction` 仅挡 Android。ADR L69「复用 isWeb 判定」表述与现实不符。**修订**：改为「新建 `isWebPlatform()`」，`guardExternalAction` 扩展为同挡 Android+Web。**状态**：已回填——步骤 3 改为新建 `isWebPlatform()` 并扩展 `guardExternalAction` 同挡 Android+Web；并注明 `isWebPlatform()` 同步判定在 Android 冷启动有竞态，仅用于运行时 UI 降级，启动期选型用 `await resolveBackend()`。
- **🟠 P2 三态平台 capabilities 矩阵缺失**：平台由二态（desktop-wails/android-wails）升为三态；单一 isWeb 布尔不足，Android 既有降级会与 Web 降级叠加。**修订**：补 capabilities 能力矩阵表（三态 × 各能力键）+ 能力缺失时 UI 统一降级表现（隐藏/禁用+tooltip）。**状态**：已回填——新增「能力矩阵（三态 × 能力键）」节，含 13 能力键 × 三态 + UI 降级表现 + `isWebPlatform()` 竞态警示。
- **🟡 P3 持久化边界**：补 IndexedDB 配额上限 + eviction 风险（模型数百 MB）、File System Access API 在 Firefox/Safari 不支持的兼容矩阵。
- **🟡 P3 契约测试边界**：明确 go-adapter 仍受 139 函数 + FNV-1a 契约约束，browser-adapter 只受 `BackendService` 接口契约约束（接口须覆盖 106 个真实调用函数）。

## 与现有架构的关系

- 复用 ADR-017 的 `isAndroidPlatform()` / `window.wails` 探测范式与 ADR-159 桥接注入范式；
- 复刻 `web-loader` 已验证的浏览器侧 PMX/zip 路径，避免重复造轮子；
- 不改变 Wails v3 桌面/安卓生产链路，仅在其外包裹一层可替换的 backend 抽象。

## 调用集实证（2026-07-23 实测）

> 目的：核验 P1①「改造量小」假设。方法：从 `app.contract.test.ts` 解析契约测试锁定的全量 Go 绑定函数，在业务源码中 grep 真实调用，按浏览器侧可行性分类。

**测量口径**
- 扫描范围：`frontend/src` 下全部 `.ts`，排除 `bindings/`（生成物）、`__tests__/`（测试）、`web-loader/`（独立另起炉灶实现）、`wails-bindings.ts`（聚合层自身）。
- 业务文件数：**247**。
- 契约测试基准集：**139** 函数（注释称 122、AGENTS 文档称 116，均已过时 —— 建议同步修正文档）。

**核心结果**

| 指标 | 数量 | 占比 |
|------|------|------|
| Go 绑定函数总数（契约测试） | 139 | 100% |
| **业务真实调用函数数** | **106** | 76% |
| ├ 浏览器侧可真实实现（IndexedDB / JSZip / Canvas） | 81 | 58% |
| ├ 经 File System Access 对话框替代 | 8 | 6% |
| └ 原生独占、须显式降级 | 17 | 12% |
| 未被业务调用的函数（可安全忽略） | 33 | 24% |

**结论**：ADR 蓝图原「~10 方法」假设被推翻。`BackendService` 接口须覆盖 **106** 个函数（81 实现 + 8 FSA 替代 + 17 降级），而非 10。改造面较原提案估算显著放大，但收敛性仍成立（chokepoint 在聚合层，业务调用集中于 106 函数）。

### 分组清单

**① 浏览器侧可真实实现（81）**
```
AddRecentModel, AddTag, BundleScene, CheckForUpdate, CleanOrphanCache, ClearAllCaches,
ClearExtractCache, ClearThumbnailCache, DeleteEnvPreset, DeleteModelPreset, DeletePresetScene,
ExtractZip, FileExists, GetAllTags, GetBuildInfo, GetCacheStats, GetConfig, GetDownloadAutoImport,
GetDownloadWatchEnabled, GetDownloadWatchStatus, GetLastBrowseDir, GetLibraryIndex, GetModelMetaBatch,
GetModelPresets, GetModelsByTag, GetPresetScenes, GetPresetScenesDir, GetRecentModels, GetRenderPresets,
GetStorageMode, GetSystemA11ySettings, GetTagsByModel, GetThumbnail, ImportLocalFile, ImportZip,
IsolateModelDir, ListDirRecursive, ListEnvPresets, ListSubDirs, LoadEnvPreset, LoadLastScene,
LoadModelPreset, LoadModelPresetFromLib, LoadOutfitFile, LoadSceneFile, SaveEnvPresetAuto, SaveLastScene,
SaveModelPreset, SaveModelPresetToLibAuto, SaveRenderPreset, SaveScenePreset, SaveScreenshot, SaveThumbnail,
ScanModelDir, SetBlenderPath, SetDisplayNamePriority, SetDownloadAutoImport, SetDownloadWatchEnabled,
SetEnvState, SetLastBrowseDir, SetMMDPath, SetOverridePath, SetPerformanceMode, SetResourceRoot,
SetStorageMode, SetUIAccent, SetUIAnimations, SetUIAutoUpdate, SetUIBlurBg, SetUIFontFamily, SetUIPopupWidth,
SetUIScale, SetUIState
```
> 注：`PlazaGoBack/Forward/Reload/Zoom*` 归此类（网页内 iframe 可控），但其依赖的窗口级 Plaza 能力见③。

**② 经 File System Access 对话框替代（8）**
```
SelectBundleSaveFile, SelectDir, SelectExeFile, SelectImportFile, SelectPresetOpenFile,
SelectPresetSaveFile, SelectRetargetFile, SelectSceneOpenFile
```
> 浏览器侧用 `showOpenFilePicker` / `showSaveFilePicker` / `showDirectoryPicker` 替代原生文件对话框。

**③ 原生独占、须显式降级（17）**
```
AddCustomSoftware, ClosePlazaWindow, DownloadFromPlaza, FetchPlazaConfig, GetCachedPlazaConfig,
LaunchSoftware, NavigatePlazaWindow, OpenCacheDir, OpenScreenshotDir, OpenWithSoftware,
RemoveCustomSoftware, ScanSoftwareDir, SetDownloadWatchDir, StartFileServer, StartProxy, StopProxy,
UpdateCustomSoftware
```
> 降级契约：`capabilities().externalApps === false` / `.plazaWindow === false` 时 UI 隐藏或禁用 + tooltip 说明；调用抛 `NotSupportedError` 或静默 no-op（依调用语义定）。

**④ 零调用（33，可安全不实现）**
```
DeleteRenderPreset, GetAppVersion, GetModelMeta, GetPath, GetThumbnailBatch, ListDir, OpenInBlender,
OpenInMMD, ReadFileBytes, RenameModelPreset, SaveEnvPreset, SaveModelPresetToLib, SaveSceneFile,
SelectAudioFile, SelectEnvTextureFile, SelectPMXFile, SelectVMDMotion, SelectVPDPose, SetWailsApp,
StartWatchDir, StopFileServer, StopWatchDir, ToggleFavorite, DeleteMotionPreset, GetMotionPresets,
LoadMotionPreset, LoadMotionPresetFromLib, RenameMotionPreset, SaveMotionPreset, SaveMotionPresetToLib,
SaveMotionPresetToLibAuto, SelectMotionPresetOpenFile, SelectMotionPresetSaveFile
```

**对实施的直接约束**
1. `browser-adapter.ts` 的方法表 = ① + ② + ③（共 106）；④ 不在接口内（go-adapter 仍按契约测试 139 全量实现）。
2. 每个 ③ 函数须定义显式降级行为，写入 `capabilities()` 矩阵与 UI 屏蔽规则。
3. 分类为粗粒度语义判定，实施前建议逐函数确认（尤其 ② 中 `SelectExeFile` 浏览器选 exe 无意义，可能改降级；`PlazaGo*` 与 ③ 的边界）。
